# Contracts — status-page-uptime-monitoring

<!-- graffino-agentic:begin v1 -->
> Promises across a boundary. **Provided:** this repo owns the contract; the text
> lives here only. **Consumed:** a link to the provider's entry plus the fields this
> repo relies on. **External:** what we rely on from a third-party service.
> Changing a provided contract is a PROPOSAL (AGENTS.md → The gate) and the plan
> lists the consumers' files too. Status: `approved` · `proposed` · `superseded-by`.
<!-- graffino-agentic:end -->

## Index
- C-001 · Public status page JSON API · provided · _proposed_
- C-004 · Monitors API v1 and status badge · provided
- C-002 · Telegram Bot API notification dispatch · external · _proposed_
- C-003 · Target HTTP/HTTPS Services & TLS probing · external

---

## Provided

### C-001 · Public status page JSON API
- **Status:** proposed
- **Interface:** HTTP REST API (`GET /api/v1/status/:org_slug`)
- **Consumers:** External dashboards
- **Shape:** JSON with the organization's overall status, each component's status (`operational`, `degraded`, `outage`, `maintenance`, `no_data`) and the active incidents with their human-written updates.
- **Rules:** Same data as the cached public status page, answered in under 100 ms. Needs a Bearer key (D-025). The monitors routes and the badge moved to C-004; the exact shape of this route is not decided yet.
- **Evidence:** docs/brief.md:14, docs/brief.md:22, docs/design/mocks/DS-p26-api-docs.html
- **Source:** docs · confidence high

### C-004 · Monitors API v1 and status badge
- **Status:** approved
- **Interface:** HTTP: `GET /api/v1/monitors`, `POST /api/v1/monitors`, `GET /badge/:monitor_id.svg`. Documented for its users in `API.md`.
- **Consumers:** Scripts and CI of an organization (with a key), README badges (public)
- **Shape:**
  - Auth: `Authorization: Bearer <public_id>.<secret>` (12 + 43 base64url characters), level `read` or `write`, one organization per key (D-025).
  - `GET /api/v1/monitors` → 200 `{"monitors": [{"id", "name", "url", "interval_minutes", "status"}]}`, the key's organization only, by id.
  - `POST /api/v1/monitors` (write key, `Content-Type: application/json`): `name` (1–255) and `url` (http/https, ≤ 2048) required; optional `interval_minutes` 1–60 (5), `expected_status` 100–599 (200), `timeout_ms` 1000–60000 (30000), `keyword` 1–255 (none), `latency_threshold_ms` ≥ 1 (none); null means not set; other fields are ignored; TLS is checked for `https://` urls. → 201 with the monitor in the list's shape, `status: "no_data"`.
  - `status`: `operational`, `degraded`, `outage`, `maintenance`, `no_data` (D-023).
  - Errors: `{"error", "message"}`; 401 `unauthorized` (+ `WWW-Authenticate: Bearer`), 403 `forbidden`, 400 `invalid_request` (+ `fields` for wrong fields), 429 `rate_limited` (+ `Retry-After` seconds), 500 `internal` (D-039).
  - Badge: `image/svg+xml`, `Cache-Control: no-cache`, label `operational`, `degraded`, `outage`, `maintenance` or `no data`; 404 text for an unknown id.
- **Rules:** 60 requests per minute per key, sliding window, in each web process's memory; a refused request is not counted. Requests under `/api/` need no `Origin` and read no cookie (D-040). Creating a monitor bumps `status_version`, so the public page shows it within 30 s (D-020).
- **Evidence:** src/web/api/routes.ts, src/web/api/monitor-input.ts, src/web/api/badge.ts, test/web/api-routes.test.ts, API.md
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26

## Consumed

## External

### C-002 · Telegram Bot API notification dispatch
- **Status:** proposed
- **Interface:** Telegram Bot HTTP API (`sendMessage`)
- **We rely on:** Immediate delivery of outage and resolution alerts to target chat IDs.
- **Known quirks:** Rate limits on group messages; duplicate alerts suppressed at the application layer.
- **Evidence:** docs/brief.md:12

### C-003 · Target HTTP/HTTPS Services & TLS probing
- **Status:** approved
- **Interface:** Standard HTTP/1.1 and HTTP/2 protocol and TLS socket handshake
- **We rely on:** HTTP response status code, response body keyword match, latency timing, and x509 certificate expiry date.
- **Known quirks:** Worker host DNS failures must be isolated from target failures by cross-referencing other probes on the same worker.
- **Evidence:** docs/brief.md:10, docs/brief.md:24, src/worker/check.ts
- **Confirmed:** 2026-11-26
