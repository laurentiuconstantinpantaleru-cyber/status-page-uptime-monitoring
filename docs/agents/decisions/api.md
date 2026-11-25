# API Decisions

## D-017 · API key levels, storage, and rate limiting

- **Status:** approved
- **Date:** 2026-11-25
- **Rule:** API keys are scoped per organization and issued with one of two permission levels: `read` (read monitors and their current status) or `write` (read + create, modify, delete monitors). A key's plaintext is shown exactly once at creation time and is never stored or logged; only its bcrypt hash is persisted. Rate limit is 60 requests per minute per key, enforced in-memory per process, returning HTTP 429 on excess. The SVG badge endpoint (`GET /badge/:monitorId`) is public and requires no key.
- **Why:** Provides controlled programmatic access for integrations while protecting key material; badge endpoint must be embeddable in public READMEs without authentication.
- **Rejected:** Single-level keys with full write access (over-privileges read-only integrations); plaintext key storage (security risk).
- **Evidence:** docs/brief.md:16
- **Source:** user · confidence high
- **Confirmed:** 2026-11-25
