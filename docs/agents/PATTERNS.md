# Patterns — status-page-uptime-monitoring

<!-- graffino-agentic:begin v1 -->
> How we build things here. Copy only `approved` entries. `candidate` = seen once or
> not yet confirmed; agents add these freely. Promotion needs the user's OK.
<!-- graffino-agentic:end -->

## Index
- PATTERN-001 · Injectable clock interface for simulated-time tests · candidate
- PATTERN-002 · Multi-worker ping confirmation before state change · candidate
- PATTERN-003 · Version-polled in-memory cache invalidation on monitor state change · candidate
- PATTERN-004 · Time columns get their value from the Clock, never a database default · candidate
- PATTERN-005 · Mock screenshots through headless Chrome inside fixed-width iframes · candidate
- PATTERN-006 · Network calls through an injected client, errors classified by a pure function · candidate

---

## PATTERN-001 · Injectable clock interface for simulated-time tests
- **Status:** candidate
- **Use when:** Implementing or testing the drift-free scheduler, uptime calculations, or maintenance windows.
- **How:** Accept an injectable `Clock` interface (`now(): Date`) across domain services rather than calling `Date.now()` or `new Date()` directly. Production code gets `systemClock`; tests get `FakeClock`, which alone has `advance(ms: number)`, so production code cannot move time.
- **Example:** src/shared/clock.ts, test/shared/clock.test.ts
- **Why:** Enables instant, 100% deterministic testing of 30-day/90-day intervals and cross-month uptime boundaries without test delays or flaky sleeps.
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26

## PATTERN-002 · Multi-worker ping confirmation before state change
- **Status:** candidate
- **Use when:** A worker probe fails (timeout, non-200 status code, TLS expiration, or missing keyword).
- **How:** The primary worker stores its `down` check; the other worker polls every 5 s for unconfirmed `down` checks of other workers, probes the target itself and stores the result with `confirms_check_id` (D-027). The incident engine counts a failure only when its confirmation is also `down`.
- **Example:** src/worker/worker.ts (`confirmPending`, `recordCheck`), src/shared/incidents.ts, test/worker/worker.test.ts
- **Why:** Avoids false positives from isolated worker network or DNS interruptions.
- **Source:** docs · confidence high
- **Confirmed:** 2026-11-26

## PATTERN-003 · Version-polled in-memory cache invalidation on monitor state change
- **Status:** candidate
- **Use when:** Serving public status page components and uptime summaries.
- **How:** Cache rendered payload/HTML in memory in the web process. Workers increment a version number in the database whenever an incident opens, closes, or updates; the web process reads it every 30 seconds and drops the cache when it changed (D-020).
- **Example:** docs/brief.md:22, D-020
- **Why:** Guarantees sub-100ms response time while ensuring visitors see a status change within 30 seconds.
- **Source:** docs · confidence high
- **Confirmed:** 2026-11-26

## PATTERN-004 · Time columns get their value from the Clock, never a database default
- **Status:** candidate
- **Use when:** Adding a `DATETIME(3)` column or writing a row that has one.
- **How:** Declare time columns without `DEFAULT CURRENT_TIMESTAMP` or `ON UPDATE`, and pass `clock.now()` as a query parameter. A migration that inserts seed rows may use `UTC_TIMESTAMP(3)`.
- **Example:** db/migrations/0001_initial_schema.sql, src/db/migrate.ts (`applied_at`)
- **Why:** A database default reads the server's clock, which simulated-time tests cannot move (D-004, D-021).
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26

## PATTERN-005 · Mock screenshots through headless Chrome inside fixed-width iframes
- **Status:** candidate
- **Use when:** Saving `docs/design/screens/<DS-id>.<light|dark>.png` for a mock, at the smallest (360 px) and largest supported widths.
- **How:** Write a throwaway wrapper page (outside the repo) that holds one `<iframe>` per width, e.g. 360 px and 1280 px side by side, each loading `mocks/<DS-id>.html?state=<state>&theme=<light|dark>`. Capture it with `chrome --headless=old --hide-scrollbars --virtual-time-budget=3000 --window-size=<total width>,<height> --screenshot=<file>`. Under WSL, pass Windows paths (`wslpath -w`, `wslpath -m`) to the Windows Chrome binary.
- **Example:** docs/design/screens/DS-p26-public-status.light.png
- **Why:** Headless Chrome will not lay out a window narrower than about 500 px, so a 360 px window screenshot shows the tablet layout cropped; an iframe gets a real 360 px viewport and its media queries.
- **Source:** session 2026-11-26 · confidence medium

## PATTERN-006 · Network calls through an injected client, errors classified by a pure function
- **Status:** candidate
- **Use when:** Code calls an outside service (target site, Telegram, SMTP) and its result or failure must be tested.
- **How:** Accept a small client interface in a `deps` argument next to the `Clock`; the real adapter only performs the call and rethrows the original error. Turn the error into a domain value in a pure function that reads the Node `name` and `code`, so tests throw fake errors with real codes and never open a socket.
- **Example:** src/worker/check.ts (`HttpClient`, `classifyError`), test/worker/check.test.ts; the real adapter src/worker/http-client.ts, tested against a local server in test/worker/http-client.test.ts (the one place tests open a socket)
- **Why:** Tests stay offline and deterministic (D-004), and the mapping from error to cause is tested instead of hidden in the adapter.
- **Source:** session 2026-11-26 · confidence medium
- **Confirmed:** 2026-11-26
