# Admin panel decisions

## D-037 · The monitors dashboard and its actions
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** `GET /admin/monitors` (DS-p26-admin-monitors) lists the monitors of the user's organization, or every organization grouped by name for a global admin, each with its status (D-023), interval and last check. Any signed-in user can start quick maintenance for 15, 30 or 60 minutes (`POST /admin/monitors/:id/maintenance`, D-012, D-031). An org admin or global admin can delete a monitor after a confirmation page (`GET` then `POST /admin/monitors/:id/delete`); the delete bumps `status_version`. Add and Edit are shown to org admins and global admins as disabled "coming soon" buttons; members do not see Add, Edit or Delete.
- **Why:** The user approved the plan on 2026-11-26 and confirmed the mock with a confirmation page instead of its `<dialog>`, which would need script that D-024 does not allow.
- **Rejected:** A `<dialog>` opened by script (D-024); building Add and Edit now (not requested).
- **Evidence:** src/web/admin/monitors.ts, src/web/views/admin/monitors.html, test/web/admin-monitors.test.ts
- **Source:** user · confidence high

## D-038 · Writing incident updates
- **Status:** approved
- **Date:** 2026-11-26
- **Rule:** `GET /admin/incidents` (DS-p26-admin-incidents) lists the open incidents and the ones resolved in the 90 × 24 h before now, of the user's organization (all for a global admin), each with its updates and a form. Any signed-in user may post an update (`POST /admin/incidents/:id/updates`) with a stage (`investigating`, `identified`, `monitoring`, `resolved`) and a text of 1–2000 characters after trimming. A `resolved` update is text only: incidents still resolve on their own (D-006). The insert and the `status_version` bump run in one transaction (D-033), with the author's id. Updates are never edited or deleted.
- **Why:** The user approved the plan on 2026-11-26; the resolved ones of the last 90 days are the ones the status page still shows (D-032).
- **Rejected:** Closing an incident from a `resolved` update (would fight the worker's M=2 rule); editing and deleting updates (not requested).
- **Evidence:** src/web/admin/incidents.ts, test/web/admin-incidents.test.ts
- **Source:** user · confidence high
