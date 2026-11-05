/**
 * Hash Harvest account server: accounts, Miner Pass subscriptions (Stripe or
 * demo billing) and cloud saves. Zero runtime dependencies: node:http + node:sqlite.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import {
  burnPasswordCheck, createSession, hashPassword, newUserId, normalizeEmail, requireUser, revokeSession,
  validateCredentials, verifyPassword,
} from './auth.ts';
import { demoCancel, handleWebhook, isPlanId, openPortal, PLANS, publicUser, startCheckout, subscriptionOf } from './billing.ts';
import { config, devBilling } from './config.ts';
import { saves, sessions, transaction, users } from './db.ts';
import { clientIp, createRateLimiter, HttpError, readJson, readRawBody, sendError, sendJson, str } from './http.ts';
import { inspectSave } from './saves.ts';

const authLimiter = createRateLimiter(10, 60_000);
const saveLimiter = createRateLimiter(30, 60_000);

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const routes: Record<string, Handler> = {
  'GET /api/health': async (_req, res) => sendJson(res, 200, { ok: true, devBilling }),

  'GET /api/plans': async (_req, res) =>
    sendJson(res, 200, {
      devBilling,
      plans: Object.values(PLANS).map(({ stripePriceId: _price, ...p }) => p),
    }),

  'POST /api/auth/register': async (req, res) => {
    authLimiter(`reg:${clientIp(req)}`);
    const body = await readJson(req);
    const email = normalizeEmail(str(body.email, 'email', 254));
    const password = str(body.password, 'password', 200);
    validateCredentials(email, password);
    if (users.byEmail(email)) throw new HttpError(409, 'email_taken', 'An account with this email already exists.');
    const passwordHash = await hashPassword(password);
    const id = newUserId();
    try {
      users.insert(id, email, passwordHash);
    } catch {
      throw new HttpError(409, 'email_taken', 'An account with this email already exists.');
    }
    const session = createSession(id);
    const user = users.byId(id);
    if (!user) throw new HttpError(500, 'internal', 'Could not create account.');
    sendJson(res, 201, { token: session.token, expiresAt: session.expiresAt, user: publicUser(user) });
  },

  'POST /api/auth/login': async (req, res) => {
    const body = await readJson(req);
    const email = normalizeEmail(str(body.email, 'email', 254));
    authLimiter(`login:${clientIp(req)}`);
    authLimiter(`login:${email}`);
    const password = str(body.password, 'password', 200);
    const user = users.byEmail(email);
    if (!user) {
      await burnPasswordCheck(password);
      throw new HttpError(401, 'bad_credentials', 'Wrong email or password.');
    }
    if (!(await verifyPassword(password, user.password_hash))) throw new HttpError(401, 'bad_credentials', 'Wrong email or password.');
    const session = createSession(user.id);
    sendJson(res, 200, { token: session.token, expiresAt: session.expiresAt, user: publicUser(user) });
  },

  'POST /api/auth/logout': async (req, res) => {
    revokeSession(req);
    sendJson(res, 200, { ok: true });
  },

  'GET /api/me': async (req, res) => {
    const user = requireUser(req);
    sendJson(res, 200, { user: publicUser(user), save: saves.meta(user.id) });
  },

  'DELETE /api/me': async (req, res) => {
    const user = requireUser(req);
    authLimiter(`del:${user.id}`);
    const body = await readJson(req);
    if (!(await verifyPassword(str(body.password, 'password', 200), user.password_hash))) {
      throw new HttpError(401, 'bad_credentials', 'Wrong password.');
    }
    if (subscriptionOf(user).active && !devBilling && !user.cancel_at_period_end) {
      throw new HttpError(409, 'active_subscription', 'Cancel your Miner Pass in the billing portal before deleting the account.');
    }
    users.remove(user.id);
    sendJson(res, 200, { ok: true });
  },

  'POST /api/billing/checkout': async (req, res) => {
    const user = requireUser(req);
    const body = await readJson(req);
    if (!isPlanId(body.plan)) throw new HttpError(400, 'invalid_plan', 'Unknown plan.');
    const result = await startCheckout(user, body.plan);
    const fresh = users.byId(user.id) ?? user;
    sendJson(res, 200, { ...result, user: publicUser(fresh) });
  },

  'POST /api/billing/portal': async (req, res) => {
    const user = requireUser(req);
    sendJson(res, 200, await openPortal(user));
  },

  'POST /api/billing/cancel': async (req, res) => {
    const user = requireUser(req);
    demoCancel(user);
    sendJson(res, 200, { user: publicUser(users.byId(user.id) ?? user) });
  },

  'POST /api/billing/webhook': async (req, res) => {
    const raw = await readRawBody(req, 512 * 1024);
    const sig = req.headers['stripe-signature'];
    await handleWebhook(raw, Array.isArray(sig) ? sig[0] : sig);
    sendJson(res, 200, { received: true });
  },

  // Reading your cloud save is always allowed (you never lose progress);
  // writing requires an active Miner Pass.
  'GET /api/save': async (req, res) => {
    const user = requireUser(req);
    const row = saves.get(user.id);
    if (!row) throw new HttpError(404, 'no_save', 'No cloud save yet.');
    sendJson(res, 200, { blob: row.blob, revision: row.revision, updatedAt: row.updated_at, summary: JSON.parse(row.summary) as unknown });
  },

  'PUT /api/save': async (req, res) => {
    const user = requireUser(req);
    saveLimiter(`save:${user.id}`);
    if (!subscriptionOf(user).active) {
      throw new HttpError(402, 'subscription_required', 'Cloud saving requires an active Miner Pass.');
    }
    const body = await readJson(req, config.maxSaveBytes + 1024);
    const blob = str(body.blob, 'blob', config.maxSaveBytes);
    const baseRevision = body.baseRevision === null || body.baseRevision === undefined ? null : Number(body.baseRevision);
    const force = body.force === true;
    const info = inspectSave(blob);
    const result = transaction(() => {
      const current = saves.meta(user.id);
      if (current && !force && current.revision !== baseRevision) {
        return { conflict: current };
      }
      const revision = (current?.revision ?? 0) + 1;
      saves.upsert(user.id, blob, info.checksum, info.version, revision, info.summary);
      return { conflict: null, meta: saves.meta(user.id) };
    });
    if (result.conflict) {
      throw new HttpError(409, 'save_conflict', 'The cloud save changed on another device.', result.conflict);
    }
    sendJson(res, 200, { save: result.meta });
  },
};

// ───────────────────────── Static frontend (production) ─────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  if (!existsSync(config.staticDir) || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let file = join(config.staticDir, safe);
  if (!file.startsWith(config.staticDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(config.staticDir, 'index.html');
  if (!existsSync(file)) return false;
  const immutable = file.includes(`${join(config.staticDir, 'assets')}`);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}

// ───────────────────────── Server ─────────────────────────

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  try {
    if (path.startsWith('/api/')) {
      const handler = routes[`${req.method} ${path}`];
      if (!handler) throw new HttpError(404, 'not_found', 'Unknown endpoint.');
      await handler(req, res);
      return;
    }
    if (!serveStatic(req, res)) sendJson(res, 404, { error: { code: 'not_found', message: 'Not found.' } });
  } catch (err) {
    sendError(res, err);
  }
});

setInterval(() => sessions.purgeExpired(), 3_600_000).unref();

server.listen(config.port, () => {
  console.log(`[server] Hash Harvest accounts on http://localhost:${config.port}`);
  console.log(`[server] billing: ${devBilling ? 'DEMO mode (no STRIPE_SECRET_KEY, no real charges)' : 'Stripe live/test keys'}`);
});
