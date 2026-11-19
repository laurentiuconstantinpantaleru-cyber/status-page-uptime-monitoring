# Monitoring Decisions

## D-010 · TLS certificate expiration warnings at 30 days and 7 days reminder
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** The TLS certificate checker emits an initial warning notification 30 days prior to certificate expiry and a critical reminder 7 days prior to expiry.
- **Why:** Provides sufficient advance notice to renew TLS certificates before outages occur, matching survey respondent preferences.
- **Rejected:** Single late alert (e.g. at 2 days); excessive daily warning spam.
- **Evidence:** docs/survey-results.md:10
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19

## D-011 · Raw check retention for 7 days with hourly and daily roll-up compaction
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** Raw individual check results (timestamp, latency, HTTP code, TLS status) are retained for 7 days. A periodic background job compacts older records into hourly roll-ups (retained for 60 days) and daily roll-ups (retained for 90+ days).
- **Why:** Ensures constant PostgreSQL table size and sub-100ms response times when serving 30/90-day latency and uptime charts.
- **Rejected:** Infinite raw data retention (causes table bloat and slow aggregation queries).
- **Evidence:** docs/brief.md:21, docs/survey-results.md:11
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19
