# API questions

## Q-016 · Where do the API and status badge docs live?
- **Status:** answered 2026-11-26
- **Blocks:** The footer link on DS-p26-public-status; the mock links to a placeholder. The API itself is C-004.
- **Who answers:** user
- **Answer:** In `API.md` at the repo root. Where the public status page's footer link points is still open (Q-022).
- **Recorded as:** C-004

## Q-018 · What do the API's requests and responses look like?
- **Status:** answered 2026-11-26
- **Blocks:** `GET /api/v1/monitors` and `GET /api/v1/status/:org_slug` and the examples on DS-p26-api-docs.
- **Who answers:** user
- **Answer:** The user approved the proposed answer with the plan on 2026-11-26, with five status values instead of three: `GET /api/v1/monitors` returns `{"monitors": [{"id", "name", "url", "interval_minutes", "status"}]}` and `status` is `operational`, `degraded`, `outage`, `maintenance` or `no_data`; `POST /api/v1/monitors` takes `name`, `url` and the optional fields listed in C-004 and answers 201 with the monitor; 401, 403 and 429 as proposed. Only the list is a read route; `GET /api/v1/status/:org_slug` stays in C-001, not yet shaped.
- **Recorded as:** C-004, D-039

## Q-022 · Where does the public status page's API link point?
- **Status:** open
- **Blocks:** The footer link on DS-p26-public-status (a placeholder in the mock). The docs live in `API.md` (Q-016); there is no web page for them yet (DS-p26-api-docs is a draft).
- **Who answers:** user
