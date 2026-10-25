-- Run only when upgrading the earlier schema whose Users table had no login fields.
ALTER TABLE Users
  ADD COLUMN email VARCHAR(190) NULL,
  ADD COLUMN password_hash VARCHAR(255) NULL,
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE Users SET email = CONCAT('legacy-user-', id, '@local.invalid') WHERE email IS NULL;

ALTER TABLE Users
  MODIFY COLUMN email VARCHAR(190) NOT NULL,
  MODIFY COLUMN password_hash VARCHAR(255) NOT NULL,
  ADD UNIQUE KEY uq_users_email (email);

-- Legacy users receive placeholder email addresses and no usable password.
-- Create a fresh administrator account with `npm run create-admin -- ...`.
