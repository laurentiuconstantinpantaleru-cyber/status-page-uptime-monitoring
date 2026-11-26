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
- **Confirmed:** 2026-11-26

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
- **Confirmed:** 2026-11-26

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

## D-031 · Recurring maintenance rules and the quick button's extension
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** A recurring maintenance window is a per-monitor rule in `maintenance_schedules`: daily, or weekly on one or more chosen weekdays; a start time in UTC and a duration in minutes, under 24 h for daily and under 7 days for weekly; windows start on a chosen first day at the earliest. The rule is expanded into windows when read, never stored as generated rows. Ending a rule sets `ended_at`: no window starts after it, one in progress ends there, and past windows stay in uptime history. The quick button pressed while maintenance is in force extends that maintenance (with any window that follows on without a gap) by the chosen 15, 30 or 60 minutes. Creating or ending any window or rule bumps `status_version` (D-020).
- **Why:** D-012 asks for recurring calendar windows; the user answered Q-009 on 2026-11-26 (daily and weekly, UTC, several weekdays, a chosen first day, extension on a second press). Expanding at read time needs no job and keeps a rule's edits from leaving stale rows.
- **Rejected:** Generating rows in `maintenance_windows` from a job (a new job; stale rows after an edit); a full RRULE field or a recurrence library (daily and weekly do not need one); deleting a rule (would rewrite past uptime and monthly reports, D-019).
- **Evidence:** src/shared/maintenance.ts, src/db/maintenance.ts, src/web/maintenance/store.ts, db/migrations/0006_maintenance_schedules.sql, test/shared/maintenance.test.ts
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26

## D-032 · Incidents and uptime on the public status page
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** Each component shows two uptime numbers from `uptime()` (D-030): over the 90 × 24 h and the 30 × 24 h before now, "—" without history; the page loads incidents and maintenance over those 90 × 24 h. Each open incident shows as an "Active incident" card with its updates newest first, the newest stage in its eyebrow; with no update yet it says "No updates yet." and shows no stage and no generated text (D-014). Incidents have no written title: the title is the monitor's name and a phrase for the cause the incident opened with (e.g. "Bookings API timed out"). Past incidents: resolved ones of the last 90 days, grouped by the UTC day they started, newest first (Q-013).
- **Why:** The user approved the plan's recommendations on 2026-11-26: both periods on the card, a title without a migration, no automated message standing in for a human update.
- **Rejected:** A `title` column on `incidents` (a migration and an admin field nobody writes yet); a stock "We are looking into it." update (D-014 rejects automated messages); only the 90-day number (the request asks for 30 too).
- **Evidence:** src/web/status/model.ts (`monitorUptime`, `pastIncidents`), src/web/status/render.ts, src/web/views/status.html, test/web/status-page.test.ts
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26
