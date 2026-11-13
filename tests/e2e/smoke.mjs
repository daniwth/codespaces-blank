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
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, STATIC_DIR: join(process.cwd(), 'dist'), STRIPE_SECRET_KEY: '', SEED_TEST_ACCOUNT: '1' },
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
  const saveOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('hash-harvest-tycoon') ?? '{}').state ?? {});
  const state = () => saveOf(page);
  const canvas = page.locator('canvas[aria-label="Mining room view"]');
  const roomCanvas = (p) => p.locator('canvas[aria-label="Mining room view"]');
  const menuOf = (p) => p.getByTestId('title-screen');
  /**
   * Passes the title screen. `new` = New game on a browser without progress,
   * `overwrite` = New game + confirm, `continue` = resume the seeded save.
   * Picks "Play as guest" when the account step is shown.
   */
  const enterGame = async (p, how = 'new') => {
    const menu = menuOf(p);
    await menu.waitFor({ timeout: 10_000 });
    await p.locator('[data-testid="menu-identity"], [data-testid="menu-main"]').first().waitFor({ timeout: 5000 });
    if (await p.getByTestId('menu-identity').isVisible()) await menu.locator('button:has-text("Play as guest")').click();
    if (how === 'continue') await menu.locator('button:has-text("Continue")').click();
    else {
      await menu.locator('button:has-text("New game")').click();
      if (how === 'overwrite') await p.locator('[role="dialog"] button:has-text("Overwrite")').click();
    }
    await roomCanvas(p).waitFor({ timeout: 10_000 });
  };

  /**
   * Finishes sign-up after clicking "Create account": the "check your email" view exposes the emailed link
   * (dev server only). The token is consumed through the API (like opening it elsewhere), then the player logs in.
   */
  const verifyAndLogin = async (p, scope, password = 'e2e-password') => {
    const view = scope.getByTestId('check-email');
    await view.waitFor({ timeout: 8000 });
    const email = /[\w.+-]+@[\w.-]+\.com/.exec((await view.textContent()) ?? '')?.[0];
    assert(email, 'check-email view does not show the address');
    const href = await scope.getByTestId('dev-link').getAttribute('href');
    const token = new globalThis.URL(href).searchParams.get('verify');
    const r = await p.request.post(`${URL}api/auth/verify`, { data: { token } });
    assert(r.ok(), `verify answered ${r.status()}`);
    await scope.locator('button:has-text("Back to log in")').click();
    await scope.locator('input[autocomplete="email"]').fill(email);
    await scope.locator('input[autocomplete="current-password"]').fill(password);
    await scope.locator('form button:has-text("Log in")').last().click();
  };

  console.log('Hash Harvest E2E smoke test');
  await page.goto(URL);

  await check('title menu shows on boot, with no Continue and no running game without a save', async () => {
    await menuOf(page).waitFor({ timeout: 10_000 });
    await page.getByTestId('menu-identity').waitFor({ timeout: 3000 });
    assert((await canvas.count()) === 0, 'the game canvas is mounted behind the menu');
    await page.screenshot({ path: join(ART, 'menu-identity.png') });
    await menuOf(page).locator('button:has-text("Play as guest")').click();
    await page.getByTestId('menu-main').waitFor({ timeout: 3000 });
    assert((await menuOf(page).locator('button:has-text("Continue")').count()) === 0, 'Continue offered without a save');
    assert(await menuOf(page).locator('button:has-text("New game")').isVisible(), 'New game missing');
    assert(/guest/i.test((await page.getByTestId('menu-identity-status').textContent()) ?? ''), 'guest status line missing');
  });

  await check('boots and renders the room canvas', async () => {
    await enterGame(page, 'new');
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
      raw.state.stats.playTimeSec = Math.max(raw.state.stats.playTimeSec, 60);
      localStorage.setItem('hash-harvest-tycoon', JSON.stringify(raw));
    });
    await page.reload();
    await menuOf(page).waitFor({ timeout: 10_000 });
    // Continue appears only once a save with progress exists, with its summary.
    const summary = (await page.getByTestId('continue-summary').textContent()) ?? '';
    assert(/\$100(\.0)?K|\$100,000|\$100000/i.test(summary), `Continue summary does not show the saved cash: ${summary}`);
    assert(/played/i.test(summary) && /last played/i.test(summary), `Continue summary incomplete: ${summary}`);
    await page.screenshot({ path: join(ART, 'menu.png') });
    await enterGame(page, 'continue');
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
    for (const tab of ['Shop', 'Rigs', 'Lab', 'Market', 'Pools', 'Contracts', 'Halving', 'VIP', 'Trophies', 'Account', 'System']) {
      await page.locator(`nav[aria-label="Panels"] button:has-text("${tab}")`).click();
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: join(ART, 'panels.png') });
  });

  await check('HUD grid demand and Halving $SC/h readouts', async () => {
    const grid = await page.getByTestId('hud-grid').textContent();
    assert(/grid x\d/.test(grid ?? ''), `HUD grid readout: ${grid}`);
    await page.locator('nav[aria-label="Panels"] button:has-text("Halving")').click();
    await page.getByTestId('halving-rate').getByText('$SC / HOUR').waitFor({ timeout: 3000 });
    await page.getByText('NEXT $SC AT').waitFor({ timeout: 3000 });
    await page.screenshot({ path: join(ART, 'halving.png') });
  });

  await check('account: register, subscribe (demo) and cloud save', async () => {
    await page.locator('nav[aria-label="Panels"] button:has-text("Account")').click();
    await page.click('button:has-text("Create account")');
    await page.fill('input[autocomplete="email"]', `e2e${Date.now()}@example.com`);
    await page.locator('input[autocomplete="new-password"]').nth(0).fill('e2e-password');
    await page.locator('input[autocomplete="new-password"]').nth(1).fill('e2e-password');
    await page.locator('form button:has-text("Create account")').last().click();
    await verifyAndLogin(page, page.locator('body'));
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
  const bootPatched = async (p, patch, { enter = true } = {}) => {
    await p.goto(URL);
    await enterGame(p, 'new');
    await p.waitForTimeout(2300);
    await p.addInitScript((src) => {
      if (sessionStorage.getItem('e2e-patch')) return;
      sessionStorage.setItem('e2e-patch', '1');
      const raw = JSON.parse(localStorage.getItem('hash-harvest-tycoon'));
      // Enough play time to count as a save worth continuing.
      raw.state.stats.playTimeSec = Math.max(raw.state.stats.playTimeSec, 60);
      new Function('state', src)(raw.state);
      localStorage.setItem('hash-harvest-tycoon', JSON.stringify(raw));
    }, patch);
    await p.reload();
    if (enter) await enterGame(p, 'continue');
    else await menuOf(p).waitFor({ timeout: 10_000 });
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
      await enterGame(p, 'new');
      const cv = roomCanvas(p);
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
      await enterGame(p, 'new');
      await p.locator('nav[aria-label="Panels"] button:has-text("Account")').click();
      await p.click('button:has-text("Create account")');
      await p.fill('input[autocomplete="email"]', `e2e-reload${Date.now()}@example.com`);
      await p.locator('input[autocomplete="new-password"]').nth(0).fill('e2e-password');
      await p.locator('input[autocomplete="new-password"]').nth(1).fill('e2e-password');
      await p.locator('form button:has-text("Create account")').last().click();
      await verifyAndLogin(p, p.locator('body'));
      await p.locator('button:has-text("Subscribe")').first().click();
      await p.getByText('ACTIVE ·').waitFor({ timeout: 8000 });
      await p.waitForTimeout(5500); // enough play time for the title menu to offer Continue
      // Same device, nothing else open: the unload upload must not desync baseRevision.
      await p.reload();
      await enterGame(p, 'continue');
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
      await enterGame(p, 'new');
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
      await enterGame(p, 'new');
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 0, `horizontal overflow of ${overflow}px`);
      const unnamed = await p.locator('nav[aria-label="Panels"] button').evaluateAll((bs) =>
        bs.filter((b) => !(b.innerText.trim() || b.getAttribute('aria-label') || b.getAttribute('title'))).length);
      assert(unnamed === 0, `${unnamed} icon-only tab buttons have no accessible name on mobile`);
    } finally {
      await context.close();
    }
  });
  await check('challenge runs: pick one on New game, the HUD shows it, Halving lists it, abandon lifts it (desktop + mobile)', async () => {
    for (const [label, opts] of [['desktop', { viewport: { width: 1600, height: 1000 } }], ['mobile', { ...devices['iPhone 13'] }]]) {
      const { context, p } = await fresh(opts);
      try {
        await p.goto(URL);
        await menuOf(p).waitFor({ timeout: 10_000 });
        await menuOf(p).locator('button:has-text("Play as guest")').click();
        await p.getByTestId('menu-challenge').waitFor({ timeout: 3000 });
        await p.getByTestId('menu-challenge-select').selectOption('single_room');
        await p.getByTestId('menu-challenge-info').waitFor({ timeout: 3000 });
        await p.screenshot({ path: join(ART, `challenge-menu-${label}.png`) });
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(overflow <= 0, `${label}: horizontal overflow of ${overflow}px on the menu`);
        await menuOf(p).locator('button:has-text("New game")').click();
        await roomCanvas(p).waitFor({ timeout: 10_000 });
        const banner = p.getByTestId('challenge-banner');
        await banner.waitFor({ timeout: 3000 });
        assert(/SINGLE ROOM/.test((await banner.textContent()) ?? ''), `${label}: HUD banner does not name the challenge`);
        assert((await saveOf(p)).challenge?.id === 'single_room', `${label}: challenge not stored in the save`);
        await p.screenshot({ path: join(ART, `challenge-hud-${label}.png`) });
        await p.locator('nav[aria-label="Panels"] button[aria-label="Shop"]').click();
        await p.getByRole('button', { name: 'Rooms', exact: true }).click();
        await p.getByText('Locked by the Single Room challenge.').first().waitFor({ timeout: 3000 });
        await p.locator('nav[aria-label="Panels"] button[aria-label="Halving"]').click();
        const log = p.getByTestId('challenge-log');
        await log.waitFor({ timeout: 3000 });
        assert((await log.locator('[data-testid^="challenge-row-"]').count()) === 4, `${label}: Halving panel does not list the 4 challenges`);
        await log.scrollIntoViewIfNeeded();
        await p.screenshot({ path: join(ART, `challenge-halving-${label}.png`) });
        await banner.locator('button:has-text("Abandon")').click();
        await banner.locator('button:has-text("Confirm abandon")').click();
        await banner.waitFor({ state: 'detached', timeout: 3000 });
        await p.waitForTimeout(2300);
        assert((await saveOf(p)).challenge === null, `${label}: abandoning did not clear the challenge in the save`);
      } finally {
        await context.close();
      }
    }
  });

  await check('altcoins: choose $NOVA in Pools, it mines into its own wallet and shows in the HUD and Market (desktop + mobile)', async () => {
    for (const [label, opts] of [['desktop', { viewport: { width: 1600, height: 1000 } }], ['mobile', { ...devices['iPhone 13'] }]]) {
      const { context, p } = await fresh(opts);
      try {
        await p.goto(URL);
        await enterGame(p, 'new');
        await p.locator('nav[aria-label="Panels"] button[aria-label="Pools"]').click();
        for (const id of ['CC', 'BYT', 'NOVA']) await p.getByTestId(`mine-${id}`).waitFor({ timeout: 3000 });
        assert((await p.getByTestId('mine-CC').getAttribute('aria-pressed')) === 'true', `${label}: $CC is not the default mined coin`);
        await p.getByTestId('mine-NOVA').click();
        assert((await p.getByTestId('mine-NOVA').getAttribute('aria-pressed')) === 'true', `${label}: $NOVA did not become the mined coin`);
        await p.getByTestId('mine-NOVA').scrollIntoViewIfNeeded();
        await p.screenshot({ path: join(ART, `altcoins-pools-${label}.png`) });
        await p.waitForFunction(() => {
          const s = JSON.parse(localStorage.getItem('hash-harvest-tycoon') ?? '{}').state;
          return s && s.minedCoin === 'NOVA' && s.alts && s.alts.NOVA.amount > 0;
        }, undefined, { timeout: 15_000 });
        const s = await saveOf(p);
        assert(s.alts.NOVA.costBasis === 0, `${label}: mined $NOVA has a cost basis`);
        assert(Object.keys(s.market).sort().join() === 'BYT,CC,MEME,NOVA', `${label}: market lacks the altcoins`);
        await p.locator('nav[aria-label="Panels"] button[aria-label="Market"]').click();
        await p.getByTestId('coin-tab-NOVA').click();
        await p.getByTestId('alt-cost-basis').waitFor({ timeout: 3000 });
        await p.getByTestId('coin-tab-BYT').click();
        await p.getByTestId('alt-cost-basis').waitFor({ timeout: 3000 });
        await p.screenshot({ path: join(ART, `altcoins-market-${label}.png`) });
        await p.getByTestId('coin-tab-NOVA').click();
        await p.getByText('HOLDINGS').waitFor({ timeout: 3000 });
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(overflow <= 0, `${label}: horizontal overflow of ${overflow}px`);
        await p.screenshot({ path: join(ART, `altcoins-hud-${label}.png`) });
      } finally {
        await context.close();
      }
    }
  });

  // ───────────── Title screen / main menu ─────────────

  await check('menu: the simulation does not tick and no offline time is credited until Continue', async () => {
    const { context, p } = await fresh();
    try {
      // Away for 2 hours: lastTick is in the past.
      await bootPatched(p, 'state.lastTick = Date.now() - 2 * 3600 * 1000;', { enter: false });
      const before = await saveOf(p);
      await p.waitForTimeout(3500); // > the 2 s throttled save: any tick would have been persisted
      const after = await saveOf(p);
      assert(after.lastTick === before.lastTick, `lastTick moved on the menu (${before.lastTick} -> ${after.lastTick})`);
      assert(after.cash === before.cash && after.cc === before.cc, `cash/cc changed on the menu (${before.cash} -> ${after.cash})`);
      assert(after.stats.playTimeSec === before.stats.playTimeSec, 'play time advanced on the menu');
      assert(!(await p.getByText('Welcome back, miner').isVisible()), 'offline report shown on the menu');
      assert((await roomCanvas(p).count()) === 0, 'game canvas mounted on the menu');
      // Continue applies the normal boot behaviour: offline progress + report.
      await enterGame(p, 'continue');
      await p.getByText('Welcome back, miner').waitFor({ timeout: 5000 });
      await p.waitForTimeout(2500);
      const resumed = await saveOf(p);
      assert(resumed.lastTick > before.lastTick + 3600 * 1000, 'Continue did not credit the time away');
    } finally {
      await context.close();
    }
  });

  await check('menu: New game asks for confirmation when progress exists, then starts from zero', async () => {
    const { context, p } = await fresh();
    try {
      await bootPatched(p, "state.cash = '5000'; state.lifetimeEarnings = '9000'; state.lastTick = Date.now() - 3600 * 1000;", { enter: false });
      const menu = menuOf(p);
      await menu.locator('button:has-text("New game")').click();
      const dialog = p.locator('[role="dialog"]', { hasText: 'Start a new game?' });
      await dialog.waitFor({ timeout: 3000 });
      assert(/overwritten/i.test((await dialog.textContent()) ?? ''), 'confirmation does not warn about overwriting');
      assert(/cloud save/i.test((await dialog.textContent()) ?? ''), 'confirmation does not mention the cloud save');
      await p.screenshot({ path: join(ART, 'menu-new-game-confirm.png') });
      await p.keyboard.press('Escape');
      await p.waitForTimeout(150);
      assert(!(await dialog.isVisible()), 'Escape did not close the confirmation');
      assert((await saveOf(p)).lifetimeEarnings === '9000', 'cancelling still wiped the save');
      await menu.locator('button:has-text("New game")').click();
      await p.locator('[role="dialog"] button:has-text("Overwrite")').click();
      await roomCanvas(p).waitFor({ timeout: 10_000 });
      assert(!(await p.getByText('Welcome back, miner').isVisible()), 'a new game credited offline progress');
      const s = await saveOf(p);
      assert(s.lifetimeEarnings === '0' && Number(s.cash) <= 41, `new game kept progress (cash ${s.cash}, lifetime ${s.lifetimeEarnings})`);
      assert(Object.keys(s.gpus).length === 1 && Object.values(s.racks)[0].modelId === 'bench', 'starter bench rig missing');
      assert(Date.now() - s.lastTick < 10_000, 'lastTick not reset to now');
    } finally {
      await context.close();
    }
  });

  await check('menu: guest mode skips the account step on reload', async () => {
    const { context, p } = await fresh();
    try {
      await p.goto(URL);
      await p.getByTestId('menu-identity').waitFor({ timeout: 10_000 });
      await p.click('[data-testid="menu-identity"] button:has-text("Play as guest")');
      await p.getByTestId('menu-main').waitFor({ timeout: 3000 });
      await p.reload();
      await menuOf(p).waitFor({ timeout: 10_000 });
      await p.getByTestId('menu-main').waitFor({ timeout: 3000 });
      assert(!(await p.getByTestId('menu-identity').isVisible()), 'account step shown again after choosing guest');
    } finally {
      await context.close();
    }
  });

  await check('menu: settings and How to play open from the menu (keyboard + Escape)', async () => {
    const { context, p } = await fresh();
    try {
      await p.goto(URL);
      await p.click('[data-testid="menu-identity"] button:has-text("Play as guest")');
      const menu = menuOf(p);
      await menu.locator('button:has-text("Settings")').click();
      const settings = p.locator('[role="dialog"]', { hasText: 'AUDIO & VIDEO' });
      await settings.waitFor({ timeout: 3000 });
      for (const label of ['Mute all sound', 'Particles (smoke, coins)', 'Offline earnings']) {
        assert(await settings.getByLabel(label).isVisible(), `${label} toggle missing`);
      }
      assert(await settings.locator('input[type="range"]').isVisible(), 'volume slider missing');
      assert(await settings.locator('button:has-text("Export")').isVisible(), 'export missing');
      assert(await settings.locator('button:has-text("Import pasted save")').isVisible(), 'import missing');
      await settings.getByLabel('Mute all sound').check();
      await p.screenshot({ path: join(ART, 'menu-settings.png') });
      await p.keyboard.press('Escape');
      await p.waitForTimeout(150);
      assert(!(await settings.isVisible()), 'Escape did not close Settings');
      assert((await roomCanvas(p).count()) === 0, 'settings started the game');
      await p.waitForTimeout(2300);
      assert((await saveOf(p)).settings?.muted === true, 'setting changed on the menu was not saved');
      // How to play, opened with the keyboard.
      await menu.locator('button:has-text("How to play")').focus();
      await p.keyboard.press('Enter');
      const wiki = p.locator('[role="dialog"]', { hasText: "MINER'S MANUAL" });
      await wiki.waitFor({ timeout: 5000 });
      assert(await wiki.getByRole('searchbox').getAttribute('placeholder').then((v) => /Search/.test(v ?? '')), 'wiki search placeholder is not English');
      assert(await wiki.locator('nav button', { hasText: 'Getting started' }).isVisible(), 'English wiki page missing');
      await p.screenshot({ path: join(ART, 'wiki-en.png') });
      await p.keyboard.press('Escape');
      await p.waitForTimeout(150);
      assert(!(await wiki.isVisible()), 'Escape did not close the wiki');
      // Switch to Spanish in Settings: the wiki is bilingual (buttons are found by position because their labels translate).
      const buttonIndex = (label) => menu.evaluate((el, l) => [...el.querySelectorAll('button')].findIndex((b) => (b.textContent ?? '').includes(l)), label);
      const settingsIdx = await buttonIndex('Settings');
      const wikiIdx = await buttonIndex('How to play');
      assert(settingsIdx >= 0 && wikiIdx >= 0, 'menu buttons not found');
      const openSettings = async () => {
        await menu.locator('button').nth(settingsIdx).click();
        await p.locator('[role="dialog"]').first().waitFor({ timeout: 3000 });
      };
      await openSettings();
      await p.getByRole('radiogroup').locator('button:has-text("Español")').click();
      await p.keyboard.press('Escape');
      await p.waitForTimeout(150);
      await menu.locator('button').nth(wikiIdx).click();
      const wikiEs = p.locator('[role="dialog"]', { hasText: 'MANUAL DEL MINERO' });
      await wikiEs.waitFor({ timeout: 5000 });
      assert(await wikiEs.locator('nav button', { hasText: 'Primeros pasos' }).isVisible(), 'Spanish wiki page missing');
      assert(await wikiEs.getByRole('searchbox').getAttribute('placeholder').then((v) => /Buscar/.test(v ?? '')), 'wiki search placeholder is not Spanish');
      await wikiEs.getByRole('searchbox').fill('pasta');
      assert(await wikiEs.getByText(/resultado/).first().isVisible(), 'Spanish search count missing');
      await p.screenshot({ path: join(ART, 'wiki-es.png') });
      await p.keyboard.press('Escape');
      await p.keyboard.press('Escape');
      await p.waitForTimeout(150);
      assert(!(await wikiEs.isVisible()), 'Escape did not close the Spanish wiki');
      // Back to English for the rest of the checks.
      await openSettings();
      await p.getByRole('radiogroup').locator('button:has-text("English")').click();
      await p.keyboard.press('Escape');
      await p.waitForTimeout(150);
      // And from the in-game HUD.
      await enterGame(p, 'new');
      await p.locator('header button[aria-label="How to play"]').click();
      await wiki.waitFor({ timeout: 5000 });
      await p.keyboard.press('Escape');
    } finally {
      await context.close();
    }
  });

  await check('menu: "Main menu" saves, returns to the title screen and pauses the game', async () => {
    const { context, p } = await fresh();
    try {
      await p.goto(URL);
      await enterGame(p, 'new');
      await p.waitForTimeout(6500);
      await p.locator('nav[aria-label="Panels"] button:has-text("System")').click();
      await p.click('button:has-text("Main menu")');
      await menuOf(p).waitFor({ timeout: 3000 });
      assert((await roomCanvas(p).count()) === 0, 'game still mounted');
      const before = await saveOf(p);
      assert(Date.now() - before.lastTick < 2000, 'save was not flushed when leaving the game');
      await p.waitForTimeout(3000);
      const after = await saveOf(p);
      assert(after.lastTick === before.lastTick && after.cc === before.cc, 'simulation kept running behind the menu');
      assert(await menuOf(p).locator('button:has-text("Continue")').isVisible(), 'Continue missing after returning with progress');
      await enterGame(p, 'continue');
    } finally {
      await context.close();
    }
  });

  await check('menu: sign in from the menu offers "Load cloud save" on another device', async () => {
    const email = `e2e-menu${Date.now()}@example.com`;
    const a = await fresh();
    const b = await fresh();
    try {
      // Device A: create the account from the menu, play, subscribe (uploads the save).
      await a.p.goto(URL);
      await a.p.click('[data-testid="menu-identity"] button:has-text("Sign in")');
      const dlg = a.p.locator('[role="dialog"]', { hasText: 'Account' });
      await dlg.locator('button:has-text("Create account")').first().click();
      await dlg.locator('input[autocomplete="email"]').fill(email);
      await dlg.locator('input[autocomplete="new-password"]').nth(0).fill('e2e-password');
      await dlg.locator('input[autocomplete="new-password"]').nth(1).fill('e2e-password');
      await dlg.locator('form button:has-text("Create account")').last().click();
      await verifyAndLogin(a.p, dlg);
      await a.p.getByTestId('menu-main').waitFor({ timeout: 8000 });
      await a.p.getByTestId('menu-identity-status').getByText(email).waitFor({ timeout: 5000 });
      await enterGame(a.p, 'new');
      await a.p.waitForTimeout(6500);
      await a.p.locator('nav[aria-label="Panels"] button:has-text("Account")').click();
      await a.p.locator('button:has-text("Subscribe")').first().click();
      await a.p.getByText('ACTIVE ·').waitFor({ timeout: 8000 });
      await a.p.getByText(/synced/).first().waitFor({ timeout: 8000 });
      // Device B: log in from the menu and load the cloud save.
      await b.p.goto(URL);
      await b.p.click('[data-testid="menu-identity"] button:has-text("Sign in")');
      const dlgB = b.p.locator('[role="dialog"]', { hasText: 'Account' });
      await dlgB.locator('input[autocomplete="email"]').fill(email);
      await dlgB.locator('input[autocomplete="current-password"]').fill('e2e-password');
      await dlgB.locator('form button:has-text("Log in")').last().click();
      const offer = b.p.getByTestId('cloud-offer');
      await offer.waitFor({ timeout: 8000 });
      await b.p.screenshot({ path: join(ART, 'menu-cloud-offer.png') });
      await offer.locator('button:has-text("Load cloud save")').click();
      await roomCanvas(b.p).waitFor({ timeout: 10_000 });
      await b.p.waitForTimeout(2500);
      const loaded = await saveOf(b.p);
      assert(loaded.stats.playTimeSec >= 5, `cloud save not loaded (played ${loaded.stats.playTimeSec}s)`);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  await check('menu: mobile layout has no horizontal overflow', async () => {
    const { context, p } = await fresh({ ...devices['iPhone 13'] });
    try {
      await bootPatched(p, "state.cash = '123456';", { enter: false });
      await p.getByTestId('continue-summary').waitFor({ timeout: 3000 });
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 0, `horizontal overflow of ${overflow}px on the menu`);
      await p.screenshot({ path: join(ART, 'menu-mobile.png') });
    } finally {
      await context.close();
    }
  });

  // ───────────── QA regressions: title screen / modals (see the QA report) ─────────────

  await check('regression: with "Offline earnings" off, Continue credits no time spent away or on the menu', async () => {
    const { context, p } = await fresh();
    try {
      await bootPatched(p, 'state.settings.offlineProgress = false; state.lastTick = Date.now() - 9 * 60 * 1000;', { enter: false });
      const before = await saveOf(p);
      await enterGame(p, 'continue');
      await p.waitForTimeout(2600);
      const after = await saveOf(p);
      const credited = after.stats.playTimeSec - before.stats.playTimeSec;
      assert(credited < 30, `${Math.round(credited)}s were simulated for a ~3 s session (the 9 min away were credited at the online rate)`);
    } finally {
      await context.close();
    }
  });

  await check('regression: Factory reset while synced does not silently overwrite the cloud save', async () => {
    const { context, p } = await fresh();
    const me = () =>
      p.evaluate(async () => {
        const { token } = JSON.parse(localStorage.getItem('hash-harvest-account')).state;
        return (await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } })).json();
      });
    try {
      await p.goto(URL);
      await enterGame(p, 'new');
      await p.waitForTimeout(6000);
      await p.locator('nav[aria-label="Panels"] button:has-text("Account")').click();
      await p.click('button:has-text("Create account")');
      await p.fill('input[autocomplete="email"]', `e2e-reset${Date.now()}@example.com`);
      await p.locator('input[autocomplete="new-password"]').nth(0).fill('e2e-password');
      await p.locator('input[autocomplete="new-password"]').nth(1).fill('e2e-password');
      await p.locator('form button:has-text("Create account")').last().click();
      await verifyAndLogin(p, p.locator('body'));
      await p.locator('button:has-text("Subscribe")').first().click();
      await p.getByText('ACTIVE ·').waitFor({ timeout: 8000 });
      await p.getByText(/synced/).first().waitFor({ timeout: 8000 });
      const cloudBefore = (await me()).save.summary;
      await p.locator('nav[aria-label="Panels"] button:has-text("System")').click();
      await p.click('button:has-text("Factory reset")');
      await p.click('button:has-text("Yes, wipe")');
      await p.click('button:has-text("Main menu")'); // auto-sync uploads on the way out
      await menuOf(p).waitFor({ timeout: 5000 });
      await p.waitForTimeout(2000);
      const cloudAfter = (await me()).save.summary;
      assert(
        cloudAfter.playTimeSec >= cloudBefore.playTimeSec,
        `the wiped local save replaced the cloud save without a conflict prompt (cloud play time ${cloudBefore.playTimeSec}s -> ${cloudAfter.playTimeSec}s)`,
      );
    } finally {
      await context.close();
    }
  });

  await check('regression: keyboard focus moves into the BIOS and Tab cannot reach the rack modal behind it', async () => {
    const { context, p } = await fresh();
    try {
      await p.goto(URL);
      await enterGame(p, 'new');
      const box = await roomCanvas(p).boundingBox();
      await p.mouse.click(box.x + (212 / 480) * box.width, box.y + (180 / 270) * box.height);
      await p.getByText('PCIE SLOTS').waitFor({ timeout: 3000 });
      await p.locator('button[title="Overclock in the BIOS"]').first().click();
      await p.getByText('PhoenixBits CMOS Setup Utility').waitFor({ timeout: 3000 });
      const focusInRack = () =>
        p.evaluate(() => {
          const rack = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => d.textContent.includes('PCIE SLOTS'));
          const a = document.activeElement;
          return { inRack: !!rack && rack.contains(a), label: (a?.getAttribute('aria-label') || a?.getAttribute('title') || a?.textContent || a?.tagName || '').trim().slice(0, 40) };
        });
      const open = await focusInRack();
      assert(!open.inRack, `focus stayed on "${open.label}" in the rack modal behind the BIOS`);
      await p.keyboard.press('Tab');
      const tabbed = await focusInRack();
      assert(!tabbed.inRack, `Tab inside the BIOS focused "${tabbed.label}" in the rack modal behind it (Enter would act on it)`);
    } finally {
      await context.close();
    }
  });

  await check('regression: Tab stays inside an open dialog on the title screen', async () => {
    const { context, p } = await fresh();
    try {
      await p.goto(URL);
      await p.click('[data-testid="menu-identity"] button:has-text("Play as guest")');
      await menuOf(p).locator('button:has-text("Settings")').click();
      const dialog = p.locator('[role="dialog"]', { hasText: 'AUDIO & VIDEO' });
      await dialog.waitFor({ timeout: 3000 });
      for (let i = 0; i < 20; i += 1) {
        await p.keyboard.press('Tab');
        const inside = await dialog.evaluate((d) => d.contains(document.activeElement));
        if (!inside) {
          const at = await p.evaluate(() => (document.activeElement?.textContent || document.activeElement?.tagName || '').trim().slice(0, 30));
          throw new Error(`Tab #${i + 1} left the Settings dialog (focus on "${at}" behind the aria-modal window)`);
        }
      }
    } finally {
      await context.close();
    }
  });

  await check('regression: returning from Stripe Checkout (?checkout=success) gives visible feedback', async () => {
    const { context, p } = await fresh();
    try {
      await p.goto(URL);
      await p.click('[data-testid="menu-identity"] button:has-text("Sign in")');
      const dlg = p.locator('[role="dialog"]', { hasText: 'Account' });
      await dlg.locator('button:has-text("Create account")').first().click();
      await dlg.locator('input[autocomplete="email"]').fill(`e2e-stripe-return${Date.now()}@example.com`);
      await dlg.locator('input[autocomplete="new-password"]').nth(0).fill('e2e-password');
      await dlg.locator('input[autocomplete="new-password"]').nth(1).fill('e2e-password');
      await dlg.locator('form button:has-text("Create account")').last().click();
      await verifyAndLogin(p, dlg);
      await p.getByTestId('menu-main').waitFor({ timeout: 8000 });
      await p.goto(`${URL}?checkout=success`);
      await p.waitForTimeout(2500);
      const inGameOnAccount =
        (await roomCanvas(p).count()) > 0 &&
        /account/i.test((await p.locator('nav[aria-label="Panels"] button[aria-current="page"]').textContent().catch(() => '')) ?? '');
      const menuFeedback = (await menuOf(p).count()) > 0 && (await menuOf(p).getByText(/checkout|miner pass/i).count()) > 0;
      await p.screenshot({ path: join(ART, 'checkout-return.png') });
      assert(inGameOnAccount || menuFeedback, 'back from checkout on the plain title screen: no confirmation, the Account-tab switch and log line are hidden behind the menu');
    } finally {
      await context.close();
    }
  });

  // ───────────── Email verification + password reset screens ─────────────
  const postJson = async (path, body) => {
    const r = await fetch(`${URL}api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const appLink = (devLink) => `${URL}${new globalThis.URL(devLink).search}`;
  const accountDialog = (p) => p.locator('[role="dialog"]', { hasText: 'Account' });

  await check('account: ?verify= link signs in, shows the result and cleans the URL; used/invalid links show an error', async () => {
    const { context, p } = await fresh();
    try {
      const email = `e2e-verify${Date.now()}@example.com`;
      const reg = await postJson('/auth/register', { email, password: 'e2e-password' });
      assert(reg.status === 202 && reg.json.devLink, `register: ${reg.status}`);
      const link = appLink(reg.json.devLink);
      await p.goto(link);
      const dlg = accountDialog(p);
      await dlg.getByText('Email confirmed. You are signed in.').waitFor({ timeout: 8000 });
      await dlg.getByText(email).waitFor({ timeout: 3000 });
      assert(!/verify=/.test(new globalThis.URL(p.url()).search), `URL not cleaned: ${p.url()}`);
      await p.screenshot({ path: join(ART, 'account-verified.png') });
      // The same link a second time: visible error, no session.
      const again = await fresh();
      try {
        await again.p.goto(link);
        await accountDialog(again.p).getByText('This link is invalid or has expired.').waitFor({ timeout: 8000 });
        assert(!/verify=/.test(new globalThis.URL(again.p.url()).search), 'URL not cleaned after a failed link');
        await again.p.screenshot({ path: join(ART, 'account-verify-failed.png') });
      } finally {
        await again.context.close();
      }
    } finally {
      await context.close();
    }
  });

  await check('account: forgot password form, ?reset= link, new password logs in (desktop and 390 px)', async () => {
    for (const [label, viewport] of [['desktop', { width: 1600, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
      const email = `e2e-forgot-${label}${Date.now()}@example.com`;
      const reg = await postJson('/auth/register', { email, password: 'old-password1' });
      await postJson('/auth/verify', { token: new globalThis.URL(reg.json.devLink).searchParams.get('verify') });
      const { context, p } = await fresh({ viewport });
      try {
        await p.goto(URL);
        await p.click('[data-testid="menu-identity"] button:has-text("Sign in")');
        const dlg = accountDialog(p);
        await dlg.locator('button:has-text("Forgot password?")').click();
        await dlg.getByTestId('forgot-form').waitFor({ timeout: 3000 });
        await p.screenshot({ path: join(ART, `account-forgot-${label}.png`) });
        await dlg.locator('input[autocomplete="email"]').fill(email);
        await dlg.locator('form button:has-text("Send reset link")').click();
        const sent = dlg.getByTestId('forgot-sent');
        await sent.waitFor({ timeout: 5000 });
        await p.screenshot({ path: join(ART, `account-forgot-sent-${label}.png`) });
        const link = appLink(await dlg.getByTestId('dev-link').getAttribute('href'));
        await p.goto(link);
        const reset = accountDialog(p).getByTestId('reset-form');
        await reset.waitFor({ timeout: 8000 });
        assert(!/reset=/.test(new globalThis.URL(p.url()).search), `URL not cleaned: ${p.url()}`);
        await p.screenshot({ path: join(ART, `account-reset-${label}.png`) });
        // Mismatch is shown, not swallowed.
        const pw = `new-password-${label}1`;
        await reset.locator('input[autocomplete="new-password"]').nth(0).fill(pw);
        await reset.locator('input[autocomplete="new-password"]').nth(1).fill('different-one');
        await reset.locator('button:has-text("Save new password")').click();
        await reset.getByText('Passwords do not match.').waitFor({ timeout: 2000 });
        await reset.locator('input[autocomplete="new-password"]').nth(1).fill(pw);
        await reset.locator('button:has-text("Save new password")').click();
        await accountDialog(p).getByText('Password updated. Log in with your new password.').waitFor({ timeout: 5000 });
        await p.screenshot({ path: join(ART, `account-reset-done-${label}.png`) });
        // Old password is refused with a visible error; the new one signs in.
        await dlg.locator('input[autocomplete="email"]').fill(email);
        await dlg.locator('input[autocomplete="current-password"]').fill('old-password1');
        await dlg.locator('form button:has-text("Log in")').last().click();
        await dlg.getByText('Wrong email or password.').waitFor({ timeout: 5000 });
        await dlg.locator('input[autocomplete="current-password"]').fill(pw);
        await dlg.locator('form button:has-text("Log in")').last().click();
        await p.getByTestId('menu-identity-status').getByText(email).waitFor({ timeout: 8000 });
      } finally {
        await context.close();
      }
    }
  });

  await check('account: an unconfirmed login shows "check your email" with resend (390 px)', async () => {
    const { context, p } = await fresh({ viewport: { width: 390, height: 844 } });
    try {
      const email = `e2e-pending${Date.now()}@example.com`;
      await postJson('/auth/register', { email, password: 'e2e-password' });
      await p.goto(URL);
      await p.click('[data-testid="menu-identity"] button:has-text("Sign in")');
      const dlg = accountDialog(p);
      await dlg.locator('input[autocomplete="email"]').fill(email);
      await dlg.locator('input[autocomplete="current-password"]').fill('e2e-password');
      await dlg.locator('form button:has-text("Log in")').last().click();
      await dlg.getByText('Confirm your email first', { exact: false }).waitFor({ timeout: 5000 });
      await dlg.getByTestId('check-email').waitFor({ timeout: 3000 });
      await dlg.locator('button:has-text("Resend verification")').click();
      await dlg.getByText('a new link is on its way', { exact: false }).waitFor({ timeout: 5000 });
      await p.screenshot({ path: join(ART, 'account-check-email-mobile.png') });
    } finally {
      await context.close();
    }
  });

  // ───────────── v7: Lab, roadmap, drones, daily bonus, Forge, bulk buying ─────────────
  const V7_SEED = `
    const g = Object.values(state.gpus)[0];
    for (let i = 0; i < 3; i += 1) state.gpus['spare' + i] = { ...g, uid: 'spare' + i, quality: 'bronze', wear: 0 };
    state.cash = '100000';
    state.lifetimeEarnings = '5';
    state.nextAirdropAt = 0;
  `;
  for (const view of [{ name: 'desktop', viewport: { width: 1600, height: 1000 } }, { name: '390 px', viewport: { width: 390, height: 844 } }]) {
    await check(`v7: goal bar, daily bonus, drone, Lab, Forge and bulk buying (${view.name})`, async () => {
      const { context, p } = await fresh({ viewport: view.viewport });
      const pageErrors = [];
      p.on('pageerror', (e) => pageErrors.push(e.message));
      try {
        await bootPatched(p, V7_SEED);
        const panel = (tab) => p.locator(`nav[aria-label="Panels"] button[title="${tab}"]`);

        // Roadmap: the first goal is met by the seed, claiming it moves to the second.
        const title = p.getByTestId('goal-title');
        await p.getByTestId('goal-claim').click({ timeout: 8000 });
        await p.waitForFunction(() => document.querySelector('[data-testid="goal-title"]')?.textContent !== 'First sale', null, { timeout: 3000 });
        assert((await title.textContent()) !== 'First sale', 'goal did not advance after the claim');

        // Supply drone: due at once, catch it with the button.
        await p.getByTestId('airdrop-catch').click({ timeout: 8000 });
        await p.getByText(/DRONE CRATE/).first().waitFor({ timeout: 3000 });
        assert((await p.getByTestId('airdrop-catch').count()) === 0, 'drone still there after catching it');

        // Daily bonus: claim once, then it reports as claimed.
        await p.getByTestId('daily-open').click();
        await p.getByTestId('daily-ladder').waitFor({ timeout: 3000 });
        await p.getByTestId('daily-claim').click();
        await p.getByText('Claimed. Come back tomorrow!').waitFor({ timeout: 3000 });
        await p.screenshot({ path: join(ART, `v7-daily-${view.name === 'desktop' ? 'desktop' : 'mobile'}.png`) });
        await p.keyboard.press('Escape');
        assert((await p.getByTestId('daily-ladder').count()) === 0, 'Escape did not close the daily bonus');

        // Lab: start a project, see it running, cancel it for a refund.
        await panel('Lab').click();
        await p.getByTestId('research-airflow').locator('button').click();
        await p.getByTestId('lab-active').waitFor({ timeout: 3000 });
        await p.screenshot({ path: join(ART, `v7-lab-${view.name === 'desktop' ? 'desktop' : 'mobile'}.png`) });
        await p.getByTestId('lab-active').locator('button:has-text("Cancel")').click();
        await p.getByText('The Lab is idle. Pick a project below.').waitFor({ timeout: 3000 });

        // Forge: the three seeded spares fuse into one better card.
        await panel('Rigs').click();
        const group = p.locator('[data-testid^="forge-"]').first();
        await group.locator('button:has-text("Fuse")').click();
        await p.getByText(/SILICON FORGE: 3x/).first().waitFor({ timeout: 3000 });
        await p.getByTestId('autofill-all').click();
        await p.getByText(/Auto-fill: \d+ parts installed/).first().waitFor({ timeout: 3000 });

        // Shop: x5 buys five coolers in one click.
        await panel('Shop').click();
        await p.locator('button:has-text("Cooling")').first().click();
        await p.getByTestId('qty-5').click();
        await p.locator('div.bg-panel-2 button:has-text("Buy x5")').first().click();
        await p.getByText(/Bought 5x /).first().waitFor({ timeout: 3000 });

        // Progress panel: roadmap list and stats.
        await panel('Trophies').click();
        await p.getByTestId('roadmap-current').waitFor({ timeout: 3000 });
        await p.screenshot({ path: join(ART, `v7-progress-${view.name === 'desktop' ? 'desktop' : 'mobile'}.png`), fullPage: true });
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(overflow <= 1, `page scrolls horizontally by ${overflow}px`);
        assert(pageErrors.length === 0, pageErrors.join(' | '));
      } finally {
        await context.close();
      }
    });
  }

  await check('AI Farm Manager: buy an hour with gems, it starts buying, pause stops the clock (desktop + 390 px)', async () => {
    for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }]) {
      const { context, p } = await fresh({ viewport });
      const pageErrors = [];
      p.on('pageerror', (e) => pageErrors.push(e.message));
      try {
        await bootPatched(p, `state.gems = 5; state.cash = '3000'; state.nextAirdropAt = Date.now() + 3600000;`);
        await p.locator('nav[aria-label="Panels"] button[title="VIP"]').click();
        const card = p.getByTestId('autopilot-card');
        assert(await p.getByTestId('autopilot-buy-d1').isDisabled(), 'the 1-day plan should need more gems');
        await p.getByTestId('autopilot-buy-h1').click();
        await p.getByTestId('autopilot-status').getByText(/Working · /).waitFor({ timeout: 3000 });
        await p.getByTestId('autopilot-chip').waitFor({ timeout: 3000 });
        // It has cash: within a few seconds it buys something and says so.
        await p.getByText(/AI MANAGER: /).first().waitFor({ timeout: 15000 });
        const stats = (await card.textContent()) ?? '';
        assert(/[1-9]\d* purchases/.test(stats), `no purchase recorded: ${stats}`);
        await p.screenshot({ path: join(ART, `autopilot-${viewport.width}.png`) });
        await p.getByTestId('autopilot-pause').click();
        await p.getByTestId('autopilot-status').getByText(/Paused · /).waitFor({ timeout: 3000 });
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(overflow <= 1, `page scrolls horizontally by ${overflow}px`);
        assert(pageErrors.length === 0, pageErrors.join(' | '));
      } finally {
        await context.close();
      }
    }
  });

  await check('test account: "danitest" / "AITEST" logs in, loads 1000 gems on a brand new farm and can buy a manager day', async () => {
    const { context, p } = await fresh();
    try {
      await p.goto(URL);
      await p.click('[data-testid="menu-identity"] button:has-text("Sign in")');
      const dlg = accountDialog(p);
      await dlg.locator('input[autocomplete="email"]').fill('danitest');
      await dlg.locator('input[autocomplete="current-password"]').fill('AITEST');
      await dlg.locator('form button:has-text("Log in")').last().click();
      const offer = p.getByTestId('cloud-offer');
      await offer.waitFor({ timeout: 8000 });
      await offer.locator('button:has-text("Load cloud save")').click();
      await roomCanvas(p).waitFor({ timeout: 10_000 });
      const state = await p.evaluate(() => JSON.parse(localStorage.getItem('hash-harvest-tycoon')).state);
      assert(state.gems === 1000, `expected 1000 gems, got ${state.gems}`);
      assert(Object.keys(state.gpus).length === 1 && state.ownedRooms.length === 1 && state.stats.halvings === 0, 'the test account should start on a brand new farm');
      assert(Number(state.lifetimeEarnings) === 0 && state.roadmap.step === 0, 'the test account should have no progress');
      await p.locator('nav[aria-label="Panels"] button[title="VIP"]').click();
      await p.getByTestId('autopilot-halving').check();
      await p.getByTestId('autopilot-buy-d1').click();
      await p.getByTestId('autopilot-status').getByText(/Working · /).waitFor({ timeout: 3000 });
      await p.screenshot({ path: join(ART, 'test-account.png') });
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
