-- Monthly uptime reports (D-019, D-041): one row per organization and UTC month, so a re-run of
-- the job stores nothing twice. Times come from the Clock (PATTERN-004).
-- sending_at marks a claim to email the report; emailed_at is set once the mail server took it.

CREATE TABLE monthly_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  -- `YYYY-MM`.
  month CHAR(7) NOT NULL,
  pdf MEDIUMBLOB NOT NULL,
  generated_at DATETIME(3) NOT NULL,
  sending_at DATETIME(3) NULL,
  emailed_at DATETIME(3) NULL,
  last_error VARCHAR(1024) NULL,
  UNIQUE KEY uq_monthly_reports_org_month (organization_id, month),
  CONSTRAINT fk_monthly_reports_organization FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT chk_monthly_reports_month CHECK (month REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$')
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
