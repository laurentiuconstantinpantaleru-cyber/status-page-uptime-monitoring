# Contracts — status-page-uptime-monitoring

<!-- graffino-agentic:begin v1 -->
> Promises across a boundary. **Provided:** this repo owns the contract; the text
> lives here only. **Consumed:** a link to the provider's entry plus the fields this
> repo relies on. **External:** what we rely on from a third-party service.
> Changing a provided contract is a PROPOSAL (AGENTS.md → The gate) and the plan
> lists the consumers' files too. Status: `approved` · `proposed` · `superseded-by`.
<!-- graffino-agentic:end -->

## Index
- C-001 · Public status page JSON API & badge interface · provided · _proposed_
- C-002 · Telegram Bot API notification dispatch · external · _proposed_
- C-003 · Target HTTP/HTTPS Services & TLS probing · external · _proposed_

---

## Provided

### C-001 · Public status page JSON API & badge interface
- **Status:** proposed
- **Interface:** HTTP REST API (`/api/v1/status/:org_slug`, `/api/v1/monitors`, `/badge/:monitor_id.svg`)
- **Consumers:** Public status page client script, external dashboards, repository README badges
- **Shape:** JSON response returning component health status (`operational`, `degraded`, `outage`), active incidents with human-readable updates, and SVG markup for status badges.
- **Rules:** Status page endpoints must be cached in-memory and respond in under 100ms. Monitor management routes require API key authentication.
- **Evidence:** docs/brief.md:14, docs/brief.md:16, docs/brief.md:22
- **Source:** docs · confidence high

## Consumed

## External

### C-002 · Telegram Bot API notification dispatch
- **Status:** proposed
- **Interface:** Telegram Bot HTTP API (`sendMessage`)
- **We rely on:** Immediate delivery of outage and resolution alerts to target chat IDs.
- **Known quirks:** Rate limits on group messages; duplicate alerts suppressed at the application layer.
- **Evidence:** docs/brief.md:12

### C-003 · Target HTTP/HTTPS Services & TLS probing
- **Status:** proposed
- **Interface:** Standard HTTP/1.1 and HTTP/2 protocol and TLS socket handshake
- **We rely on:** HTTP response status code, response body keyword match, latency timing, and x509 certificate expiry date.
- **Known quirks:** Worker host DNS failures must be isolated from target failures by cross-referencing other probes on the same worker.
- **Evidence:** docs/brief.md:10, docs/brief.md:24
