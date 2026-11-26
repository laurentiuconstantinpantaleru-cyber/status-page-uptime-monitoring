-- A worker found degraded (D-015): one row per episode, open while ended_at is NULL.
-- The counts are what the judgment that opened it saw. Times come from the Clock (PATTERN-004).
-- open_worker_id is set only while open, so the unique key allows one open episode per worker
-- (the same shape as incidents.open_monitor_id).

CREATE TABLE worker_faults (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  worker_id BIGINT UNSIGNED NOT NULL,
  started_at DATETIME(3) NOT NULL,
  ended_at DATETIME(3) NULL,
  monitors_checked INT UNSIGNED NOT NULL,
  checks_total INT UNSIGNED NOT NULL,
  checks_failed INT UNSIGNED NOT NULL,
  confirmations_total INT UNSIGNED NOT NULL,
  confirmations_up INT UNSIGNED NOT NULL,
  open_worker_id BIGINT UNSIGNED GENERATED ALWAYS AS (IF(ended_at IS NULL, worker_id, NULL)) VIRTUAL,
  UNIQUE KEY uq_worker_faults_open_worker (open_worker_id),
  KEY idx_worker_faults_worker_started (worker_id, started_at),
  CONSTRAINT fk_worker_faults_worker FOREIGN KEY (worker_id) REFERENCES workers (id),
  CONSTRAINT chk_worker_faults_ended CHECK (ended_at IS NULL OR ended_at >= started_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
