-- ─────────────────────────────────────────────────────────────────────────────
-- 0071 — The WBS, and the end of the typed percentage.
--
-- Step 1 of `docs/PROJECTS-EXECUTION-LAYER.md` §4, and the first line of what
-- the MD actually asked for: "tasks drive execution".
--
-- WHAT THIS REPLACES. `projects.progress_percent` is a number somebody drags a
-- slider to. It is the module's own gap list item one — "Progress is manual %.
-- No tasks, milestones, or dependencies" — and it is below what Procore, Candy
-- and MS Project all do, which is to DERIVE progress from work that was
-- actually measured. A typed percentage is how a project reports 90% complete
-- for four months, and every extension-of-time argument that follows is had
-- without evidence.
--
-- ── Six decisions ───────────────────────────────────────────────────────────
--
-- 1. PROGRESS IS DERIVED WHERE THERE ARE TASKS AND TYPED WHERE THERE ARE NONE.
--    `projects.progress_percent` is NOT dropped and NOT recomputed by a
--    trigger. It stays exactly what it was and stops being the answer: it is
--    the fallback for a project with no WBS. Where tasks exist, progress is
--    their weighted roll-up, computed on read.
--
--    Deliberately not a stored column. Same reasoning as the budget total in
--    0070 decision 5 and the cached financials in decision 1 — a rolled-up
--    number with a second copy is a number that will disagree with what it
--    rolls up, and this codebase has three of those in its history already.
--
-- 2. A SUMMARY TASK HAS NO PROGRESS OF ITS OWN.
--    Only a LEAF carries a percentage. A task with subtasks takes its number
--    from them, and `project_tasks_leaf_owns_progress` refuses to store one on
--    it — because the single most common way a WBS lies is a manager typing
--    90% on a summary line whose children are at 20%.
--
--    It follows that a summary task cannot be stored as `done` either: `done`
--    is 100, 100 is the roll-up, and the roll-up is a read. A parent whose
--    children are all done READS as done and is not written that way.
--
-- 3. WEIGHT, NOT COUNT.
--    A weighted average, falling back to estimated hours and then to equal
--    shares: COALESCE(weight, estimated_hours, 1). An unweighted average makes
--    "order the cable" worth as much as "lay 8km of subbase", which is how a
--    project is 50% complete having done none of the work.
--
--    `weight > 0`, never zero — a zero-weight task is invisible to the average
--    while still appearing on the page, which is worse than not being there.
--
-- 4. `done` MEANS 100 AND 100 MEANS `done`.
--    A biconditional, not an implication. A leaf sitting at 100% that nobody
--    has marked done is the same lie as a summary at 90%, pointing the other
--    way. `cancelled` is excluded from both the CHECK and the roll-up: work
--    that was called off is not work that was completed, and it is not work
--    outstanding either.
--
-- 5. THE HIERARCHY IS AN LTREE, MAINTAINED BY TRIGGER OVER THE SUBTREE.
--    Exactly as `categories` does it (0062), for exactly the reasons written
--    there: the cycle check comes free with the path, moving a node moves its
--    descendants, and `depth` is generated from the path so it cannot
--    disagree. It also makes the roll-up a subtree JOIN — `leaf.path <@
--    task.path` — rather than a recursive CTE per task.
--
-- 6. ACTUAL HOURS ARE NOT A COLUMN.
--    The MD's template lists `actualHours` beside `estimatedHours`. Actual
--    hours are the sum of the timesheets against a task, and timesheets are
--    step 4 — so storing the total now means storing a number with no writer,
--    which is precisely the `financials` mistake 0070 spent a migration
--    undoing. Estimated hours stay: they are a plan, and a plan is typed.
--
-- WHAT IS DELIBERATELY NOT HERE: dependencies and a critical path.
-- `PROJECTS-QALITRACK-PLAN.md` §4 is blunt that a Gantt without predecessor
-- links "is a picture of a programme, not a programme". Half of one is worse
-- than none, so it waits until it can be done properly.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "public"."project_task_status" AS ENUM(
  'todo', 'in_progress', 'blocked', 'done', 'cancelled'
);--> statement-breakpoint

CREATE TABLE "project_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,

	-- RESTRICT, not CASCADE: deleting a summary task must not silently take
	-- the work underneath it. Same call `categories` made in 0062.
	"parent_task_id" uuid,

	-- Materialised by trigger over the WHOLE subtree. The DEFAULT is a
	-- placeholder the BEFORE trigger always overwrites; it exists so a caller
	-- never supplies a path, because the tree owns it.
	"path" ltree DEFAULT ''::ltree NOT NULL,
	"depth" integer GENERATED ALWAYS AS (nlevel("path") - 1) STORED,

	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "project_task_status" DEFAULT 'todo' NOT NULL,

	-- Who is on it. A party rather than a user, so the roster
	-- (`project_assignments`) and the task list name the same people — a
	-- subcontractor doing the work has no login.
	"assigned_party_id" uuid,
	"assigned_name" text,

	"planned_start" date,
	"planned_end" date,
	"actual_start" date,
	"actual_end" date,

	"estimated_hours" numeric(12, 2),
	-- Decision 3. NULL means "use estimated_hours, then an equal share".
	"weight" numeric(12, 4),
	-- Decision 2: leaves only.
	"progress_percent" integer DEFAULT 0 NOT NULL,

	"cost_code_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,

	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "project_tasks_title_not_blank" CHECK (length(btrim("title")) > 0),
	CONSTRAINT "project_tasks_progress_in_range" CHECK (
		"progress_percent" BETWEEN 0 AND 100
	),
	CONSTRAINT "project_tasks_hours_non_negative" CHECK (
		"estimated_hours" IS NULL OR "estimated_hours" >= 0
	),
	-- Decision 3: zero weight makes a task invisible to the average while it
	-- still shows on the page.
	CONSTRAINT "project_tasks_weight_positive" CHECK (
		"weight" IS NULL OR "weight" > 0
	),

	CONSTRAINT "project_tasks_planned_dates_ordered" CHECK (
		"planned_start" IS NULL OR "planned_end" IS NULL
		OR "planned_end" >= "planned_start"
	),
	CONSTRAINT "project_tasks_actual_dates_ordered" CHECK (
		"actual_start" IS NULL OR "actual_end" IS NULL
		OR "actual_end" >= "actual_start"
	),

	-- An id with no name beside it is a link nothing can render. Same pair
	-- rule as the project's client and manager.
	CONSTRAINT "project_tasks_assignee_pair" CHECK (
		"assigned_party_id" IS NULL
		OR length(btrim(COALESCE("assigned_name", ''))) > 0
	),

	-- Decision 4, and both directions of it.
	CONSTRAINT "project_tasks_done_is_complete" CHECK (
		"status" = 'cancelled'
		OR ("status" = 'done') = ("progress_percent" = 100)
	),
	-- Work nobody has started has not progressed, and has no start date.
	CONSTRAINT "project_tasks_todo_has_not_started" CHECK (
		"status" <> 'todo'
		OR ("progress_percent" = 0 AND "actual_start" IS NULL)
	),
	-- A finish date belongs to finished work.
	CONSTRAINT "project_tasks_finished_has_ended" CHECK (
		"actual_end" IS NULL OR "status" IN ('done', 'cancelled')
	),

	CONSTRAINT "project_tasks_not_own_parent" CHECK (
		"parent_task_id" IS NULL OR "parent_task_id" <> "id"
	)
);
--> statement-breakpoint

ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_assigned_party_id_parties_id_fk" FOREIGN KEY ("assigned_party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_cost_code_id_project_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."project_cost_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- A SUBTASK BELONGS TO ITS PARENT'S PROJECT. A plain FK on `parent_task_id`
-- cannot say that, and a WBS spanning two projects makes both projects' roll-ups
-- wrong at once. The composite reference says it in the schema, the same way
-- `stock_request_fulfilments` ties an item to its tenant.
CREATE UNIQUE INDEX "project_tasks_id_project_uq" ON "project_tasks" USING btree ("id","project_id");--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_parent_same_project_fk" FOREIGN KEY ("parent_task_id","project_id") REFERENCES "public"."project_tasks"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "project_tasks_path_gist" ON "project_tasks" USING gist ("path");--> statement-breakpoint
-- The task list: one project's tree, in order.
CREATE INDEX "project_tasks_project_idx" ON "project_tasks" USING btree ("company_id","project_id","sort_order");--> statement-breakpoint
CREATE INDEX "project_tasks_parent_idx" ON "project_tasks" USING btree ("parent_task_id") WHERE "parent_task_id" IS NOT NULL;--> statement-breakpoint
-- "What is on my plate", across projects.
CREATE INDEX "project_tasks_assignee_idx" ON "project_tasks" USING btree ("company_id","assigned_party_id","status") WHERE "assigned_party_id" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The path, maintained for the whole subtree (decision 5).
--
-- Lifted from `categories_sync_path` (0062) — including the cycle test against
-- the LABEL rather than OLD.path, because on an insert there is no OLD and on
-- an update OLD.path may already be stale.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_tasks_sync_path() RETURNS trigger AS $$
DECLARE
  v_parent_path ltree;
  v_label       text;
BEGIN
  v_label := replace(NEW.id::text, '-', '_');

  IF NEW.parent_task_id IS NULL THEN
    NEW.path := v_label::ltree;
  ELSE
    SELECT path INTO v_parent_path FROM project_tasks WHERE id = NEW.parent_task_id;
    IF v_parent_path IS NULL THEN
      RAISE EXCEPTION 'Parent task does not exist'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_parent_path @> v_label::ltree
       OR v_parent_path ~ (('*.' || v_label || '.*')::lquery) THEN
      RAISE EXCEPTION 'A task cannot be moved beneath itself.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.path := v_parent_path || v_label::ltree;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_tasks_path_before"
BEFORE INSERT OR UPDATE OF parent_task_id ON "project_tasks"
FOR EACH ROW EXECUTE FUNCTION project_tasks_sync_path();--> statement-breakpoint

CREATE OR REPLACE FUNCTION project_tasks_resync_descendants() RETURNS trigger AS $$
BEGIN
  UPDATE project_tasks
     SET path = NEW.path || subpath(path, nlevel(OLD.path))
   WHERE path <@ OLD.path AND id <> NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_tasks_path_after"
AFTER UPDATE ON "project_tasks"
FOR EACH ROW WHEN (NEW.path IS DISTINCT FROM OLD.path)
EXECUTE FUNCTION project_tasks_resync_descendants();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A summary task has no progress of its own (decision 2).
--
-- The single most common way a work breakdown lies is a manager typing 90% on
-- a summary line whose children are at 20%. A CHECK cannot express this — it
-- is a fact about OTHER rows — so it is a trigger, and it fires however the
-- row is written rather than only through the action that remembers to look.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_tasks_leaf_owns_progress() RETURNS trigger AS $$
BEGIN
  IF NEW.progress_percent = 0 AND NEW.status <> 'done' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM project_tasks c WHERE c.parent_task_id = NEW.id) THEN
    RAISE EXCEPTION
      'Task "%" has subtasks, so its progress comes from them. Set progress on the subtasks instead.',
      NEW.title
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_tasks_leaf_owns_progress"
BEFORE INSERT OR UPDATE OF progress_percent, status ON "project_tasks"
FOR EACH ROW EXECUTE FUNCTION project_tasks_leaf_owns_progress();--> statement-breakpoint

-- Breaking a task down demotes it to a summary, so whatever percentage it was
-- carrying stops being its own. Without this, the trigger above would leave a
-- task that had 60% typed on it before it was broken down holding that 60% for
-- ever, in a column nothing reads.
CREATE OR REPLACE FUNCTION project_tasks_demote_new_parent() RETURNS trigger AS $$
BEGIN
  UPDATE project_tasks
     SET progress_percent = 0,
         status = CASE WHEN status = 'done' THEN 'in_progress'::project_task_status
                       ELSE status END,
         updated_at = now()
   WHERE id = NEW.parent_task_id
     AND (progress_percent <> 0 OR status = 'done');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_tasks_demote_new_parent"
AFTER INSERT ON "project_tasks"
FOR EACH ROW WHEN (NEW.parent_task_id IS NOT NULL)
EXECUTE FUNCTION project_tasks_demote_new_parent();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "project_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "project_tasks"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_tasks" TO app_user;
