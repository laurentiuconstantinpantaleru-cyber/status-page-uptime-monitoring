# Patterns — status-page-uptime-monitoring

<!-- graffino-agentic:begin v1 -->
> How we build things here. Copy only `approved` entries. `candidate` = seen once or
> not yet confirmed; agents add these freely. Promotion needs the user's OK.
<!-- graffino-agentic:end -->

## Index
- PATTERN-001 · Injectable clock interface for simulated-time tests · candidate
- PATTERN-002 · Multi-worker ping confirmation before state change · candidate
- PATTERN-003 · Version-polled in-memory cache invalidation on monitor state change · candidate

---

## PATTERN-001 · Injectable clock interface for simulated-time tests
- **Status:** candidate
- **Use when:** Implementing or testing the drift-free scheduler, uptime calculations, or maintenance windows.
- **How:** Accept an injectable `Clock` interface (`now(): Date`) across domain services rather than calling `Date.now()` or `new Date()` directly. Production code gets `systemClock`; tests get `FakeClock`, which alone has `advance(ms: number)`, so production code cannot move time.
- **Example:** src/shared/clock.ts, test/shared/clock.test.ts
- **Why:** Enables instant, 100% deterministic testing of 30-day/90-day intervals and cross-month uptime boundaries without test delays or flaky sleeps.
- **Source:** user · confidence high

## PATTERN-002 · Multi-worker ping confirmation before state change
- **Status:** candidate
- **Use when:** A worker probe fails (timeout, non-200 status code, TLS expiration, or missing keyword).
- **How:** Worker 1 records potential failure and enqueues immediate verification task for Worker 2. Incident transition to DOWN occurs only if Worker 2 independently confirms failure.
- **Example:** docs/brief.md:24
- **Why:** Avoids false positives from isolated worker network or DNS interruptions.
- **Source:** docs · confidence high

## PATTERN-003 · Version-polled in-memory cache invalidation on monitor state change
- **Status:** candidate
- **Use when:** Serving public status page components and uptime summaries.
- **How:** Cache rendered payload/HTML in memory in the web process. Workers increment a version number in the database whenever an incident opens, closes, or updates; the web process reads it every 30 seconds and drops the cache when it changed (D-020).
- **Example:** docs/brief.md:22, D-020
- **Why:** Guarantees sub-100ms response time while ensuring visitors see a status change within 30 seconds.
- **Source:** docs · confidence high
