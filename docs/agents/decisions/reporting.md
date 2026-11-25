# Reporting Decisions

## D-019 · Monthly uptime report: schedule, recipients, format, and idempotency

- **Status:** approved
- **Date:** 2026-11-25
- **Rule:** Monthly uptime reports are generated automatically on the 1st of each month. Recipients are org admins only (not members). Delivery is by email with the PDF attached. Org admins can also download the report on demand from the admin dashboard. PDF generation uses a PDF library (e.g. pdfkit or pdf-lib) — no headless browser. The generation job is idempotent per (organization, year-month): re-running it does not duplicate emails or PDFs.
- **Why:** Provides a reliable monthly audit trail for each organization's uptime without manual intervention; idempotency prevents double-sending on job restarts.
- **Rejected:** Headless browser for PDF (unnecessary complexity and resource overhead); sending to all members (alert contact privacy); non-idempotent job (risk of duplicate emails on retry).
- **Evidence:** docs/brief.md:15
- **Source:** user · confidence high
- **Confirmed:** 2026-11-25
