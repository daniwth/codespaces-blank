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
const { chromium } = require('playwright');

const PORT = 8799;
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
    for (const tab of ['Shop', 'Rigs', 'Market', 'Pools', 'Halving', 'VIP', 'Trophies', 'Account', 'System']) {
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
