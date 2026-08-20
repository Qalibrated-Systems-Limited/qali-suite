-- ============================================================================
-- 0043 — Credentials move to Postgres.
--
-- 0036 left the password hash out on purpose: "moving credentials is a
-- deliberate, security-sensitive cutover of its own, and NextAuth still reads
-- them through mongoose; a column added now would be one nothing enforces,
-- which reads like a control and is not one."
--
-- This is that cutover. The column is added because auth is about to read it,
-- not ahead of it.
--
-- WHAT MOVES, AND WHAT DOES NOT CHANGE. The hash is bcrypt, produced by
-- bcryptjs with cost 10, and it is copied verbatim. A bcrypt hash carries its
-- own algorithm, cost and salt in the string, so comparing against it in
-- Postgres is the same operation as comparing against it in Mongo — nobody's
-- password changes and nobody is asked to reset one. Rehashing on next login
-- would be a separate decision; it is not needed to switch stores.
--
-- NULL IS A REAL STATE. A Google user has no password and never did; the
-- Mongo model says so ("Not required — Google OAuth users don't have a
-- password"). So the column is nullable, and the credentials provider must
-- refuse a null rather than treat it as an empty password.
-- ============================================================================

ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint

-- Reset tokens, so "forgot password" works against this table too. The token
-- is already a hash of the emailed value in the source; it is carried as-is.
ALTER TABLE "users" ADD COLUMN "reset_password_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_password_expire" timestamp with time zone;--> statement-breakpoint

-- A token is only usable while it has an expiry, and an expiry is meaningless
-- without a token. The pair moves together or not at all.
ALTER TABLE "users"
  ADD CONSTRAINT "users_reset_token_pairs_with_expiry" CHECK (
    ("reset_password_token" IS NULL AND "reset_password_expire" IS NULL)
    OR ("reset_password_token" IS NOT NULL AND "reset_password_expire" IS NOT NULL)
  );--> statement-breakpoint

-- Looked up by token on the reset path, which is otherwise a full scan of every
-- login in the platform. Partial, because almost every row is null.
CREATE INDEX "users_reset_token_idx" ON "users" ("reset_password_token")
  WHERE "reset_password_token" IS NOT NULL;
-- (Email uniqueness is already enforced — 0036 created users_email_uq.)
