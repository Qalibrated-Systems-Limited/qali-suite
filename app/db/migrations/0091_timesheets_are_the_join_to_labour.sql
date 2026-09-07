-- ─────────────────────────────────────────────────────────────────────────────
-- 0089 — The timesheet, and the end of labour being invisible to a project.
--
-- Step 4 of `docs/PROJECTS-EXECUTION-LAYER.md` §4, and the largest remaining
-- hole in project cost. 0088's handoff put the number on it: on a worked
-- example the reported margin was 45.6% against a true 18.9%, because a
-- contractor's own labour — usually the biggest line on a job — reaches the
-- P&L through payroll and reaches no project at all.
--
-- 0084 put `project_id` and `cost_code_id` on `journal_lines` and 0085 gave
-- material issues an account to post to. This is the other half of the same
-- sentence: the record that says WHOSE time, on WHICH job, for HOW LONG.
--
-- ── Decision 1 — A TIMESHEET DOES NOT POST. It never will. ──────────────────
--
-- Restating the execution layer's decision 4 here, because this is the file a
-- future reader will have open when they are tempted to add the posting.
--
-- Odoo, NetSuite OpenAir and Procore all treat a timesheet as an ANALYTIC
-- record. Labour reaches the general ledger through PAYROLL, once, where the
-- PAYE and the NSSF are. Posting the timesheet as well books the same wage
-- twice, in a system that already has a payroll module posting real entries.
--
-- It is the rule 0070 was built on: transactions own financial truth, projects
-- aggregate. A timesheet is not a transaction. If labour is ever to reconcile
-- to the trial balance it is by ONE period-end allocation journal over these
-- rows — never a posting per timesheet, which is how a ledger acquires fifty
-- thousand lines a month and no clean way to reverse a correction. That
-- decision (§12's (a)/(b)/(c)) is not taken here and nothing below presumes it.
--
-- ── Decision 2 — ONLY AN EMPLOYEE'S TIME PRODUCES COST. ─────────────────────
--
-- The roster holds employees, suppliers and both. A subcontractor's cost
-- already arrives on a BILL carrying the project, and `computeActualsFor`
-- counts it at `approved`. Counting their timesheet as well would charge the
-- job twice for the same work.
--
-- So a supplier's timesheet records QUANTITY — for T&M billing, for progress,
-- for the day-rate argument at the end of the job — and carries no cost. This
-- is the line Odoo and Procore both draw between internal labour cost and
-- subcontract cost, and `project_timesheets_cost_is_employee_labour` makes it
-- structural rather than a rule the write path is trusted to remember.
--
-- `both` is costed like a supplier, deliberately: a party you also buy from
-- will invoice you, and the invoice is the authoritative number.
--
-- ── Decision 3 — A MONTHLY SALARY IS APPORTIONED BY `working_days()`. ───────
--
-- The roster's four rate units do not all multiply the same way, and this is
-- the one that needed answering.
--
--   hour, day  — a straight multiplication.
--   month      — a salary, apportioned: daily = rate / working_days() for the
--                month the day falls in. That is the SAME function 0045 gave
--                payroll and leave, and the same convention `payroll_entries`
--                already stores as `working_days_total`.
--   fixed      — a lump sum against the project, closer to a milestone than a
--                timesheet. NOT costable: the days are recorded, the money
--                comes from the contract.
--
-- Dividing by the month's own working days — rather than a flat 22, or an
-- annualised 260 — is what makes a month split across two jobs SUM BACK TO THE
-- SALARY. A fixed divisor cannot do that in a 20- or a 23-day month, and the
-- project total then drifts from the payslip that is the source of truth.
--
-- ── Decision 4 — THE COST IS WRITTEN BY THE DATABASE, NOT BY THE CALLER. ────
--
-- Same shape as `project_budget_lines_derive_account` (0073): a trigger reads
-- the assignment, snapshots the party and the rate onto the row, and computes
-- the money. There is then no write path — including the ones nobody has
-- written yet, and the import somebody will want — that can produce a
-- timesheet whose cost disagrees with the rate it was charged at.
--
-- The rate is SNAPSHOT, not read through. A raise in March must not silently
-- restate January's project cost.
--
-- ── Decision 5 — A PERSON'S DAY CANNOT BE SOLD TWICE. ──────────────────────
--
-- The apportionment guarantee in decision 3 only holds if the days charged
-- across every job sum to the days worked. Nothing else in the schema stops
-- eight hours going to three projects, and on a monthly salary that inflates
-- total labour cost above the salary actually paid — the exact failure this
-- migration exists to remove, pointing the other way.
--
-- `project_timesheets_day_not_overbooked` sums day-equivalents for a party on
-- a date across ALL of that company's projects and refuses more than one day.
-- It is an AFTER trigger so it sees the row the derive trigger finished, and
-- it is a best-effort check rather than a serialisable one: two concurrent
-- inserts can each pass it. That is the same guarantee every other cross-row
-- rule in this schema gives, and it is worth having.
--
-- Hours become days through `attendance_config.standard_hours` — the company's
-- own standard day, defaulting to 8 — so this cannot disagree with attendance
-- about how long a day is.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "project_timesheet_unit" AS ENUM ('hour', 'day');--> statement-breakpoint
CREATE TYPE "project_timesheet_status" AS ENUM ('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint

CREATE TABLE "project_timesheets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,

  -- The roster row is the join. It carries the rate, the party and the
  -- decision about whether this person's time is costed at all.
  "assignment_id" uuid NOT NULL,

  -- Snapshots, written by the trigger from the assignment.
  "party_id" uuid NOT NULL,
  "party_name" text NOT NULL,
  "party_type" "project_party_type" NOT NULL,

  -- Nullable: time booked to a job with no WBS is still time. Where a task is
  -- given, this is what makes `project_tasks.estimated_hours` answerable —
  -- 0071 deliberately stored no `actual_hours` column, because these rows are
  -- the actual hours.
  "task_id" uuid,

  -- The budget-holder's vocabulary (0073). Nullable, and its account is
  -- derived rather than typed, exactly as a budget line's is.
  "cost_code_id" uuid,
  "account_id" uuid,

  "work_date" date NOT NULL,
  "quantity" numeric(12, 4) NOT NULL,
  "unit" "project_timesheet_unit" NOT NULL,

  -- The rate this was charged at, snapshot at entry.
  "rate_amount" numeric(19, 4),
  "rate_unit" "project_rate_unit",
  -- NULL where the time is not costable: a supplier, a `fixed` engagement, or
  -- a roster row with no rate on it. NULL means "no cost", never "zero cost".
  "cost_amount" numeric(19, 4),

  -- T&M billing. `bill_rate` is per the timesheet's OWN unit — the number
  -- somebody quotes is "12,000 a day", and asking them to restate it in the
  -- rate unit of a roster row they cannot see is how a bill rate gets typed
  -- wrong by a factor of eight.
  "billable" boolean DEFAULT true NOT NULL,
  "bill_rate" numeric(19, 4),
  "bill_amount" numeric(19, 4),

  "status" "project_timesheet_status" DEFAULT 'draft' NOT NULL,
  "notes" text DEFAULT '' NOT NULL,

  "entered_by_id" text,
  "entered_by_name" text,
  "approved_at" timestamp with time zone,
  "approved_by_id" text,
  "approved_by_name" text,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  -- A day is a day. 24 hours is already absurd and is the outer bound rather
  -- than the expectation; decision 5's trigger is what actually holds the line.
  CONSTRAINT "project_timesheets_quantity_positive"
    CHECK ("quantity" > 0),
  CONSTRAINT "project_timesheets_quantity_within_a_day"
    CHECK (("unit" = 'hour' AND "quantity" <= 24)
        OR ("unit" = 'day'  AND "quantity" <= 1)),

  -- An amount with no unit is not a rate — `project_assignments_rate_pair`,
  -- said again about the snapshot.
  CONSTRAINT "project_timesheets_rate_pair"
    CHECK (("rate_amount" IS NULL) = ("rate_unit" IS NULL)),
  CONSTRAINT "project_timesheets_rate_non_negative"
    CHECK ("rate_amount" IS NULL OR "rate_amount" >= 0),

  -- Decision 2, structurally. A cost can only exist for an employee, and only
  -- against a rate that multiplies.
  CONSTRAINT "project_timesheets_cost_is_employee_labour"
    CHECK ("cost_amount" IS NULL
           OR ("party_type" = 'employee'
               AND "rate_amount" IS NOT NULL
               AND "rate_unit" <> 'fixed')),
  CONSTRAINT "project_timesheets_cost_non_negative"
    CHECK ("cost_amount" IS NULL OR "cost_amount" >= 0),

  -- Nothing is billed on a line marked not billable.
  CONSTRAINT "project_timesheets_bill_needs_billable"
    CHECK (("bill_rate" IS NULL AND "bill_amount" IS NULL) OR "billable"),
  CONSTRAINT "project_timesheets_bill_pair"
    CHECK (("bill_rate" IS NULL) = ("bill_amount" IS NULL)),
  CONSTRAINT "project_timesheets_bill_non_negative"
    CHECK ("bill_rate" IS NULL OR "bill_rate" >= 0),

  -- A code without its account is a code whose spend lands nowhere.
  CONSTRAINT "project_timesheets_cost_code_pair"
    CHECK (("cost_code_id" IS NULL) = ("account_id" IS NULL)),

  -- Approved means somebody approved it, and the reverse.
  CONSTRAINT "project_timesheets_approval_pair"
    CHECK (("status" = 'approved') = ("approved_at" IS NOT NULL))
);--> statement-breakpoint

ALTER TABLE "project_timesheets" ADD CONSTRAINT "project_timesheets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_timesheets" ADD CONSTRAINT "project_timesheets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- `restrict`: removing somebody from the roster must not delete the record of
-- the time they worked. `setAssignmentStatus(..., 'removed')` is the exit.
ALTER TABLE "project_timesheets" ADD CONSTRAINT "project_timesheets_assignment_id_project_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."project_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_timesheets" ADD CONSTRAINT "project_timesheets_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- `set null`: deleting a task loses the breakdown, not the day's work.
ALTER TABLE "project_timesheets" ADD CONSTRAINT "project_timesheets_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_timesheets" ADD CONSTRAINT "project_timesheets_cost_code_id_project_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."project_cost_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_timesheets" ADD CONSTRAINT "project_timesheets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_timesheets" ADD CONSTRAINT "project_timesheets_entered_by_id_users_id_fk" FOREIGN KEY ("entered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_timesheets" ADD CONSTRAINT "project_timesheets_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- The project's own timesheet list, and the cost arm of `computeActualsFor`,
-- which filters on status.
CREATE INDEX "project_timesheets_project_idx" ON "project_timesheets" USING btree ("company_id","project_id","work_date");--> statement-breakpoint
CREATE INDEX "project_timesheets_project_status_idx" ON "project_timesheets" USING btree ("project_id","status");--> statement-breakpoint
-- Decision 5's trigger reads by party and date across every project.
CREATE INDEX "project_timesheets_party_day_idx" ON "project_timesheets" USING btree ("company_id","party_id","work_date");--> statement-breakpoint
-- A task's actual hours are the sum of its timesheets — 0071's missing column.
CREATE INDEX "project_timesheets_task_idx" ON "project_timesheets" USING btree ("task_id") WHERE "task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "project_timesheets_cost_code_idx" ON "project_timesheets" USING btree ("project_id","cost_code_id") WHERE "cost_code_id" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The company's standard day. One definition, so this and attendance cannot
-- disagree about how many hours a day is.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_timesheet_hours_per_day(p_company_id uuid)
RETURNS numeric AS $$
  SELECT COALESCE(
    NULLIF((SELECT c.standard_hours FROM attendance_config c
             WHERE c.company_id = p_company_id), 0),
    8);
$$ LANGUAGE sql STABLE;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Day-equivalents. Decision 5 counts in these, and decision 3 multiplies by
-- them, so they are defined once.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_timesheet_days(
  p_company_id uuid, p_quantity numeric, p_unit project_timesheet_unit)
RETURNS numeric AS $$
  SELECT CASE p_unit
           WHEN 'day'  THEN p_quantity
           WHEN 'hour' THEN p_quantity / project_timesheet_hours_per_day(p_company_id)
         END;
$$ LANGUAGE sql STABLE;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Decision 3 — what a day of this person's time costs.
--
-- Returns NULL wherever there is no costable rate, which the CHECK above then
-- agrees with. NULL is "no cost", not "zero cost": a supplier's time is not
-- free, it is invoiced.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_timesheet_cost(
  p_company_id uuid,
  p_party_type project_party_type,
  p_rate       numeric,
  p_rate_unit  project_rate_unit,
  p_quantity   numeric,
  p_unit       project_timesheet_unit,
  p_work_date  date)
RETURNS numeric AS $$
DECLARE
  v_days      numeric;
  v_hours     numeric;
  v_wd        integer;
BEGIN
  IF p_party_type <> 'employee' OR p_rate IS NULL OR p_rate_unit = 'fixed' THEN
    RETURN NULL;
  END IF;

  v_days  := project_timesheet_days(p_company_id, p_quantity, p_unit);
  v_hours := v_days * project_timesheet_hours_per_day(p_company_id);

  IF p_rate_unit = 'hour' THEN
    RETURN ROUND(p_rate * v_hours, 4);
  ELSIF p_rate_unit = 'day' THEN
    RETURN ROUND(p_rate * v_days, 4);
  ELSIF p_rate_unit = 'month' THEN
    v_wd := working_days(
              p_company_id,
              date_trunc('month', p_work_date)::date,
              (date_trunc('month', p_work_date) + interval '1 month - 1 day')::date);

    -- A month with no working days at all is a holiday calendar problem, not
    -- a free month. Fall back rather than divide by zero or return NULL,
    -- which would silently drop the cost.
    IF v_wd IS NULL OR v_wd = 0 THEN
      v_wd := 22;
    END IF;

    RETURN ROUND((p_rate / v_wd) * v_days, 4);
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Decision 4 — the party, the rate, the cost and the account are written here.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_timesheets_derive() RETURNS trigger AS $$
DECLARE
  a record;
  c record;
BEGIN
  SELECT pa.party_id, pa.party_name, pa.party_type, pa.rate_amount,
         pa.rate_unit, pa.status, pa.project_id, pa.removed_at
    INTO a
    FROM project_assignments pa
   WHERE pa.id = NEW.assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That roster entry does not exist.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF a.project_id <> NEW.project_id THEN
    RAISE EXCEPTION '% is on a different project''s roster.', a.party_name
      USING ERRCODE = 'check_violation';
  END IF;

  -- Time worked BEFORE somebody came off the roster is still time worked, and
  -- it is normally entered afterwards. Time after is a mistake.
  IF a.status = 'removed' AND a.removed_at IS NOT NULL
     AND NEW.work_date > a.removed_at::date THEN
    RAISE EXCEPTION '% left this project on %.',
      a.party_name, to_char(a.removed_at, 'DD Mon YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.party_id    := a.party_id;
  NEW.party_name  := a.party_name;
  NEW.party_type  := a.party_type;
  NEW.rate_amount := a.rate_amount;
  NEW.rate_unit   := a.rate_unit;

  NEW.cost_amount := project_timesheet_cost(
    NEW.company_id, a.party_type, a.rate_amount, a.rate_unit,
    NEW.quantity, NEW.unit, NEW.work_date);

  -- The task must be on this project, or the WBS roll-up reads another job's
  -- hours. `set null` on delete is the only other way this column empties.
  IF NEW.task_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM project_tasks t
                      WHERE t.id = NEW.task_id AND t.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'That task belongs to a different project.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The account comes from the cost code, exactly as a budget line's does.
  IF NEW.cost_code_id IS NULL THEN
    NEW.account_id := NULL;
  ELSE
    SELECT cc.account_id, cc.code, cc.project_id INTO c
      FROM project_cost_codes cc
     WHERE cc.id = NEW.cost_code_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'That cost code does not exist.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF c.project_id IS NOT NULL AND c.project_id <> NEW.project_id THEN
      RAISE EXCEPTION 'Cost code % belongs to a different project.', c.code
        USING ERRCODE = 'check_violation';
    END IF;

    NEW.account_id := c.account_id;
  END IF;

  -- Billing is the caller's number, multiplied here so it cannot be typed
  -- inconsistently with the quantity beside it.
  IF NEW.billable AND NEW.bill_rate IS NOT NULL THEN
    NEW.bill_amount := ROUND(NEW.bill_rate * NEW.quantity, 4);
  ELSE
    NEW.bill_rate   := NULL;
    NEW.bill_amount := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_timesheets_derive"
BEFORE INSERT OR UPDATE OF assignment_id, task_id, cost_code_id, quantity,
                           unit, work_date, billable, bill_rate
ON "project_timesheets"
FOR EACH ROW EXECUTE FUNCTION project_timesheets_derive();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Decision 5 — a person's day cannot be sold twice.
--
-- AFTER, so it reads the row the derive trigger finished rather than racing
-- it on trigger name order. A rejected line is not a claim on the day.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION project_timesheets_day_not_overbooked() RETURNS trigger AS $$
DECLARE
  v_days numeric;
BEGIN
  SELECT COALESCE(SUM(project_timesheet_days(t.company_id, t.quantity, t.unit)), 0)
    INTO v_days
    FROM project_timesheets t
   WHERE t.company_id = NEW.company_id
     AND t.party_id   = NEW.party_id
     AND t.work_date  = NEW.work_date
     AND t.status <> 'rejected';

  -- A hair over one day is rounding on an hours-to-days division, not a
  -- second day's work.
  IF v_days > 1.0001 THEN
    RAISE EXCEPTION
      '% is already booked for % of a day on %. A day cannot be charged twice.',
      NEW.party_name, ROUND(v_days - project_timesheet_days(NEW.company_id, NEW.quantity, NEW.unit), 2),
      to_char(NEW.work_date, 'DD Mon YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "project_timesheets_day_not_overbooked"
AFTER INSERT OR UPDATE OF quantity, unit, work_date, status
ON "project_timesheets"
FOR EACH ROW EXECUTE FUNCTION project_timesheets_day_not_overbooked();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security, same shape as every other tenant-scoped table.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "project_timesheets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_timesheets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "project_timesheets"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_timesheets" TO app_user;
