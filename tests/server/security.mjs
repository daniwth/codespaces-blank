/**
 * Server security & billing integration test. Spins up a fake Stripe API and
 * the real account server, then replays the attacks from the security audit.
 * Run: node tests/server/security.mjs  (exit code 1 on any failure)
 */
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Base port (7 consecutive ports are used); override with SEC_PORT_BASE for parallel runs. */
const BASE = Number(process.env.SEC_PORT_BASE ?? 8781);
const P = { fake: BASE, demo: BASE + 1, prod: BASE + 2, live: BASE + 3, mail: BASE + 4, mailApi: BASE + 5, httpMail: BASE + 6 };
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(true);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

// ── Fake Stripe ──
const subs = new Map();
let stripeDown = false;
const fake = createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (stripeDown) return send(500, { error: { message: 'Invalid API Key provided: sk_live_****SECRET' } });
  const m = /^\/v1\/subscriptions\/([\w-]+)$/.exec(req.url);
  if (m && req.method === 'GET') return subs.has(m[1]) ? send(200, subs.get(m[1])) : send(404, { error: { message: 'No such subscription' } });
  if (m && req.method === 'DELETE') {
    const s = subs.get(m[1]);
    if (!s) return send(404, { error: { message: 'none' } });
    s.status = 'canceled';
    return send(200, s);
  }
  if (m && req.method === 'POST') {
    const s = subs.get(m[1]);
    s.cancel_at_period_end = new URLSearchParams(body).get('cancel_at_period_end') === 'true';
    return send(200, s);
  }
  if (req.url === '/v1/customers') return send(200, { id: 'cus_test' });
  // Slow enough that two concurrent checkout requests overlap.
  if (req.url === '/v1/checkout/sessions') return void setTimeout(() => send(200, { url: 'https://checkout.stripe.com/c/test' }), 150);
  send(404, { error: { message: 'unknown' } });
});
await new Promise((r) => fake.listen(P.fake, r));

// ── Fake transactional-mail API (Resend-style) ──
const inbox = [];
let mailApiDown = false;
const mailApi = createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (mailApiDown) {
    res.writeHead(500).end();
    return;
  }
  inbox.push({ url: req.url, method: req.method, auth: req.headers.authorization, type: req.headers['content-type'], body: JSON.parse(body) });
  res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"id":"mail_1"}');
});
await new Promise((r) => mailApi.listen(P.mailApi, r));
const waitInbox = async (n) => {
  for (let i = 0; i < 100 && inbox.length < n; i += 1) await new Promise((r) => setTimeout(r, 30));
  return inbox.length >= n;
};
const linkParam = (link, name) => new URL(link).searchParams.get(name);

const SECRET = 'whsec_test';
const mkSub = (id, userId, status, price = 'price_month', extra = {}) => {
  const s = { id, customer: 'cus_test', status, cancel_at_period_end: false, metadata: { userId }, items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, price: { id: price } }] }, ...extra };
  subs.set(id, s);
  return s;
};

const dataDir = mkdtempSync(join(tmpdir(), 'hht-sec-'));
const procs = [];
const start = (port, env) =>
  new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--no-warnings', 'server/index.ts'], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, STATIC_DIR: join(process.cwd(), 'dist'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    let out = '';
    p.stdout.on('data', (d) => {
      out += d;
      if (out.includes('accounts on')) resolve(p);
    });
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => reject(Object.assign(new Error(`exit ${code}`), { out })));
  });
const stop = async (p) => {
  p.kill();
  await new Promise((r) => p.once('exit', r));
};

const api = (port) => async (method, path, body, headers = {}) => {
  const res = await fetch(`http://localhost:${port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
};
/** Registers and confirms an account through the emailed (dev) link; returns the verification session. */
const signup = async (call, email, password = 'password123', headers = {}) => {
  const reg = await call('POST', '/auth/register', { email, password }, headers);
  assert(reg.status === 202 && reg.json?.devLink, `register ${email}: ${reg.status} ${JSON.stringify(reg.json)}`);
  const ver = await call('POST', '/auth/verify', { token: linkParam(reg.json.devLink, 'verify') });
  assert(ver.status === 200 && ver.json?.token, `verify ${email}: ${ver.status} ${JSON.stringify(ver.json)}`);
  return ver.json;
};
const signed = (event) => {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', SECRET).update(`${t}.${payload}`).digest('hex');
  return { payload, headers: { 'Stripe-Signature': `t=${t},v1=${v1}` } };
};

console.log('Server security & billing tests');
try {
  // ── Demo mode ──
  let demo = await start(P.demo, { STRIPE_SECRET_KEY: '', TRUST_PROXY: '0' });
  const d = api(P.demo);

  await check('X-Forwarded-For rotation does not bypass the register limit', async () => {
    const codes = [];
    for (let i = 0; i < 12; i += 1) codes.push((await d('POST', '/auth/register', { email: `xff${i}@x.io`, password: 'password123' }, { 'X-Forwarded-For': `10.0.0.${i}` })).status);
    assert(codes.includes(429), `no 429 in ${codes}`);
  });

  await check('huge spoofed X-Forwarded-For headers do not grow memory', async () => {
    const junk = 'a'.repeat(7000);
    const before = (await d('GET', '/health')).status;
    let tooLarge = 0;
    for (let i = 0; i < 300; i += 1) {
      const r = await fetch(`http://localhost:${P.demo}/api/auth/register`, { method: 'POST', headers: { 'X-Forwarded-For': `${junk}${i}` } }).catch(() => null);
      if (!r || r.status === 429 || r.status === 400 || r.status === 431) tooLarge += 1;
    }
    assert(before === 200 && tooLarge === 300, `unexpected responses (${tooLarge}/300)`);
  });

  await check('malformed URI answers 400, not 500', async () => {
    const r = await fetch(`http://localhost:${P.demo}/%E0%A4%A`);
    assert(r.status === 400 || r.status === 404, `got ${r.status}`);
  });

  await check('static pages ship CSP and frame protections', async () => {
    const r = await fetch(`http://localhost:${P.demo}/`);
    if (r.status === 404) return; // dist not built
    assert(/frame-ancestors 'none'/.test(r.headers.get('content-security-policy') ?? ''), 'missing CSP');
    assert(r.headers.get('x-frame-options') === 'DENY', 'missing XFO');
  });

  await check('demo: cancel then re-subscribe resumes instead of stacking', async () => {
    await stop(demo);
    demo = await start(P.demo, { STRIPE_SECRET_KEY: '', TRUST_PROXY: '1' });
    const reg = { json: await signup(d, 'demo@x.io', 'password123', { 'X-Forwarded-For': '203.0.113.9' }) };
    const auth = { Authorization: `Bearer ${reg.json.token}` };
    await d('POST', '/billing/checkout', { plan: 'monthly' }, auth);
    await d('POST', '/billing/cancel', {}, auth);
    const again = await d('POST', '/billing/checkout', { plan: 'monthly' }, auth);
    assert(again.json?.reactivated === true && again.json.user.subscription.cancelAtPeriodEnd === false, JSON.stringify(again.json));
  });

  await check('a third party cannot lock a victim out (TRUST_PROXY=1)', async () => {
    await signup(d, 'victim@x.io', 'password123', { 'X-Forwarded-For': '198.51.100.1' });
    for (let i = 0; i < 12; i += 1) await d('POST', '/auth/login', { email: 'victim@x.io', password: 'wrong-pass' }, { 'X-Forwarded-For': '192.0.2.66' });
    const victim = await d('POST', '/auth/login', { email: 'victim@x.io', password: 'password123' }, { 'X-Forwarded-For': '198.51.100.1' });
    assert(victim.status === 200, `victim got ${victim.status}`);
    const attacker = await d('POST', '/auth/login', { email: 'victim@x.io', password: 'password123' }, { 'X-Forwarded-For': '192.0.2.66' });
    assert(attacker.status === 429, `attacker pair should be blocked, got ${attacker.status}`);
  });
  await stop(demo);

  await check('refuses to start in production without Stripe key', async () => {
    const r = await start(P.prod, { STRIPE_SECRET_KEY: '', NODE_ENV: 'production' }).then(() => 'started', (e) => e.out);
    assert(r !== 'started' && /Refusing to start/.test(r), `unexpected: ${r}`);
  });

  // ── Stripe mode (fake API) ──
  const stripeEnv = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_MONTHLY: 'price_month', STRIPE_PRICE_YEARLY: 'price_year', STRIPE_API_BASE: `http://localhost:${P.fake}` };
  const live = await start(P.live, stripeEnv);
  const s = api(P.live);

  await check('demo subscriptions are voided when real billing starts', async () => {
    const login = await s('POST', '/auth/login', { email: 'demo@x.io', password: 'password123' });
    assert(login.status === 200, `login ${login.status}`);
    assert(login.json.user.subscription.active === false, JSON.stringify(login.json.user.subscription));
  });

  const reg = { json: await signup(s, 'payer@x.io') };
  const uid = reg.json.user.id;
  const auth = { Authorization: `Bearer ${reg.json.token}` };
  const hook = (event) => {
    const { payload, headers } = signed(event);
    return s('POST', '/billing/webhook', payload, headers);
  };

  await check('concurrent checkouts open only one Stripe session', async () => {
    const [a, b] = await Promise.all([s('POST', '/billing/checkout', { plan: 'monthly' }, auth), s('POST', '/billing/checkout', { plan: 'monthly' }, auth)]);
    const codes = [a.status, b.status].sort();
    assert(codes[0] === 200 && codes[1] === 409, `got ${codes}`);
    const after = await s('POST', '/billing/checkout', { plan: 'monthly' }, auth);
    assert(after.status === 200, `lock not released: ${after.status}`);
  });

  await check('webhook failure is retried instead of silently lost', async () => {
    mkSub('sub_A', uid, 'active');
    stripeDown = true;
    const first = await hook({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: uid, customer: 'cus_test', subscription: 'sub_A' } } });
    stripeDown = false;
    assert(first.status >= 500, `first delivery should fail, got ${first.status}`);
    assert(!JSON.stringify(first.json).includes('sk_live'), 'Stripe error leaked to client');
    const retry = await hook({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: uid, customer: 'cus_test', subscription: 'sub_A' } } });
    assert(retry.status === 200, `retry ${retry.status}`);
    const me = await s('GET', '/me', undefined, auth);
    assert(me.json.user.subscription.active, 'not activated after retry');
  });

  await check('out-of-order events cannot downgrade the state', async () => {
    const r = await hook({ id: 'evt_2', type: 'customer.subscription.created', data: { object: { id: 'sub_A', status: 'incomplete' } } });
    assert(r.status === 200, `status ${r.status}`);
    const me = await s('GET', '/me', undefined, auth);
    assert(me.json.user.subscription.active, 'stale payload overwrote the authoritative state');
  });

  await check('a second checkout is refused while a subscription is live', async () => {
    const r = await s('POST', '/billing/checkout', { plan: 'yearly' }, auth);
    assert(r.status === 409, `got ${r.status}`);
  });

  await check('cancel-at-period-end + checkout resumes the same subscription', async () => {
    subs.get('sub_A').cancel_at_period_end = true;
    await hook({ id: 'evt_3', type: 'customer.subscription.updated', data: { object: { id: 'sub_A' } } });
    const r = await s('POST', '/billing/checkout', { plan: 'monthly' }, auth);
    assert(r.status === 200 && r.json.reactivated === true && subs.get('sub_A').cancel_at_period_end === false, JSON.stringify(r.json));
  });

  await check('events for a different (stale) subscription are ignored', async () => {
    mkSub('sub_OLD', uid, 'canceled');
    await hook({ id: 'evt_4', type: 'customer.subscription.deleted', data: { object: { id: 'sub_OLD' } } });
    const me = await s('GET', '/me', undefined, auth);
    assert(me.json.user.subscription.active, 'stale deleted event revoked access');
  });

  await check('subscriptions to other products never grant a Miner Pass', async () => {
    const other = { json: await signup(s, 'other@x.io') };
    mkSub('sub_X', other.json.user.id, 'active', 'price_SOMETHING_ELSE');
    await hook({ id: 'evt_5', type: 'customer.subscription.created', data: { object: { id: 'sub_X' } } });
    const me = await s('GET', '/me', undefined, { Authorization: `Bearer ${other.json.token}` });
    assert(!me.json.user.subscription.active, 'foreign price activated the pass');
  });

  await check('malformed signed webhook answers 400', async () => {
    const r = await hook({ id: 'evt_bad', type: 'x' });
    assert(r.status === 400, `got ${r.status}`);
  });

  await check('account deletion keeps the account if Stripe cancel fails', async () => {
    stripeDown = true;
    const r = await s('DELETE', '/me', { password: 'password123' }, auth);
    stripeDown = false;
    assert(r.status === 502, `got ${r.status}`);
    assert((await s('GET', '/me', undefined, auth)).status === 200, 'account was deleted anyway');
  });

  await check('account deletion cancels the live Stripe subscription', async () => {
    const r = await s('DELETE', '/me', { password: 'password123' }, auth);
    assert(r.status === 200, `got ${r.status}`);
    assert(subs.get('sub_A').status === 'canceled', 'subscription still billable');
  });

  await stop(live);

  // ── Email verification & password reset (log mailer, dev links) ──
  const mailSrv = await start(P.mail, { STRIPE_SECRET_KEY: '', TRUST_PROXY: '1', MAIL_MODE: 'log' });
  const m = api(P.mail);
  let ipSeq = 0;
  const freshIp = () => ({ 'X-Forwarded-For': `203.0.113.${(ipSeq += 1)}` });
  const db = new DatabaseSync(join(dataDir, 'hash-harvest.db'));
  const login = (email, password, headers) => m('POST', '/auth/login', { email, password }, headers ?? freshIp());

  await check('register answers identically for a new and an already-registered email (no token, no oracle)', async () => {
    const ip = freshIp();
    const fresh = await m('POST', '/auth/register', { email: 'oracle@x.io', password: 'password123' }, ip);
    await m('POST', '/auth/verify', { token: linkParam(fresh.json.devLink, 'verify') });
    const again = await m('POST', '/auth/register', { email: 'oracle@x.io', password: 'another-pass1' }, ip);
    const unknown = await m('POST', '/auth/register', { email: 'oracle2@x.io', password: 'password123' }, ip);
    assert(fresh.status === 202 && again.status === 202 && unknown.status === 202, `${fresh.status}/${again.status}/${unknown.status}`);
    const shape = (r) => Object.keys(r.json).sort().join(',');
    assert(shape(fresh) === shape(again) && shape(again) === shape(unknown), `body shapes differ: ${shape(fresh)} | ${shape(again)} | ${shape(unknown)}`);
    assert(!('token' in fresh.json) && !('user' in again.json), 'register must not issue a session');
    assert(!JSON.stringify(again.json).includes('verify='), 'existing account leaked a verification token');
    // The "you already have an account" mail changes nothing: the original password still works, the new one does not.
    assert((await login('oracle@x.io', 'password123')).status === 200, 'original password stopped working');
    assert((await login('oracle@x.io', 'another-pass1')).status === 401, 'register changed an existing password');
  });

  await check('unverified login is refused only after the right password; wrong/unknown stay generic', async () => {
    const ip = freshIp();
    await m('POST', '/auth/register', { email: 'pending@x.io', password: 'password123' }, ip);
    const wrong = await login('pending@x.io', 'wrong-pass1', ip);
    const unknown = await login('ghost@x.io', 'wrong-pass1', ip);
    const right = await login('pending@x.io', 'password123', ip);
    assert(wrong.status === 401 && wrong.json.error.code === 'bad_credentials', JSON.stringify(wrong.json));
    assert(unknown.status === 401 && unknown.json.error.message === wrong.json.error.message, 'unknown email answered differently');
    assert(right.status === 403 && right.json.error.code === 'email_not_verified' && !right.json.token, JSON.stringify(right.json));
  });

  await check('verification token: hashed at rest, single-use, returns a working session', async () => {
    const ip = freshIp();
    const reg = await m('POST', '/auth/register', { email: 'verify1@x.io', password: 'password123' }, ip);
    const token = linkParam(reg.json.devLink, 'verify');
    assert(reg.json.devLink.startsWith('http://localhost:5173/?verify='), reg.json.devLink);
    const rows = db.prepare('SELECT token_hash FROM email_tokens').all().map((r) => r.token_hash);
    assert(!rows.includes(token) && rows.some((h) => /^[0-9a-f]{64}$/.test(h)), 'token stored in clear text');
    const ok = await m('POST', '/auth/verify', { token }, ip);
    assert(ok.status === 200 && ok.json.user.email === 'verify1@x.io', JSON.stringify(ok.json));
    assert((await m('GET', '/me', undefined, { Authorization: `Bearer ${ok.json.token}` })).status === 200, 'session does not work');
    const reuse = await m('POST', '/auth/verify', { token }, ip);
    assert(reuse.status === 400 && reuse.json.error.code === 'invalid_token', `reuse: ${reuse.status}`);
    assert((await m('POST', '/auth/verify', { token: 'x'.repeat(43) }, ip)).status === 400, 'garbage token accepted');
    assert((await login('verify1@x.io', 'password123', ip)).status === 200, 'cannot log in after verifying');
  });

  await check('verification token expires after 24 h', async () => {
    const ip = freshIp();
    const reg = await m('POST', '/auth/register', { email: 'verify-old@x.io', password: 'password123' }, ip);
    const uid = db.prepare("SELECT id FROM users WHERE email = 'verify-old@x.io'").get().id;
    const row = db.prepare("SELECT expires_at, created_at FROM email_tokens WHERE user_id = ? AND kind = 'verify'").get(uid);
    const ttl = row.expires_at - row.created_at;
    assert(Math.abs(ttl - 86_400_000) < 5000, `ttl ${ttl}`);
    db.prepare('UPDATE email_tokens SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, uid);
    const r = await m('POST', '/auth/verify', { token: linkParam(reg.json.devLink, 'verify') }, ip);
    assert(r.status === 400 && r.json.error.code === 'invalid_token', `expired token accepted: ${r.status}`);
    assert((await login('verify-old@x.io', 'password123', ip)).status === 403, 'expired link verified the account');
  });

  await check('re-registering an unverified address: newest password and link win, older link dies', async () => {
    const ip = freshIp();
    const first = await m('POST', '/auth/register', { email: 'squat@x.io', password: 'squatter-pass1' }, ip);
    const second = await m('POST', '/auth/register', { email: 'squat@x.io', password: 'owner-pass123' }, ip);
    assert((await m('POST', '/auth/verify', { token: linkParam(first.json.devLink, 'verify') }, ip)).status === 400, 'old link still valid');
    assert((await m('POST', '/auth/verify', { token: linkParam(second.json.devLink, 'verify') }, ip)).status === 200, 'new link rejected');
    assert((await login('squat@x.io', 'squatter-pass1', ip)).status === 401, 'squatter password survived');
    assert((await login('squat@x.io', 'owner-pass123', ip)).status === 200, 'owner password rejected');
  });

  await check('resend verification: always 202, fresh link replaces the old one, per-IP and per-address caps', async () => {
    const ip = freshIp();
    await signup(m, 'resend-ok@x.io', 'password123', ip);
    await m('POST', '/auth/register', { email: 'resend-me@x.io', password: 'password123' }, ip);
    const old = (await m('POST', '/auth/resend', { email: 'resend-me@x.io' }, ip));
    const verified = await m('POST', '/auth/resend', { email: 'resend-ok@x.io' }, ip);
    const unknown = await m('POST', '/auth/resend', { email: 'nobody@x.io' }, ip);
    assert([old.status, verified.status, unknown.status].every((c) => c === 202), `${old.status}/${verified.status}/${unknown.status}`);
    assert(verified.json.devLink === undefined && unknown.json.devLink === undefined, 'link for a verified/unknown account');
    const newer = await m('POST', '/auth/resend', { email: 'resend-me@x.io' }, ip);
    assert((await m('POST', '/auth/verify', { token: linkParam(old.json.devLink, 'verify') }, ip)).status === 400, 'older link survived a resend');
    // register + 2 resends used the 3 mails per hour: the 4th request is still 202 but sends nothing.
    const capped = await m('POST', '/auth/resend', { email: 'resend-me@x.io' }, freshIp());
    assert(capped.status === 202 && capped.json.devLink === undefined, `per-address cap: ${capped.status} ${JSON.stringify(capped.json)}`);
    assert((await m('POST', '/auth/verify', { token: linkParam(newer.json.devLink, 'verify') }, ip)).status === 200, 'latest link rejected');
    const flood = freshIp();
    const codes = [];
    for (let i = 0; i < 7; i += 1) codes.push((await m('POST', '/auth/resend', { email: `flood${i}@x.io` }, flood)).status);
    assert(codes.slice(0, 5).every((c) => c === 202) && codes[6] === 429, `per-IP cap: ${codes}`);
  });

  await check('forgot password: always 202, mails only real accounts, newest token wins', async () => {
    const ip = freshIp();
    await signup(m, 'forgetful@x.io', 'password123', ip);
    const unknown = await m('POST', '/auth/forgot', { email: 'nobody-here@x.io' }, ip);
    const first = await m('POST', '/auth/forgot', { email: 'forgetful@x.io' }, ip);
    const second = await m('POST', '/auth/forgot', { email: 'Forgetful@X.io' }, ip);
    assert(unknown.status === 202 && first.status === 202 && second.status === 202, 'not always 202');
    assert(unknown.json.accepted === true && unknown.json.devLink === undefined, 'unknown email produced a link');
    assert(first.json.devLink.startsWith('http://localhost:5173/?reset='), first.json.devLink);
    const t1 = linkParam(first.json.devLink, 'reset');
    assert((await m('POST', '/auth/reset', { token: t1, password: 'brand-new-pass' }, ip)).status === 400, 'older reset token still valid');
    // 3 mails per hour for this address: the 4th request is still 202 but sends nothing.
    const third = await m('POST', '/auth/forgot', { email: 'forgetful@x.io' }, ip);
    const fourth = await m('POST', '/auth/forgot', { email: 'forgetful@x.io' }, ip);
    assert(third.status === 202 && third.json.devLink, 'third request should still mail');
    assert(fourth.status === 202 && fourth.json.devLink === undefined, `per-address cap: ${fourth.status} ${JSON.stringify(fourth.json)}`);
    const flood = freshIp();
    const codes = [];
    for (let i = 0; i < 7; i += 1) codes.push((await m('POST', '/auth/forgot', { email: `f${i}@x.io` }, flood)).status);
    assert(codes.slice(0, 5).every((c) => c === 202) && codes[6] === 429, `per-IP cap: ${codes}`);
  });

  await check('reset: sets the password, revokes every session, token is single-use', async () => {
    const ip = freshIp();
    const a = await signup(m, 'resetme@x.io', 'old-password1', ip);
    const b = await login('resetme@x.io', 'old-password1', ip);
    const forgot = await m('POST', '/auth/forgot', { email: 'resetme@x.io' }, ip);
    const token = linkParam(forgot.json.devLink, 'reset');
    const rows = db.prepare('SELECT token_hash FROM email_tokens WHERE kind = ?').all('reset').map((r) => r.token_hash);
    assert(!rows.includes(token), 'reset token stored in clear text');
    const weak = await m('POST', '/auth/reset', { token, password: 'short' }, ip);
    assert(weak.status === 400 && weak.json.error.code === 'weak_password', `weak: ${weak.status}`);
    const ok = await m('POST', '/auth/reset', { token, password: 'new-password1' }, ip);
    assert(ok.status === 200 && !ok.json.token, `reset: ${ok.status} ${JSON.stringify(ok.json)}`);
    for (const session of [a, b.json]) {
      assert((await m('GET', '/me', undefined, { Authorization: `Bearer ${session.token}` })).status === 401, 'old session survived the reset');
    }
    assert((await m('POST', '/auth/reset', { token, password: 'third-password1' }, ip)).status === 400, 'reset token reused');
    assert((await login('resetme@x.io', 'old-password1', ip)).status === 401, 'old password still works');
    assert((await login('resetme@x.io', 'new-password1', ip)).status === 200, 'new password rejected');
  });

  await check('reset token expires after 1 h and a reset confirms the mailbox', async () => {
    const ip = freshIp();
    await m('POST', '/auth/register', { email: 'reset-late@x.io', password: 'password123' }, ip);
    const forgot = await m('POST', '/auth/forgot', { email: 'reset-late@x.io' }, ip);
    const token = linkParam(forgot.json.devLink, 'reset');
    const uid = db.prepare("SELECT id FROM users WHERE email = 'reset-late@x.io'").get().id;
    const row = db.prepare("SELECT expires_at, created_at FROM email_tokens WHERE user_id = ? AND kind = 'reset'").get(uid);
    assert(Math.abs(row.expires_at - row.created_at - 3_600_000) < 5000, 'reset ttl is not 1 h');
    db.prepare("UPDATE email_tokens SET expires_at = ? WHERE user_id = ? AND kind = 'reset'").run(Date.now() - 1000, uid);
    assert((await m('POST', '/auth/reset', { token, password: 'new-password1' }, ip)).status === 400, 'expired reset token accepted');
    const again = await m('POST', '/auth/forgot', { email: 'reset-late@x.io' }, freshIp());
    assert((await m('POST', '/auth/reset', { token: linkParam(again.json.devLink, 'reset'), password: 'new-password1' }, ip)).status === 200, 'fresh token rejected');
    assert((await login('reset-late@x.io', 'new-password1', ip)).status === 200, 'account stayed unverified after reading the reset mail');
  });

  await check('accounts created before verification existed are treated as verified', async () => {
    const id = 'usr_legacy';
    db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, 'legacy@x.io', 'x', 0)").run(id);
    assert(db.prepare('SELECT email_verified AS v FROM users WHERE id = ?').get(id).v === 1, 'column default is not verified');
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });

  await check('per-IP register limit stays, but probing taken emails no longer locks out new sign-ups', async () => {
    const ip = freshIp();
    await signup(m, 'taken@x.io', 'password123', ip);
    const codes = [];
    for (let i = 0; i < 6; i += 1) codes.push((await m('POST', '/auth/register', { email: 'taken@x.io', password: 'password123' }, ip)).status);
    const brandNew = await m('POST', '/auth/register', { email: 'newcomer@x.io', password: 'password123' }, ip);
    assert(codes.every((c) => c === 202) && brandNew.status === 202, `${codes} then ${brandNew.status}`);
    const rest = [];
    for (let i = 0; i < 4; i += 1) rest.push((await m('POST', '/auth/register', { email: `cap${i}@x.io`, password: 'password123' }, ip)).status);
    assert(rest.includes(429), `register limit disappeared: ${rest}`);
  });

  db.close();
  await stop(mailSrv);

  // ── Production: HTTP mailer, no dev links ──
  const prodEnv = { STRIPE_SECRET_KEY: '', BILLING_MODE: 'demo', NODE_ENV: 'production' };
  await check('production refuses to start without a mailer (or with the log mailer)', async () => {
    const none = await start(P.prod, prodEnv).then(() => 'started', (e) => e.out);
    assert(none !== 'started' && /no mailer configured/.test(none), `unexpected: ${none}`);
    const log = await start(P.prod, { ...prodEnv, MAIL_MODE: 'log' }).then(() => 'started', (e) => e.out);
    assert(log !== 'started' && /MAIL_MODE=log never delivers/.test(log), `unexpected: ${log}`);
    const partial = await start(P.prod, { ...prodEnv, MAIL_MODE: 'http', MAIL_API_URL: `http://localhost:${P.mailApi}/emails` }).then(() => 'started', (e) => e.out);
    assert(partial !== 'started' && /MAIL_API_KEY/.test(partial), `unexpected: ${partial}`);
  });

  const httpMail = await start(P.httpMail, { ...prodEnv, MAIL_MODE: 'http', MAIL_API_URL: `http://localhost:${P.mailApi}/emails`, MAIL_API_KEY: 'key_test_123', MAIL_FROM: 'Hash Harvest <noreply@example.com>', APP_URL: 'https://hash.example.com' });
  const h = api(P.httpMail);

  await check('production: no devLink anywhere; the mailer receives a Bearer-authenticated JSON email', async () => {
    const before = inbox.length;
    const reg = await h('POST', '/auth/register', { email: 'prod@x.io', password: 'password123' });
    assert(reg.status === 202 && !('devLink' in reg.json) && !JSON.stringify(reg.json).includes('verify='), JSON.stringify(reg.json));
    assert(await waitInbox(before + 1), 'no verification email was sent');
    const mail = inbox[before];
    assert(mail.method === 'POST' && mail.url === '/emails' && mail.auth === 'Bearer key_test_123' && /application\/json/.test(mail.type), JSON.stringify(mail));
    assert(mail.body.from === 'Hash Harvest <noreply@example.com>' && Array.isArray(mail.body.to) && mail.body.to[0] === 'prod@x.io', JSON.stringify(mail.body));
    const link = /https:\/\/hash\.example\.com\/\?verify=[\w-]+/.exec(mail.body.text)?.[0];
    assert(typeof mail.body.subject === 'string' && link, `no link in mail: ${mail.body.text}`);
    const ver = await h('POST', '/auth/verify', { token: linkParam(link, 'verify') });
    assert(ver.status === 200, `verify via emailed link: ${ver.status}`);
    const forgot = await h('POST', '/auth/forgot', { email: 'prod@x.io' });
    assert(forgot.status === 202 && !('devLink' in forgot.json), JSON.stringify(forgot.json));
    assert(await waitInbox(before + 2), 'no reset email was sent');
    assert(/\/\?reset=[\w-]+/.test(inbox[before + 1].body.text), 'reset email has no link');
    const dup = await h('POST', '/auth/register', { email: 'prod@x.io', password: 'password123' });
    assert(dup.status === 202 && !('devLink' in dup.json), 'existing email answered differently');
    assert(await waitInbox(before + 3) && /already/i.test(inbox[before + 2].body.subject), 'no "already registered" email');
  });

  await check('production: a mail API outage still answers 202 and never leaks details', async () => {
    mailApiDown = true;
    const r = await h('POST', '/auth/register', { email: 'prod-down@x.io', password: 'password123' });
    mailApiDown = false;
    assert(r.status === 202 && JSON.stringify(r.json) === '{"accepted":true}', JSON.stringify(r.json));
  });
  await stop(httpMail);
} catch (err) {
  results.push(false);
  console.error(err);
} finally {
  procs.forEach((p) => p.kill());
  fake.close();
  mailApi.close();
  rmSync(dataDir, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
