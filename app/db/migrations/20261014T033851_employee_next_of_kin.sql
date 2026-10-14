-- ============================================================================
-- EMPLOYEE NEXT OF KIN
--
-- The register only had an EMERGENCY CONTACT — who to call when something
-- happens at work. Next of kin is a different person for a different purpose:
-- who receives the final dues, the gratuity and any benefit claim if the
-- employee dies. HR asks for both on every Kenyan registration form, and they
-- are often not the same person.
--
-- The ID number is there because a benefit claim is paid against the
-- beneficiary's identity, not their phone number.
--
-- SAFE TO APPLY because: every column is nullable text and nothing writes them
-- yet. No constraint, no backfill, no lock beyond the instant ADD COLUMN takes.
-- ============================================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS next_of_kin_name text,
  ADD COLUMN IF NOT EXISTS next_of_kin_relationship text,
  ADD COLUMN IF NOT EXISTS next_of_kin_phone text,
  ADD COLUMN IF NOT EXISTS next_of_kin_id_number text;
