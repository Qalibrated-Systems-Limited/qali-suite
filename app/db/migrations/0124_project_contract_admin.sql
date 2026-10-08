-- 0124 — contract administration fields, from the QSL Project Control template.
--
-- The FIDIC conditions a notice/claim clock and a payment run against. Retention
-- %, defects months and the advance were added with the data sheet (0122); these
-- are the rest. All nullable — taken from the particular conditions of contract,
-- never a template default.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "form_of_contract"            text,
  ADD COLUMN IF NOT EXISTS "engineer_name"               text,
  ADD COLUMN IF NOT EXISTS "notice_days"                 integer,
  ADD COLUMN IF NOT EXISTS "detail_claim_days"           integer,
  ADD COLUMN IF NOT EXISTS "employer_pays_days"          integer,
  ADD COLUMN IF NOT EXISTS "late_payment_interest_pct"   numeric(9,4),
  ADD COLUMN IF NOT EXISTS "retention_limit"             numeric(19,4),
  ADD COLUMN IF NOT EXISTS "ld_per_day"                  numeric(19,4),
  ADD COLUMN IF NOT EXISTS "damages_cap_pct"             numeric(9,4),
  ADD COLUMN IF NOT EXISTS "variation_cap_pct"           numeric(9,4),
  ADD COLUMN IF NOT EXISTS "perf_security_expires"       date,
  ADD COLUMN IF NOT EXISTS "advance_guarantee_expires"   date;
