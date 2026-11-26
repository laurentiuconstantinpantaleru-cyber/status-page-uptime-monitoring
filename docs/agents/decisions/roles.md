# Role and Permission Decisions

## D-018 · Role permission matrix

- **Status:** superseded-by D-042
- **Date:** 2026-11-25
- **Rule:** Four roles exist with the following permissions:
  - **Visitor** — public status page only; no login required.
  - **Member** — view monitors and incidents; acknowledge incidents; write human incident timeline updates; start quick maintenance mode (15/30/60 min). Cannot create or delete monitors, cannot view alert contacts, cannot manage API keys.
  - **Org Admin** — all Member actions plus: create, modify, delete monitors; view and manage alert contacts; manage API keys; download monthly reports on demand; schedule monthly reports — within their organization only.
  - **Global Admin** — all Org Admin actions across all organizations.
- **Why:** Separates operational acknowledgment from administrative configuration; prevents members from accidentally exposing alert contacts or revoking API keys.
- **Rejected:** Flat single-role model (no access control); exposing alert contacts to Members (privacy concern).
- **Evidence:** docs/brief.md:17
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26

## D-042 · Role permission matrix
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** Four roles exist with the following permissions:
  - **Visitor** — public status page only; no login required.
  - **Member** — view monitors and incidents; acknowledge incidents; write human incident timeline updates; start quick maintenance mode (15/30/60 min). Cannot create or delete monitors, cannot view alert contacts, cannot manage API keys, cannot download monthly reports.
  - **Org Admin** — all Member actions plus: create, modify, delete monitors; view and manage alert contacts; manage API keys; download monthly reports on demand — within their organization only. Monthly reports go out automatically on the 1st (D-019, D-041); there is no schedule to set.
  - **Global Admin** — all Org Admin actions across all organizations.
- **Why:** As D-018. The user approved removing "schedule monthly reports" on 2026-11-26: D-019 sends reports automatically on the 1st, and the two entries contradicted each other.
- **Rejected:** As D-018; a per-organization report schedule (not asked for; D-019 fixes the 1st).
- **Evidence:** docs/brief.md:17, src/web/auth/access.ts, test/web/access-matrix.test.ts
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26
