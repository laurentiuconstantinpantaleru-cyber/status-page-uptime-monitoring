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

## D-041 · How the monthly report is made, counted, sent and downloaded
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** The report covers one UTC calendar month of one organization and is in English. It lists each monitor's uptime (D-030), number of incidents, downtime outside maintenance and mean latency; the 3 incident causes with the most downtime in the month, with their number of incidents (ties: more incidents, then the cause's name); and the slowest monitor, by the mean latency of the month's scheduled checks that got a response. A job in the web process runs at start and every hour and works on the last closed month, so the first run after 00:00 UTC on the 1st makes it and a server that was down catches up later in the month. `monthly_reports` keeps one PDF per (organization, month) by a unique key; the right to email it is claimed with `sending_at` in one UPDATE, `emailed_at` is set once the mail server took it, a failed send stores `last_error` and is tried at the next run, and a claim older than an hour is taken to be a crashed send. One email goes to all org admins of the organization (no members, no global admins), through SMTP (`SMTP_URL`, `MAIL_FROM`, Q-004); without them, reports are stored and wait. An organization without org admins gets its report stored and no email. Org admins (their organization) and global admins (any) download a closed month at `GET /admin/reports/:org_id/YYYY-MM.pdf`: the stored PDF, or one made on demand and not stored. The current month and later months are 404. PDFs use pdfkit with DejaVu Sans embedded.
- **Why:** The user approved the plan on 2026-11-26 and chose top 3 by downtime, mean latency, closed months only and SMTP through nodemailer. A PDF made on demand is not stored, so it cannot stop the job from emailing the month.
- **Rejected:** A headless browser (D-019); a cron outside the app (none on the VPS, D-029, and not testable on a simulated clock); running the job in the workers (two of them, a different job, D-027); p95 latency and ranking causes by count; the current month so far; Noto Sans (DejaVu Sans was already on the build host with a licence that allows redistribution).
- **Evidence:** src/shared/report.ts, src/web/reports/job.ts, src/web/reports/store.ts, src/web/reports/pdf.ts, db/migrations/0008_monthly_reports.sql, test/web/report-job.test.ts
- **Source:** user · confidence high
- **Confirmed:** 2026-11-26
