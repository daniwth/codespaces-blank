/**
 * Hash Harvest account server: accounts, Miner Pass subscriptions (Stripe or
 * demo billing) and cloud saves. Zero runtime dependencies: node:http + node:sqlite.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import {
  burnPasswordCheck, consumeEmailToken, createSession, hashPassword, issueEmailToken, needsRehash, newUserId, normalizeEmail,
  requireUser, revokeSession, validateCredentials, validatePassword, verifyPassword,
} from './auth.ts';
import {
  cancelBillingForDeletion, demoCancel, handleWebhook, isPlanId, onBillingStartup, openPortal, PLANS, publicUser,
  startCheckout, subscriptionOf,
} from './billing.ts';
import { billingMode, config, devBilling, mailMode } from './config.ts';
import { emailTokens, purgeWebhookEvents, saves, sessions, transaction, users, type UserRow } from './db.ts';
import {
  clientIp, createRateLimiter, HttpError, PAGE_CSP, readJson, readRawBody, SECURITY_HEADERS, sendError, sendJson, str,
} from './http.ts';
import { alreadyRegisteredMail, dispatchMail, resetMail, verifyMail } from './mail.ts';
import { inspectSave } from './saves.ts';
import { seedTestAccount, TEST_ACCOUNT } from './seed.ts';

/** Account creation per IP. */
const registerLimiter = createRateLimiter(10, 60_000);
/** Resend-verification and forgot-password requests per IP (429 does not depend on the account existing). */
const mailRequestLimiter = createRateLimiter(5, 10 * 60_000);
/**
 * Emails sent to one address per kind, so nobody can mail-bomb a victim. Over the cap the request
 * is still answered normally (202) and the email is silently skipped.
 */
const mailTargetLimiter = createRateLimiter(3, 60 * 60_000);
/** All login attempts per IP (throttles credential stuffing across many emails). */
const loginIpLimiter = createRateLimiter(30, 60_000);
/**
 * Failed logins per (email, IP) pair: only failures count and a success resets
 * it, so a third party cannot lock a victim out of their own account.
 */
const loginFailLimiter = createRateLimiter(10, 10 * 60_000);
const sensitiveLimiter = createRateLimiter(10, 60_000);
const saveLimiter = createRateLimiter(30, 60_000);

/** True while `key` is under its cap (counts one use); never throws. */
const allow = (limiter: ReturnType<typeof createRateLimiter>, key: string): boolean => {
  try {
    limiter.hit(key);
    return true;
  } catch {
    return false;
  }
};

/** Emails a fresh single-use verification link. Returns the dev link when allowed. */
function sendVerification(user: UserRow): string | undefined {
  if (!allow(mailTargetLimiter, `verify:${user.email}`)) return undefined;
  const link = `${config.appUrl}/?verify=${issueEmailToken(user.id, 'verify')}`;
  return dispatchMail(verifyMail(user.email, link), link);
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const routes: Record<string, Handler> = {
  'GET /api/health': async (_req, res) => sendJson(res, 200, { ok: true }),

  'GET /api/plans': async (_req, res) =>
    sendJson(res, 200, {
      devBilling,
      plans: Object.values(PLANS).map(({ stripePriceId: _price, ...p }) => p),
    }),

  // The answer never depends on whether the email is already registered (same status, same body shape,
  // password hashed before the lookup so the timing matches); the outcome only travels by email.
  'POST /api/auth/register': async (req, res) => {
    registerLimiter.hit(clientIp(req));
    const body = await readJson(req);
    const email = normalizeEmail(str(body.email, 'email', 254));
    const password = str(body.password, 'password', 200);
    validateCredentials(email, password);
    const passwordHash = await hashPassword(password);
    let user = users.byEmail(email);
    let created = false;
    if (!user) {
      try {
        users.insert(newUserId(), email, passwordHash);
        created = true;
      } catch {
        // Lost a race with a concurrent sign-up for the same address: handled as an existing account.
      }
      user = users.byEmail(email);
    }
    if (!user) throw new HttpError(500, 'internal', 'Could not create account.');
    let devLink: string | undefined;
    if (created) {
      devLink = sendVerification(user);
    } else if (user.email_verified === 0) {
      // A sign-up nobody confirmed holds no data: the latest password wins, so whoever owns the
      // mailbox ends up with the password they chose (an earlier squatter cannot pre-set it).
      users.setPasswordHash(user.id, passwordHash);
      devLink = sendVerification(user);
    } else if (allow(mailTargetLimiter, `already:${email}`)) {
      devLink = dispatchMail(alreadyRegisteredMail(email, `${config.appUrl}/`), `${config.appUrl}/`);
    }
    sendJson(res, 202, { accepted: true, ...(devLink ? { devLink } : {}) });
  },

  'POST /api/auth/verify': async (req, res) => {
    sensitiveLimiter.hit(`verify:${clientIp(req)}`);
    const body = await readJson(req);
    const userId = consumeEmailToken(str(body.token, 'token', 128), 'verify');
    if (!userId) throw new HttpError(400, 'invalid_token', 'This link is invalid or has expired.');
    users.markVerified(userId);
    const user = users.byId(userId);
    if (!user) throw new HttpError(400, 'invalid_token', 'This link is invalid or has expired.');
    const session = createSession(user.id);
    sendJson(res, 200, { token: session.token, expiresAt: session.expiresAt, user: publicUser(user) });
  },

  'POST /api/auth/resend': async (req, res) => {
    mailRequestLimiter.hit(`resend:${clientIp(req)}`);
    const body = await readJson(req);
    const user = users.byEmail(normalizeEmail(str(body.email, 'email', 254)));
    const devLink = user && user.email_verified === 0 ? sendVerification(user) : undefined;
    sendJson(res, 202, { accepted: true, ...(devLink ? { devLink } : {}) });
  },

  'POST /api/auth/forgot': async (req, res) => {
    mailRequestLimiter.hit(`forgot:${clientIp(req)}`);
    const body = await readJson(req);
    const user = users.byEmail(normalizeEmail(str(body.email, 'email', 254)));
    let devLink: string | undefined;
    if (user && allow(mailTargetLimiter, `reset:${user.email}`)) {
      const link = `${config.appUrl}/?reset=${issueEmailToken(user.id, 'reset')}`;
      devLink = dispatchMail(resetMail(user.email, link), link);
    }
    sendJson(res, 202, { accepted: true, ...(devLink ? { devLink } : {}) });
  },

  'POST /api/auth/reset': async (req, res) => {
    sensitiveLimiter.hit(`reset:${clientIp(req)}`);
    const body = await readJson(req);
    const token = str(body.token, 'token', 128);
    const password = str(body.password, 'password', 200);
    validatePassword(password);
    const passwordHash = await hashPassword(password);
    const done = transaction(() => {
      const userId = consumeEmailToken(token, 'reset');
      if (!userId) return false;
      users.setPasswordHash(userId, passwordHash);
      users.markVerified(userId); // reading the reset email proves the mailbox
      sessions.removeAllForUser(userId);
      emailTokens.removeAllForUser(userId);
      return true;
    });
    if (!done) throw new HttpError(400, 'invalid_token', 'This link is invalid or has expired.');
    sendJson(res, 200, { ok: true });
  },

  'POST /api/auth/login': async (req, res) => {
    const body = await readJson(req);
    const email = normalizeEmail(str(body.email, 'email', 254));
    const ip = clientIp(req);
    const failKey = `${email}|${ip}`;
    loginIpLimiter.hit(ip);
    loginFailLimiter.check(failKey);
    const password = str(body.password, 'password', 200);
    const user = users.byEmail(email);
    const ok = user ? await verifyPassword(password, user.password_hash) : (await burnPasswordCheck(password), false);
    if (!user || !ok) {
      loginFailLimiter.hit(failKey);
      throw new HttpError(401, 'bad_credentials', 'Wrong email or password.');
    }
    loginFailLimiter.reset(failKey);
    // Only reachable with the right password, so this reveals nothing to someone who does not hold it.
    if (!user.email_verified) throw new HttpError(403, 'email_not_verified', 'Confirm your email first: check your inbox or request a new link.');
    if (needsRehash(user.password_hash)) users.setPasswordHash(user.id, await hashPassword(password));
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
    sensitiveLimiter.hit(`del:${user.id}`);
    const body = await readJson(req);
    if (!(await verifyPassword(str(body.password, 'password', 200), user.password_hash))) {
      throw new HttpError(401, 'bad_credentials', 'Wrong password.');
    }
    // Cancel any subscription that could still charge before the account disappears.
    await cancelBillingForDeletion(user);
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
    saveLimiter.hit(user.id);
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
  let urlPath: string;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    throw new HttpError(400, 'bad_request', 'Malformed URL.');
  }
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let file = join(config.staticDir, safe);
  if (!file.startsWith(config.staticDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(config.staticDir, 'index.html');
  if (!existsSync(file)) return false;
  const immutable = file.includes(`${join(config.staticDir, 'assets')}`);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Security-Policy': PAGE_CSP,
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}

// ───────────────────────── Server ─────────────────────────

const server = createServer({ maxHeaderSize: 8 * 1024 }, async (req, res) => {
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

setInterval(() => {
  sessions.purgeExpired();
  emailTokens.purgeExpired();
  users.purgeUnverified(7 * 86_400_000);
  purgeWebhookEvents(90 * 86_400_000);
}, 3_600_000).unref();
onBillingStartup();
// Development servers only (see seed.ts): a ready-made login to test the gem features. Seeded before
// the port opens, so the account is there for the very first request.
const seeded = await seedTestAccount();
if (seeded === 'removed') console.log(`[server] removed the development test account "${TEST_ACCOUNT.login}": it is not allowed on this server`);
else if (seeded !== 'skipped') console.log(`[server] test account ${seeded}: "${TEST_ACCOUNT.login}" / "${TEST_ACCOUNT.password}" (dev only; SEED_TEST_ACCOUNT=0 disables it)`);

server.listen(config.port, () => {
  console.log(`[server] Hash Harvest accounts on http://localhost:${config.port}`);
  console.log(`[server] billing mode: ${billingMode} · mail mode: ${mailMode}${config.trustProxyHops ? ` · trusting ${config.trustProxyHops} proxy hop(s)` : ''}`);
});
