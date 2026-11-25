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

---

## Q-001 · Which 10 student project URLs and 2 local business URLs will be monitored?
- **Status:** investigating
- **Blocks:** Live monitoring deployment and verification of the 14-day pre-delivery requirement.
- **Who answers:** user
- **Proposed answer:** The 2 local businesses are confirmed: `https://hugthemug.ro/` and `http://cafewien.ro/` at 5-minute interval (confirmed by user 2026-11-25, see D-016). The 10 student project URLs are currently being gathered in `MONITORS.md`.

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
