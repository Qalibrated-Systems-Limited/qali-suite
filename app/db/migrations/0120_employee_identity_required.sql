-- ============================================================================
-- AN EMPLOYEE HAS TO BE IDENTIFIABLE AND TAXABLE — 0120
--
-- `national_id` and `kra_pin` were both nullable text with no check of any
-- kind, and the form asked for neither. So an employee could be created, put
-- on a payroll run and paid without either one — and neither is optional in
-- the country this payroll files in:
--
--   KRA PIN       PAYE is deducted and remitted against it. Without one the
--                 deduction has nowhere to go, the P9 has a blank where the
--                 employee's tax identity belongs, and the iTax return cannot
--                 be filed for that person at all.
--
--   National ID   the identity NSSF and SHA are registered against, and what
--                 a bank matches before it will pay a salary into an account.
--
-- Both were being collected on paper and typed in later, which is exactly the
-- arrangement that produces a payroll run in month three with four people
-- nobody can file for.
--
-- A PASSPORT STANDS IN FOR THE ID, and only for that. A non-citizen employee
-- has no Kenyan national ID and is identified by passport plus a work permit;
-- requiring `national_id` outright would make the system unable to employ
-- them, which is a worse bug than the one being fixed. It does NOT stand in
-- for the KRA PIN: a foreign national on a Kenyan payroll is registered for
-- PAYE like anybody else.
--
-- PRESENCE IS THE DATABASE'S JOB; SHAPE IS THE APPLICATION'S. The check below
-- asks only that the fields are there and not blank. Whether a PIN looks like
-- A012345678Z is enforced in `hr-employee-actions.ts`, where a mistyped one
-- can be reported against the field that holds it — and where a bulk import of
-- historical records can still be made to land, rather than being refused by a
-- constraint with no way to explain itself.
--
-- EXISTING ROWS ARE CHECKED. This is a young table on a deployment that starts
-- fresh, and every row present already carries both. Were that not true the
-- right move would be NOT VALID plus a backfill, because a constraint that
-- cannot be added is a constraint nobody adds.
-- ============================================================================

-- Blank-or-absent, not just absent. `''` passes a NOT NULL and is the form of
-- "missing" an HTML form actually produces.
ALTER TABLE "employees"
  DROP CONSTRAINT IF EXISTS "employees_kra_pin_present";--> statement-breakpoint

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_kra_pin_present"
  CHECK ("kra_pin" IS NOT NULL AND btrim("kra_pin") <> '');--> statement-breakpoint

ALTER TABLE "employees"
  DROP CONSTRAINT IF EXISTS "employees_identity_document_present";--> statement-breakpoint

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_identity_document_present"
  CHECK (
    ("national_id"      IS NOT NULL AND btrim("national_id")      <> '')
    OR
    ("passport_number"  IS NOT NULL AND btrim("passport_number")  <> '')
  );--> statement-breakpoint

-- One employee, one PIN, within a company. Two people sharing a KRA PIN means
-- one of them is typed wrong, and the P9 it produces is wrong for both.
-- Partial on the non-blank values so the index does not collide on rows the
-- checks above already govern.
CREATE UNIQUE INDEX IF NOT EXISTS "employees_company_kra_pin_key"
  ON "employees" ("company_id", upper(btrim("kra_pin")))
  WHERE "kra_pin" IS NOT NULL AND btrim("kra_pin") <> '';--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "employees_company_national_id_key"
  ON "employees" ("company_id", btrim("national_id"))
  WHERE "national_id" IS NOT NULL AND btrim("national_id") <> '';--> statement-breakpoint
