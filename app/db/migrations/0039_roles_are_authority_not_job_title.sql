-- ============================================================================
-- 0039 — A role says what you may do, not what you do all day.
--
-- 0038 constrained the role columns to the sixteen values in
-- app/models/user.js. Writing that list down made the problem visible: four of
-- the sixteen carried no description, and two of those were job titles rather
-- than levels of authority.
--
-- SAP, NetSuite, Dynamics, Odoo, Xero and QuickBooks all model a role as a
-- bundle of PERMISSIONS. Dynamics is the clearest about it — Roles are made of
-- Duties, Duties of Privileges — and none of them ship a role called
-- "Technician", because that is a job, and a job belongs on the employee
-- record next to the salary.
--
-- Three go:
--
--   Technician → Employee   A job title. The concept survives where it is
--                           actually used: stock_requests.technician_id is a
--                           foreign key to `parties`, so the person on a repair
--                           job is still named — by their party row, not by a
--                           permission level.
--
--   CEO        → Viewer     The model's own comment says "read access across
--                           the business; no operational writes". That is
--                           Viewer. A separate value that means the same thing
--                           is a second spelling of one fact, and the two drift
--                           the moment somebody adds a gate for one and not the
--                           other.
--
--   User       → Employee   Marked "Legacy generic — prefer Employee for new
--                           users" in the model, and set as the DEFAULT, so
--                           every user created without an explicit role landed
--                           on the role the model tells you not to use.
--
-- And HR becomes HR Manager, so it reads as authority rather than as the
-- department someone sits in. `department` already records the latter.
--
-- Data first, constraint second. A CHECK added before the rows are moved
-- fails on the first existing row.
-- ============================================================================

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_valid";--> statement-breakpoint
ALTER TABLE "user_company_access"
  DROP CONSTRAINT IF EXISTS "user_company_access_role_valid";--> statement-breakpoint

UPDATE "users" SET "role" = 'Employee' WHERE "role" IN ('Technician', 'User');--> statement-breakpoint
UPDATE "users" SET "role" = 'Viewer'   WHERE "role" = 'CEO';--> statement-breakpoint
UPDATE "users" SET "role" = 'HR Manager' WHERE "role" = 'HR';--> statement-breakpoint

UPDATE "user_company_access" SET "role" = 'Employee'
 WHERE "role" IN ('Technician', 'User');--> statement-breakpoint
UPDATE "user_company_access" SET "role" = 'Viewer' WHERE "role" = 'CEO';--> statement-breakpoint
UPDATE "user_company_access" SET "role" = 'HR Manager' WHERE "role" = 'HR';--> statement-breakpoint

ALTER TABLE "users"
  ADD CONSTRAINT "users_role_valid" CHECK ("role" IN (
    'SuperAdmin',
    'Admin',
    'CFO',
    'Finance Manager',
    'Accountant',
    'Sales Manager',
    'Procurement Officer',
    'Manager',
    'Store Manager',
    'Storekeeper',
    'HR Manager',
    'Employee',
    'Viewer'
  ));--> statement-breakpoint

ALTER TABLE "user_company_access"
  ADD CONSTRAINT "user_company_access_role_valid"
  CHECK ("role" IS NULL OR "role" IN (
    'SuperAdmin',
    'Admin',
    'CFO',
    'Finance Manager',
    'Accountant',
    'Sales Manager',
    'Procurement Officer',
    'Manager',
    'Store Manager',
    'Storekeeper',
    'HR Manager',
    'Employee',
    'Viewer'
  ));
