/**
 * Server security & billing integration test. Spins up a fake Stripe API and
 * the real account server, then replays the attacks from the security audit.
 * Run: node tests/server/security.mjs  (exit code 1 on any failure)
 */
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Base port (5 consecutive ports are used); override with SEC_PORT_BASE for parallel runs. */
const BASE = Number(process.env.SEC_PORT_BASE ?? 8781);
const P = { fake: BASE, demo: BASE + 1, prod: BASE + 2, live: BASE + 3 };
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
    const reg = await d('POST', '/auth/register', { email: 'demo@x.io', password: 'password123' }, { 'X-Forwarded-For': '203.0.113.9' });
    const auth = { Authorization: `Bearer ${reg.json.token}` };
    await d('POST', '/billing/checkout', { plan: 'monthly' }, auth);
    await d('POST', '/billing/cancel', {}, auth);
    const again = await d('POST', '/billing/checkout', { plan: 'monthly' }, auth);
    assert(again.json?.reactivated === true && again.json.user.subscription.cancelAtPeriodEnd === false, JSON.stringify(again.json));
  });

  await check('a third party cannot lock a victim out (TRUST_PROXY=1)', async () => {
    await d('POST', '/auth/register', { email: 'victim@x.io', password: 'password123' }, { 'X-Forwarded-For': '198.51.100.1' });
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

  const reg = await s('POST', '/auth/register', { email: 'payer@x.io', password: 'password123' });
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
    const other = await s('POST', '/auth/register', { email: 'other@x.io', password: 'password123' });
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
} catch (err) {
  results.push(false);
  console.error(err);
} finally {
  procs.forEach((p) => p.kill());
  fake.close();
  rmSync(dataDir, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
