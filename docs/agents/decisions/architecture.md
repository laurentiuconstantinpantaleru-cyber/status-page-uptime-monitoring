# Architecture Decisions

## D-001 · Node.js + TypeScript with Fastify for web API, SSR status page, and workers
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** Use Node.js and TypeScript with Fastify across the codebase: for the HTTP REST API, the server-rendered public status page, and background check workers running as separate processes from the same codebase.
- **Why:** Delivers high I/O throughput for concurrent network probing, unified type definitions between web and workers, and sub-100ms response times for cached status endpoints.
- **Rejected:** Go or Python (user selected Node.js + TypeScript ecosystem); NestJS / Express (Fastify is faster and has low overhead).
- **Evidence:** docs/brief.md:19
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19

## D-002 · Server-rendered frontend with minimal vanilla JS for charts
- **Status:** superseded-by D-024
- **Date:** 2026-11-19
- **Rule:** Render public status pages and admin interfaces server-side using Fastify templates with minimal client-side vanilla JavaScript strictly for rendering uptime/latency charts; do not introduce React or heavy SPA frameworks.
- **Why:** Maximizes page load speed, achieves sub-100ms TTFB for public status pages, keeps build pipeline simple, and avoids frontend hydration overhead.
- **Rejected:** React, Next.js, Vue SPA (rejected by user in favor of SSR with minimal JS).
- **Evidence:** docs/brief.md:14, docs/brief.md:22
- **Source:** user · confidence high

## D-024 · Server-rendered frontend with minimal vanilla JS for charts and the theme toggle
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** Render public status pages and admin interfaces on the server with templates, with minimal client-side vanilla JavaScript only for the uptime and latency charts (including the daily bar tooltips) and for the light/dark theme toggle (saved in localStorage, the system preference on first load). Menus use `<details>`, without JavaScript. Do not introduce React or heavy SPA frameworks.
- **Why:** Keeps D-002's speed and simplicity; the user asked for a theme toggle on DS-p26-public-status, which needs a few lines of script.
- **Rejected:** React, Next.js, Vue SPA (as in D-002); a theme toggle without memory (the choice would reset on every visit).
- **Evidence:** src/web/views/status.html, docs/design/mocks/DS-p26-public-status.html
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26

## D-003 · PostgreSQL with versioned migrations and in-memory cache for status page
- **Status:** superseded-by D-020
- **Date:** 2026-11-19
- **Rule:** Use PostgreSQL as the relational datastore with versioned migrations. Do not use Redis; use an in-process in-memory cache with immediate invalidation on monitor state transition to serve public status page data.
- **Why:** Reliable ACID transactions for incidents, maintenance windows, and roll-ups, while in-memory caching keeps operational complexity low without external caching services.
- **Rejected:** Redis (unnecessary complexity for single-host setup), MongoDB (weak relational consistency for incident tracking).
- **Evidence:** docs/brief.md:21, docs/brief.md:22
- **Source:** user · confidence high

## D-020 · MySQL 8 with versioned migrations and in-memory cache for status page
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** Use MySQL 8 as the relational datastore with versioned migrations. All timestamps are stored in UTC as `DATETIME(3)`, and every connection sets `time_zone = '+00:00'`. Do not use Redis; use an in-process in-memory cache in the web process. Workers increment a version number in the database on every monitor state change; the web process reads it every 30 seconds (Q-007) and invalidates the cache when it changes.
- **Why:** The user knows MySQL better.
- **Rejected:** PostgreSQL (the user knows MySQL better); Redis (unnecessary complexity for single-host setup, as in D-003); MongoDB (weak relational consistency for incident tracking, as in D-003); LISTEN/NOTIFY for invalidation (not available in MySQL).
- **Evidence:** docs/brief.md:21, docs/brief.md:22
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26

## D-021 · Plain SQL migrations applied forward-only by an own runner
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** Schema changes are numbered SQL files in `db/migrations/` (`NNNN_name.sql`), applied in order and forward only by `src/db/migrate.ts` (`npm run db:migrate`, driver `mysql2`) and recorded in `schema_migrations`. An applied migration is never edited; a mistake is fixed by a new migration. Time columns have no database default (`CURRENT_TIMESTAMP`); the application supplies every time from its `Clock`.
- **Why:** The smallest tool that gives versioned migrations (D-020); the only new dependency is the MySQL driver the app needs anyway. Times from the `Clock` keep simulated-time tests in control of every stored timestamp (D-004).
- **Rejected:** knex migrations (adds a query builder nobody asked for); dbmate (an external binary to install locally and in CI); database time defaults (bypass the simulated clock).
- **Evidence:** src/db/migrate.ts, db/migrations/0001_initial_schema.sql
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26

## D-004 · Vitest with injectable clock for simulated-time tests
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** Use Vitest as the testing framework. All time-dependent routines (scheduler drift prevention, maintenance overlap, multi-month uptime calculations across month boundaries) must be tested using an injectable simulated clock and never real-world timers or `sleep()`.
- **Why:** Core requirement of the project brief: verify 300+ monitors and multi-month calculations deterministically in seconds without timer drift.
- **Rejected:** Jest (slower, complex ESM setup with TypeScript); `setTimeout`/sleep-based testing (non-deterministic and slow).
- **Evidence:** docs/brief.md:19, docs/brief.md:24, docs/brief.md:33
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19

## D-005 · Multi-worker check architecture with two-phase failure confirmation
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** Check workers must run as separate processes from the web server (minimum 2 workers). A failure detected by one worker must be verified and confirmed by a second independent worker before declaring an incident.
- **Why:** Eliminates false alarms caused by localized worker connectivity glitches or DNS failures on a single node.
- **Rejected:** Single worker checks without confirmation (triggers false positive alerts when worker host experiences network jitter).
- **Evidence:** docs/brief.md:11, docs/brief.md:20, docs/brief.md:24
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19

## D-008 · Check workers co-located as separate processes on the same host
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** The minimum 2 check workers run as separate Node.js processes co-located on the same physical or virtual host. Multi-region geographically distributed worker deployments are not supported in v1.
- **Why:** Provides process and event loop isolation for independent verification while avoiding multi-host deployment and networking overhead.
- **Rejected:** Multi-region distributed clusters (out of scope for v1 student project).
- **Evidence:** docs/brief.md:20
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19

## D-015 · Worker degradation detection and fault suppression

- **Status:** approved
- **Date:** 2026-11-25
- **Rule:** A worker is classified as "degraded" in a check window when all three conditions hold: (a) at least `MIN_WORKER_MONITORS` (default: 3) of its monitors were checked in that window; (b) at least `WORKER_FAULT_THRESHOLD` % (default: 70 %) of those checks failed; (c) the other worker succeeds on the same monitors in the same window. When a worker is degraded, its incident declarations for that window are suppressed and a `worker_fault` event is recorded in the database and surfaced in the admin panel. When fewer than `MIN_WORKER_MONITORS` monitors were checked, no degradation judgment is made and the two-phase confirmation from D-005 applies exclusively. Both thresholds are environment-variable-configurable.
- **Why:** Prevents false incidents when a worker's local network (DNS, routing) fails; required explicitly by docs/brief.md §Twist.
- **Rejected:** Always trusting a single-worker failure without cross-worker comparison (causes false incidents on worker network blips).
- **Evidence:** docs/brief.md:24, docs/brief.md:39
- **Source:** user · confidence high
- **Confirmed:** 2026-11-25

## D-009 · Explicit out-of-scope architectural and functional boundaries
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** The following features are strictly out of scope: (1) Single Page Application frameworks (React/Vue), (2) External cache servers (Redis), (3) Headless browser synthetic testing (Puppeteer/Playwright), (4) Paid SMS/voice alerting (Twilio), (5) Billing/subscriptions (Stripe), (6) External issue tracker sync (Jira/ClickUp), (7) Native mobile apps, (8) Visitor email/RSS subscriptions to incidents, (9) CI deployment pause webhooks (quick button and maintenance calendar remain), (10) Multi-region worker clouds.
- **Why:** Keeps the implementation bounded to the ~32h estimated effort and focuses engineering on core availability monitoring requirements.
- **Rejected:** Expanding scope into commercial SaaS features.
- **Evidence:** docs/brief.md:2, docs/survey-results.md:16
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19
