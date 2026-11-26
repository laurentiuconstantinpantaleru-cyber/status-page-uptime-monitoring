-- The first student projects from MONITORS.md whose owners gave consent (Q-001).
-- 5-minute interval (D-016), 30 s timeout for Render cold starts (D-022), TLS checked.
-- Safe to run twice: the organization is keyed by its slug and a monitor by its url.

INSERT INTO organizations (slug, name, created_at, updated_at)
VALUES ('student-projects', 'Student projects', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE slug = slug;

INSERT INTO monitors
  (organization_id, name, url, interval_minutes, expected_status, timeout_ms, keyword, check_tls, created_at, updated_at)
SELECT o.id, s.name, s.url, 5, 200, 30000, s.keyword, TRUE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM organizations o
JOIN (
  SELECT 'Peer review' AS name,
         'https://peer-review-double-blind-pentru-proiecte.onrender.com/' AS url,
         'Peer review' AS keyword
  UNION ALL
  SELECT 'P23 Sneaker Price Monitor', 'https://pricemonitor-ma.onrender.com/catalog', 'PriceMonitor'
  UNION ALL
  SELECT 'StudRide', 'https://proiectweb1-production.up.railway.app/', 'StudRide'
) s
WHERE o.slug = 'student-projects'
  AND NOT EXISTS (SELECT 1 FROM monitors m WHERE m.organization_id = o.id AND m.url = s.url);
