# Decisions — p26-status

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
