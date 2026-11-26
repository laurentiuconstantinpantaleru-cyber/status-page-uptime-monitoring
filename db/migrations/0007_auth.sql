-- Sign-in (D-034, D-035). Times come from the application's Clock (PATTERN-004).

-- bcrypt hash of the password; NULL until one is set, and such a user cannot sign in.
ALTER TABLE users ADD COLUMN password_hash CHAR(60) NULL AFTER display_name;

-- One row per signed-in browser. `id` is the SHA-256 (hex) of the cookie's token, never the token.
CREATE TABLE sessions (
  id CHAR(64) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
