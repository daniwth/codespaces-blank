# Handoff — Hash Harvest Tycoon

Branch: `claude/hash-harvest-tycoon` (pushed, up to date with origin). No PR to `main` yet: it was offered twice and the user has not answered. Do not create one unless they say yes.
Reply to the user in Spanish. Project conventions are in `CLAUDE.md`; do not repeat them here.

## State
- The game is complete and green: `npm run test:all` = 147 unit, 17/17 server, 27/27 E2E.
- Features done: pixel-art tycoon, account and subscription server, Halving/SC economy and talent tree, title screen (new game / account / guest / settings), wiki, QA fixes for the title flow.
- **Last task (done): Spanish translation.** See `git log` for the commits.
  - Core: `src/i18n/index.ts`. English text is the key. React uses `const t = useT()`, non-React code uses `tr(en, params)`. Placeholders are `{name}`. A missing key falls back to English.
  - The language lives in `useLangStore` and localStorage `hh-lang`, outside the save (no migration). The default follows `navigator.language`. The selector is in `SettingsPanel`.
  - Spanish dictionaries: `src/i18n/es/{common,menu,game,panels,data,store,wiki}.ts`, merged in `es/index.ts`.
  - Config strings (names, descriptions) stay in English in `src/config`; components call `t(model.name)` and the entries live in `es/data.ts`.
  - The wiki is bilingual: `wikiContent.ts` (es), `wikiContent.en.ts`, `wikiFacts.ts`, `wikiTables.ts` takes a `lang`.
  - `gamePhysics.ts` (Web Worker) does not import i18n. Its messages carry `key`/`params` and `applyTick` translates them.
  - Tests: `tests/unit/i18n.test.ts` (every literal `t('…')` needs a Spanish entry, placeholders must match) and `tests/unit/i18nData.test.ts`. E2E runs in English.

## Known limits / possible follow-ups
- The Press Start 2P pixel font draws uppercase Ó/É small ("SESIóN"). It is a font limitation. Canvas text in the world is ASCII-only Spanish (`SOBRECAL`, `VACIO`).
- Log lines and notices keep the language they had when created; they do not retranslate when the language changes.
- Dates use the browser locale, not the game language.
- Not checked by hand in Spanish: every side tab and the mobile layout (agents checked their own areas at 390 px and desktop; I only viewed the title screen and the game with the shop open).
- Dynamic keys (non-literal `t(x)`) are not covered by the coverage test; the data test covers the config catalogs only.
- Other notes: the title backdrop uses about 0.2 s of CPU per second on the menu; the shop ROI ignores electricity.

## Gotchas
- `npm run test:e2e` boots its own server on :8799. A stale server from an old agent worktree held that port and made E2E test an old build. Check with `ps aux | grep server/index.ts` and kill it, or use `E2E_PORT`.
- Worktrees under `.claude/worktrees/agent-*` are leftovers from the agents (all merged). Safe to remove with `git worktree remove`.
- Agent worktrees may start from `main`: tell agents to `git reset --hard claude/hash-harvest-tycoon` first.
- Stop hooks ask to commit and push. This file is untracked: commit it or delete it, as the user prefers.
- Commit messages end with the `Co-Authored-By` and `Claude-Session` lines from the attribution reminder; no model ids in code or commits. Push with `git push -u origin claude/hash-harvest-tycoon` and retry on network errors.

## Suggested skills
- `anthropic-skills:caveman` only if the user asks for terse answers.
- For a PR, there is no dedicated skill: use the GitHub MCP `create_pull_request` after checking for a PR template, and only when the user says yes.
- `code-review` or `security-review` if the user wants a review before the PR.
