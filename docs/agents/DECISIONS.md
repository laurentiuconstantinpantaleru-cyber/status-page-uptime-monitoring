# Decisions — status-page-uptime-monitoring

<!-- graffino-agentic:begin v1 -->
> Constraints the code must obey. Status: `approved` (obey) · `proposed` (do not
> build on it) · `superseded-by <ID>` (kept to explain old code).
> Adding or changing an entry needs the user's OK (AGENTS.md → The gate).
<!-- graffino-agentic:end -->

## Index
- D-001 · Node.js + TypeScript with Fastify for web API, SSR status page, and workers
- D-002 · Server-rendered frontend with minimal vanilla JS for charts
- D-003 · PostgreSQL with versioned migrations and in-memory cache for status page
- D-004 · Vitest with injectable clock for simulated-time tests
- D-005 · Multi-worker check architecture with two-phase failure confirmation
- D-006 · Incident lifecycle thresholds: N=2 confirmed failures to open, M=3 successes to close
- D-007 · Alert escalation timeout and operator acknowledgment
- D-008 · Check workers co-located as separate processes on the same host
- D-009 · Explicit out-of-scope architectural and functional boundaries

---

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
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** Render public status pages and admin interfaces server-side using Fastify templates with minimal client-side vanilla JavaScript strictly for rendering uptime/latency charts; do not introduce React or heavy SPA frameworks.
- **Why:** Maximizes page load speed, achieves sub-100ms TTFB for public status pages, keeps build pipeline simple, and avoids frontend hydration overhead.
- **Rejected:** React, Next.js, Vue SPA (rejected by user in favor of SSR with minimal JS).
- **Evidence:** docs/brief.md:14, docs/brief.md:22
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19

## D-003 · PostgreSQL with versioned migrations and in-memory cache for status page
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** Use PostgreSQL as the relational datastore with versioned migrations. Do not use Redis; use an in-process in-memory cache with immediate invalidation on monitor state transition to serve public status page data.
- **Why:** Reliable ACID transactions for incidents, maintenance windows, and roll-ups, while in-memory caching keeps operational complexity low without external caching services.
- **Rejected:** Redis (unnecessary complexity for single-host setup), MongoDB (weak relational consistency for incident tracking).
- **Evidence:** docs/brief.md:21, docs/brief.md:22
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19

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

## D-006 · Incident lifecycle thresholds: N=2 confirmed failures to open, M=3 successes to close
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** An incident is opened only after N=2 consecutive check failures confirmed by a secondary worker. An active incident is automatically marked resolved only after M=3 consecutive successful checks.
- **Why:** Balances rapid outage detection with resilience against transient network blips and flapping services; validated by user interview.
- **Rejected:** Immediate alert on 1 failure (noisy/false positives); 1 success to close (premature resolution of unstable services).
- **Evidence:** docs/brief.md:24, docs/survey-results.md:7, docs/survey-results.md:12
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19

## D-007 · Alert escalation timeout and operator acknowledgment
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** Outage alerts are dispatched immediately to primary Telegram/email contacts. If not acknowledged within 15 minutes (configurable up to 1 hour), escalation notifies the secondary contact. Acknowledgment is performed via a signed token link or in the admin UI.
- **Why:** Prevents unattended prolonged downtime without creating spam loops (1 alert per incident + 1 on resolution).
- **Rejected:** Unconditional continuous alert spamming; indefinite single-contact alerting without escalation.
- **Evidence:** docs/brief.md:12, docs/survey-results.md:9, docs/survey-results.md:13
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

## D-009 · Explicit out-of-scope architectural and functional boundaries
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** The following features are strictly out of scope: (1) Single Page Application frameworks (React/Vue), (2) External cache servers (Redis), (3) Headless browser synthetic testing (Puppeteer/Playwright), (4) Paid SMS/voice alerting (Twilio), (5) Billing/subscriptions (Stripe), (6) External issue tracker sync (Jira/ClickUp), (7) Native mobile apps, (8) Visitor email/RSS subscriptions to incidents, (9) CI deployment pause webhooks (quick button and maintenance calendar remain), (10) Multi-region worker clouds.
- **Why:** Keeps the implementation bounded to the ~32h estimated effort and focuses engineering on core availability monitoring requirements.
- **Rejected:** Expanding scope into commercial SaaS features.
- **Evidence:** docs/brief.md:2, docs/survey-results.md:16
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19
