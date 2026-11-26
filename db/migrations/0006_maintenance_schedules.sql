-- Recurring maintenance rules (D-012, D-031): daily, or weekly on chosen weekdays, all in UTC.
-- A rule is expanded into windows when it is read (src/shared/maintenance.ts); no rows are generated.
-- A rule is ended by setting ended_at, never deleted, so the uptime of past periods stays the same.
-- Times come from the Clock (PATTERN-004).

CREATE TABLE maintenance_schedules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  monitor_id BIGINT UNSIGNED NOT NULL,
  frequency ENUM('daily', 'weekly') NOT NULL,
  weekdays SET('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat') NOT NULL,
  start_time TIME NOT NULL,
  duration_minutes INT UNSIGNED NOT NULL,
  starts_on DATE NOT NULL,
  ended_at DATETIME(3) NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_maintenance_schedules_monitor (monitor_id),
  CONSTRAINT fk_maintenance_schedules_monitor FOREIGN KEY (monitor_id) REFERENCES monitors (id) ON DELETE CASCADE,
  CONSTRAINT fk_maintenance_schedules_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_maintenance_schedules_start_time CHECK (start_time >= '00:00:00' AND start_time < '24:00:00'),
  -- Daily: no weekdays, under 24 h. Weekly: at least one weekday, under 7 days.
  CONSTRAINT chk_maintenance_schedules_shape CHECK (
    (frequency = 'daily' AND weekdays = '' AND duration_minutes BETWEEN 1 AND 1439)
    OR (frequency = 'weekly' AND weekdays <> '' AND duration_minutes BETWEEN 1 AND 10079)
  )
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
