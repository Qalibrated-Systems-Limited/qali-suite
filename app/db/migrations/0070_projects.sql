-- ─────────────────────────────────────────────────────────────────────────────
-- 0070 — Projects: the cost dimension five modules have been waiting for.
--
-- Every other module in this port is a faithful port. This one is not quite,
-- and `docs/PROJECTS-QALITRACK-PLAN.md` says why: the MD's prototype is a road
-- contract administration system, which is a different product built on top of
-- a project. That product is `contracts`, and it is not this migration.
--
-- This is the small half, and it is the half that unblocks work: `projects` as
-- the cost centre the ledger already refers to. Claims, invoices, bills,
-- expenses and stock requests each carry a `project_id` that has been TEXT with
-- no foreign key since 0053/0054, because the thing it pointed at was still in
-- Mongo. It is not any more, so those five columns become real references at
-- the bottom of this file and the five modules stop reading Mongo.
--
-- ── Seven decisions ─────────────────────────────────────────────────────────
--
-- 1. THE CACHED FINANCIALS DO NOT SURVIVE.
--    `project.financials.{totalRevenue,totalCosts,totalCommitted}` is three
--    stored numbers maintained by `$inc` from other modules — the same shape as
--    `products.quantityAvailable` and `parties.cachedBalance`, and the same
--    failure: a number that can disagree with the documents it summarises.
--
--    It is already worse than that. NOTHING CALLS THE UPDATER. Grep
--    `updateProjectFinancials`, `recomputeProjectFinancials` and
--    `reconcileAllProjectFinancials` across `app/`, `lib/` and `components/`
--    and the only hits are the definitions and one comment. The `$inc` helper
--    the module was designed around has no callers at all, so every project's
--    cached figures have been whatever they were at creation: zero.
--
--    So there are no columns here for them. `getProjectFinancialSummaryPg`
--    computes revenue, cost and committed from the documents, live, which is
--    what the detail page already did through `computeProjectActuals`.
--
--    And `computeProjectActuals` was itself broken, which nothing could see
--    because the numbers beside it were zeros. It aggregates the MONGO
--    `Invoice`, `Bill`, `StockRequest` and `StockMovement` collections — all
--    four moved to Postgres, and none of them is written to any more. Project
--    revenue, bill cost and stock commitment have read a dead store since
--    those modules ported. The Postgres rewrite fixes it by existing.
--
-- 2. NOTHING IS POSTED TO THE LEDGER BY THIS TABLE, and there is deliberately
--    no project dimension on `journal_lines`.
--
--    The plan note suggests project P&L as a `journal_lines` query, and for
--    REVENUE and COST that would be the better answer. It cannot answer the
--    question the module is actually for. `committed` — approved and not yet
--    paid — is the number a budget is checked against, and an approved stock
--    request has no ledger entry at all: nothing has been received, nothing is
--    owed, and there is correctly not a line anywhere. A ledger-only summary
--    would report a project as having spent nothing right up to the day the
--    goods arrive.
--
--    So the summary reads documents, as it did. Adding `project_id` to
--    `journal_lines` is the right move when IPCs and retention arrive and a
--    project needs a true trial balance; it is a separate migration and it
--    touches every posting path, so it is not smuggled in here.
--
-- 3. THE STATUS MACHINE MOVES INTO THE DATABASE.
--    `projectSchema.methods.canTransitionTo` enforces it, and exactly one
--    caller goes through `transitionTo`. `updateProject` and
--    `updateProjectProgress` write with `findOneAndUpdate`, so any future
--    writer that sets `status` directly bypasses the machine entirely. The
--    trigger below does not care which function you are in.
--
-- 4. ONE APPROVED BUDGET PER PROJECT, AS AN INDEX.
--    `budget.approve()` supersedes the previous approved version with an
--    `updateMany` and then approves this one — read, write, write, with no
--    lock. Two approvals racing leave two approved budgets, and
--    `getProjectBudgetVsActual` takes whichever sorts first. A partial unique
--    index makes the second one impossible.
--
-- 5. THE BUDGET TOTAL IS NOT STORED, AND IS NOT COPIED ONTO THE PROJECT.
--    Mongo stores `budget.totalAmount`, recomputed in a `pre("save")` hook
--    that only fires `if (this.isModified("lines"))`, and then COPIES it to
--    `project.budget.amount` on approve. That is the same number in three
--    places: the lines, the budget row, and the project row.
--
--    Here the lines are the number. `project_budgets` has no total column, and
--    approving a budget writes nothing to `projects`. `budget_amount` on the
--    project stays what it always was on the create form — the advisory figure
--    somebody typed before there were any lines — and the repository reads
--    COALESCE(approved budget's line total, budget_amount). One rule, stated
--    once, and no third copy to go stale.
--
-- 6. A BUDGET HAS ONE LINE PER ACCOUNT.
--    `getProjectBudgetVsActual` builds `actualMap[accountId]` and then reads it
--    once per budget line. Two lines against the same GL account each display
--    the FULL actual for that account, so a budget split "Travel — Mombasa"
--    and "Travel — Kisumu" reports the spend twice and the project looks
--    twice as far over budget as it is. `project_budget_lines_one_per_account`
--    refuses the second line; the split belongs in cost codes.
--
-- 7. COST CODE UNIQUENESS NEEDS TWO INDEXES, NOT ONE.
--    Mongo's `{ companyId, code, projectId }` unique index works there because
--    Mongo treats a missing `projectId` as a value. Postgres does not — NULLs
--    are distinct in a unique index — so the same index here would let a
--    company hold ten company-wide codes all called `LAB`. Two partial
--    indexes, split on whether the code is scoped to a project.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "public"."project_status" AS ENUM('planning', 'active', 'on_hold', 'completed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."project_priority" AS ENUM('low', 'normal', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."project_billing_model" AS ENUM('fixed', 'milestone', 'time_material');--> statement-breakpoint
CREATE TYPE "public"."project_budget_status" AS ENUM('draft', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."project_assignment_status" AS ENUM('active', 'inactive', 'removed');--> statement-breakpoint
CREATE TYPE "public"."project_rate_unit" AS ENUM('hour', 'day', 'month', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."project_party_type" AS ENUM('employee', 'supplier', 'both');--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- projects
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,

	-- PRJ-00001, from next_entry_number (0001). Mongo built
	-- `PRJ-{CODE}-{YYYYMM}-{SEQ}` from a counter keyed by company code and
	-- month; the counter here is already per company, and the unique index is
	-- on (company_id, project_number), so the decoration bought nothing.
	"project_number" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,

	-- The client, and a snapshot of who they were when the project was raised.
	"client_party_id" uuid,
	"client_name" text,
	"client_email" text,

	"project_manager_user_id" text,
	"project_manager_name" text,

	-- Subprojects. `ON DELETE set null` rather than cascade: deleting a parent
	-- must not silently take its children's costs with it.
	"parent_project_id" uuid,

	"billing_model" "project_billing_model",
	"contract_value" numeric(19, 4),

	-- Typed in by hand, and `PROJECTS-QALITRACK-PLAN.md` §4 says why that is
	-- below industry standard: it is how a project reports 90% complete for
	-- four months. It stays typed until there is measured work to derive it
	-- from, which arrives with `contracts`.
	"progress_percent" integer DEFAULT 0 NOT NULL,

	"status" "project_status" DEFAULT 'planning' NOT NULL,
	"priority" "project_priority" DEFAULT 'normal' NOT NULL,

	"start_date" date,
	"end_date" date,
	"actual_end_date" date,

	-- Advisory. The module warns at 90% and never blocks — decision 2 of the
	-- original design, and it survives the port. See decision 5 above for what
	-- this is once an approved budget exists.
	"budget_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"budget_currency" text DEFAULT 'KES' NOT NULL,

	"tags" text[] DEFAULT '{}' NOT NULL,

	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "projects_name_not_blank" CHECK (length(btrim("projects"."name")) > 0),
	CONSTRAINT "projects_progress_in_range" CHECK (
		"projects"."progress_percent" BETWEEN 0 AND 100
	),
	CONSTRAINT "projects_amounts_non_negative" CHECK (
		"projects"."budget_amount" >= 0
		AND ("projects"."contract_value" IS NULL OR "projects"."contract_value" >= 0)
	),

	-- An id with no name beside it is a link nothing can render. Both columns
	-- or neither, written as a condition on the id so a free-text client name
	-- with no Party behind it stays legal — which is what the create form
	-- allows and what a one-off client is.
	CONSTRAINT "projects_client_pair" CHECK (
		"projects"."client_party_id" IS NULL
		OR length(btrim(COALESCE("projects"."client_name", ''))) > 0
	),
	CONSTRAINT "projects_manager_pair" CHECK (
		"projects"."project_manager_user_id" IS NULL
		OR length(btrim(COALESCE("projects"."project_manager_name", ''))) > 0
	),

	-- A project cannot have finished while it is still running. The trigger
	-- stamps the date on the way into `completed`; this stops anything else
	-- writing one.
	CONSTRAINT "projects_actual_end_needs_an_end" CHECK (
		"projects"."actual_end_date" IS NULL
		OR "projects"."status" IN ('completed', 'closed')
	),
	CONSTRAINT "projects_dates_ordered" CHECK (
		"projects"."start_date" IS NULL
		OR "projects"."end_date" IS NULL
		OR "projects"."end_date" >= "projects"."start_date"
	),
	-- Not its own parent. The deeper cycles are the trigger's job.
	CONSTRAINT "projects_not_own_parent" CHECK (
		"projects"."parent_project_id" IS NULL
		OR "projects"."parent_project_id" <> "projects"."id"
	)
);
--> statement-breakpoint

ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_party_id_parties_id_fk" FOREIGN KEY ("client_party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_project_manager_user_id_users_id_fk" FOREIGN KEY ("project_manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_parent_project_id_projects_id_fk" FOREIGN KEY ("parent_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "projects_company_number_idx" ON "projects" USING btree ("company_id","project_number");--> statement-breakpoint
-- The list page: filtered by status, newest first.
CREATE INDEX "projects_company_status_idx" ON "projects" USING btree ("company_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "projects_company_client_idx" ON "projects" USING btree ("company_id","client_party_id");--> statement-breakpoint
CREATE INDEX "projects_company_manager_idx" ON "projects" USING btree ("company_id","project_manager_user_id");--> statement-breakpoint
CREATE INDEX "projects_company_parent_idx" ON "projects" USING btree ("company_id","parent_project_id") WHERE "projects"."parent_project_id" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- project_budgets — versioned, GL-linked, one approved at a time.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "project_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "project_budget_status" DEFAULT 'draft' NOT NULL,

	"approved_by_id" text,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"revision_notes" text DEFAULT '' NOT NULL,

	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "project_budgets_version_positive" CHECK ("project_budgets"."version" >= 1),

	-- The approval is three columns that mean nothing apart, and a superseded
	-- budget WAS approved — it keeps its stamp. So the biconditional is
	-- against `draft`, not against `approved`.
	CONSTRAINT "project_budgets_approval_pair" CHECK (
		("project_budgets"."status" = 'draft')
		= ("project_budgets"."approved_at" IS NULL)
	),
	CONSTRAINT "project_budgets_approver_pair" CHECK (
		("project_budgets"."approved_at" IS NULL)
		= (length(btrim(COALESCE("project_budgets"."approved_by_name", ''))) = 0)
	)
);
--> statement-breakpoint

ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "project_budgets_version_idx" ON "project_budgets" USING btree ("project_id","version");--> statement-breakpoint
-- Decision 4: the supersede-then-approve race cannot leave two.
CREATE UNIQUE INDEX "project_budgets_one_approved" ON "project_budgets" USING btree ("project_id") WHERE "project_budgets"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "project_budgets_company_project_idx" ON "project_budgets" USING btree ("company_id","project_id","version" DESC NULLS LAST);--> statement-breakpoint

CREATE TABLE "project_budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"line_number" integer NOT NULL,

	"account_id" uuid NOT NULL,
	-- What the account was called when the budget was set, so an account
	-- renamed in March does not rewrite a budget approved in January.
	"account_code_at_budget" text DEFAULT '' NOT NULL,
	"account_name_at_budget" text DEFAULT '' NOT NULL,

	"description" text DEFAULT '' NOT NULL,
	"amount" numeric(19, 4) NOT NULL,

	CONSTRAINT "project_budget_lines_amount_non_negative" CHECK ("project_budget_lines"."amount" >= 0)
);
--> statement-breakpoint

ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_budget_id_project_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."project_budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "project_budget_lines_number_idx" ON "project_budget_lines" USING btree ("budget_id","line_number");--> statement-breakpoint
-- Decision 6: budget-vs-actual reads the actual per ACCOUNT, so a second line
-- on the same account displays the same spend twice.
CREATE UNIQUE INDEX "project_budget_lines_one_per_account" ON "project_budget_lines" USING btree ("budget_id","account_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- project_cost_codes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "project_cost_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	-- NULL = available to every project in the company.
	"project_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,

	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "project_cost_codes_code_not_blank" CHECK (length(btrim("project_cost_codes"."code")) > 0),
	CONSTRAINT "project_cost_codes_name_not_blank" CHECK (length(btrim("project_cost_codes"."name")) > 0)
);
--> statement-breakpoint

ALTER TABLE "project_cost_codes" ADD CONSTRAINT "project_cost_codes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_codes" ADD CONSTRAINT "project_cost_codes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Decision 7. One index cannot say this, because NULLs are distinct.
CREATE UNIQUE INDEX "project_cost_codes_company_code_idx" ON "project_cost_codes" USING btree ("company_id","code") WHERE "project_cost_codes"."project_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_cost_codes_project_code_idx" ON "project_cost_codes" USING btree ("company_id","project_id","code") WHERE "project_cost_codes"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "project_cost_codes_active_idx" ON "project_cost_codes" USING btree ("company_id","is_active");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- project_assignments — the labour roster.
--
-- Assigning somebody posts nothing. Cost arrives when they are paid, through
-- an expense or a bill carrying this project. The rate here is planning
-- metadata, which is why it is nullable and why it has no ledger meaning.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "project_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,

	"party_id" uuid NOT NULL,
	"party_name" text NOT NULL,
	"party_type" "project_party_type" DEFAULT 'employee' NOT NULL,

	"role" text DEFAULT '' NOT NULL,

	-- An amount with no unit is not a rate. Both or neither.
	"rate_amount" numeric(19, 4),
	"rate_unit" "project_rate_unit",

	"status" "project_assignment_status" DEFAULT 'active' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_id" text,
	"assigned_by_name" text,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "project_assignments_rate_pair" CHECK (
		("project_assignments"."rate_amount" IS NULL)
		= ("project_assignments"."rate_unit" IS NULL)
	),
	CONSTRAINT "project_assignments_rate_non_negative" CHECK (
		"project_assignments"."rate_amount" IS NULL
		OR "project_assignments"."rate_amount" >= 0
	),
	CONSTRAINT "project_assignments_removal_pair" CHECK (
		("project_assignments"."status" = 'removed')
		= ("project_assignments"."removed_at" IS NOT NULL)
	)
);
--> statement-breakpoint

ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Re-assigning somebody reactivates their row; it does not add a second one.
CREATE UNIQUE INDEX "project_assignments_party_once" ON "project_assignments" USING btree ("project_id","party_id");--> statement-breakpoint
CREATE INDEX "project_assignments_roster_idx" ON "project_assignments" USING btree ("company_id","project_id","status");--> statement-breakpoint
CREATE INDEX "project_assignments_party_idx" ON "project_assignments" USING btree ("company_id","party_id","status");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The status machine (decision 3).
--
--   planning → active → on_hold → active
--                     → completed → closed
--
-- `transitionTo` is the only Mongo path that enforces this, and two of the
-- three writers do not use it: `updateProject` and `updateProjectProgress`
-- both go through `findOneAndUpdate`. A `$set: { status }` slipped into either
-- of them — or into whatever writes status next — reaches the collection with
-- nothing checking it. Here there is nowhere to slip it through.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_status_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION
      'Project % is closed and cannot be reopened.', OLD.project_number
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (
       (OLD.status = 'planning'  AND NEW.status = 'active')
    OR (OLD.status = 'active'    AND NEW.status IN ('on_hold', 'completed'))
    OR (OLD.status = 'on_hold'   AND NEW.status = 'active')
    OR (OLD.status = 'completed' AND NEW.status = 'closed')
  ) THEN
    RAISE EXCEPTION 'A project cannot move from % to %.', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- The date the work actually stopped, stamped once on the way out of
  -- `active`. Mongo re-stamps it on `closed` as well, which overwrites the
  -- completion date with the administrative one; COALESCE keeps the first.
  IF NEW.status IN ('completed', 'closed') THEN
    NEW.actual_end_date := COALESCE(OLD.actual_end_date, NEW.actual_end_date, CURRENT_DATE);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_status_transition"
BEFORE UPDATE OF status ON "projects"
FOR EACH ROW EXECUTE FUNCTION project_status_transition();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A project cannot be its own ancestor.
--
-- `getProjectsForParentPicker`'s docstring says it "excludes self and own
-- children". It excludes SELF: the query is `_id: { $ne: excludeProjectId }`
-- and there is no second clause. So A can be given its own child B as a
-- parent, and `getSubprojects` then recurses for ever on a page that will not
-- render. The picker is fixed in the repository; this is the half that holds
-- however the row is written.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_parent_is_acyclic() RETURNS trigger AS $$
DECLARE
  ancestor uuid := NEW.parent_project_id;
  hops integer := 0;
BEGIN
  WHILE ancestor IS NOT NULL LOOP
    IF ancestor = NEW.id THEN
      RAISE EXCEPTION
        'Project % cannot be a subproject of its own descendant.',
        NEW.project_number
        USING ERRCODE = 'check_violation';
    END IF;

    hops := hops + 1;
    -- A cycle that predates this trigger would spin here rather than raise.
    -- Nothing legitimate nests ten deep.
    IF hops > 10 THEN
      RAISE EXCEPTION 'Project hierarchy for % is too deep or already cyclic.',
        NEW.project_number
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT p.parent_project_id INTO ancestor FROM projects p WHERE p.id = ancestor;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_parent_is_acyclic"
BEFORE INSERT OR UPDATE OF parent_project_id ON "projects"
FOR EACH ROW WHEN (NEW.parent_project_id IS NOT NULL)
EXECUTE FUNCTION project_parent_is_acyclic();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- An approved budget's lines are frozen.
--
-- `updateProjectBudget` refuses anything that is not a draft, at ONE call
-- site. The version history is the whole point of the table — v2 exists so v1
-- can still be read as what was signed — and an edit to an approved v1 rewrites
-- what somebody approved with no trace. Same reasoning as
-- `employee_claim_items_frozen` in 0052.
--
-- The DELETE arm allows the cascade: when the budget row itself is going, its
-- lines go with it whatever state it was in.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_budget_lines_frozen() RETURNS trigger AS $$
DECLARE
  parent record;
BEGIN
  SELECT b.id, b.status, b.version INTO parent
    FROM project_budgets b
   WHERE b.id = COALESCE(NEW.budget_id, OLD.budget_id);

  -- The budget is already gone: this is the cascade, not an edit.
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF parent.status <> 'draft' THEN
    RAISE EXCEPTION
      'Budget v% is % and its lines cannot be changed. Create a new version.',
      parent.version, parent.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_budget_lines_frozen"
BEFORE INSERT OR UPDATE OR DELETE ON "project_budget_lines"
FOR EACH ROW EXECUTE FUNCTION project_budget_lines_frozen();--> statement-breakpoint

-- A budget with no lines is not a budget. Mongo says so in Zod
-- (`CreateBudgetSchema.lines.min(1)`) and nowhere else, so a budget whose
-- lines were all removed could still be approved and would then report a
-- total of zero against which everything is over budget.
CREATE OR REPLACE FUNCTION project_budget_has_lines() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    IF NOT EXISTS (SELECT 1 FROM project_budget_lines l WHERE l.budget_id = NEW.id) THEN
      RAISE EXCEPTION 'Budget v% has no lines to approve.', NEW.version
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_budget_has_lines"
BEFORE UPDATE OF status ON "project_budgets"
FOR EACH ROW EXECUTE FUNCTION project_budget_has_lines();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects', 'project_budgets', 'project_budget_lines',
                           'project_cost_codes', 'project_assignments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "projects" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_budgets" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_budget_lines" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_cost_codes" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_assignments" TO app_user;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The five deferred links become real.
--
-- 0053 typed all of these `text` for one stated reason: "a project id today is
-- a Mongo ObjectId — 24 hex characters — which no uuid column accepts". That
-- stops being true above.
--
-- ANY VALUE THAT IS NOT A UUID IS DISCARDED, not migrated. There is no prod
-- data to preserve (`docs/POSTGRES-MIGRATION-PLAN.md` — this is a fresh
-- deploy), and an ObjectId in a development database points at a Mongo project
-- that has no counterpart here. Keeping it would mean keeping the column text,
-- which is the thing being fixed. The snapshot columns beside it —
-- `project_number_at_*`, `project_name_at_*` — are left alone, so a row whose
-- link is dropped still says in words which project it was for.
--
-- `ON DELETE set null` on all five: deleting a project must never delete an
-- invoice. `deleteProjectPg` refuses while anything is linked, so this is the
-- backstop rather than the rule.
-- ─────────────────────────────────────────────────────────────────────────────

-- Two partial indexes carry `project_id <> ''`, which has no meaning for a
-- uuid and no operator to evaluate it. They are rebuilt below.
DROP INDEX IF EXISTS "invoices_company_project_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "employee_claims_project_idx";--> statement-breakpoint

DO $$
DECLARE
  spec record;
  uuid_re constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('invoices',       'project_id'),
      ('bills',          'project_id'),
      ('expenses',       'project_id'),
      ('employee_claims','project_id'),
      ('stock_requests', 'project_id'),
      ('expenses',       'cost_code_id'),
      ('employee_claims','cost_code_id'),
      ('stock_requests', 'cost_code_id')
    ) AS v(tbl, col)
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND %I !~ %L',
      spec.tbl, spec.col, spec.col, spec.col, uuid_re);
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE uuid USING NULLIF(%I, '''')::uuid',
      spec.tbl, spec.col, spec.col);
  END LOOP;
END $$;--> statement-breakpoint

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_claims" ADD CONSTRAINT "employee_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- `bills.cost_code_id` was ALREADY uuid (0015) while the other three were
-- text — so the bill form's cost code picker, which posts a Mongo ObjectId
-- from `getCostCodes`, has thrown `invalid input syntax for type uuid` on
-- every bill anybody tagged. The column was right and the picker feeding it
-- was not; both ends line up from here.
ALTER TABLE "bills" ADD CONSTRAINT "bills_cost_code_id_project_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."project_cost_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cost_code_id_project_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."project_cost_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_claims" ADD CONSTRAINT "employee_claims_cost_code_id_project_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."project_cost_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_cost_code_id_project_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."project_cost_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Rebuilt without the `<> ''`, and added for the two that never had one —
-- every one of these is read once per project on the detail page.
CREATE INDEX "invoices_company_project_idx" ON "invoices" USING btree ("company_id","project_id") WHERE "project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "employee_claims_project_idx" ON "employee_claims" USING btree ("company_id","project_id") WHERE "project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bills_company_project_idx" ON "bills" USING btree ("company_id","project_id") WHERE "project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "stock_requests_company_project_idx" ON "stock_requests" USING btree ("company_id","project_id") WHERE "project_id" IS NOT NULL;
