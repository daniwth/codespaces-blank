/**
 * End-to-end smoke test. Requires a production build (npm run build).
 * Boots the account server (which also serves dist/) on a throwaway database,
 * drives the game in headless Chromium and exits non-zero on any failure.
 * Screenshots land in tests/e2e/artifacts/.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = Number(process.env.E2E_PORT ?? 8799);
const URL = `http://localhost:${PORT}/`;
const ART = join(process.cwd(), 'tests/e2e/artifacts');
mkdirSync(ART, { recursive: true });
if (!existsSync('dist/index.html')) {
  console.error('dist/ missing: run `npm run build` first.');
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), 'hht-e2e-'));
const server = spawn(process.execPath, ['--no-warnings', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, STATIC_DIR: join(process.cwd(), 'dist'), STRIPE_SECRET_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.log(`  ✗ ${name}\n      ${err.message.split('\n')[0]}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const r = await fetch(`${URL}api/health`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 409/.test(m.text())) errors.push(m.text());
  });
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('hash-harvest-tycoon') ?? '{}').state ?? {});
  const canvas = page.locator('canvas[aria-label="Mining room view"]');

  console.log('Hash Harvest E2E smoke test');
  await page.goto(URL);

  await check('boots and renders the room canvas', async () => {
    await canvas.waitFor({ timeout: 10_000 });
    const box = await canvas.boundingBox();
    assert(box && box.width >= 320, 'canvas too small');
    const colors = await canvas.evaluate((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const set = new Set();
      for (let i = 0; i < d.length; i += 400) set.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      return set.size;
    });
    assert(colors > 20, `canvas looks blank (${colors} colors)`);
  });

  await check('simulation ticks and mines $CC', async () => {
    await page.waitForTimeout(3500);
    const s = await state();
    assert(Number(s.cc) > 0, `cc did not grow (${s.cc})`);
  });

  await check('shop purchase rolls silicon lottery', async () => {
    // The game flushes its own save on unload, so inject cash before the next document boots.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('e2e-cash')) return;
      sessionStorage.setItem('e2e-cash', '1');
      const raw = JSON.parse(localStorage.getItem('hash-harvest-tycoon'));
      raw.state.cash = '100000';
      localStorage.setItem('hash-harvest-tycoon', JSON.stringify(raw));
    });
    await page.reload();
    await canvas.waitFor();
    await page.locator('div.bg-panel-2', { hasText: 'Pixelia PX-580' }).locator('button').first().click();
    await page.getByText('SILICON LOTTERY', { exact: true }).waitFor({ timeout: 3000 });
  });

  await check('rack modal opens with slots and BIOS', async () => {
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + (212 / 480) * box.width, box.y + (180 / 270) * box.height);
    await page.getByText('PCIE SLOTS').waitFor({ timeout: 3000 });
    await page.locator('button[title="Overclock in the BIOS"]').first().click();
    await page.getByText('PhoenixBits CMOS Setup Utility').waitFor({ timeout: 3000 });
    await page.screenshot({ path: join(ART, 'bios.png') });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  await check('every side panel renders', async () => {
    for (const tab of ['Shop', 'Rigs', 'Market', 'Pools', 'Contracts', 'Halving', 'VIP', 'Trophies', 'Account', 'System']) {
      await page.locator(`nav[aria-label="Panels"] button:has-text("${tab}")`).click();
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: join(ART, 'panels.png') });
  });

  await check('account: register, subscribe (demo) and cloud save', async () => {
    await page.locator('nav[aria-label="Panels"] button:has-text("Account")').click();
    await page.click('button:has-text("Create account")');
    await page.fill('input[autocomplete="email"]', `e2e${Date.now()}@example.com`);
    await page.locator('input[autocomplete="new-password"]').nth(0).fill('e2e-password');
    await page.locator('input[autocomplete="new-password"]').nth(1).fill('e2e-password');
    await page.locator('form button:has-text("Create account")').last().click();
    await page.locator('button:has-text("Subscribe")').first().click();
    await page.getByText('ACTIVE ·').waitFor({ timeout: 5000 });
    await page.click('button:has-text("Save to cloud")');
    await page.getByText(/Saved to the cloud|synced/).first().waitFor({ timeout: 5000 });
    await page.screenshot({ path: join(ART, 'account.png') });
  });

  await check('no runtime errors in the console', async () => {
    assert(errors.length === 0, errors.join(' | '));
  });

  // ───────────── Regressions found by the QA pass (game-qa-tester) ─────────────
  // Each one runs in its own fresh browser context.
  const fresh = async (opts = { viewport: { width: 1600, height: 1000 } }) => {
    const context = await browser.newContext(opts);
    const p = await context.newPage();
    return { context, p };
  };
  /** Boot once so a save exists, patch it before the next document loads, reload. */
  const bootPatched = async (p, patch) => {
    await p.goto(URL);
    await p.locator('canvas[aria-label="Mining room view"]').waitFor({ timeout: 10_000 });
    await p.waitForTimeout(2300);
    await p.addInitScript((src) => {
      if (sessionStorage.getItem('e2e-patch')) return;
      sessionStorage.setItem('e2e-patch', '1');
      const raw = JSON.parse(localStorage.getItem('hash-harvest-tycoon'));
      new Function('state', src)(raw.state);
      localStorage.setItem('hash-harvest-tycoon', JSON.stringify(raw));
    }, patch);
    await p.reload();
    await p.locator('canvas[aria-label="Mining room view"]').waitFor({ timeout: 10_000 });
  };

  await check('contracts: board renders 3 cards and a completed contract can be claimed', async () => {
    const { context, p } = await fresh();
    try {
      // Seed: the first contract is already fulfilled, with a known reward.
      await bootPatched(p, `
        const c = state.contracts.slots[0];
        c.progress = c.target;
        c.completedAt = Date.now();
        c.expiresAt = Date.now() + 3600000;
        c.reward = { cash: 777, gems: 2, gpuModelId: null };
        state.gems = 0;
      `);
      const tab = p.locator('nav[aria-label="Panels"] button:has-text("Contracts")');
      assert(/ready to claim/.test((await tab.getAttribute('aria-label')) ?? ''), 'tab does not announce a claimable contract');
      await tab.click();
      const cards = p.locator('article[aria-label^="Contract:"]');
      await cards.first().waitFor({ timeout: 3000 });
      assert((await cards.count()) === 3, `expected 3 contract cards, got ${await cards.count()}`);
      const done = p.locator('article[data-contract-state="complete"]');
      assert((await done.count()) === 1, 'seeded contract is not shown as complete');
      assert((await p.locator('article[data-contract-state="active"] button[aria-label^="Reroll"]').count()) === 2, 'reroll buttons missing');
      await p.screenshot({ path: join(ART, 'contracts.png') });
      const claimedId = await p.evaluate(() => JSON.parse(localStorage.getItem('hash-harvest-tycoon')).state.contracts.slots[0].id);
      await done.locator('button[aria-label^="Claim"]').click();
      await p.waitForTimeout(150);
      assert((await p.locator('article[data-contract-state="complete"]').count()) === 0, 'claimed card still on the board');
      await p.getByText('Incoming contract in').waitFor({ timeout: 2000 });
      await p.waitForTimeout(2600); // throttled save
      const after = await p.evaluate(() => JSON.parse(localStorage.getItem('hash-harvest-tycoon')).state);
      assert(after.gems === 2, `gems after claim: ${after.gems}`);
      assert(after.stats.contractsCompleted === 1, `contractsCompleted: ${after.stats.contractsCompleted}`);
      assert(!after.contracts.slots.some((c) => c.id === claimedId), 'claimed contract still persisted');
      await p.screenshot({ path: join(ART, 'contracts-claimed.png') });
    } finally {
      await context.close();
    }
  });

  await check('regression: bot rule inputs accept 0.9x and re-typed numbers', async () => {
    const { context, p } = await fresh();
    try {
      await bootPatched(p, "state.lifetimeEarnings = '1000';");
      await p.locator('nav[aria-label="Panels"] button:has-text("Market")').click();
      await p.click('button:has-text("New bot")');
      const thr = p.locator('input[aria-label="Threshold multiple"]');
      await thr.click();
      await thr.press('Control+a');
      await thr.pressSequentially('0.9');
      const cd = p.locator('input[aria-label="Cooldown seconds"]');
      await cd.click();
      await cd.press('Control+a');
      await cd.press('Backspace');
      await cd.pressSequentially('30');
      const got = { threshold: await thr.inputValue(), cooldown: await cd.inputValue() };
      assert(got.threshold === '0.9' && got.cooldown === '30', `typed 0.9 / 30, inputs show ${got.threshold} / ${got.cooldown}`);
    } finally {
      await context.close();
    }
  });

  await check('regression: Escape in the BIOS closes only the BIOS', async () => {
    const { context, p } = await fresh();
    try {
      await p.goto(URL);
      const cv = p.locator('canvas[aria-label="Mining room view"]');
      await cv.waitFor();
      const box = await cv.boundingBox();
      await p.mouse.click(box.x + (212 / 480) * box.width, box.y + (180 / 270) * box.height);
      await p.getByText('PCIE SLOTS').waitFor({ timeout: 3000 });
      await p.locator('button[title="Overclock in the BIOS"]').first().click();
      await p.getByText('PhoenixBits CMOS Setup Utility').waitFor({ timeout: 3000 });
      await p.keyboard.press('Escape');
      await p.waitForTimeout(200);
      assert(!(await p.getByText('PhoenixBits CMOS Setup Utility').isVisible()), 'BIOS still open');
      assert(await p.getByText('PCIE SLOTS').isVisible(), 'one Escape also closed the rack modal underneath');
    } finally {
      await context.close();
    }
  });

  await check('regression: reloading the page does not cause a cloud conflict with yourself', async () => {
    const { context, p } = await fresh();
    try {
      await p.goto(URL);
      await p.locator('canvas[aria-label="Mining room view"]').waitFor();
      await p.locator('nav[aria-label="Panels"] button:has-text("Account")').click();
      await p.click('button:has-text("Create account")');
      await p.fill('input[autocomplete="email"]', `e2e-reload${Date.now()}@example.com`);
      await p.locator('input[autocomplete="new-password"]').nth(0).fill('e2e-password');
      await p.locator('input[autocomplete="new-password"]').nth(1).fill('e2e-password');
      await p.locator('form button:has-text("Create account")').last().click();
      await p.locator('button:has-text("Subscribe")').first().click();
      await p.getByText('ACTIVE ·').waitFor({ timeout: 8000 });
      await p.waitForTimeout(800);
      // Same device, nothing else open: the unload upload must not desync baseRevision.
      await p.reload();
      await p.locator('canvas[aria-label="Mining room view"]').waitFor();
      await p.waitForTimeout(1500);
      await p.locator('nav[aria-label="Panels"] button:has-text("Account")').click();
      await p.click('button:has-text("Save to cloud")');
      await p.waitForTimeout(1200);
      assert(!(await p.getByText('Keep this device').isVisible()), 'conflict prompt after a plain reload on the only device');
    } finally {
      await context.close();
    }
  });

  await check('regression: a 2 h sleep with the tab open is credited (not capped to 10 min)', async () => {
    const { context, p } = await fresh();
    try {
      await p.clock.install();
      await p.goto(URL);
      await p.locator('canvas[aria-label="Mining room view"]').waitFor();
      await p.clock.runFor(5000);
      await p.waitForTimeout(300);
      await p.clock.runFor(3000);
      const before = await p.evaluate(() => JSON.parse(localStorage.getItem('hash-harvest-tycoon')).state.stats.playTimeSec);
      await p.clock.fastForward('02:00:00'); // laptop lid closed: timers stop, then the clock jumps
      for (let i = 0; i < 3; i += 1) {
        await p.waitForTimeout(400);
        await p.clock.runFor(3000);
      }
      const after = await p.evaluate(() => JSON.parse(localStorage.getItem('hash-harvest-tycoon')).state.stats.playTimeSec);
      const report = await p.getByText('Welcome back, miner').isVisible();
      assert(report || after - before > 3600, `only ${Math.round(after - before)}s of a 7200s gap were simulated and no offline report was shown`);
    } finally {
      await context.close();
    }
  });

  await check('regression: mobile side tabs have accessible names and no horizontal overflow', async () => {
    const { context, p } = await fresh({ ...devices['iPhone 13'] });
    try {
      await p.goto(URL);
      await p.locator('canvas[aria-label="Mining room view"]').waitFor();
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 0, `horizontal overflow of ${overflow}px`);
      const unnamed = await p.locator('nav[aria-label="Panels"] button').evaluateAll((bs) =>
        bs.filter((b) => !(b.innerText.trim() || b.getAttribute('aria-label') || b.getAttribute('title'))).length);
      assert(unnamed === 0, `${unnamed} icon-only tab buttons have no accessible name on mobile`);
    } finally {
      await context.close();
    }
  });
} catch (err) {
  results.push({ name: 'harness', ok: false, err: err.message });
  console.error(err);
} finally {
  await browser?.close();
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
