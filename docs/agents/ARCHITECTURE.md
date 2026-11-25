# Architecture — status-page-uptime-monitoring

<!-- graffino-agentic:begin v1 -->
> How this repo is built, generated from the code at backfill and kept current by
> whoever changes the structure. The code wins: when this page is wrong, fix it.
<!-- graffino-agentic:end -->

## Overview
Status page + uptime monitoring is an availability monitoring and status page platform. It periodically probes external services
via separated check workers, detects outages using two-worker confirmation, manages incident lifecycles,
sends alerts, and serves sub-100ms cached public status pages per organization.

```text
                  +----------------------------------------------+
                  |                  MySQL 8.4                   |
                  | (monitors, incidents, checks, roll-up metrics)|
                  +----------------------+-----------------------+
                                         ^
                                         |
     +-----------------------------------+-----------------------------------+
     |                                   |                                   |
     v                                   v                                   v
+-----------------------+     +-----------------------+     +-----------------------+
|      Fastify Web      |     |    Check Worker 1     |     |    Check Worker 2     |
| (API, SSR Status Page,|     |  (scheduler, probes,  |     |  (scheduler, probes,  |
|  in-memory cache)     |     |   failure candidate)  |     |   confirmation probe) |
+-----------+-----------+     +-----------+-----------+     +-----------+-----------+
            |                             |                             |
            v                             +--------------+--------------+
       [ Browsers ]                                      |
 (Public Status / Admin UI)                              v
                                            +-------------------------+
                                            | External Targets & APIs |
                                            | (HTTP, TLS, Telegram)   |
                                            +-------------------------+
```

## Parts
Source is split into three roots: `src/web/` (web process), `src/worker/` (check
worker processes) and `src/shared/` (code both use, e.g. the `Clock` in
`src/shared/clock.ts`). Paths marked _planned_ do not exist yet.

| Part | Path | Responsibility | Talks to |
|---|---|---|---|
| Web Server | `src/web/` (`app.ts`, `server.ts`) | Serves Fastify REST API, SSR status pages, admin views; `GET /health` | MySQL, in-memory cache |
| In-Memory Cache | `src/web/` _planned_ | Caches rendered status payloads under 100ms | Web Server |
| Scheduler | `src/worker/` _planned_ | Drift-free execution planning for monitor probes | Check Workers |
| Check Workers | `src/worker/` _planned_ | Executes HTTP/TLS/keyword probes; performs 2nd worker confirmation | MySQL, External Targets |
| Incident Engine | `src/shared/` _planned_ | State machine opening/closing incidents and calculating uptime | MySQL, Alert Dispatcher |
| Alert Dispatcher | `src/worker/` _planned_ | Sends Telegram and email notifications with escalation | Telegram API, SMTP |
| Roll-up Job | `src/worker/` _planned_ | Aggregates raw check data older than 7 days | MySQL |
| Clock | `src/shared/clock.ts` | `Clock` interface, `systemClock`, `FakeClock` for simulated-time tests | All time-dependent code |

## Data flow
1. **Probe Trigger:** Scheduler dispatches scheduled monitor checks to Worker 1 without timing drift.
2. **Failure Confirmation:** If Worker 1 detects an error, it requests an immediate independent probe from Worker 2.
3. **Incident Declaration:** If Worker 2 confirms the failure across N consecutive checks, the Incident Engine marks the monitor as DOWN and opens an incident.
4. **Cache Invalidation & Alerting:** The worker increments the cache version number; the web process reads it every 30 seconds and invalidates the public status cache (D-020); Alert Dispatcher dispatches email and Telegram notifications.
5. **Resolution:** When M consecutive successful checks occur, the incident is closed, a resolution alert is sent, and the status page cache is cleared.
6. **Data Compaction:** Raw checks older than 7 days are aggregated into hourly/daily roll-up metrics by a scheduled background job.

## State and storage
| What | Where | Owner | Notes |
|---|---|---|---|
| Monitors & Orgs | MySQL `monitors`, `organizations` | Web / Admin | Monitored targets, check intervals, thresholds |
| Incidents & Updates | MySQL `incidents`, `incident_updates` | Incident Engine | Start time, end time, root cause, manual notes |
| Raw Probe Logs | MySQL `check_results` | Check Workers | Kept for 7 days then rolled up |
| Aggregated Metrics | MySQL `rollup_hourly`, `rollup_daily` | Roll-up Job | 90-day uptime and latency history |
| Maintenance Windows | MySQL `maintenance_windows` | Web / Admin | Scheduled downtime excluded from uptime calculations |

## Configuration
| Name | Where set | Used by | Notes |
|---|---|---|---|
| `PORT` | Environment | Web Server | HTTP listening port (default 3000) |
| `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_RANDOM_ROOT_PASSWORD` | `.env` | `docker-compose.yml` | Local MySQL container credentials; root password generated at first start |
| `DATABASE_URL` | Environment | All parts | MySQL connection string (`mysql://…`) |
| `TELEGRAM_BOT_TOKEN` | Environment | Alert Dispatcher | Telegram bot token |
| `SMTP_HOST` | Environment | Alert Dispatcher | Outbound SMTP email server |
| `SMTP_PORT` | Environment | Alert Dispatcher | Outbound SMTP port |
| `SMTP_USER` | Environment | Alert Dispatcher | SMTP username |
| `SMTP_PASS` | Environment | Alert Dispatcher | SMTP password |

## Build, deploy, runtime
- Node.js (v20+) runtime with TypeScript.
- Build step: `npm run build` compiles TypeScript to `dist/`.
- Runtime: Web server (`dist/web/server.js`, started with `npm run start:web`) and Workers (entry under `dist/worker/`, _planned_) run as separate processes.
- Local database: `docker-compose.yml` runs MySQL 8.4 only, published on host port 3307, configured from `.env` (template: `.env.example`).
- CI (`.github/workflows/ci.yml`): ledger lint, `npm ci`, `npm run build`, `npm test` on Node 22.

## Boundaries
- Public Status Page: Publicly readable; cached in-memory with sub-100ms response time; isolated from administrative write routes.
- API Key Auth: Guarded routes for creating and editing monitors (`/api/v1/monitors`).
- Multi-Worker Confirmation: Protects against false alarms caused by single worker host failure.
