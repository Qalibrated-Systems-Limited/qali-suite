-- ─────────────────────────────────────────────────────────────────────────────
-- 0093 — Milestones: a stage of the works, with a value and a date.
--
-- Step 2 of `docs/PROJECTS-EXECUTION-LAYER.md` §4, and the last of that
-- document's tables to be built.
--
-- ── What "milestone" meant here until now: nothing ─────────────────────────
--
-- Three references to the word and every one a placeholder.
--
--   * `/dashboard/projects/milestones` was a "Milestone Tracker" that was a
--     second view of `project_tasks` and showed no milestones, because there
--     were none. It is a redirect now.
--   * `billing_model = 'milestone'` is declared and NOTHING ACTS ON IT — the
--     enum comment says so. A milestone-billed project bills exactly as
--     `fixed`.
--   * `valuation_source = 'milestone'` on a certificate can record that its
--     figure came from a stage, and nothing has ever set it: the form writes
--     `measured` or `manual`.
--
-- ── Why it matters most on an INSTALLATION contract ────────────────────────
--
-- A road contract values by REMEASUREMENT against a priced bill — 0080 built
-- that, and a certificate takes its figure from the measured total. An
-- installation contract has no bill to remeasure: what it has is stages, each
-- worth an agreed part of the sum. Design approved, equipment delivered,
-- commissioned, accepted. That is the whole valuation method, and without this
-- table the only way to certify one is to type the figure and mark it
-- `manual`.
--
-- 0082 already knows the difference — `project_types` distinguishes
-- construction from installation and hides the sections that do not apply. This
-- is the other half of that distinction.
--
-- ── Decision 1 — THE SUM MAY NOT EXCEED THE CONTRACT, AND MAY FALL SHORT ───
--
-- Milestones that add up to more than the contract sum are wrong in every
-- reading: the stages would certify more than the job is worth. That is a hard
-- refusal.
--
-- Falling short is NOT an error, and enforcing the total both ways would make
-- the table unusable — the first milestone entered would fail because one
-- stage is never the whole contract. So under-allocation is a legitimate
-- work-in-progress state, and the register shows what is still unallocated
-- rather than the database refusing it. Same shape as a budget whose lines do
-- not yet reach the budget amount.
--
-- ── Decision 2 — ACHIEVING IS A DATE, NOT A FLAG ──────────────────────────
--
-- `achieved_on` is what the certificate reads: the cumulative value of stages
-- achieved ON OR BEFORE the valuation date. A boolean cannot answer that, and
-- a certificate for March must not pick up a stage signed off in May. The
-- biconditional against `status` is the same one the budget approval, the
-- certificate and the variation all carry.
--
-- ── Decision 3 — IT OFFERS A FIGURE. IT DOES NOT CERTIFY ONE ──────────────
--
-- Achieving a milestone posts nothing and raises nothing. It makes a number
-- available to the next certificate, offered with a button, exactly as the
-- measured bill is offered — because a stage being achieved and the employer
-- being asked to pay for it are two decisions, and 0081 kept them apart
-- everywhere else.
--
-- ── Decision 4 — AND IT CARRIES THE RETENTION RELEASE ──────────────────────
--
-- This is the reason the plan called milestones a blocker rather than a
-- feature: "retention release schedule — still needs milestones, which are
-- still not a table". Releasing retention today means somebody typing a
-- cumulative figure and remembering when it fell due.
--
-- `retention_release_percent` is what proportion of the retention HELD falls
-- due when this stage is achieved — half at practical completion, the balance
-- at the end of the defects period, which is the ordinary form. They may not
-- add up to more than 100%.
--
-- It still only OFFERS the figure to the certificate. Decision 3 applies to
-- the release as much as to the valuation: 0081 posts a release when a
-- certificate says so, and that stays the only place it happens.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "project_milestone_status" AS ENUM ('pending', 'achieved', 'cancelled');--> statement-breakpoint

CREATE TABLE "project_milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "contract_id" uuid NOT NULL,

  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "sequence" integer DEFAULT 0 NOT NULL,

  -- What this stage is worth. Not a percentage: a percentage of a contract sum
  -- that moves with every variation is a value that changes under the stage
  -- after it was agreed.
  "value" numeric(19, 4) DEFAULT '0' NOT NULL,

  "due_date" date,
  "achieved_on" date,

  -- Decision 4. NULL and 0 mean the same thing here and both are ordinary:
  -- most stages release no retention.
  "retention_release_percent" numeric(5, 2),

  "status" "project_milestone_status" DEFAULT 'pending' NOT NULL,
  "notes" text DEFAULT '' NOT NULL,

  "achieved_by_id" text,
  "achieved_by_name" text,
  "created_by_id" text,
  "created_by_name" text DEFAULT 'System' NOT NULL,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "project_milestones_name_not_blank"
    CHECK (length(btrim("name")) > 0),
  CONSTRAINT "project_milestones_value_non_negative"
    CHECK ("value" >= 0),
  CONSTRAINT "project_milestones_release_in_range"
    CHECK ("retention_release_percent" IS NULL
           OR ("retention_release_percent" >= 0 AND "retention_release_percent" <= 100)),

  -- Decision 2: achieved means a date, and a date means achieved.
  CONSTRAINT "project_milestones_achievement_pair"
    CHECK (("status" = 'achieved') = ("achieved_on" IS NOT NULL)),
  CONSTRAINT "project_milestones_achiever_named"
    CHECK ("achieved_on" IS NULL OR "achieved_by_name" IS NOT NULL)
);--> statement-breakpoint

ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_contract_id_project_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."project_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_achieved_by_id_users_id_fk" FOREIGN KEY ("achieved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "project_milestones_schedule_idx" ON "project_milestones" USING btree ("project_id","sequence");--> statement-breakpoint
-- The certificate reads by contract and date: what was achieved on or before
-- the valuation date.
CREATE INDEX "project_milestones_achieved_idx" ON "project_milestones" USING btree ("contract_id","achieved_on") WHERE "achieved_on" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Decision 1 and the release cap, both cross-row and so both triggers.
--
-- A CANCELLED milestone counts for neither: it is a stage that was dropped,
-- and its value is available to be allocated again.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_milestones_within_the_contract() RETURNS trigger AS $$
DECLARE
  v_total    numeric;
  v_sum      numeric;
  v_release  numeric;
BEGIN
  SELECT COALESCE(SUM(m.value), 0),
         COALESCE(SUM(COALESCE(m.retention_release_percent, 0)), 0)
    INTO v_sum, v_release
    FROM project_milestones m
   WHERE m.contract_id = NEW.contract_id
     AND m.status <> 'cancelled';

  SELECT c.contract_sum INTO v_total
    FROM project_contracts c WHERE c.id = NEW.contract_id;

  -- Falling short is work in progress; going over certifies more than the job
  -- is worth.
  IF v_total IS NOT NULL AND v_total > 0 AND v_sum > v_total THEN
    RAISE EXCEPTION
      'These stages come to % against a contract sum of %. A milestone schedule cannot exceed the contract.',
      to_char(v_sum, 'FM999,999,999,990.00'), to_char(v_total, 'FM999,999,999,990.00')
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_release > 100 THEN
    RAISE EXCEPTION
      'These stages release % of the retention between them, which is more than is held.',
      to_char(v_release, 'FM990.00') || '%%'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_milestones_within_the_contract"
AFTER INSERT OR UPDATE OF value, retention_release_percent, status, contract_id
ON "project_milestones"
FOR EACH ROW EXECUTE FUNCTION project_milestones_within_the_contract();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A milestone belongs to its own project's contract — not expressible as a
-- plain foreign key, and the same guard `project_variations` carries.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_milestones_belong_together() RETURNS trigger AS $$
DECLARE
  v_project uuid;
BEGIN
  SELECT c.project_id INTO v_project
    FROM project_contracts c WHERE c.id = NEW.contract_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That contract does not exist.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_project <> NEW.project_id THEN
    RAISE EXCEPTION 'That contract belongs to a different project.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_milestones_belong_together"
BEFORE INSERT OR UPDATE OF contract_id, project_id
ON "project_milestones"
FOR EACH ROW EXECUTE FUNCTION project_milestones_belong_together();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "project_milestones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_milestones" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "project_milestones"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_milestones" TO app_user;
