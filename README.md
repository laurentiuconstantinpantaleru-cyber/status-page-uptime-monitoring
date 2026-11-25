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
