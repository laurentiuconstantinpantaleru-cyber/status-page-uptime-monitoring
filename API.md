# API and status badge

Read and create your organization's monitors from scripts, and show a monitor's live
status in a README. The contract behind this page is C-004 in
[`docs/agents/CONTRACTS.md`](docs/agents/CONTRACTS.md). Times are UTC.

- [Keys](#keys)
- [List monitors](#list-monitors) · `GET /api/v1/monitors`
- [Create a monitor](#create-a-monitor) · `POST /api/v1/monitors`
- [Errors](#errors)
- [Rate limit](#rate-limit)
- [Status badge](#status-badge) · `GET /badge/:monitor_id.svg`

## Keys

Every `/api/v1` request needs a key in the `Authorization` header:

```http
Authorization: Bearer <public_id>.<secret>
```

A key belongs to one organization and sees only that organization's monitors. It has one
of two levels:

| Level | Can |
|---|---|
| `read` | List monitors and read their current status. |
| `write` | Everything `read` can, plus create monitors. |

Someone with access to the server creates a key with:

```bash
npm run build
DATABASE_URL=… npm run apikey:create -- --org <organization-slug> --name "<what it is for>" --level <read|write>
```

The command prints the key **once**. Store it somewhere safe, such as your CI's secret
store. Only the public id and a bcrypt hash of the secret are stored, so a lost key cannot
be shown again; create a new one instead. Keys go in the header, never in a URL, so they
stay out of server logs.

The API reads no cookies: signing in to the admin pages does not give a script access.

## List monitors

```http
GET /api/v1/monitors
```

Every monitor of the key's organization, by id, with its current status.

```bash
curl https://<your-status-host>/api/v1/monitors \
  -H "Authorization: Bearer <public_id>.<secret>"
```

```json
{
  "monitors": [
    {
      "id": 12,
      "name": "Hug The Mug",
      "url": "https://hugthemug.ro/",
      "interval_minutes": 5,
      "status": "operational"
    }
  ]
}
```

`status` is one of:

| Value | Means |
|---|---|
| `operational` | The last check passed. |
| `degraded` | The last check was slower than the monitor's latency threshold. |
| `outage` | An incident is open: two workers confirmed the failure. |
| `maintenance` | A maintenance window is running; no incident opens. |
| `no_data` | The monitor has not been checked yet. |

## Create a monitor

```http
POST /api/v1/monitors
Content-Type: application/json
```

Needs a `write` key.

| Field | Required | Value | Default |
|---|---|---|---|
| `name` | yes | text, 1–255 characters | — |
| `url` | yes | an `http://` or `https://` URL, up to 2048 characters | — |
| `interval_minutes` | no | whole number, 1–60 | `5` |
| `expected_status` | no | whole number, 100–599 | `200` |
| `timeout_ms` | no | whole number, 1000–60000 | `30000` |
| `keyword` | no | text, 1–255 characters, that the page must contain | none |
| `latency_threshold_ms` | no | whole number, at least 1; slower checks show `degraded` | none |

`null` means the same as leaving a field out. Other fields are ignored. The TLS
certificate is checked for `https://` URLs.

```bash
curl https://<your-status-host>/api/v1/monitors \
  -H "Authorization: Bearer <public_id>.<secret>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Library catalogue", "url": "https://library.example/", "interval_minutes": 10}'
```

```http
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "id": 42,
  "name": "Library catalogue",
  "url": "https://library.example/",
  "interval_minutes": 10,
  "status": "no_data"
}
```

The workers pick the new monitor up within a minute, and the public status page shows it
within 30 seconds.

## Errors

Every error is JSON with an `error` code and a `message` for people:

```json
{ "error": "forbidden", "message": "This key can only read. Create a write key to change monitors." }
```

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_request` | The body is not a JSON object sent as `application/json`, or fields are wrong. Wrong fields are listed in `fields`, one message each. |
| 401 | `unauthorized` | The key is missing, malformed, unknown, wrong or revoked. Sent with `WWW-Authenticate: Bearer`. |
| 403 | `forbidden` | A `read` key tried to create a monitor. |
| 429 | `rate_limited` | The key made more than 60 requests in the last minute. |
| 500 | `internal` | Something failed on the server. Try again later. |

```json
{
  "error": "invalid_request",
  "message": "Some fields are wrong; see fields.",
  "fields": {
    "interval_minutes": "Give interval_minutes as a whole number from 1 to 60."
  }
}
```

## Rate limit

Each key can make 60 requests in any 60 seconds. The next one gets 429; wait the seconds in
`Retry-After` and try again. Refused requests do not count, and requests with a wrong key
do not use up the key's limit.

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{
  "error": "rate_limited",
  "message": "This key made more than 60 requests in the last minute. Try again in 30 seconds."
}
```

## Status badge

```http
GET /badge/:monitor_id.svg
```

A small SVG image with a monitor's current status: `operational`, `degraded`, `outage`,
`maintenance` or `no data`. It is public, needs no key and has no rate limit, so it works
in a README. It is sent with `Cache-Control: no-cache`. An id that is not a monitor gets
404.

```markdown
[![Status](https://<your-status-host>/badge/12.svg)](https://<your-status-host>/status)
```
