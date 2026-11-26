# Monitoring questions

## Q-001 · Which 10 student project URLs and 2 local business URLs will be monitored?
- **Status:** investigating
- **Blocks:** Live monitoring deployment and verification of the 14-day pre-delivery requirement.
- **Who answers:** user
- **Proposed answer:** The 2 local businesses are confirmed: `https://hugthemug.ro/` and `http://cafewien.ro/` at 5-minute interval (confirmed by user 2026-11-25, see D-016). The 10 student project URLs are currently being gathered in `MONITORS.md`.
- **Confirmed:** 2026-11-26

## Q-010 · What latency threshold do the seeded business monitors use?
- **Status:** open
- **Blocks:** Latency alerts for `hugthemug.ro` and `cafewien.ro`; their `latency_threshold_ms` is NULL until answered.
- **Who answers:** user

## Q-023 · What do the D-011 roll-ups keep, so the monthly report's mean latency survives the 7-day retention?
- **Status:** investigating
- **Blocks:** The raw-check retention and roll-up job (D-011). Until it exists every check is kept, so the report is right today; once checks older than 7 days are deleted, `loadMonth` (src/web/reports/store.ts) averages only the month's last 7 days, and a month downloaded later shows no slowest monitor (D-041).
- **Who answers:** user
- **Proposed answer:** The hourly roll-up keeps, per monitor and hour, the sum and the count of `latency_ms` of scheduled checks that got a response, so a month's mean is the sum of sums over the sum of counts. `loadMonth` reads the roll-ups for hours older than the raw retention and the raw checks for the rest. Evidence: the report's mean is over scheduled checks with a response (D-041), and a mean cannot be rebuilt from hourly means without their counts.

