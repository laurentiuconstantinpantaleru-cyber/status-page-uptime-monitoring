# Decisions — status-page-uptime-monitoring

<!-- graffino-agentic:begin v1 -->
> Constraints the code must obey. Status: `approved` (obey) · `proposed` (do not
> build on it) · `superseded-by <ID>` (kept to explain old code).
> Adding or changing an entry needs the user's OK (AGENTS.md → The gate).
<!-- graffino-agentic:end -->

## Index
### [Api](decisions/api.md)
- D-017 · API key levels, storage, and rate limiting

### [Architecture](decisions/architecture.md)
- D-001 · Node.js + TypeScript with Fastify for web API, SSR status page, and workers
- D-002 · Server-rendered frontend with minimal vanilla JS for charts
- D-003 · PostgreSQL with versioned migrations and in-memory cache for status page
- D-004 · Vitest with injectable clock for simulated-time tests
- D-005 · Multi-worker check architecture with two-phase failure confirmation
- D-008 · Check workers co-located as separate processes on the same host
- D-015 · Worker degradation detection and fault suppression
- D-009 · Explicit out-of-scope architectural and functional boundaries

### [Incidents](decisions/incidents.md)
- D-006 · Incident lifecycle thresholds: N=2 confirmed failures to open, M=2 successes to close
- D-007 · Alert escalation timeout and operator acknowledgment
- D-012 · Quick maintenance mode button (15/30/60 min) in addition to scheduled calendar windows
- D-013 · Alert payload structure: HTTP code, error cause, and time since last successful check
- D-014 · Human-authored incident timeline updates with standardized lifecycle stages

### [Monitoring](decisions/monitoring.md)
- D-016 · Default check interval of 5 minutes, range 1–60 minutes
- D-010 · TLS certificate expiration warnings at 30 days and 7 days reminder
- D-011 · Raw check retention for 7 days with hourly and daily roll-up compaction

### [Reporting](decisions/reporting.md)
- D-019 · Monthly uptime report: schedule, recipients, format, and idempotency

### [Roles](decisions/roles.md)
- D-018 · Role permission matrix

---
