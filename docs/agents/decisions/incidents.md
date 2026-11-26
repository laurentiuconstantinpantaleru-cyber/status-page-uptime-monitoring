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
- **Confirmed:** 2026-11-26

## D-014 · Human-authored incident timeline updates with standardized lifecycle stages
- **Status:** approved
- **Date:** 2026-11-19
- **Rule:** Active and past incidents displayed on the public status page include human-written operator updates progressing through standard lifecycle stages: Investigating, Identified, Monitoring, and Resolved.
- **Why:** Increases public trust and transparent communication during downtime events; favored by 3 of 4 survey respondents.
- **Rejected:** Fully automated binary up/down incident messages without human status notes.
- **Evidence:** docs/survey-results.md:14
- **Source:** user · confidence high
- **Confirmed:** 2026-11-19

## D-028 · Checks keep running during maintenance; no incident opens
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** During a maintenance window checks keep running and are stored. No incident opens; an open incident can still resolve. An incident opens after 2 consecutive scheduled failures, each confirmed `down` by the other worker (an `up` or missing confirmation breaks the run); it starts at the first failure, takes cause and HTTP code from the latest confirmation, and resolves at the first of 2 consecutive successful scheduled checks (D-006).
- **Why:** The response time chart keeps its data through maintenance, and downtime inside the window is excluded from uptime anyway (D-012).
- **Rejected:** Pausing checks during maintenance (gaps in the charts).
- **Evidence:** src/shared/incidents.ts, test/shared/incidents.test.ts
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26

## D-030 · Uptime ratio from incidents and maintenance
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** Uptime over a period [from, to) is (measured − maintenance − downtime) / (measured − maintenance), where measured runs from the later of `from` and the monitor's history start (D-023) to the earlier of `to` and now. Downtime is the union of incidents (an open one until now) minus the union of maintenance windows; check counts never enter it. Months are UTC calendar months; "30 days" is the 30 × 24 h before now. No measured time left after maintenance, or no history: no value, shown as "—". Shown truncated to 2 decimals (99.996 % → 99.99 %), never rounded up to 100.00 %.
- **Why:** docs/brief.md:24 asks for uptime from incidents, across month boundaries and with partial maintenance overlap; the history start, the all-maintenance case and the rounding were answered by the user on 2026-11-26.
- **Rejected:** Counting checks (a 1-minute and a 60-minute monitor would not be comparable); counting the days before a monitor existed as available; 100 % for a period that was all maintenance; rounding to the nearest (99.996 % would show 100.00 % despite downtime).
- **Evidence:** src/shared/uptime.ts, test/shared/uptime.test.ts, src/web/views/docs/uptime.html
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26
