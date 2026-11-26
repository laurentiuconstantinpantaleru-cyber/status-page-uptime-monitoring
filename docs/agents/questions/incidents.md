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
- **Status:** open
- **Blocks:** Email alerting implementation and PDF/email monthly uptime report dispatcher.
- **Who answers:** user
- **Proposed answer:** Standard SMTP credentials via environment variables (e.g. Resend, Sendgrid, or Gmail SMTP).

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
