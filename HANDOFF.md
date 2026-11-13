# Handoff — Hash Harvest Tycoon

Branch: `claude/laughing-shannon-fwtvb4` (pushed to origin). No PR to `main`: do not create one unless the user asks.
Reply to the user in Spanish. Project conventions are in `CLAUDE.md`; do not repeat them here.

## State
- Green: `npm run test:all` = build + Vitest unit + server (`tests/server/security.mjs`) + E2E (`tests/e2e/smoke.mjs`). Current counts are in the last section of this file.
- Shipped before this update: pixel-art tycoon, account/subscription server, Halving and talent tree, title screen, bilingual wiki, contracts, challenges, altcoins, Lab research, roadmap, supply drones, daily bonus, Silicon Forge, bulk buying, AI Farm Manager, dev test account.
- Save format: see `SAVE_VERSION` in `src/config/gameBalance.ts` (must equal `MAX_SAVE_VERSION` in `server/config.ts`).

## v9 systems (where things live)
- Floating canvas labels: `FloatingTextLayer` in `src/engine/PixelCanvas.ts`; the simulation reports `SimOutput.rackFx` and store actions emit `fxBus` `rackText` events.
- Thermal view: `thermalView` (UI state, key `T`), palette `thermalColor` in `SpriteManager.ts`.
- Crew rally and special drones: `src/config/buffs.ts` + `GameData.buffs` (read by `gamePhysics.ts`).
- Ambience: `ambienceFor` in `src/hooks/useAudioFx.ts` (pure mapping), separate `settings.ambientVolume`.
- Hotkeys: `src/hooks/useHotkeys.ts` (ignored while typing or with a dialog open).

## i18n
- `src/i18n/index.ts`: English text is the key. React uses `const t = useT()`, other code `tr(en, params)`. Placeholders are `{name}`.
- Language lives in `useLangStore` / localStorage `hh-lang`, outside the save. Dictionaries: `src/i18n/es/*.ts`, merged in `es/index.ts` (`update9.ts` holds everything added by the v9 update).
- `gamePhysics.ts` (Web Worker) never imports i18n: its messages carry `key`/`params` and the log renders them with `logLine`, so the whole log follows a language switch (covered by E2E).
- Dates, clocks and money go through `formatDate` / `formatClock` / `formatDateTime` / `formatMoney` (`es-ES` / `en-US` from the game language, never the browser locale).
- Canvas text uses the 3×5 font in `SpriteManager.ts`; `pixelTextOf` upper-cases and strips accents (Ñ has a glyph), so dictionary entries are written in normal Spanish.

## Server
- A public deployment (`NODE_ENV=production` or an `APP_URL` that is not localhost / 127.0.0.1 / ::1) refuses to start with demo billing or the console mailer. Production needs Stripe keys and `MAIL_MODE=http`.
- `inspectSave` validates and bounds every summary field (`SUMMARY_LIMITS`): NaN, Infinity, negatives and out-of-range values reject the save with `invalid_save`.
- Dev test account `danitest` / `AITEST` (1000 gems, Miner Pass): only seeded when `SEED_TEST_ACCOUNT=1` on a local dev server (demo billing + `MAIL_MODE=log` + not production). `npm run dev` and both test suites set it; `npm run server` alone does not. Any other server deletes the seeded row.

## Gotchas
- `npm run test:e2e` boots its own server on :8799 (override with `E2E_PORT`); `test:server` uses 8781-8787 (`SEC_PORT_BASE`). A stale server on those ports makes the suites test an old build: check with `ps aux | grep server/index.ts`.
- E2E selects side tabs with `nav[aria-label="Panels"] button[title="…"]`: keep each tab's `title` equal to its English label.
- The i18n unit test fails on any literal `t('…')` / `tr('…')` / `logT('…')` without a Spanish entry.
- Commit messages end with the attribution lines of the session; no model ids in code or commits.

## Test counts
- Phase 1 of the v9 update (audit and hardening): 280 unit, 38/38 server, 37/37 E2E.
- Phase 2 (game feel: floating labels, thermal view, crew rally, special drones, ambience synth; save v9): 304 unit, 38/38 server, 38/38 E2E.
