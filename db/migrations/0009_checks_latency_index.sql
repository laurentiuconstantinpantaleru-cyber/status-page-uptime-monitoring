-- The monthly report's mean latency (D-041, D-043) filters a month of checks on kind and
-- latency_ms. Extending idx_checks_monitor_checked with those columns lets MySQL answer it from
-- the index alone. The name stays: queries that use (monitor_id, checked_at) are served as before.

ALTER TABLE checks
  DROP INDEX idx_checks_monitor_checked,
  ADD INDEX idx_checks_monitor_checked (monitor_id, checked_at, kind, latency_ms);
