# Status page + uptime monitoring

Availability and uptime monitoring service for student projects and local businesses.
Provides HTTP/TLS/keyword/latency checks, automated incident lifecycle, maintenance windows,
email/Telegram alerts, sub-100ms cached public status pages, and monthly uptime reporting.

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
| `DOMAIN` | the public host name; without a domain, `<ip with dashes>.sslip.io`, e.g. `203-0-113-7.sslip.io` |
| `MYSQL_DATABASE`, `MYSQL_USER` | e.g. `uptime` |
| `MYSQL_PASSWORD` | letters and digits only, e.g. `openssl rand -hex 24` (it goes into a URL) |

The status page is then at `https://<DOMAIN>/status`. The monitors with consent
(MONITORS.md) come with the migrations, at 5 minutes.
