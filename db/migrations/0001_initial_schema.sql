-- Initial schema (D-020, D-021). All times are UTC DATETIME(3) and are supplied by
-- the application from its Clock: no column has a time default.

CREATE TABLE organizations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  escalation_timeout_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_organizations_slug (slug),
  -- D-007: default 15 minutes, configurable up to 1 hour.
  CONSTRAINT chk_organizations_escalation CHECK (escalation_timeout_minutes BETWEEN 1 AND 60)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NULL,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  role ENUM('member', 'org_admin', 'global_admin') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_users_email (email),
  -- RESTRICT: MySQL forbids referential actions on a column used in a CHECK.
  CONSTRAINT fk_users_organization FOREIGN KEY (organization_id) REFERENCES organizations (id),
  -- D-018: a global admin spans all organizations; every other user belongs to one.
  CONSTRAINT chk_users_role_organization CHECK ((role = 'global_admin') = (organization_id IS NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE monitors (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  interval_minutes TINYINT UNSIGNED NOT NULL DEFAULT 5,
  expected_status SMALLINT UNSIGNED NOT NULL DEFAULT 200,
  timeout_ms INT UNSIGNED NOT NULL,
  keyword VARCHAR(255) NULL,
  check_tls BOOLEAN NOT NULL,
  latency_threshold_ms INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_monitors_organization (organization_id),
  CONSTRAINT fk_monitors_organization FOREIGN KEY (organization_id) REFERENCES organizations (id),
  -- D-016: default 5 minutes, range 1-60.
  CONSTRAINT chk_monitors_interval CHECK (interval_minutes BETWEEN 1 AND 60)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE workers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  last_seen_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_workers_name (name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Raw check results, kept 7 days (D-011).
CREATE TABLE checks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  monitor_id BIGINT UNSIGNED NOT NULL,
  worker_id BIGINT UNSIGNED NOT NULL,
  checked_at DATETIME(3) NOT NULL,
  kind ENUM('scheduled', 'confirmation') NOT NULL,
  outcome ENUM('up', 'down') NOT NULL,
  http_status SMALLINT UNSIGNED NULL,
  latency_ms INT UNSIGNED NULL,
  error_cause VARCHAR(64) NULL,
  tls_expires_at DATETIME(3) NULL,
  -- Latest checks of a monitor (N/M thresholds, charts).
  KEY idx_checks_monitor_checked (monitor_id, checked_at),
  -- One worker's checks in a window (D-015 degradation).
  KEY idx_checks_worker_checked (worker_id, checked_at),
  -- Removing raw checks older than 7 days (D-011).
  KEY idx_checks_checked (checked_at),
  CONSTRAINT fk_checks_monitor FOREIGN KEY (monitor_id) REFERENCES monitors (id) ON DELETE CASCADE,
  CONSTRAINT fk_checks_worker FOREIGN KEY (worker_id) REFERENCES workers (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE incidents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  monitor_id BIGINT UNSIGNED NOT NULL,
  started_at DATETIME(3) NOT NULL,
  resolved_at DATETIME(3) NULL,
  cause VARCHAR(64) NOT NULL,
  cause_detail VARCHAR(1024) NULL,
  http_status SMALLINT UNSIGNED NULL,
  -- Set only while open, so the unique key allows one open incident per monitor.
  -- VIRTUAL: a STORED column could not use monitor_id, whose foreign key cascades.
  open_monitor_id BIGINT UNSIGNED GENERATED ALWAYS AS (IF(resolved_at IS NULL, monitor_id, NULL)) VIRTUAL,
  UNIQUE KEY uq_incidents_open_monitor (open_monitor_id),
  -- Incidents overlapping a period (uptime across month boundaries).
  KEY idx_incidents_monitor_started (monitor_id, started_at),
  CONSTRAINT fk_incidents_monitor FOREIGN KEY (monitor_id) REFERENCES monitors (id) ON DELETE CASCADE,
  CONSTRAINT chk_incidents_resolved CHECK (resolved_at IS NULL OR resolved_at >= started_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Human-written timeline updates (D-014).
CREATE TABLE incident_updates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  incident_id BIGINT UNSIGNED NOT NULL,
  author_user_id BIGINT UNSIGNED NULL,
  stage ENUM('investigating', 'identified', 'monitoring', 'resolved') NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_incident_updates_incident_created (incident_id, created_at),
  CONSTRAINT fk_incident_updates_incident FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE,
  CONSTRAINT fk_incident_updates_author FOREIGN KEY (author_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Scheduled calendar windows and quick maintenance (D-012). Recurrence: Q-009.
CREATE TABLE maintenance_windows (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  monitor_id BIGINT UNSIGNED NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  source ENUM('scheduled', 'quick') NOT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_maintenance_windows_monitor_starts (monitor_id, starts_at),
  CONSTRAINT fk_maintenance_windows_monitor FOREIGN KEY (monitor_id) REFERENCES monitors (id) ON DELETE CASCADE,
  CONSTRAINT fk_maintenance_windows_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_maintenance_windows_range CHECK (ends_at > starts_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Primary contacts are alerted at once, secondary ones on escalation (D-007).
CREATE TABLE alert_contacts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  channel ENUM('email', 'telegram') NOT NULL,
  address VARCHAR(255) NOT NULL,
  priority ENUM('primary', 'secondary') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_alert_contacts_organization_priority (organization_id, priority),
  CONSTRAINT fk_alert_contacts_organization FOREIGN KEY (organization_id) REFERENCES organizations (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- D-017: a key is `<public_id>.<secret>`; only the bcrypt hash of the secret is stored.
CREATE TABLE api_keys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  level ENUM('read', 'write') NOT NULL,
  public_id CHAR(12) NOT NULL,
  key_hash CHAR(60) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  UNIQUE KEY uq_api_keys_public_id (public_id),
  KEY idx_api_keys_organization (organization_id),
  CONSTRAINT fk_api_keys_organization FOREIGN KEY (organization_id) REFERENCES organizations (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
