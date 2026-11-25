-- The monitors from MONITORS.md whose owners gave consent: the two local businesses
-- (by phone, 2026-11-25). Student projects follow once agreed (Q-001).
-- Latency thresholds are not set yet (Q-010).

INSERT INTO organizations (slug, name, created_at, updated_at) VALUES
  ('hug-the-mug', 'Hug The Mug', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('cafe-wien', 'Cafe Wien Sibiu', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

INSERT INTO monitors
  (organization_id, name, url, interval_minutes, expected_status, timeout_ms, check_tls, created_at, updated_at)
SELECT id, 'Hug The Mug', 'https://hugthemug.ro/', 5, 200, 10000, TRUE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM organizations WHERE slug = 'hug-the-mug';

INSERT INTO monitors
  (organization_id, name, url, interval_minutes, expected_status, timeout_ms, check_tls, created_at, updated_at)
SELECT id, 'Cafe Wien Sibiu', 'http://cafewien.ro/', 5, 200, 10000, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM organizations WHERE slug = 'cafe-wien';
