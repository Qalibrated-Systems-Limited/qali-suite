-- ============================================================================
-- 0038 — A role has to be one of the roles.
--
-- 0036 gave `users.role` a default and no constraint, while `status` and
-- `auth_provider` beside it both have CHECKs. That is not a stylistic
-- inconsistency, it is a hole: `roleAllowed` (lib/permissions.js) answers false
-- for anything not in the allow-list, so a role saved as "Acountant" or
-- "manager" is refused by every gate in the product. The person can sign in
-- and can do nothing, and there is no error anywhere that says why.
--
-- A CHECK rather than a Postgres ENUM type, to match the twelve other
-- constrained text columns in this schema (companies.status, companies.plan,
-- user_company_access.status, and so on). The enum types that do exist —
-- account_type, party_type, journal_status — are shapes of the LEDGER, fixed
-- by accounting rather than by us. Roles are a product decision and get added
-- as the product grows; a CHECK is one migration to change, and it does not
-- take a lock on every table that references the type.
--
-- The list mirrors `userRoles` in app/models/user.js. It is duplicated, which
-- is the price of the constraint living where the data is — and a role added
-- to one and not the other fails loudly at the INSERT rather than quietly at
-- the permission check, which is the right way round.
--
-- user_company_access.role gets the same treatment. It is NULL for every grant
-- carried over from the single-company model, meaning "use the user's global
-- role", so the constraint has to allow null — and it does, because a CHECK
-- that evaluates to NULL passes.
-- ============================================================================

ALTER TABLE "users"
  ADD CONSTRAINT "users_role_valid" CHECK ("role" IN (
    'SuperAdmin',
    'Admin',
    'CEO',
    'CFO',
    'Finance Manager',
    'Accountant',
    'Sales Manager',
    'Procurement Officer',
    'Manager',
    'Store Manager',
    'Storekeeper',
    'HR',
    'Technician',
    'Employee',
    'User',
    'Viewer'
  ));--> statement-breakpoint

ALTER TABLE "user_company_access"
  ADD CONSTRAINT "user_company_access_role_valid" CHECK ("role" IS NULL OR "role" IN (
    'SuperAdmin',
    'Admin',
    'CEO',
    'CFO',
    'Finance Manager',
    'Accountant',
    'Sales Manager',
    'Procurement Officer',
    'Manager',
    'Store Manager',
    'Storekeeper',
    'HR',
    'Technician',
    'Employee',
    'User',
    'Viewer'
  ));
