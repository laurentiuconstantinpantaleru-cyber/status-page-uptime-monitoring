# Incident Decisions

## D-006 · Incident lifecycle thresholds: N=2 confirmed failures to open, M=2 successes to close
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** An incident is opened only after N=2 consecutive check failures confirmed by a secondary worker. An active incident is automatically marked resolved only after M=2 consecutive successful checks.
- **Why:** Balances rapid outage detection with resilience against transient network blips and flapping services; validated by colleague survey results.
- **Rejected:** Immediate alert on 1 failure (noisy/false positives); 1 success to close (premature resolution of unstable services).
- **Evidence:** docs/survey-results.md:7, docs/survey-results.md:12
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19

## D-007 · Alert escalation timeout and operator acknowledgment
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** Outage alerts are dispatched immediately to primary Telegram/email contacts. If not acknowledged within a configurable duration (default 15 minutes, configurable per organization up to 1 hour), escalation notifies the secondary contact. Acknowledgment is performed via a signed token link or in the admin UI.
- **Why:** Prevents unattended prolonged downtime without creating spam loops; satisfies diverse preferences observed in the user survey.
- **Rejected:** Unconditional continuous alert spamming; non-configurable single timeout.
- **Evidence:** docs/survey-results.md:9, docs/survey-results.md:13
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19

## D-012 · Quick maintenance mode button (15/30/60 min) in addition to scheduled calendar windows
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** In addition to calendar-scheduled recurring maintenance windows, the admin UI provides a one-click quick maintenance button per monitor with preset durations (15, 30, or 60 minutes) that suppresses alerts and excludes the interval from downtime calculations.
- **Why:** Directly requested in the survey to support quick application deployments without creating complex calendar events.
- **Rejected:** Requiring full calendar entry setup for routine short deploys.
- **Evidence:** docs/survey-results.md:16
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19

## D-013 · Alert payload structure: HTTP code, error cause, and time since last successful check
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** Incident alert notifications (Email and Telegram) must contain: target name/URL, returned HTTP code (or connection/TLS error), root cause description, time elapsed since the last successful probe, and a secure one-click acknowledgment link.
- **Why:** Provides operators immediate diagnostic context without forcing them to log into the dashboard; supported unanimously in the colleague survey.
- **Rejected:** Bare "service down" notification without diagnostics.
- **Evidence:** docs/survey-results.md:13
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19

## D-014 · Human-authored incident timeline updates with standardized lifecycle stages
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** Active and past incidents displayed on the public status page include human-written operator updates progressing through standard lifecycle stages: Investigating, Identified, Monitoring, and Resolved.
- **Why:** Increases public trust and transparent communication during downtime events; favored by 3 of 4 survey respondents.
- **Rejected:** Fully automated binary up/down incident messages without human status notes.
- **Evidence:** docs/survey-results.md:14
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19
