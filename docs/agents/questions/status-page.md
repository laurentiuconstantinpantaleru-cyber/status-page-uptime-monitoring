# Status page questions

## Q-011 · Which time zone does the public status page show times in?
- **Status:** answered 2026-11-26
- **Blocks:** Time formatting on DS-p26-public-status (incident updates, maintenance banner, "Updated" time, chart axis).
- **Who answers:** user
- **Answer:** UTC, labelled "UTC" next to each time, and the footer states that all times are in UTC (user's redesign brief for DS-p26-public-status, 2026-11-26).
- **Confirmed:** 2026-11-26

## Q-012 · What period and which monitor does the public response time chart show?
- **Status:** investigating
- **Blocks:** The response time chart on DS-p26-public-status and the query behind it.
- **Who answers:** user
- **Partial answer:** Two periods, the last 24 hours and the last 30 days (user, 2026-11-26).
- **Proposed answer:** One monitor at a time, picked from a list of monitors that have data. 24 hours: median per hour from raw checks (inside the 7-day raw retention, D-011). 30 days: median per day from the hourly and daily roll-ups. Median, 95th percentile and slowest value shown above the chart, as drawn in the mock.
- **Confirmed:** 2026-11-26

## Q-013 · How far back does the public status page list past incidents?
- **Status:** answered 2026-11-26
- **Blocks:** The past incidents list on DS-p26-public-status.
- **Who answers:** user
- **Answer:** Resolved incidents of the last 90 days, grouped by the UTC day they started, newest first; the empty state reads "No incidents in the last 90 days."
- **Recorded as:** D-032

## Q-014 · How are monitors grouped on the public status page?
- **Status:** answered 2026-11-26
- **Blocks:** The grouped component cards on DS-p26-public-status ("Local businesses", "Student projects"); `monitors` has no group column today (`db/migrations/0001_initial_schema.sql`).
- **Who answers:** user
- **Answer:** For now `GET /status` shows every monitor, one card per organization, in the order organizations were created; no schema change. A group name per monitor (the earlier proposed answer) can come later.

## Q-015 · Which status wins when several apply, in the overall banner and in a daily bar?
- **Status:** answered 2026-11-26
- **Blocks:** The overall status banner and the colour of each daily uptime bar on DS-p26-public-status.
- **Who answers:** user
- **Answer:** Down, then Degraded, then Maintenance, then Operational. "No data" counts only when no monitor (or no check that day) has data. A day shows the worst status it had.

## Q-017 · Does the public status page share DS-p26-header or keep its own header variant?
- **Status:** open
- **Blocks:** Building the header partial (`src/web/views/partials/header.html`) for DS-p26-public-status.
- **Who answers:** user
- **Context:** DS-p26-public-status draws a header with Status, Dashboard, API, Docs, a Login pill and a theme toggle, not sticky. DS-p26-header has a Features menu and a "Get started" pill, is sticky and has no theme toggle.
