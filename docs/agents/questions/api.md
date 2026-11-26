# API questions

## Q-016 · Where do the API and status badge docs live?
- **Status:** open
- **Blocks:** The footer link on DS-p26-public-status; the mock links to a placeholder. The API itself is C-001 (proposed).
- **Who answers:** user
- **Confirmed:** 2026-11-26

## Q-018 · What do the API's requests and responses look like?
- **Status:** investigating
- **Blocks:** `GET /api/v1/monitors` and `GET /api/v1/status/:org_slug` (C-001, proposed) and the examples on DS-p26-api-docs.
- **Who answers:** user
- **Proposed answer:** Keys travel as `Authorization: Bearer <public_id>.<secret>` (D-025). `GET /api/v1/monitors` returns `{"monitors": [{"id", "name", "url", "interval_minutes", "status"}]}`; `GET /api/v1/status/:org_slug` returns `{"organization", "status", "updated_at", "components": [{"name", "status"}], "active_incidents": []}`; `status` is `operational`, `degraded` or `outage`. A missing or wrong key gets 401, a `read` key that writes gets 403, and request 61 in a minute gets 429 with `Retry-After` and `{"error": "rate_limited", "message"}`. The badge is `GET /badge/:monitor_id.svg` (D-025), as drawn on DS-p26-api-docs.
