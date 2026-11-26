-- Alerts (D-007, D-013, D-044). Times come from the Clock (PATTERN-004).
-- One row per alert to one contact: (incident, kind, contact) is unique, so a re-run or a second
-- process sends nothing twice. sending_at claims a send, sent_at is set once it went out,
-- next_try_at holds a retry back (Telegram's retry_after), last_error keeps no address.

CREATE TABLE incident_alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  incident_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('opened', 'escalated', 'resolved') NOT NULL,
  contact_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  sending_at DATETIME(3) NULL,
  sent_at DATETIME(3) NULL,
  next_try_at DATETIME(3) NULL,
  last_error VARCHAR(1024) NULL,
  UNIQUE KEY uq_incident_alerts (incident_id, kind, contact_id),
  KEY idx_incident_alerts_contact (contact_id),
  CONSTRAINT fk_incident_alerts_incident FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE,
  CONSTRAINT fk_incident_alerts_contact FOREIGN KEY (contact_id) REFERENCES alert_contacts (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Each opened or escalated alert carries its own acknowledge link; only the SHA-256 of the
-- link's random token is stored (as for sessions, D-040).
CREATE TABLE incident_ack_tokens (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  incident_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_incident_ack_tokens_incident (incident_id),
  CONSTRAINT fk_incident_ack_tokens_incident FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Who acknowledged an incident and when; NULL user: through an alert's link.
ALTER TABLE incidents
  ADD COLUMN acknowledged_at DATETIME(3) NULL,
  ADD COLUMN acknowledged_by_user_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT fk_incidents_acknowledged_by FOREIGN KEY (acknowledged_by_user_id) REFERENCES users (id) ON DELETE SET NULL;
