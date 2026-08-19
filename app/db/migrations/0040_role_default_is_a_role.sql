-- ============================================================================
-- 0040 — The DEFAULT has to be one of the roles too.
--
-- 0036 set `users.role DEFAULT 'User'`, mirroring the Mongo model. 0039 retired
-- 'User', so the column was left with a default its own CHECK rejects: any
-- insert that omitted a role would fail on a value the schema itself supplied.
--
-- Caught by reading the column back after the migration rather than trusting
-- that it had applied — which also caught the real lesson here. This started
-- as an edit APPENDED to 0039, and the migrator silently did nothing: it
-- tracks which migrations have run, so changing the text of one that already
-- ran is a change that never happens. An applied migration is immutable; the
-- fix goes in a new file.
--
-- Employee is what 'User' becomes, and what app/models/user.js always said to
-- prefer for new users.
-- ============================================================================

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'Employee';
