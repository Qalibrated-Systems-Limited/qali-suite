-- ============================================================================
-- 0033 — Which companies a user may operate in.
--
-- Authorisation is a SET; operating context is exactly ONE of it. RLS stays on
-- the active company: widening it to `company_id = ANY(allowed)` would make an
-- ordinary `SELECT * FROM invoices` return three companies' ledgers in one
-- list, which is not a broader view of the books but a meaningless one.
--
--     allowed  →  which companies may I switch into?   (this table)
--     active   →  which company is this request on?    (app.company_id)
--
-- KEYED ON THE USER, NOT THE COMPANY. "Which companies may I enter" is asked
-- BEFORE a company is chosen, so a company_id policy could never answer it.
-- 0024 already set the precedent: `companies` keys its policy on its own `id`
-- because that is its natural boundary. This one's boundary is the user, so it
-- keys on app.user_id — a second scope set alongside app.company_id.
--
-- user_id is text for the same reason the 47 actor columns are (0031): there is
-- no users table to reference. It becomes a foreign key when there is one.
--
-- role is null for every grant derived from the previous single-company model,
-- meaning "use the user's global role". Per-company roles are what NetSuite,
-- SAP, Dynamics and Xero all do and where this ends up; the column lands now
-- so that move is not a migration.
-- ============================================================================

CREATE TABLE "user_company_access" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "role" text,
  "status" text NOT NULL DEFAULT 'active',
  "granted_via" text NOT NULL DEFAULT 'manual',
  "granted_by_id" text,
  "granted_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_company_access_status_valid"
    CHECK ("status" IN ('active', 'suspended')),
  CONSTRAINT "user_company_access_granted_via_valid"
    CHECK ("granted_via" IN ('primary', 'superadmin', 'invite', 'manual'))
);--> statement-breakpoint

-- One grant per user per company: a second row makes "what is my role here"
-- ambiguous, which is the question the table exists to answer.
CREATE UNIQUE INDEX "user_company_access_user_company_uq"
  ON "user_company_access" ("user_id", "company_id");--> statement-breakpoint
CREATE INDEX "user_company_access_company_idx"
  ON "user_company_access" ("company_id");--> statement-breakpoint

ALTER TABLE "user_company_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_company_access" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- A user reads and writes only their own grants. Unset app.user_id returns
-- zero rows rather than every row — fails closed, like every other policy here.
CREATE POLICY "own_grants" ON "user_company_access"
  USING ("user_id" = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), ''));
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "user_company_access" TO app_user;
