# Hash Harvest Tycoon — notes for Claude

Pixel-art crypto-mining tycoon: React 19 + TypeScript strict + Vite + Zustand + Canvas 2D, with a zero-dependency Node account server (`server/`, node:sqlite, Stripe or demo billing).

## Commands
- `npm run dev` — local development: account server (:8787) + Vite together (Vite proxies `/api` to :8787). Separately: `dev:server` and `dev:web`. `npm run dev` sets `SEED_TEST_ACCOUNT=1`, which seeds the dev login `danitest` / `AITEST` (1000 gems); a bare `npm run server` needs that variable set by hand.
- `npm run typecheck` — frontend + server.
- `npm test` — Vitest unit tests (`tests/unit/`).
- `npm run test:e2e` — Playwright smoke test (needs `npm run build`; boots its own server on :8799).
- `npm run test:server` — account server security/billing test against a fake Stripe.
- `npm run test:all` — build + unit + server + E2E. Must be green before finishing any change. Current counts and branch state: `HANDOFF.md`.

## Conventions
- Simulation lives in the pure `src/store/gamePhysics.ts` (runs in a Web Worker); it returns deltas merged by `applyTick`.
- Persisted fields: `GameData` + `DATA_KEYS` + `createInitialData` + a migration in `src/store/migrations.ts` (bump `SAVE_VERSION` and `server/config.ts` `MAX_SAVE_VERSION`).
- Currency is `BigNum` strings (`src/utils/bignum.ts`). No `any`. All sprites procedural (`src/engine/SpriteManager.ts`).
- Selectors returning objects must use `useGameShallow`/`useShallow`.
- Earnings (`runEarnings`/`lifetimeEarnings`) only count realized profit over the coins' cost basis (`ccCostBasis`/`memeCostBasis`).
- Player edits to simulated GPU fields must call `recordGpuEdit` (`src/store/editLedger.ts`) so in-flight ticks don't revert them.
- Modals must register in `src/utils/modalStack.ts` so Escape only closes the top one.
- Dates, clocks and money use the `format*` helpers in `src/utils/formatters.ts` (game language, never the browser locale). Canvas text goes through `drawPixelText` (accents are stripped by `pixelTextOf`).
- The server refuses demo billing and the console mailer on a public deployment (`NODE_ENV=production` or a non-local `APP_URL`).

## Agents (`.claude/agents/`)
- `gameplay-feature-dev` builds features · `pixel-art-dev` visuals · `balance-designer` economy data
- `game-qa-tester` runs/extends tests and hunts bugs (edits only `tests/`)
- `backend-security-reviewer` audits `server/` (read-only)
Typical loop: feature-dev / pixel-art-dev implement → game-qa-tester verifies → fix → backend-security-reviewer for server changes.
