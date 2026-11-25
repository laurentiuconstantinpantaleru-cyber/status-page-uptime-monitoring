# AI_LOG

## 2026-11-25 · Project foundation

**Unealta:** Claude Code (Claude Opus 5.5), with the repo's `/plan` and `/build` skills.

**Ce am cerut:** The project foundation through `/plan` and then `/build`: folders
`src/web`, `src/worker`, `src/shared`; TypeScript config; Fastify with a health
endpoint; Vitest with an injectable Clock; docker-compose with PostgreSQL;
`.env.example`; a CI workflow that runs the tests and `ledger-lint.py`.

**Ce am primit:**
- A plan with files, tests, risks and the ledger entries it relied on, plus three
  open questions (folder layout vs. `ARCHITECTURE.md`, health check with or without
  the database, what to do with uncommitted decision drafts).
- Tests written first (`test/web/health.test.ts`, `test/shared/clock.test.ts`, 5 tests),
  failing because the modules did not exist, then the code that makes them pass:
  `src/web/app.ts` (`GET /health` → `{"status":"ok"}`), `src/web/server.ts`,
  `src/shared/clock.ts` (`Clock`, `systemClock`, `FakeClock`).
- `package.json` (fastify 5; typescript 7, vitest 5, @types/node 22), `tsconfig.json`,
  `vitest.config.ts`, `docker-compose.yml` (PostgreSQL 17 only, named volume,
  `pg_isready` healthcheck), `.env.example` with placeholders, and the existing CI
  workflow rewritten to run ledger lint, `npm ci`, build and tests on Node 22.
- Checks: `npm test` 5/5, `npm run build`, `npm run lint` and `ledger-lint.py` pass;
  the PostgreSQL container reached `healthy` and answered `PostgreSQL 17.12`.

**Ce am făcut cu ea:**
- Confirmed the plan with its recommendations: keep the three folders and update
  `ARCHITECTURE.md` to match; `/health` without a database check; leave the
  uncommitted decision drafts untouched during the build.
- Changed: `PATTERN-001` now puts `advance(ms)` only on `FakeClock`, not on the
  `Clock` interface, so production code cannot move time. `ARCHITECTURE.md` was
  corrected from `src/workers/`, `src/cache/`, `src/scheduler/` to the three roots.
- Rejected / not taken: no ESLint (not requested; `npm run lint` is `tsc --noEmit`
  plus the ledger lint), no `pg` driver and no database check in `/health`, no
  migrations yet, no SMTP/Telegram variables in `.env.example` (Q-004 still open).
- Stopped the agent when it wrote `docker-compose.yml`, `.env.example` and the CI
  file through shell heredocs; asked for them to be written with the file-writing
  tool and to see `docker-compose.yml` before it was run. The first config files
  (`package.json`, `tsconfig.json`, `vitest.config.ts`) had already been written
  with heredocs before that.
- Docker was not reachable from WSL at first and `.env` was missing, so the compose
  check waited until Docker was running and `.env` was created from `.env.example`
  with a generated password (kept only in `.env`, which is git-ignored).
- Left as is: `env_file: .env` also passes `PORT` and `DATABASE_URL` into the
  PostgreSQL container; harmless, not changed.
- Merged the foundation branch into `main` locally after the checks passed.
