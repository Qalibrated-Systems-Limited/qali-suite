-- 0122 — the project "data sheet" fields, from the QSL Project Control template.
--
-- "Start a project" is a data sheet grouped into Identification, Commercial,
-- Programme, Cost of being paid and Control. Several fields already exist on
-- projects (name, client, contract_value, dates, project manager); these are
-- the ones that did not. All nullable — an existing project simply has them
-- empty until edited.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "contract_number"     text,
  ADD COLUMN IF NOT EXISTS "county"              text,
  ADD COLUMN IF NOT EXISTS "scope"               text,
  ADD COLUMN IF NOT EXISTS "contract_sum_source" text,
  ADD COLUMN IF NOT EXISTS "vat_rate"            numeric(9,4),
  ADD COLUMN IF NOT EXISTS "retention_percent"   numeric(9,4),
  ADD COLUMN IF NOT EXISTS "defects_months"      integer,
  ADD COLUMN IF NOT EXISTS "advance_amount"      numeric(19,4),
  ADD COLUMN IF NOT EXISTS "bond_cost"           numeric(19,4),
  ADD COLUMN IF NOT EXISTS "insurance_cost"      numeric(19,4),
  ADD COLUMN IF NOT EXISTS "finance_cost"        numeric(19,4),
  ADD COLUMN IF NOT EXISTS "statutory_cost"      numeric(19,4),
  ADD COLUMN IF NOT EXISTS "contract_months"     integer,
  ADD COLUMN IF NOT EXISTS "bank_account"        text,
  ADD COLUMN IF NOT EXISTS "site_agent_name"     text,
  ADD COLUMN IF NOT EXISTS "qs_name"             text,
  ADD COLUMN IF NOT EXISTS "funds_ringfenced"    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "boq_on_file"         boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- The budget line's cost category (Materials, Labour, Plant hire, …) — the
-- template groups every budget line by one for the cost report.
ALTER TABLE "project_budget_lines"
  ADD COLUMN IF NOT EXISTS "category" text;
