-- ─────────────────────────────────────────────────────────────────────────────
-- 0076 — The bill of quantities, and the end of progress as an opinion.
--
-- Step 2 of `docs/PROJECTS-QALITRACK-PLAN.md` §8, which answers §6.4: quantities
-- ARE measured against a bill, so the bill is the missing table and progress
-- derives from it.
--
-- WHAT THIS FINISHES. 0071 replaced a typed percentage with a weighted roll-up
-- of tasks, and said so honestly: `progress.source` returns `tasks` or `typed`.
-- But a roll-up of tasks is still somebody's opinion of each task, rolled up
-- carefully — every leaf percentage in that tree was typed by a person. This is
-- the first table in the module where the number is a MEASUREMENT: 8 of 20 km of
-- subbase laid is 40% because 8 km was measured against a rate, not because
-- anyone thought so. `source` gains a third value, `measured`, and it outranks
-- the other two.
--
-- It also supplies the one figure §7's certificate arithmetic does not have —
-- "work done to date" for a measured valuation.
--
-- ── Eight decisions ─────────────────────────────────────────────────────────
--
-- 1. A HEADER, A TREE, AND A MEASUREMENT LOG — THREE TABLES, NOT TWO.
--    §8 described two. Building it showed the bill-level facts have no home in
--    the items: what method of measurement the bill was drawn to, which version
--    is the awarded one, and what freezing means. The precedent is in this same
--    module — `project_budgets` / `project_budget_lines`, versioned, one live at
--    a time, lines frozen once signed — and a bill of quantities is that shape
--    with quantities. Following it costs one small table and buys the whole
--    revision story.
--
-- 2. QUANTITY TO DATE IS A SUM, NEVER A COLUMN.
--    The measured quantity of an item is the sum of the measurements recorded
--    against it, computed on read. Same rule as the budget total in 0070
--    decision 5, the financials in decision 1 and the task roll-up in 0071
--    decision 1: a rolled-up number with a second copy is a number that will
--    disagree with what it rolls up. A remeasured quantity somebody can type
--    over is a final account nobody can defend.
--
-- 3. `amount` IS GENERATED FROM quantity × rate.
--    A bill whose extension does not equal its own quantity times its own rate
--    is the oldest error in the trade, and it is arithmetic, so the database
--    does it. `bills.total` and `expenses.total` are generated for the same
--    reason.
--
-- 4. ONLY A LEAF IS PRICED.
--    A section takes its amount from the items under it. A priced parent with
--    priced children is double-counted in the bill total, and there is no way
--    to tell from the row which of the two was meant. Exactly 0071 decision 2,
--    applied to money instead of a percentage.
--
--    And where 0071 silently DEMOTED a parent to 0%, this REFUSES to put a
--    child under a priced item. A percentage is a working number; a rate is a
--    contractual figure, and discarding one without saying so is worse than
--    declining and explaining. The message names the fix.
--
-- 5. AN AWARDED BILL IS FROZEN, AND A VARIATION ISSUES A NEW ITEM.
--    Once `awarded`, no item's quantity, rate, unit or code may move — the same
--    trigger shape as `project_budget_lines_frozen` (0070) and
--    `employee_claim_items_frozen` (0052). This is what makes the final account
--    answerable, and it is the same instinct as `original_contract_value`
--    beside the current one, and as every `*_at_*` snapshot column here.
--
--    It does NOT need `contracts` to exist first: `awarded` is a status on the
--    bill. When `contracts` lands it supplies the award DATE, not the concept.
--
-- 6. A MEASUREMENT MAY BE NEGATIVE, AND THE TOTAL MAY EXCEED THE BILL.
--    A correction to an over-measure is a negative remeasure, and it is how the
--    trade fixes last month's certificate without editing it. And measuring
--    more than was billed is INFORMATION — it is usually the first evidence of a
--    variation — so nothing here caps it. The module warns and does not block:
--    the same rule as the budget at 90% and the milestone schedule that does not
--    sum to the contract.
--
--    Zero is refused. A measurement of nothing is a row that says nothing.
--
-- 7. THE UNIT AND THE METHOD OF MEASUREMENT ARE TEXT, NOT ENUMS.
--    CESMM4, SMM7, POMI and the national standards each define their own units
--    and how an item is measured, and they are not interchangeable. This is
--    multi-tenant: whichever standard our own bills happen to use would look
--    like the obvious enum, and an enum is a migration to change. The screen
--    offers a list; the column takes what the contract says.
--
-- 8. THERE IS NO `certificate_id` ON A MEASUREMENT YET.
--    It belongs there — a measurement is taken up in a certificate, and §8 step
--    5 is where certificates land. But adding the column now creates a number
--    with no writer, which is precisely the cached `financials` that 0070 spent
--    a migration undoing. It arrives with the table that fills it.
--
-- WHAT IS DELIBERATELY NOT HERE: the BOQ does not replace the WBS. One nullable
-- `task_id` joins them, so an item can say which programme activity it measures
-- and that activity's progress becomes earned rather than typed. The programme
-- is the PLAN, the bill is the MEASUREMENT, and Procore, Candy and MS Project
-- all keep both.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "public"."project_boq_status" AS ENUM('draft', 'awarded', 'superseded');--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- project_boqs — the bill header. Versioned, one awarded at a time.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "project_boqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,

	"version" integer DEFAULT 1 NOT NULL,
	"status" "project_boq_status" DEFAULT 'draft' NOT NULL,

	-- Decision 7. Free text, offered as a list on the form.
	"method_of_measurement" text,
	"currency" text DEFAULT 'KES' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,

	-- The stamp, on the same biconditional pair rule as project_budgets:
	-- a superseded bill WAS awarded and keeps its stamp, so the test is
	-- against `draft` rather than against `awarded`.
	"awarded_by_id" text,
	"awarded_by_name" text,
	"awarded_at" timestamp with time zone,

	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "project_boqs_version_positive" CHECK ("version" > 0),
	CONSTRAINT "project_boqs_draft_is_unawarded" CHECK (
		("status" = 'draft') = ("awarded_at" IS NULL)
	),
	CONSTRAINT "project_boqs_award_pair" CHECK (
		("awarded_at" IS NULL)
		= (length(btrim(COALESCE("awarded_by_name", ''))) = 0)
	)
);
--> statement-breakpoint

ALTER TABLE "project_boqs" ADD CONSTRAINT "project_boqs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_boqs" ADD CONSTRAINT "project_boqs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_boqs" ADD CONSTRAINT "project_boqs_awarded_by_id_users_id_fk" FOREIGN KEY ("awarded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_boqs" ADD CONSTRAINT "project_boqs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_boqs" ADD CONSTRAINT "project_boqs_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "project_boqs_version_uq" ON "project_boqs" USING btree ("project_id","version");--> statement-breakpoint
-- One awarded bill per project. The same partial unique index that stops two
-- approved budgets racing (0070 decision 3) — the check-then-write in the
-- action is not a lock.
CREATE UNIQUE INDEX "project_boqs_one_awarded" ON "project_boqs" USING btree ("project_id") WHERE "project_boqs"."status" = 'awarded';--> statement-breakpoint
CREATE UNIQUE INDEX "project_boqs_id_project_uq" ON "project_boqs" USING btree ("id","project_id");--> statement-breakpoint
CREATE INDEX "project_boqs_project_idx" ON "project_boqs" USING btree ("company_id","project_id","status");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- project_boq_items — the bill itself, as an ltree tree.
--
-- A bill of quantities is numbered hierarchically — bill, section, sub-section,
-- item — and the figures a quantity surveyor reads are the SECTION totals,
-- which are roll-ups of the leaves. Same tree machinery as `categories` (0062)
-- and `project_tasks` (0071), for the reasons written there: the cycle check
-- comes free with the path, moving a node moves its descendants, `depth` cannot
-- disagree with the path, and a section total is a subtree JOIN rather than a
-- recursive CTE per row.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "project_boq_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"boq_id" uuid NOT NULL,
	-- Denormalised from the header so the composite key to `project_tasks`
	-- below can say "the same project" without a join.
	"project_id" uuid NOT NULL,

	-- RESTRICT: deleting a section must not silently take the items priced
	-- under it. Same call `categories` and `project_tasks` made.
	"parent_item_id" uuid,

	"path" ltree DEFAULT ''::ltree NOT NULL,
	"depth" integer GENERATED ALWAYS AS (nlevel("path") - 1) STORED,

	-- The reference as PRINTED in the bill — "B.2.14". Nullable, because a
	-- narrative line in a bill legitimately has no number.
	"item_code" text,
	"description" text NOT NULL,
	"is_heading" boolean DEFAULT false NOT NULL,

	-- Decision 7.
	"unit" text,
	"quantity" numeric(19, 4),
	"rate" numeric(19, 4),
	-- Decision 3.
	"amount" numeric(19, 4) GENERATED ALWAYS AS (("quantity" * "rate")::numeric(19,4)) STORED,

	"cost_code_id" uuid,
	-- The programme activity this item measures, so measured quantity can earn
	-- that task's progress. Nullable, and the composite FK below keeps it in
	-- the same project.
	"task_id" uuid,

	"sort_order" integer DEFAULT 0 NOT NULL,

	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "project_boq_items_description_not_blank" CHECK (
		length(btrim("description")) > 0
	),
	CONSTRAINT "project_boq_items_code_not_blank" CHECK (
		"item_code" IS NULL OR length(btrim("item_code")) > 0
	),
	-- A heading is a title. It carries no unit, no quantity and no rate, and
	-- its amount is what sits under it.
	CONSTRAINT "project_boq_items_heading_is_unpriced" CHECK (
		NOT "is_heading"
		OR ("unit" IS NULL AND "quantity" IS NULL AND "rate" IS NULL)
	),
	-- A quantity with no unit is a number nobody can read. Written as a
	-- conditional on the quantity so the pair is both-or-neither.
	CONSTRAINT "project_boq_items_quantity_needs_unit" CHECK (
		"quantity" IS NULL OR length(btrim(COALESCE("unit", ''))) > 0
	),
	CONSTRAINT "project_boq_items_quantity_non_negative" CHECK (
		"quantity" IS NULL OR "quantity" >= 0
	),
	CONSTRAINT "project_boq_items_rate_non_negative" CHECK (
		"rate" IS NULL OR "rate" >= 0
	),
	-- A rate with nothing to apply it to prices nothing, and is the shape of a
	-- half-entered line that later reads as zero.
	CONSTRAINT "project_boq_items_rate_needs_quantity" CHECK (
		"rate" IS NULL OR "quantity" IS NOT NULL
	),
	CONSTRAINT "project_boq_items_not_own_parent" CHECK (
		"parent_item_id" IS NULL OR "parent_item_id" <> "id"
	)
);
--> statement-breakpoint

ALTER TABLE "project_boq_items" ADD CONSTRAINT "project_boq_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_boq_items" ADD CONSTRAINT "project_boq_items_boq_id_project_boqs_id_fk" FOREIGN KEY ("boq_id") REFERENCES "public"."project_boqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_boq_items" ADD CONSTRAINT "project_boq_items_cost_code_id_project_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."project_cost_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_boq_items" ADD CONSTRAINT "project_boq_items_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_boq_items" ADD CONSTRAINT "project_boq_items_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- AN ITEM BELONGS TO ITS HEADER'S PROJECT, and a sub-item to its parent's BILL.
-- Plain foreign keys cannot say either, and a bill spanning two projects makes
-- both projects' measured progress wrong at once. Same composite-key technique
-- as `project_tasks_parent_same_project_fk` (0071).
ALTER TABLE "project_boq_items" ADD CONSTRAINT "project_boq_items_boq_same_project_fk" FOREIGN KEY ("boq_id","project_id") REFERENCES "public"."project_boqs"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_boq_items_id_boq_uq" ON "project_boq_items" USING btree ("id","boq_id");--> statement-breakpoint
ALTER TABLE "project_boq_items" ADD CONSTRAINT "project_boq_items_parent_same_boq_fk" FOREIGN KEY ("parent_item_id","boq_id") REFERENCES "public"."project_boq_items"("id","boq_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- The measured task must be in the same project as the item measuring it.
-- `project_tasks_id_project_uq` (0071) is the key this references, and a NULL
-- `task_id` skips the check under MATCH SIMPLE — which is what makes the link
-- optional.
ALTER TABLE "project_boq_items" ADD CONSTRAINT "project_boq_items_task_same_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."project_tasks"("id","project_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- The item code as quoted in a certificate or a claim. Unique within a bill,
-- because two items numbered B.2.14 make every reference to B.2.14 ambiguous —
-- and a bill legitimately has unnumbered narrative lines, so the index is
-- partial rather than the column being NOT NULL.
CREATE UNIQUE INDEX "project_boq_items_code_uq" ON "project_boq_items" USING btree ("boq_id","item_code") WHERE "item_code" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "project_boq_items_path_gist" ON "project_boq_items" USING gist ("path");--> statement-breakpoint
CREATE INDEX "project_boq_items_boq_idx" ON "project_boq_items" USING btree ("company_id","boq_id","sort_order");--> statement-breakpoint
CREATE INDEX "project_boq_items_parent_idx" ON "project_boq_items" USING btree ("parent_item_id") WHERE "parent_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "project_boq_items_task_idx" ON "project_boq_items" USING btree ("task_id") WHERE "task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "project_boq_items_cost_code_idx" ON "project_boq_items" USING btree ("cost_code_id") WHERE "cost_code_id" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- project_boq_measurements — one row per measurement event (decision 2).
--
-- Never a running total. The quantity measured to date is SUM(quantity) over
-- these rows, and last month's over-measure is corrected by a negative row
-- rather than by editing what was certified.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "project_boq_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"boq_item_id" uuid NOT NULL,

	"measured_on" date DEFAULT CURRENT_DATE NOT NULL,
	-- Signed. Decision 6.
	"quantity" numeric(19, 4) NOT NULL,

	-- Where it was measured — chainage, grid reference, sheet number, level.
	-- The thing that makes a remeasure checkable two years later, which is when
	-- a final account is argued.
	"reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,

	"measured_by_id" text,
	"measured_by_name" text DEFAULT 'System' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "project_boq_measurements_quantity_not_zero" CHECK ("quantity" <> 0)
);
--> statement-breakpoint

ALTER TABLE "project_boq_measurements" ADD CONSTRAINT "project_boq_measurements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_boq_measurements" ADD CONSTRAINT "project_boq_measurements_boq_item_id_project_boq_items_id_fk" FOREIGN KEY ("boq_item_id") REFERENCES "public"."project_boq_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_boq_measurements" ADD CONSTRAINT "project_boq_measurements_measured_by_id_users_id_fk" FOREIGN KEY ("measured_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "project_boq_measurements_item_idx" ON "project_boq_measurements" USING btree ("boq_item_id","measured_on");--> statement-breakpoint
CREATE INDEX "project_boq_measurements_company_idx" ON "project_boq_measurements" USING btree ("company_id","measured_on");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The path, maintained for the whole subtree.
--
-- Lifted from `project_tasks_sync_path` (0071), itself lifted from
-- `categories_sync_path` (0062) — including the cycle test against the LABEL
-- rather than OLD.path, because on an insert there is no OLD and on an update
-- OLD.path may already be stale.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_boq_items_sync_path() RETURNS trigger AS $$
DECLARE
  v_parent_path ltree;
  v_label       text;
BEGIN
  v_label := replace(NEW.id::text, '-', '_');

  IF NEW.parent_item_id IS NULL THEN
    NEW.path := v_label::ltree;
  ELSE
    SELECT path INTO v_parent_path FROM project_boq_items WHERE id = NEW.parent_item_id;
    IF v_parent_path IS NULL THEN
      RAISE EXCEPTION 'Parent bill item does not exist'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_parent_path @> v_label::ltree
       OR v_parent_path ~ (('*.' || v_label || '.*')::lquery) THEN
      RAISE EXCEPTION 'A bill item cannot be moved beneath itself.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.path := v_parent_path || v_label::ltree;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_boq_items_path_before"
BEFORE INSERT OR UPDATE OF parent_item_id ON "project_boq_items"
FOR EACH ROW EXECUTE FUNCTION project_boq_items_sync_path();--> statement-breakpoint

CREATE OR REPLACE FUNCTION project_boq_items_resync_descendants() RETURNS trigger AS $$
BEGIN
  UPDATE project_boq_items
     SET path = NEW.path || subpath(path, nlevel(OLD.path))
   WHERE path <@ OLD.path AND id <> NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_boq_items_path_after"
AFTER UPDATE ON "project_boq_items"
FOR EACH ROW WHEN (NEW.path IS DISTINCT FROM OLD.path)
EXECUTE FUNCTION project_boq_items_resync_descendants();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Only a leaf is priced (decision 4), in both directions.
--
-- A CHECK cannot express either half — both are facts about OTHER rows — so
-- they are triggers, and they fire however the row is written rather than only
-- through the action that remembers to look.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_boq_items_leaf_owns_quantity() RETURNS trigger AS $$
BEGIN
  IF NEW.quantity IS NULL AND NEW.rate IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM project_boq_items c WHERE c.parent_item_id = NEW.id) THEN
    RAISE EXCEPTION
      'Item % has sub-items, so its amount is their total. Price the sub-items instead.',
      COALESCE(NEW.item_code, NEW.description)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_boq_items_leaf_owns_quantity"
BEFORE INSERT OR UPDATE OF quantity, rate ON "project_boq_items"
FOR EACH ROW EXECUTE FUNCTION project_boq_items_leaf_owns_quantity();--> statement-breakpoint

-- The other direction: breaking a PRICED item down would make it a section
-- holding a rate. 0071 demoted the parent silently, which is right for a
-- percentage and wrong for money — a rate is a contractual figure, and
-- discarding one without saying so is worse than declining and explaining.
CREATE OR REPLACE FUNCTION project_boq_items_refuse_child_of_priced() RETURNS trigger AS $$
DECLARE
  parent record;
BEGIN
  SELECT item_code, description, quantity, rate INTO parent
    FROM project_boq_items WHERE id = NEW.parent_item_id;

  IF FOUND AND (parent.quantity IS NOT NULL OR parent.rate IS NOT NULL) THEN
    RAISE EXCEPTION
      'Item % is priced, so it cannot also have sub-items. Clear its quantity and rate first, then break it down.',
      COALESCE(parent.item_code, parent.description)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_boq_items_refuse_child_of_priced"
BEFORE INSERT OR UPDATE OF parent_item_id ON "project_boq_items"
FOR EACH ROW WHEN (NEW.parent_item_id IS NOT NULL)
EXECUTE FUNCTION project_boq_items_refuse_child_of_priced();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- An awarded bill is frozen (decision 5).
--
-- Same shape as `project_budget_lines_frozen` (0070), including the arm that
-- lets the cascade through: when the header itself is going, its items go with
-- it whatever state it was in.
--
-- `sort_order`, the cost code and the task link are NOT frozen. None of them is
-- a contractual figure — they are how the bill is displayed and what it is
-- cross-referenced to — and needing a new version of the bill to tie an item to
-- a programme activity would mean nobody ever does it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_boq_items_frozen() RETURNS trigger AS $$
DECLARE
  parent record;
BEGIN
  SELECT b.id, b.status, b.version INTO parent
    FROM project_boqs b
   WHERE b.id = COALESCE(NEW.boq_id, OLD.boq_id);

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF parent.status = 'draft' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- An UPDATE that touches none of the priced facts is allowed through.
  IF TG_OP = 'UPDATE'
     AND NEW.item_code       IS NOT DISTINCT FROM OLD.item_code
     AND NEW.description     IS NOT DISTINCT FROM OLD.description
     AND NEW.unit            IS NOT DISTINCT FROM OLD.unit
     AND NEW.quantity        IS NOT DISTINCT FROM OLD.quantity
     AND NEW.rate            IS NOT DISTINCT FROM OLD.rate
     AND NEW.is_heading      IS NOT DISTINCT FROM OLD.is_heading
     AND NEW.parent_item_id  IS NOT DISTINCT FROM OLD.parent_item_id THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Bill v% is % and its items cannot be changed. Issue a variation, or create a new version.',
    parent.version, parent.status
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_boq_items_frozen"
BEFORE INSERT OR UPDATE OR DELETE ON "project_boq_items"
FOR EACH ROW EXECUTE FUNCTION project_boq_items_frozen();--> statement-breakpoint

-- A bill with no priced item is not a bill, and awarding one would report a
-- contract value of zero against which everything is a variation. Same guard as
-- `project_budget_has_lines` (0070).
CREATE OR REPLACE FUNCTION project_boq_has_priced_items() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'awarded' AND OLD.status <> 'awarded' THEN
    IF NOT EXISTS (
      SELECT 1 FROM project_boq_items i
       WHERE i.boq_id = NEW.id AND i.quantity IS NOT NULL AND i.rate IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Bill v% has no priced item to award.', NEW.version
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_boq_has_priced_items"
BEFORE UPDATE OF status ON "project_boqs"
FOR EACH ROW EXECUTE FUNCTION project_boq_has_priced_items();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- What may be measured.
--
-- Measurement is a record of work done against a bill somebody signed, so it
-- needs an AWARDED bill and a PRICED item. Measuring against a draft is
-- measuring against a proposal, and measuring a heading is measuring a title.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_boq_measurement_is_measurable() RETURNS trigger AS $$
DECLARE
  item record;
BEGIN
  SELECT i.item_code, i.description, i.quantity, i.is_heading, b.status, b.version
    INTO item
    FROM project_boq_items i
    JOIN project_boqs b ON b.id = i.boq_id
   WHERE i.id = NEW.boq_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill item does not exist' USING ERRCODE = 'check_violation';
  END IF;

  IF item.status <> 'awarded' THEN
    RAISE EXCEPTION
      'Bill v% is %, so there is nothing to measure against yet. Award it first.',
      item.version, item.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF item.is_heading OR item.quantity IS NULL THEN
    RAISE EXCEPTION
      'Item % is not a priced item, so it cannot be measured.',
      COALESCE(item.item_code, item.description)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_boq_measurement_is_measurable"
BEFORE INSERT OR UPDATE OF boq_item_id ON "project_boq_measurements"
FOR EACH ROW EXECUTE FUNCTION project_boq_measurement_is_measurable();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_boqs', 'project_boq_items',
                           'project_boq_measurements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_boqs" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_boq_items" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_boq_measurements" TO app_user;
