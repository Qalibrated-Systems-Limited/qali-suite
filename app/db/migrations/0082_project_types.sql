-- ─────────────────────────────────────────────────────────────────────────────
-- 0078 — What KIND of work this is, and which sections follow from it.
--
-- Step 1 of `docs/PROJECTS-QALITRACK-PLAN.md` §8, and it should have been
-- first: "cheap now, expensive later, because every section gate hangs off it".
-- It is arriving after 0076 and 0077 instead, which is why 0077's certificate
-- section is the first thing gated by it.
--
-- WHY. `billing_model` says HOW a project is paid. It does not say what kind of
-- work it is, and that is what decides which sections make sense. A supply-only
-- job has no site diary and no interim payment certificate, and no standard says
-- it should — §7. Without this, every project shows every section, and the
-- module reproduces at small scale the thing that makes SAP hard to pick up:
-- menu entries for things this company does not do.
--
-- ── Four decisions ──────────────────────────────────────────────────────────
--
-- 1. A LOOKUP TABLE, NOT A `pgEnum` — §9.1.
--    §7 specified an enum while ALSO recording, as an open question, that we
--    cannot enumerate the business of tenants we have not met. Those two do not
--    survive together: an enum is a migration to change, and a multi-tenant
--    product should not need a deploy to add `logistics`. A seeded table costs
--    the same.
--
--    This does NOT apply to the enums that encode a MECHANISM this system owns
--    — `project_boq_status`, `project_task_status`, `project_certificate_status`.
--    Their values are a state machine, and adding one changes how the software
--    works, which is exactly when a migration is right. The distinction is
--    whether the TENANT or the PRODUCT owns the vocabulary.
--
-- 2. BUILT-IN ROWS ARE COMPANY-LESS, AND READ-ONLY TO EVERY TENANT.
--    `company_id IS NULL` is a built-in, visible to all. A tenant may add its
--    own and may not touch the built-ins — the RLS policy READS
--    `company_id IS NULL OR company_id = current` and WRITES only
--    `company_id = current`, so the read/write asymmetry is the database's
--    rather than something every query has to remember.
--
-- 3. THE SECTIONS ARE COLUMNS, BECAUSE THE PRODUCT OWNS THEM.
--    Decision 1 says the tenant owns the type vocabulary. It does not own the
--    section list: a section exists because a page was built for it, so adding
--    one is a code change and a migration beside it is honest. Booleans are
--    greppable and a missing one is a compile error rather than a silently
--    absent JSON key.
--
-- 4. A PROJECT WITHOUT A TYPE SHOWS EVERYTHING.
--    `type_id` is nullable and every project has NULL after this migration, so
--    nothing disappears from anybody's screen on deploy. The type is a
--    narrowing a tenant opts into, not a wall that arrives with an upgrade.
--
-- WHAT IS DELIBERATELY NOT HERE: a per-project OVERRIDE of the type's sections.
-- §7 is clear the type "chooses defaults; it does not lock anything", and that
-- is right — but the column would have no writer until a screen offers it, and
-- a column with no writer is the cached `financials` that 0070 spent a
-- migration undoing. It arrives with the checkbox that sets it. The resolver is
-- one function (`resolveProjectSections`) precisely so that is one change.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "project_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	-- NULL = built-in, readable by every tenant and writable by none.
	"company_id" uuid,

	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,

	-- Decision 3. The nav is seven entries; Dashboard and the budget are on for
	-- everything, so these are the six that vary.
	"shows_boq" boolean DEFAULT true NOT NULL,
	"shows_programme" boolean DEFAULT true NOT NULL,
	"shows_instructions" boolean DEFAULT true NOT NULL,
	"shows_diary" boolean DEFAULT true NOT NULL,
	"shows_certificates" boolean DEFAULT true NOT NULL,
	"shows_cash_requisitions" boolean DEFAULT true NOT NULL,

	-- Ordering on the picker, so the common cases are not alphabetical
	-- accidents.
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,

	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "project_types_code_not_blank" CHECK (length(btrim("code")) > 0),
	CONSTRAINT "project_types_name_not_blank" CHECK (length(btrim("name")) > 0)
);
--> statement-breakpoint

ALTER TABLE "project_types" ADD CONSTRAINT "project_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Unique within a tenant, and unique among the built-ins. Two partial indexes
-- rather than one on (company_id, code), because NULL is not equal to NULL and
-- a plain unique index would let a second built-in `construction` exist.
CREATE UNIQUE INDEX "project_types_company_code_uq" ON "project_types" USING btree ("company_id","code") WHERE "company_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_types_builtin_code_uq" ON "project_types" USING btree ("code") WHERE "company_id" IS NULL;--> statement-breakpoint
CREATE INDEX "project_types_lookup_idx" ON "project_types" USING btree ("company_id","is_active","sort_order");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The six built-ins, with the section matrix from §7.
--
-- These are DEFAULTS OFFERED, not rules. A tenant that runs a site diary on its
-- supply jobs adds its own type; nothing here decides on anybody's behalf what
-- their contract requires. Same caution as "observed practice is not the
-- specification": the matrix says which sections a KIND of work usually needs,
-- and it is silent on the terms of any contract.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "project_types"
  (company_id, code, name, description,
   shows_boq, shows_programme, shows_instructions, shows_diary,
   shows_certificates, shows_cash_requisitions, sort_order)
VALUES
  (NULL, 'construction', 'Construction',
   'Civil or building works, measured against a bill and certified.',
   true,  true,  true,  true,  true,  true,  10),
  (NULL, 'installation', 'Installation',
   'Plant, weighbridge or electrical installation, paid on delivery and acceptance stages.',
   true,  true,  true,  true,  true,  true,  20),
  (NULL, 'maintenance', 'Maintenance',
   'A recurring service agreement.',
   false, false, false, false, false, true,  30),
  (NULL, 'supply', 'Supply',
   'Goods only, invoiced on delivery.',
   false, true,  false, false, false, false, 40),
  (NULL, 'consultancy', 'Consultancy',
   'Design or advisory work, usually time and material.',
   false, true,  false, false, false, true,  50),
  (NULL, 'internal', 'Internal',
   'Own capital works or R&D. No client and nothing to certify.',
   false, true,  false, false, false, true,  60);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The project's type. Decision 4: nullable, and NULL shows everything.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "projects" ADD COLUMN "type_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_type_id_project_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."project_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_type_idx" ON "projects" USING btree ("company_id","type_id") WHERE "type_id" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security — decision 2, and the read/write asymmetry is here rather
-- than in every query that touches the table.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "project_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "project_types"
  USING (
    company_id IS NULL
    OR company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
  )
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_types" TO app_user;
