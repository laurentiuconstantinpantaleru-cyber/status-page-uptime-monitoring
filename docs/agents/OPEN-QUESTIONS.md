# Open questions — status-page-uptime-monitoring

<!-- graffino-agentic:begin v1 -->
> Unknowns. Work that depends on an open question is out of scope until it is
> answered. Only the user answers; an agent never answers by guessing. An agent may
> write a `Proposed answer` the evidence supports; the question stays
> `investigating` until the user confirms it.
> Answered entries stay, with the answer and date, and usually become a D- or PATTERN-.
<!-- graffino-agentic:end -->

## Index
- Q-001 · Which 10 student project URLs and 2 local business URLs will be monitored? · _investigating_
- Q-002 · What are the thresholds for N (open incident) and M (resolve incident)? · _answered_
- Q-003 · What is the alert escalation contact and timeout policy? · _answered_
- Q-004 · Which email transport/provider will be used for alerts and reports?
- Q-005 · What are the specific requirements requested in the 3 student interviews? · _answered_
- Q-006 · How does the web in-memory cache learn about worker state changes? · _answered_
- Q-007 · How often does the web process read the cache version number? · _answered_
- Q-008 · How do users sign in to the admin interface?
- Q-009 · How are recurring maintenance windows expressed?
- Q-010 · What latency threshold do the seeded business monitors use?
- Q-011 · Which time zone does the public status page show times in? · _answered_
- Q-012 · What period and which monitor does the public response time chart show? · _investigating_
- Q-013 · How far back does the public status page list past incidents?
- Q-014 · How are monitors grouped on the public status page?
- Q-015 · Which status wins when several apply, in the overall banner and in a daily bar?
- Q-016 · Where do the API and status badge docs live?

---

## Q-001 · Which 10 student project URLs and 2 local business URLs will be monitored?
- **Status:** investigating
- **Blocks:** Live monitoring deployment and verification of the 14-day pre-delivery requirement.
- **Who answers:** user
- **Proposed answer:** The 2 local businesses are confirmed: `https://hugthemug.ro/` and `http://cafewien.ro/` at 5-minute interval (confirmed by user 2026-11-25, see D-016). The 10 student project URLs are currently being gathered in `MONITORS.md`.
- **Confirmed:** 2026-11-26

## Q-002 · What are the thresholds for N (open incident) and M (resolve incident)?
- **Status:** answered 2026-11-19
- **Blocks:** Incident engine transition constants.
- **Who answers:** user
- **Answer:** N = 2 consecutive confirmed failures to declare an incident; M = 2 consecutive successful checks to automatically resolve the incident.
- **Recorded as:** D-006

## Q-003 · What is the alert escalation contact and timeout policy?
- **Status:** answered 2026-11-19
- **Blocks:** Alert notification escalation dispatcher.
- **Who answers:** user
- **Answer:** Primary alert dispatched immediately via Telegram/email. Secondary contact alerted if unacknowledged after 15 minutes (configurable up to 1 hour). Acknowledgment is done via a unique link/button in the alert or in the admin panel.
- **Recorded as:** D-007

## Q-004 · Which email transport/provider will be used for alerts and reports?
- **Status:** open
- **Blocks:** Email alerting implementation and PDF/email monthly uptime report dispatcher.
- **Who answers:** user
- **Proposed answer:** Standard SMTP credentials via environment variables (e.g. Resend, Sendgrid, or Gmail SMTP).

## Q-005 · What are the specific requirements requested in the 3 student interviews?
- **Status:** answered 2026-11-25
- **Blocks:** Feature prioritization and `INTERVIEW.md` documentation.
- **Who answers:** user
- **Answer:** The colleague interviews were run as an online form with 4 respondents; results are in `docs/survey-results.md` and `INTERVIEW.md`, both written by the user. The 2 local businesses gave consent by phone on 2026-11-25 (recorded in `MONITORS.md`).

## Q-006 · How does the web in-memory cache learn about worker state changes?
- **Status:** answered 2026-11-26
- **Blocks:** Inter-process cache invalidation mechanism between check workers and the web process.
- **Who answers:** user
- **Answer:** Workers increment a version number in the database on every monitor state change; the web process reads it periodically and invalidates the cache when it changes. MySQL has no LISTEN/NOTIFY. Read interval: Q-007.
- **Recorded as:** D-020

## Q-007 · How often does the web process read the cache version number?
- **Status:** answered 2026-11-26
- **Blocks:** Status page cache invalidation (D-020); how soon after a monitor status change visitors see it.
- **Who answers:** user
- **Answer:** Every 30 seconds.

## Q-008 · How do users sign in to the admin interface?
- **Status:** open
- **Blocks:** Credential columns on `users` and the admin login.
- **Who answers:** user

## Q-009 · How are recurring maintenance windows expressed?
- **Status:** open
- **Blocks:** Recurring calendar windows (D-012); `maintenance_windows` holds one-off ranges only.
- **Who answers:** user

## Q-010 · What latency threshold do the seeded business monitors use?
- **Status:** open
- **Blocks:** Latency alerts for `hugthemug.ro` and `cafewien.ro`; their `latency_threshold_ms` is NULL until answered.
- **Who answers:** user

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
- **Status:** open
- **Blocks:** The past incidents list on DS-p26-public-status.
- **Who answers:** user
- **Proposed answer:** The same 90 days as the uptime bars; the empty state reads "No incidents in the last 90 days."
- **Confirmed:** 2026-11-26

## Q-014 · How are monitors grouped on the public status page?
- **Status:** open
- **Blocks:** The grouped component cards on DS-p26-public-status ("Local businesses", "Student projects"); `monitors` has no group column today (`db/migrations/0001_initial_schema.sql`).
- **Who answers:** user
- **Proposed answer:** A nullable group name on each monitor, set by an organization admin; monitors without one go in a card titled "Other". Cards keep the order in which groups were created.
- **Confirmed:** 2026-11-26

## Q-015 · Which status wins when several apply, in the overall banner and in a daily bar?
- **Status:** open
- **Blocks:** The overall status banner and the colour of each daily uptime bar on DS-p26-public-status.
- **Who answers:** user
- **Proposed answer:** Down, then Degraded, then Maintenance, then Operational, as drawn in the mock. "No data" counts only when no monitor (or no check that day) has data. A day shows the worst status it had.
- **Confirmed:** 2026-11-26

## Q-016 · Where do the API and status badge docs live?
- **Status:** open
- **Blocks:** The footer link on DS-p26-public-status; the mock links to a placeholder. The API itself is C-001 (proposed).
- **Who answers:** user
- **Confirmed:** 2026-11-26
