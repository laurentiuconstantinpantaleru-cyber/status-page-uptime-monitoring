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
- PATTERN-007 · A CI job that needs secrets is skipped, not failed, while they are missing · candidate
- PATTERN-008 · At most one open row per owner through a generated column and a unique key · candidate
- PATTERN-009 · A recurring rule is stored as a rule and expanded into spans when read · candidate
- PATTERN-010 · An admin route: a guard preHandler for the role, the organization in the SQL, 404 outside it · candidate
- PATTERN-011 · A form posts, then redirects with 303 to a page that says what happened · candidate

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
- **Confirmed:** 2026-11-26

## PATTERN-006 · Network calls through an injected client, errors classified by a pure function
- **Status:** candidate
- **Use when:** Code calls an outside service (target site, Telegram, SMTP) and its result or failure must be tested.
- **How:** Accept a small client interface in a `deps` argument next to the `Clock`; the real adapter only performs the call and rethrows the original error. Turn the error into a domain value in a pure function that reads the Node `name` and `code`, so tests throw fake errors with real codes and never open a socket.
- **Example:** src/worker/check.ts (`HttpClient`, `classifyError`), test/worker/check.test.ts; the real adapter src/worker/http-client.ts, tested against a local server in test/worker/http-client.test.ts (the one place tests open a socket)
- **Why:** Tests stay offline and deterministic (D-004), and the mapping from error to cause is tested instead of hidden in the adapter.
- **Source:** session 2026-11-26 · confidence medium
- **Confirmed:** 2026-11-26

## PATTERN-007 · A CI job that needs secrets is skipped, not failed, while they are missing
- **Status:** candidate
- **Use when:** A GitHub Actions job (deploy, publish) needs secrets that may not be set yet.
- **How:** Secrets cannot be read in a job's `if`. Add a small job in the same environment that maps each secret to an env var, writes `ready=true|false` to `$GITHUB_OUTPUT` and names the missing ones (never their values) in a `::notice::`. The real job `needs` it and runs only `if: needs.<job>.outputs.ready == 'true'`; a skipped job counts as success.
- **Example:** .github/workflows/ci.yml (`deploy-config`, `deploy`)
- **Why:** Pushes stay green before the infrastructure exists, without a failing job that hides real failures.
- **Source:** session 2026-11-26 · confidence medium

## PATTERN-008 · At most one open row per owner through a generated column and a unique key
- **Status:** candidate
- **Use when:** A table holds periods that open and end (an incident per monitor, a worker_fault episode per worker) and at most one may be open per owner, even when two processes write at once.
- **How:** Add `open_<owner>_id BIGINT UNSIGNED GENERATED ALWAYS AS (IF(<end column> IS NULL, <owner>_id, NULL)) VIRTUAL` with a `UNIQUE KEY`; MySQL allows many NULLs, so ended rows never collide. Use VIRTUAL, not STORED, when the owner column has a cascading foreign key.
- **Example:** db/migrations/0001_initial_schema.sql (`incidents.open_monitor_id`), db/migrations/0005_worker_faults.sql (`worker_faults.open_worker_id`), test/db/schema.test.ts
- **Why:** The database itself refuses a second open row (`ER_DUP_ENTRY`), so no application lock or check-then-insert race is needed.
- **Source:** session 2026-11-26 · confidence medium
- **Confirmed:** 2026-11-26

## PATTERN-009 · A recurring rule is stored as a rule and expanded into spans when read
- **Status:** candidate
- **Use when:** Something repeats on a calendar (recurring maintenance, later perhaps report schedules) and code needs the concrete time ranges in a period.
- **How:** Store the rule's fields (frequency, weekdays, start time, duration, first day, `ended_at`). A pure function takes the rule and [from, to) and returns the ranges that overlap it, starting from the day `duration` before `from` so a range crossing midnight is not lost. Readers merge those ranges with the stored one-off ones and pass them on unchanged.
- **Example:** src/shared/maintenance.ts (`occurrences`), src/db/maintenance.ts (`loadMaintenance`), test/shared/maintenance.test.ts
- **Why:** No job has to generate rows ahead of time, an edit or an end leaves no stale rows, and the expansion is tested with plain dates instead of a database (D-004).
- **Source:** session 2026-11-26 · confidence medium

## PATTERN-010 · An admin route: a guard preHandler for the role, the organization in the SQL, 404 outside it
- **Status:** candidate
- **Use when:** Adding a route under `/admin` that reads or changes something of one organization.
- **How:** Register it with `{ preHandler: guard('<permission>') }` (session → 303 `/login`, role → 403). Parse the `:id` with the digits-only `ID` regex; pass `scopeOf(user)` to a store method whose query adds `AND organization_id = ?` unless the scope is null (global admin), and answer `notFound` when it returns null. Add the route to the table in `test/web/access-matrix.test.ts` with one expectation per role.
- **Example:** src/web/admin/routes.ts (`guard`, `idOf`, `/admin/monitors/:id/delete`), src/web/admin/store.ts (`orgFilter`), test/web/access-matrix.test.ts
- **Why:** The role and the organization are checked on the server for every route, another organization's ids do not leak (D-036), and a new route cannot skip the matrix unnoticed.
- **Source:** session 2026-11-26 · confidence medium

## PATTERN-011 · A form posts, then redirects with 303 to a page that says what happened
- **Status:** candidate
- **Use when:** A server-rendered page changes something from a `<form method="post">` (no script, D-024).
- **How:** Validate the fields in a pure function that returns the value or one message per field. Invalid: render the same page with 400, the typed values and `aria-invalid` plus the message next to each field. Saved: `303` to the page with a short query (`?posted=<id>`, `?started=<id>&minutes=30`) that the GET turns into a `role="status"` line. A failed save renders the page with 503 and keeps the typed text.
- **Example:** src/web/admin/routes.ts (`/admin/incidents/:id/updates`, `/admin/monitors/:id/maintenance`), src/web/admin/incidents.ts (`parseUpdate`), test/web/admin-incidents.test.ts
- **Why:** Reloading after a post does not post again, and errors and success read the same with or without script.
- **Source:** session 2026-11-26 · confidence medium
