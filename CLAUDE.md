# Hash Harvest Tycoon — notes for Claude

Pixel-art crypto-mining tycoon: React 19 + TypeScript strict + Vite + Zustand + Canvas 2D, with a zero-dependency Node account server (`server/`, node:sqlite, Stripe or demo billing).

## Commands
- `npm run dev:server` + `npm run dev` — local development (Vite proxies `/api` to :8787).
- `npm run typecheck` — frontend + server.
- `npm test` — Vitest unit tests (`tests/unit/`).
- `npm run test:e2e` — Playwright smoke test (needs `npm run build`; boots its own server on :8799).
- `npm run test:all` — build + unit + E2E. Must be green before finishing any change.

## Conventions
- Simulation lives in the pure `src/store/gamePhysics.ts` (runs in a Web Worker); it returns deltas merged by `applyTick`.
- Persisted fields: `GameData` + `DATA_KEYS` + `createInitialData` + a migration in `src/store/migrations.ts` (bump `SAVE_VERSION` and `server/config.ts` `MAX_SAVE_VERSION`).
- Currency is `BigNum` strings (`src/utils/bignum.ts`). No `any`. All sprites procedural (`src/engine/SpriteManager.ts`).
- Selectors returning objects must use `useGameShallow`/`useShallow`.

## Agents (`.claude/agents/`)
- `gameplay-feature-dev` builds features · `pixel-art-dev` visuals · `balance-designer` economy data
- `game-qa-tester` runs/extends tests and hunts bugs (edits only `tests/`)
- `backend-security-reviewer` audits `server/` (read-only)
Typical loop: feature-dev / pixel-art-dev implement → game-qa-tester verifies → fix → backend-security-reviewer for server changes.
