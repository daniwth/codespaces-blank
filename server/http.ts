import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { config } from './config.ts';

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

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  ...(config.appUrl.startsWith('https://') ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

/** CSP for the static app: own scripts/workers, Google Fonts, data: sprites. */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
].join('; ');

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

/**
 * Client IP used for rate limiting. X-Forwarded-For is attacker-controlled, so
 * it is only honoured when TRUST_PROXY=<hops> is set, and then we take the entry
 * appended by the closest trusted proxy (counting from the right).
 */
export function clientIp(req: IncomingMessage): string {
  const socketIp = req.socket.remoteAddress ?? 'unknown';
  if (config.trustProxyHops <= 0) return socketIp;
  const header = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(header) ? header.join(',') : header ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const candidate = chain[chain.length - config.trustProxyHops];
  return candidate && isIP(candidate) ? candidate : socketIp;
}

/** Short fixed-size key so attacker-supplied strings never bloat memory. */
const limiterKey = (key: string): string => createHash('sha256').update(key).digest('base64url').slice(0, 22);

export interface RateLimiter {
  /** Counts a hit and throws 429 when over the limit. */
  hit: (key: string) => void;
  /** Throws 429 if the key is already over the limit, without counting. */
  check: (key: string) => void;
  reset: (key: string) => void;
}

/** Fixed-window in-memory rate limiter with a hard cap on tracked keys. */
export function createRateLimiter(max: number, windowMs: number, maxKeys = 20_000): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const blocked = (entry: { count: number; resetAt: number }, now: number) => {
    throw new HttpError(429, 'rate_limited', `Too many attempts. Try again in ${Math.ceil((entry.resetAt - now) / 1000)}s.`);
  };
  return {
    hit: (raw) => {
      const key = limiterKey(raw);
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        if (entry) hits.delete(key);
        // Map keeps insertion order: evict the oldest windows first (O(1)).
        while (hits.size >= maxKeys) {
          const oldest = hits.keys().next().value;
          if (oldest === undefined) break;
          hits.delete(oldest);
        }
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return;
      }
      entry.count += 1;
      if (entry.count > max) blocked(entry, now);
    },
    check: (raw) => {
      const now = Date.now();
      const entry = hits.get(limiterKey(raw));
      if (entry && entry.resetAt > now && entry.count >= max) blocked(entry, now);
    },
    reset: (raw) => {
      hits.delete(limiterKey(raw));
    },
  };
}

/** Caps concurrent CPU-heavy work (scrypt) so floods queue or get 503 instead of starving the server. */
export function createSemaphore(concurrency: number, maxQueue: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const acquire = async (): Promise<void> => {
    if (active < concurrency) {
      active += 1;
      return;
    }
    if (queue.length >= maxQueue) throw new HttpError(503, 'busy', 'Server busy, please retry in a moment.');
    // The slot is handed over directly by release(), so no one can jump the queue.
    await new Promise<void>((resolve) => queue.push(resolve));
  };
  const release = (): void => {
    const next = queue.shift();
    if (next) next();
    else active -= 1;
  };
  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
