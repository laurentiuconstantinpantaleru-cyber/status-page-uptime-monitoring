# Monitoring Decisions

## D-016 · Default check interval of 5 minutes, range 1–60 minutes

- **Status:** approved
- **Date:** 2026-11-25
- **Rule:** The default check interval for a newly created monitor is 5 minutes. The valid configurable range is 1 to 60 minutes (inclusive), set per monitor. The two confirmed business monitors (`hugthemug.ro` and `cafewien.ro`) run at the 5-minute default.
- **Why:** Five minutes balances timely outage detection with request load on monitored services; aligns with brief's configurable 1–60 min range requirement.
- **Rejected:** No default (forces manual entry on every monitor creation); 1-minute global default (excessive load on small monitored services).
- **Evidence:** docs/brief.md:10, docs/agents/questions/monitoring.md Q-001
- **Source:** user · confidence high

## D-010 · TLS certificate expiration warnings at 30 days and 7 days reminder
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** The TLS certificate checker emits an initial warning notification 30 days prior to certificate expiry and a critical reminder 7 days prior to expiry.
- **Why:** Provides sufficient advance notice to renew TLS certificates before outages occur, matching survey respondent preferences.
- **Rejected:** Single late alert (e.g. at 2 days); excessive daily warning spam.
- **Evidence:** docs/survey-results.md:10
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26

## D-011 · Raw check retention for 7 days with hourly and daily roll-up compaction
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** Raw individual check results (timestamp, latency, HTTP code, TLS status) are retained for 7 days. A periodic background job compacts older records into hourly roll-ups (retained for 60 days) and daily roll-ups (retained for 90+ days).
- **Why:** Ensures constant database table size and sub-100ms response times when serving 30/90-day latency and uptime charts.
- **Rejected:** Infinite raw data retention (causes table bloat and slow aggregation queries).
- **Evidence:** docs/brief.md:21, docs/survey-results.md:11
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26

## D-022 · Default check timeout of 30 seconds
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** A check waits at most 30 000 ms for a response unless the monitor sets its own timeout (`DEFAULT_TIMEOUT_MS` in `src/worker/check.ts`). The `monitors.timeout_ms` column keeps no database default for now; the seeded business monitors keep 10 000 ms.
- **Why:** Free Render apps sleep and take tens of seconds to start; a shorter default would report a cold start as a timeout.
- **Rejected:** A column default and seed change in this change (left for a separate migration, D-021).
- **Evidence:** src/worker/check.ts
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26

## D-023 · Public status of a monitor and of each day
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** A monitor is Down while it has an open incident; else Maintenance inside a maintenance window; else No data yet when it has no checks; else Degraded when its last check's latency is above `latency_threshold_ms`; else Operational. A failed check without an open incident does not change it (D-006). A daily bar is Down when an incident overlaps the UTC day, else Maintenance when a window does, else Operational, and No data before the monitor's history starts (its first kept check, or its creation once older checks are removed, D-011).
- **Why:** The schema has no status column; these rules derive the status from rows that exist, without inventing data.
- **Rejected:** Counting an unconfirmed failed check as Down (false alarms, D-005).
- **Evidence:** src/web/status/model.ts, test/web/status-model.test.ts
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26

## D-026 · HTTP client behaviour of a check
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** A check sends `GET` with `User-Agent: CampusUptime/0.1` and follows 301/302/303/307/308 up to 5 hops; status code, keyword and certificate come from the last hop, and more hops fail with cause `unknown`. The whole body is read as UTF-8, with no size limit. The timeout (D-022) covers the whole request, redirects and body included.
- **Why:** `http://` targets such as cafewien.ro redirect to https; some sites refuse requests without a user agent; a keyword may sit anywhere in the page.
- **Rejected:** Reporting redirects as they come (a 301 would show as down with expected status 200); a 1 MB body cap (user chose the whole body); no user agent.
- **Evidence:** src/worker/http-client.ts, test/worker/http-client.test.ts
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26
