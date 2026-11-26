# Incident and alert questions

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
- **Status:** answered 2026-11-26
- **Blocks:** Email alerting implementation and PDF/email monthly uptime report dispatcher.
- **Who answers:** user
- **Answer:** SMTP through `nodemailer`, configured by `SMTP_URL` and `MAIL_FROM` in the environment, so any provider with SMTP works (Resend, SendGrid, Gmail). The provider itself is not chosen yet; without both variables, reports are stored but not emailed.
- **Recorded as:** D-041

## Q-009 · How are recurring maintenance windows expressed?
- **Status:** answered 2026-11-26
- **Blocks:** Recurring calendar windows (D-012); `maintenance_windows` holds one-off ranges only.
- **Who answers:** user
- **Answer:** Daily, or weekly on one or more weekdays, with a start time in UTC and a duration under 24 h (daily) or under 7 days (weekly); a rule starts on a chosen date. Pressing the quick button during maintenance extends it.
- **Recorded as:** D-031

## Q-020 · Can quick maintenance be stopped before it expires?
- **Status:** open
- **Blocks:** A "stop maintenance" action; today a quick window always runs to its end (D-031).
- **Who answers:** user

## Q-021 · Who writes incident updates, and does that code bump `status_version`?
- **Status:** answered 2026-11-26
- **Blocks:** Writing rows to `incident_updates`; no code in `src/` does it yet, so an update added straight to the database shows on the status page only after the next version bump or UTC midnight (D-020, D-032).
- **Who answers:** user
- **Answer:** The admin panel (after Q-008) writes the update and bumps `status_version` in the same transaction, as the workers do on an incident open or close (src/worker/store.ts) and maintenance does (src/web/maintenance/store.ts).
- **Recorded as:** D-033
