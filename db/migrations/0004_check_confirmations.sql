-- A confirmation check points at the scheduled check it confirms (D-005, D-027).
-- UNIQUE: one confirmation per check, even when two workers race; MySQL allows
-- many NULLs, so scheduled checks are not affected. CASCADE: removing raw checks
-- after 7 days (D-011) takes their confirmations with them.

ALTER TABLE checks
  ADD COLUMN confirms_check_id BIGINT UNSIGNED NULL AFTER kind,
  ADD UNIQUE KEY uq_checks_confirms (confirms_check_id),
  ADD CONSTRAINT fk_checks_confirms FOREIGN KEY (confirms_check_id) REFERENCES checks (id) ON DELETE CASCADE;
