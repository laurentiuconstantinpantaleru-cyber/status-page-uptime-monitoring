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
                  |                 PostgreSQL                   |
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
| Part | Path | Responsibility | Talks to |
|---|---|---|---|
| Web Server | `src/web/` | Serves Fastify REST API, SSR status pages, admin views | PostgreSQL, in-memory cache |
| In-Memory Cache | `src/cache/` | Caches rendered status payloads under 100ms | Web Server |
| Scheduler | `src/scheduler/` | Drift-free execution planning for monitor probes | Check Workers |
| Check Workers | `src/workers/` | Executes HTTP/TLS/keyword probes; performs 2nd worker confirmation | PostgreSQL, External Targets |
| Incident Engine | `src/incidents/` | State machine opening/closing incidents and calculating uptime | PostgreSQL, Alert Dispatcher |
| Alert Dispatcher | `src/alerts/` | Sends Telegram and email notifications with escalation | Telegram API, SMTP |
| Roll-up Job | `src/jobs/rollup/`| Aggregates raw check data older than 7 days | PostgreSQL |

## Data flow
1. **Probe Trigger:** Scheduler dispatches scheduled monitor checks to Worker 1 without timing drift.
2. **Failure Confirmation:** If Worker 1 detects an error, it requests an immediate independent probe from Worker 2.
3. **Incident Declaration:** If Worker 2 confirms the failure across N consecutive checks, the Incident Engine marks the monitor as DOWN and opens an incident.
4. **Cache Invalidation & Alerting:** The public status cache is invalidated; Alert Dispatcher dispatches email and Telegram notifications.
5. **Resolution:** When M consecutive successful checks occur, the incident is closed, a resolution alert is sent, and the status page cache is cleared.
6. **Data Compaction:** Raw checks older than 7 days are aggregated into hourly/daily roll-up metrics by a scheduled background job.

## State and storage
| What | Where | Owner | Notes |
|---|---|---|---|
| Monitors & Orgs | PostgreSQL `monitors`, `organizations` | Web / Admin | Monitored targets, check intervals, thresholds |
| Incidents & Updates | PostgreSQL `incidents`, `incident_updates` | Incident Engine | Start time, end time, root cause, manual notes |
| Raw Probe Logs | PostgreSQL `check_results` | Check Workers | Kept for 7 days then rolled up |
| Aggregated Metrics | PostgreSQL `rollup_hourly`, `rollup_daily` | Roll-up Job | 90-day uptime and latency history |
| Maintenance Windows | PostgreSQL `maintenance_windows` | Web / Admin | Scheduled downtime excluded from uptime calculations |

## Configuration
| Name | Where set | Used by | Notes |
|---|---|---|---|
| `PORT` | Environment | Web Server | HTTP listening port (default 3000) |
| `DATABASE_URL` | Environment | All parts | PostgreSQL connection string |
| `TELEGRAM_BOT_TOKEN` | Environment | Alert Dispatcher | Telegram bot token |
| `SMTP_HOST` | Environment | Alert Dispatcher | Outbound SMTP email server |
| `SMTP_PORT` | Environment | Alert Dispatcher | Outbound SMTP port |
| `SMTP_USER` | Environment | Alert Dispatcher | SMTP username |
| `SMTP_PASS` | Environment | Alert Dispatcher | SMTP password |

## Build, deploy, runtime
- Node.js (v20+) runtime with TypeScript.
- Build step: `npm run build` compiles TypeScript to `dist/`.
- Runtime: Web server (`dist/web/server.js`) and Workers (`dist/workers/worker.js`) run as separate processes.

## Boundaries
- Public Status Page: Publicly readable; cached in-memory with sub-100ms response time; isolated from administrative write routes.
- API Key Auth: Guarded routes for creating and editing monitors (`/api/v1/monitors`).
- Multi-Worker Confirmation: Protects against false alarms caused by single worker host failure.
