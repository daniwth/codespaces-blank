import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  console.error('[server] unexpected error', err);
  sendJson(res, 500, { error: { code: 'internal', message: 'Internal server error.' } });
}

export async function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new HttpError(413, 'payload_too_large', `Request body exceeds ${limit} bytes.`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req, limit);
  if (raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'bad_json', 'Request body must be a JSON object.');
  }
}

export const str = (v: unknown, field: string, max = 512): string => {
  if (typeof v !== 'string' || v.length === 0) throw new HttpError(400, 'invalid_field', `"${field}" is required.`);
  if (v.length > max) throw new HttpError(400, 'invalid_field', `"${field}" is too long.`);
  return v;
};

export function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
  return (first ?? req.socket.remoteAddress ?? 'unknown').trim();
}

/** Fixed-window in-memory rate limiter (per process). */
export function createRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): void => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      return;
    }
    entry.count += 1;
    if (entry.count > max) {
      throw new HttpError(429, 'rate_limited', `Too many attempts. Try again in ${Math.ceil((entry.resetAt - now) / 1000)}s.`);
    }
  };
}
