-- The status version (D-020): workers add 1 on every monitor state change, and the
-- web process reads it every 30 seconds (Q-007) to drop its cached status page.
-- One row only.

CREATE TABLE status_version (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  version BIGINT UNSIGNED NOT NULL,
  CONSTRAINT chk_status_version_single_row CHECK (id = 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

INSERT INTO status_version (id, version) VALUES (1, 0);
