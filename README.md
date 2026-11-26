# Status page + uptime monitoring

Availability and uptime monitoring service for student projects and local businesses:
HTTP/TLS/keyword/latency checks from two workers, incidents that open and close on their own,
maintenance windows, a cached public status page, an API with a status badge, monthly uptime
reports, and email and Telegram alerts with escalation.

## Status

Done, with tests:

- Checks: HTTP status, keyword, latency threshold, TLS days left, redirects (D-026), timeout (D-022).
- Two worker processes; a check is confirmed by the other worker before it counts (D-005, D-027);
  a scheduler on a fixed grid with no drift and no overlap (`test/worker/scheduler.test.ts`).
- Incidents open after 2 confirmed failures and close after 2 successes (D-006); a degraded
  worker opens none (D-015).
- Uptime from incidents and maintenance, across month boundaries (D-030, `test/shared/uptime.test.ts`).
- Maintenance: one-off, recurring and the quick 15/30/60 min button (D-012, D-031); only the
  quick button has a page.
- Public status page `/status`, cached in memory and dropped on a state change (D-020, D-032).
- Sign-in, roles, the monitors dashboard and human-written incident updates (D-034–D-038, D-042).
- API `/api/v1/monitors` with read/write Bearer keys, 60 requests per minute, and the public
  badge `/badge/:monitor_id.svg` (D-025, D-039, C-004; `API.md`).
- Monthly PDF reports per organization, emailed to org admins and downloadable at
  `/admin/reports` (D-019, D-041, D-043).
- Alerts by email and Telegram: the opened alert to the primary contacts, escalation to the
  secondary ones after the organization's timeout, one resolved alert; acknowledged from the
  alert's link or on `/admin/incidents` (D-007, D-044, C-002). Contacts come from
  `npm run contact:add`.

Not done yet:

- TLS expiry warnings (D-010): the days left are measured, nothing is sent yet.
- Raw-check retention (7 days) and the hourly / daily roll-ups (D-011, Q-023).
- The response time chart on the status page (Q-012).
- Adding and editing monitors in the dashboard (the API can create them), scheduled maintenance,
  alert contacts and API keys from the web pages (they come from `npm run contact:add` and
  `npm run apikey:create`).
- Production: no server is configured, so the deploy job is skipped. Email and Telegram need the
  `SMTP_URL`, `MAIL_FROM` and `TELEGRAM_BOT_TOKEN` secrets; without them that channel waits.
- Monitors: 2 of the 12 targets have consent (`MONITORS.md`).

## Run locally

```bash
npm install
cp .env.example .env                 # fill in MYSQL_* and DATABASE_URL
docker compose up -d                 # MySQL, see Database
npm run build && npm run db:migrate
npm run user:create -- --email admin@example.test --name "Admin" --role global_admin   # password from stdin
npm run start:web                    # http://localhost:3000/status
```

Then start two workers (Workers below). `npm test` runs the tests; `npm run lint` runs the
type check and the ledger lint.

## Database

```bash
docker compose up -d                 # local MySQL 8.4 on 127.0.0.1:3307
npm run build && npm run db:migrate  # apply db/migrations/ to DATABASE_URL
```

The schema tests need a throwaway MySQL they may wipe (database name ending in
`_test`), for example a separate container:

```bash
docker run -d --rm --name uptime-schema-test -e MYSQL_ROOT_PASSWORD=change-me \
  -e MYSQL_DATABASE=uptime_test -p 127.0.0.1:3308:3306 mysql:8.4 --default-time-zone=+00:00
TEST_DATABASE_URL=mysql://root:change-me@localhost:3308/uptime_test npm test
```

Without `TEST_DATABASE_URL` they are skipped; CI always runs them.

## Workers

```bash
WORKER_NAME=worker-1 npm run start:worker   # at least two, each with its own name (D-005, D-027)
WORKER_NAME=worker-2 npm run start:worker
```

## Deploy

Production runs on one VPS with Docker (`deploy/compose.prod.yml`): MySQL, a one-shot
migration, the web server, `worker-1`, `worker-2` and Caddy, which gets the HTTPS
certificate for `DOMAIN` from Let's Encrypt. Every push to `main` that passes the tests
and the image check builds `ghcr.io/<repo>:<commit>`, copies the compose files to
`~/uptime/` on the server, writes `~/uptime/.env` from the secrets below and restarts the
stack. Pull requests never deploy.

One-time setup:

1. Create the server (Ubuntu with Docker Engine and the compose plugin) and a deploy user
   in the `docker` group; open ports 22, 80 and 443.
2. Create an SSH key pair for the deploy; put the public key in the deploy user's
   `~/.ssh/authorized_keys`.
3. In GitHub, *Settings → Environments*, create `production` and add these secrets:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | the server's IP address |
| `DEPLOY_USER` | the deploy user |
| `DEPLOY_SSH_KEY` | the private key of step 2 |
| `DEPLOY_KNOWN_HOSTS` | the output of `ssh-keyscan <DEPLOY_HOST>`, checked against the server's own fingerprints |
| `DOMAIN` | the public host name, e.g. `status.example.ro`, with a DNS `A` record to the server's IP; its registered domain must be your own or on the Public Suffix List (not sslip.io or nip.io: D-029) |
| `MYSQL_DATABASE`, `MYSQL_USER` | e.g. `uptime` |
| `MYSQL_PASSWORD` | letters and digits only, e.g. `openssl rand -hex 24` (it goes into a URL) |
| `SMTP_URL`, `MAIL_FROM` | optional: the mail server for reports and alerts, e.g. `smtps://user:password@smtp.example.com:465` |
| `TELEGRAM_BOT_TOKEN` | optional: the bot that sends Telegram alerts (from @BotFather) |

The status page is then at `https://<DOMAIN>/status`. The monitors with consent
(MONITORS.md) come with the migrations, at 5 minutes.
