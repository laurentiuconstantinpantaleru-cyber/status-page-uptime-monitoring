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
Source is split into `src/web/` (web process), `src/worker/` (check worker
processes), `src/shared/` (code both use, e.g. the `Clock` in `src/shared/clock.ts`)
and `src/db/` (database connection and migration runner). SQL migrations live in
`db/migrations/` at the repo root. Paths marked _planned_ do not exist yet.

| Part | Path | Responsibility | Talks to |
|---|---|---|---|
| Web Server | `src/web/` (`app.ts`, `server.ts`) | Serves Fastify REST API, SSR status pages, admin views; `GET /health`; `GET /status` (DS-p26-public-status) when `DATABASE_URL` is set | MySQL, in-memory cache |
| Public Status Page | `src/web/status/` (`model.ts`, `data.ts`, `render.ts`), `src/web/views/status.html`, `src/web/public/` | Loads monitors, last checks, incidents and maintenance windows; derives each monitor's status and 90 daily bars; renders the Eta template with the tokens inlined | MySQL, In-Memory Cache |
| In-Memory Cache | `src/web/status/cache.ts` | Keeps the rendered status page; reads `status_version` at most every 30 s on a request, re-renders on a new version, at UTC midnight or a maintenance boundary; serves the last copy if MySQL fails | Web Server |
| Scheduler | `src/worker/` _planned_ | Drift-free execution planning for monitor probes | Check Workers |
| Check Engine | `src/worker/check.ts` | One check through an injected `HttpClient` and `Clock`: status, keyword, latency threshold, TLS days left, failure cause; default timeout 30 s (D-022) | External Targets (via the client) |
| Check Workers | `src/worker/` _planned_ | Schedules probes and runs the check engine; performs 2nd worker confirmation | MySQL, External Targets |
| Incident Engine | `src/shared/` _planned_ | State machine opening/closing incidents and calculating uptime | MySQL, Alert Dispatcher |
| Alert Dispatcher | `src/worker/` _planned_ | Sends Telegram and email notifications with escalation | Telegram API, SMTP |
| Roll-up Job | `src/worker/` _planned_ | Aggregates raw check data older than 7 days | MySQL |
| Database | `src/db/connection.ts`, `src/db/migrate.ts`, `db/migrations/` | UTC connections (D-020); forward-only SQL migrations recorded in `schema_migrations` (D-021) | MySQL |
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
| Orgs, users, roles | MySQL `organizations`, `users` | Web / Admin | One organization per user; `global_admin` has none (D-018) |
| Monitors | MySQL `monitors` | Web / Admin | Targets, interval 1–60 min (D-016), expected status, timeout, keyword, TLS, latency threshold |
| Workers | MySQL `workers` | Check Workers | Worker processes and when each was last seen |
| Raw checks | MySQL `checks` | Check Workers | One row per probe or confirmation; kept 7 days then rolled up (D-011) |
| Incidents & Updates | MySQL `incidents`, `incident_updates` | Incident Engine | Start, end, cause; at most one open incident per monitor; human updates by stage (D-014) |
| Maintenance Windows | MySQL `maintenance_windows` | Web / Admin | Scheduled and quick windows per monitor (D-012), excluded from uptime |
| Alert contacts | MySQL `alert_contacts` | Web / Admin | Email/Telegram, primary or secondary (D-007), per organization |
| API keys | MySQL `api_keys` | Web / Admin | `read`/`write`, public id + bcrypt hash of the secret (D-017) |
| Status version | MySQL `status_version` (one row) | Check Workers (writers, _planned_); Web Server reads | Bumped on every monitor state change; polled every 30 s (D-020, Q-007) |
| Migrations | MySQL `schema_migrations` | `npm run db:migrate` | Applied migration files (D-021) |
| Aggregated Metrics | MySQL `rollup_hourly`, `rollup_daily` _planned_ | Roll-up Job | 90-day uptime and latency history |

### Entity relationships
Times are UTC `DATETIME(3)`. Deleting a monitor deletes its checks, incidents and
maintenance windows.

```mermaid
erDiagram
    organizations ||--o{ users : "has (global_admin: none)"
    organizations ||--o{ monitors : owns
    organizations ||--o{ alert_contacts : alerts
    organizations ||--o{ api_keys : issues
    monitors ||--o{ checks : "probed by"
    workers ||--o{ checks : runs
    monitors ||--o{ incidents : has
    incidents ||--o{ incident_updates : "timeline of"
    users |o--o{ incident_updates : writes
    monitors ||--o{ maintenance_windows : "paused by"
    users |o--o{ maintenance_windows : schedules

    organizations {
        bigint id PK
        varchar slug UK
        varchar name
        smallint escalation_timeout_minutes "1-60, default 15"
    }
    users {
        bigint id PK
        bigint organization_id FK "NULL only for global_admin"
        varchar email UK
        varchar display_name
        enum role "member, org_admin, global_admin"
    }
    monitors {
        bigint id PK
        bigint organization_id FK
        varchar name
        varchar url
        tinyint interval_minutes "1-60, default 5"
        smallint expected_status "default 200"
        int timeout_ms
        varchar keyword "NULL"
        boolean check_tls
        int latency_threshold_ms "NULL"
    }
    workers {
        bigint id PK
        varchar name UK
        datetime last_seen_at "NULL"
    }
    checks {
        bigint id PK
        bigint monitor_id FK
        bigint worker_id FK
        datetime checked_at
        enum kind "scheduled, confirmation"
        enum outcome "up, down"
        smallint http_status "NULL"
        int latency_ms "NULL"
        varchar error_cause "NULL"
        datetime tls_expires_at "NULL"
    }
    incidents {
        bigint id PK
        bigint monitor_id FK
        datetime started_at
        datetime resolved_at "NULL while open"
        varchar cause
        varchar cause_detail "NULL"
        smallint http_status "NULL"
        bigint open_monitor_id UK "generated: one open per monitor"
    }
    incident_updates {
        bigint id PK
        bigint incident_id FK
        bigint author_user_id FK "NULL"
        enum stage "investigating, identified, monitoring, resolved"
        text body
    }
    maintenance_windows {
        bigint id PK
        bigint monitor_id FK
        datetime starts_at
        datetime ends_at
        enum source "scheduled, quick"
        bigint created_by_user_id FK "NULL"
    }
    alert_contacts {
        bigint id PK
        bigint organization_id FK
        enum channel "email, telegram"
        varchar address
        enum priority "primary, secondary"
    }
    api_keys {
        bigint id PK
        bigint organization_id FK
        enum level "read, write"
        char public_id UK
        char key_hash "bcrypt"
        datetime revoked_at "NULL"
    }
```

Indexes behind the main queries: `checks (monitor_id, checked_at)` for a monitor's
latest checks, `checks (worker_id, checked_at)` for worker degradation (D-015),
`checks (checked_at)` for the 7-day purge, `incidents (monitor_id, started_at)` for
incidents overlapping a period. Every table also has `created_at` (and `updated_at`
on `organizations`, `monitors`), left out of the diagram.

## Configuration
| Name | Where set | Used by | Notes |
|---|---|---|---|
| `PORT` | Environment | Web Server | HTTP listening port (default 3000) |
| `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_RANDOM_ROOT_PASSWORD` | `.env` | `docker-compose.yml` | Local MySQL container credentials; root password generated at first start |
| `DATABASE_URL` | Environment | All parts, `npm run db:migrate` | MySQL connection string (`mysql://…`) |
| `TEST_DATABASE_URL` | Environment, CI | `test/db/schema.test.ts` | Throwaway MySQL the schema tests wipe (name ends in `_test`); unset skips them |
| `TELEGRAM_BOT_TOKEN` | Environment | Alert Dispatcher | Telegram bot token |
| `SMTP_HOST` | Environment | Alert Dispatcher | Outbound SMTP email server |
| `SMTP_PORT` | Environment | Alert Dispatcher | Outbound SMTP port |
| `SMTP_USER` | Environment | Alert Dispatcher | SMTP username |
| `SMTP_PASS` | Environment | Alert Dispatcher | SMTP password |

## Build, deploy, runtime
- Node.js (v20+) runtime with TypeScript.
- Build step: `npm run build` compiles TypeScript to `dist/`.
- Migrations: `npm run db:migrate` (after the build) applies pending `db/migrations/*.sql` to `DATABASE_URL`.
- Runtime: Web server (`dist/web/server.js`, started with `npm run start:web`) and Workers (entry under `dist/worker/`, _planned_) run as separate processes.
- Local database: `docker-compose.yml` runs MySQL 8.4 only, published on host port 3307, configured from `.env` (template: `.env.example`).
- CI (`.github/workflows/ci.yml`): ledger lint, `npm ci`, `npm run build`, `npm test` on Node 22, with a `mysql:8.4` service for the schema tests.

## Boundaries
- Public Status Page: Publicly readable; cached in-memory with sub-100ms response time; isolated from administrative write routes.
- API Key Auth: Guarded routes for creating and editing monitors (`/api/v1/monitors`).
- Multi-Worker Confirmation: Protects against false alarms caused by single worker host failure.
