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
- Hotkeys: `src/hooks/useHotkeys.ts` (ignored while typing or with a dialog open; keys listed in `allowInDialog` such as `?` still fire). Bindings live in `gameHotkeys` in `src/components/App.tsx`: `1`-`9`/`0` tabs, `T` thermal view, `R` repaste, `B` BIOS of the hottest rack, `M` market, `?` help (`src/components/ui/HotkeysModal.tsx`).
- HUD P&L and bottleneck diagnosis: pure `farmPnl` / `diagnoseFarm` in `gamePhysics.ts`, rendered by `src/components/ui/FarmDiagnosis.tsx`.
- Shop impact preview: pure `mountPreview` / `previewPurchase` in `gamePhysics.ts`; the shop shows it in a fixed `impact-bar` (not inside the card, so hovering never moves the Buy button).
- Mass room actions (repaste all, repair all, auto-equip best): `repasteAll(roomId?)`, `repairAll`, `autoEquipBest` in `hardwareSlice.ts`, buttons in `WorldCanvas.tsx`.
- Rack synergies, BIOS profiles and Smart BMC defaults: `src/config/synergy.ts`; room rules (day/night clock, garage waves, battery, condensation, hull limit): `ROOM_MECHANICS` in `src/config/roomsCatalog.ts`. All of it is applied in `gamePhysics.step`.
- Balance note: the Cluster Bonus trims the electrical draw only (die heat is unchanged) and Liquid Spillover only helps racks without a liquid loop, so the cooling ladder and the wiki's packed-room model still hold.
- Market cycle, news and orders: `src/config/marketCycle.ts` (`stepCycle` / `cycleEffect` in the simulation). Pools declare a `scheme` (PPS / PPLNS / solo); PPLNS shares wait in `poolPending`.
- Reputation and Special Contracts: `src/config/reputation.ts` + `GameData.reputation` (the chain stage advances through a one-slot board).
- Relics and the Silicon Collection: `src/config/collection.ts`; they reach the simulation through `runModifiers(talents, research, perks)`.
- Unit tests freeze the market cycle in `tests/unit/helpers.ts` (like network events), because phase changes and headlines draw from the RNG.

## v10 systems (where things live)
- Offline report: pure `offlineDigest(before, after, out)` in `gamePhysics.ts` (events plus a "do first" list from `diagnoseFarm`), rendered by `OfflineModal.tsx`.
- Daily books: `GameData.ledger` (14 days, survives Halvings), folded every tick by `foldLedger`; chart in `src/components/panels/DailyLedger.tsx` (Trophies tab).
- Contextual hints: `src/config/hints.ts` (`HINTS`, `nextHint`), seen ids in `GameData.hints`, shown by `HintToast.tsx`; `settings.hints` turns them off. E2E seeds `state.hints` with the ids it does not want on screen.
- Thermal palette: `settings.thermalPalette` (`infrared` | `safe`), ramps in `SpriteManager.ts` (`thermalColor(celsius, ramp)`).
- Power market: `src/config/energy.ts` (`gridSpot`, `ppaQuote`, plans). Gated by the `energy` research: without it the bill is the flat tariff, so older balance tests are untouched. The contract is `GameData.ppa` (run-scoped); UI in `src/components/market/EnergyDesk.tsx`. Offline bills the index mean.
- Power surges: `SURGE` in `src/config/synergy.ts`, applied in `gamePhysics.step` after a thermal shutdown (online only); protectors live in `upgrades.surge` (room ids), bought with `buyRoomUpgrade('surge', roomId)`.
- Predictive Maintenance (`predictive` research): pure `maintenanceForecast` in `gamePhysics.ts`, shares `crewRates` with the simulation; shown by the HUD diagnosis and `RackDetailModal`.
- Randomized invariants: `tests/unit/update10Existing.test.ts` simulates 40 seeded farms. Mocking `Math.random` to exactly 0 hangs the market's gaussian draw: use a small non-zero value.

## v11 systems (where things live)
- Ranks: `src/config/ranks.ts` (`RANKS`, `rankIndex`, `ABILITIES`). The level comes from `lifetimeEarnings`, so ranks survive Halvings; their bonuses enter `runModifiers` through `perks.lifetimeEarnings` (pass it wherever `runModifiers` gets perks). `GameData.rankSeen` makes the gems of a rank pay once (`checkRank`, run every tick); older saves start at the rank they hold.
- Flash Mining: `buffs.rentHash` / `rentUntil` / `rentCooldownUntil`; pure `rentRate` and `flashQuote` in `gamePhysics.ts`; action `rentHashrate`.
- Pool Partner: `GameData.partner` (run-scoped), bonus applied in the mining yield; `setPool` breaks the deal (reputation penalty, `buffs.partnerCooldownUntil`); action `signPartner`.
- Hard Fork: network event `hard_fork`, `forkHashMul(firmwareLevel)` in `gameBalance.ts`. It was appended to the event pool, so tests that mock the RNG to pick an event keep their mapping only for the earlier ids.
- UI: `RankLadder.tsx` (Trophies), `RankAbilities.tsx` (Pools), `RankToast.tsx`, rank name in the HUD.

## v12 systems (where things live)
- Chip Foundry: `src/config/foundry.ts` (`FOUNDRY_NODES`, `foundryState`, `foundryModifiers`, `legalFoundry`). `GameData.foundry` is run-scoped; the simulation applies hashrate and heat per chip family (`chipFamily(model.style)`), purchases use `lotteryLuck` (`hardwareSlice.ts`). UI: `FoundryTree.tsx` at the bottom of the Lab.
- Sandbox mode: `GameData.sandbox`, set by `startNewGame(challenge, sandbox)` from the title screen and carried through The Halving. The simulation skips wear, paste drying, bad network events, raids and surges; challenge runs are refused in `createInitialData`.

## Security hardening (after the adversarial audit)
- Server never dies on a request: `requestPath` only accepts origin-form targets, the listener body is fully wrapped, plus `clientError` / `unhandledRejection` handlers and request timeouts (`server/index.ts`).
- Sign-up: an unverified address registered again with a different password becomes `contested`; on verification no password is kept and the mailbox gets a reset link (`passwordResetRequired` in the verify answer). Never go back to "latest password wins".
- A development server listens on 127.0.0.1 only (`listenHost`, override with `HOST`) and `devLink` is only returned to loopback clients. A live Stripe key makes the deployment public.
- Billing: a paid subscription with no account, or a second one, is cancelled at Stripe from the webhook; a repeated checkout reuses the open session; Stripe ids are validated before they enter a path; deleting an account also deletes its Stripe customer (best effort).
- Limits: per-account login failures across IPs, IPv6 counted per /64 (`server/net.ts`), mail budget per mailbox (`canonicalEmail`), common passwords refused, stricter email syntax.
- Saves are attacker input. Catalog `*_BY_ID` tables have no prototype (`src/utils/dict.ts`); check ids with `hasKey`, never `table[id]` truthiness or `id in table`. `migrations.ts` caps hardware counts (`SAVE_CAPS`), mounts each part once, one rack per pad, validates `event`, bounds wallets and counters. `safeMigrate` keeps an unreadable save under `BROKEN_SAVE_KEY` instead of overwriting it.
- Regression tests: `tests/unit/securityHardening.test.ts` (hostile saves) and the new checks in `tests/server/security.mjs`.
- Known and accepted: a player can edit their own local save (gems, VIP, autopilot time cost no money and nobody else sees them); the session token lives in localStorage; there is no "log out everywhere" besides a password reset.

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
- Phase 3 (rack synergies, undervolt floor and BIOS profiles, room identity, Smart BMC): 328 unit, 38/38 server, 39/39 E2E.
- Phase 4 (market cycle, news, TP/SL orders, PPLNS, reputation chains, new talents, relics, collection): 357 unit, 38/38 server, 40/40 E2E.
- Phase 5 (HUD P&L and diagnosis, shop impact preview, mass room actions, hotkeys and help modal, wiki entry for the v9 systems): 373 unit, 38/38 server, 41/41 E2E.
- v10, part 1 (offline digest, daily books, hints, colour-blind palette, randomized invariants; save v10): 434 unit, 38/38 server, 42/42 E2E.
- v10, part 2 (power market and contracts, power surges and protectors, Predictive Maintenance): 455 unit, 38/38 server, 43/43 E2E.
- v11 (ranks with gem rewards and high-rank bonuses, Flash Mining, Pool Partner, Hard Fork event; save v11): 477 unit, 38/38 server, 44/44 E2E.
- v12 (Chip Foundry tree, Sandbox mode; save v12): 490 unit, 38/38 server, 45/45 E2E.
- Security hardening after the audit: 504 unit, 45/45 server, 45/45 E2E.
