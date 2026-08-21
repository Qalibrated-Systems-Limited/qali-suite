-- ============================================================================
-- 0046 — HR: leave.
--
-- Second of four. Leave types, entitlements, requests, and the balance that is
-- no longer a counter.
--
-- FOUR THINGS CHANGE, and each of them is a defect in the source rather than a
-- preference.
--
-- 1. THE BALANCE IS DERIVED, NOT INCREMENTED.
--    employeeProfile.js keeps usedDays, pendingDays and balanceDays in an
--    embedded array and moves them with $inc at four points in the workflow:
--    markLeavePending on submit, debitLeave on approve, releasePendingLeave on
--    reject and again on recall. Every one of those is a chance for the
--    counter to stop matching the requests that justify it — a rejection that
--    fails halfway, an admin editing a request, a status changed by any path
--    that does not run the action. And nothing can ever detect the drift,
--    because the counter IS the answer.
--
--    Here the requests are the answer. `leave_entitlements` stores only what
--    was GRANTED — days for the year, plus carry-over — and the
--    `leave_balances` view sums the requests for what has been taken and what
--    is pending. §9.3: a value that is a function of other rows is not stored
--    beside them.
--
-- 2. OVERLAPPING LEAVE IS REFUSED BY THE DATABASE.
--    LeaveRequest.hasOverlap() is a countDocuments() followed by an insert,
--    which is a race: two requests submitted together both see nothing and
--    both land. An exclusion constraint cannot be raced.
--
-- 3. A RECALLED REQUEST GOES BACK TO DRAFT.
--    The model's own comment says "submitted → recalled → draft", but
--    recall() sets the status to 'recalled' and nothing ever moves it on —
--    and submit() only accepts a draft. So recalling a request STRANDS it: the
--    employee cannot resubmit, and the days are released with no way to ask
--    again except to raise a new request. 'recalled' is not a state here; it
--    is an event, and the request returns to draft.
--
-- 4. "unpaid" IS NOT A MAGIC STRING.
--    hr-leave-actions.js decides whether to touch the balance with
--    `leaveType !== "unpaid"`, in five places. A company that renames the code
--    silently starts deducting unpaid leave from the annual balance.
--    `leave_types.affects_balance` says it once, as data.
-- ============================================================================

-- Exclusion constraints over a date range need to compare a uuid for equality
-- in the same index. btree_gist is what makes that possible; it ships with
-- Postgres.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- LEAVE TYPES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "leave_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,

  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,

  "default_entitlement" numeric(6,2) NOT NULL DEFAULT 0,
  "max_carry_over" numeric(6,2) NOT NULL DEFAULT 0,

  /* Paid leave is on the payslip; unpaid is deducted from it. */
  "is_paid" boolean NOT NULL DEFAULT true,

  /*
   * Whether taking this leave consumes an entitlement.
   *
   * The source asks `leaveType !== "unpaid"` at five call sites. Unpaid leave
   * is the usual case of "no balance to consume", but so is compassionate
   * leave at some employers, and study leave at others. It is a property of
   * the type.
   */
  "affects_balance" boolean NOT NULL DEFAULT true,

  "requires_document" boolean NOT NULL DEFAULT false,
  "applicable_gender" text NOT NULL DEFAULT 'all',

  "is_active" boolean NOT NULL DEFAULT true,
  /* Seeded by onboarding. Cannot be deleted, only deactivated. */
  "is_default" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,

  "created_by_id" text,
  "created_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "leave_types_id_company_uq" UNIQUE ("id", "company_id"),
  CONSTRAINT "leave_types_company_code_uq" UNIQUE ("company_id", "code"),

  CONSTRAINT "leave_types_code_not_blank" CHECK (btrim("code") <> ''),
  CONSTRAINT "leave_types_name_not_blank" CHECK (btrim("name") <> ''),
  CONSTRAINT "leave_types_gender_valid"
    CHECK ("applicable_gender" IN ('all', 'male', 'female')),
  CONSTRAINT "leave_types_entitlement_not_negative"
    CHECK ("default_entitlement" >= 0),
  CONSTRAINT "leave_types_carry_over_not_negative" CHECK ("max_carry_over" >= 0),
  -- Carrying over more than a year's entitlement is a typo, not a policy.
  CONSTRAINT "leave_types_carry_over_within_entitlement"
    CHECK ("max_carry_over" <= "default_entitlement")
);--> statement-breakpoint

CREATE INDEX "leave_types_company_active_idx"
  ON "leave_types" ("company_id", "is_active", "sort_order");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- ENTITLEMENTS — what was GRANTED, per employee, per type, per year.
--
-- This is the whole of what is stored. Days taken and days pending are
-- questions about `leave_requests`, and the view below asks them.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "leave_entitlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL,
  "leave_type_id" uuid NOT NULL,
  "year" integer NOT NULL,

  "entitled_days" numeric(6,2) NOT NULL DEFAULT 0,
  "carry_over_days" numeric(6,2) NOT NULL DEFAULT 0,
  /* Days paid out instead of taken (leave encashment). */
  "encashed_days" numeric(6,2) NOT NULL DEFAULT 0,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "leave_entitlements_employee_fk"
    FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "leave_entitlements_type_fk"
    FOREIGN KEY ("leave_type_id", "company_id")
    REFERENCES "leave_types"("id", "company_id"),

  CONSTRAINT "leave_entitlements_uq"
    UNIQUE ("company_id", "employee_id", "leave_type_id", "year"),

  CONSTRAINT "leave_entitlements_not_negative" CHECK (
    "entitled_days" >= 0 AND "carry_over_days" >= 0 AND "encashed_days" >= 0
  ),
  CONSTRAINT "leave_entitlements_year_sane"
    CHECK ("year" BETWEEN 2000 AND 2200)
);--> statement-breakpoint

CREATE INDEX "leave_entitlements_employee_year_idx"
  ON "leave_entitlements" ("employee_id", "year");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- LEAVE REQUESTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "leave_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "leave_number" text NOT NULL,

  "employee_id" uuid NOT NULL,
  "leave_type_id" uuid NOT NULL,

  "from_date" date NOT NULL,
  "to_date" date NOT NULL,

  /*
   * Working days, counted at request time and KEPT (§9.4).
   *
   * Not derived: this is the number that was agreed and approved. Adding a
   * public holiday in March must not silently shorten leave somebody has
   * already taken in February.
   */
  "total_days" numeric(6,2) NOT NULL,

  "is_half_day" boolean NOT NULL DEFAULT false,
  "half_day_period" text,

  "reason" text,
  "notes" text,

  /* Who covers the work. A reference, not a copied name. */
  "handover_employee_id" uuid,
  "handover_notes" text,

  "status" text NOT NULL DEFAULT 'draft',

  "submitted_at" timestamp with time zone,
  "submitted_by_id" text,
  "submitted_by_name" text,
  "approved_at" timestamp with time zone,
  "approved_by_id" text,
  "approved_by_name" text,
  "rejected_at" timestamp with time zone,
  "rejected_by_id" text,
  "rejected_by_name" text,
  "rejection_reason" text,
  "recalled_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancelled_by_id" text,
  "cancelled_by_name" text,
  "cancellation_reason" text,

  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "leave_requests_id_company_uq" UNIQUE ("id", "company_id"),
  CONSTRAINT "leave_requests_company_number_uq"
    UNIQUE ("company_id", "leave_number"),

  CONSTRAINT "leave_requests_employee_fk"
    FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "leave_requests_type_fk"
    FOREIGN KEY ("leave_type_id", "company_id")
    REFERENCES "leave_types"("id", "company_id"),
  CONSTRAINT "leave_requests_handover_fk"
    FOREIGN KEY ("handover_employee_id", "company_id")
    REFERENCES "employees"("id", "company_id"),

  -- 'recalled' is deliberately NOT a status. See the header.
  CONSTRAINT "leave_requests_status_valid" CHECK ("status" IN (
    'draft', 'submitted', 'approved', 'rejected', 'completed', 'cancelled'
  )),

  CONSTRAINT "leave_requests_ends_after_it_starts"
    CHECK ("to_date" >= "from_date"),
  CONSTRAINT "leave_requests_at_least_half_a_day"
    CHECK ("total_days" >= 0.5),

  -- Half a day is one day, in the morning or the afternoon. The source lets a
  -- two-week request be flagged halfDay, and calcWorkingDays then returns 0.5
  -- for the whole fortnight.
  CONSTRAINT "leave_requests_half_day_is_one_day" CHECK (
    NOT "is_half_day"
    OR ("from_date" = "to_date" AND "total_days" = 0.5
        AND "half_day_period" IN ('morning', 'afternoon'))
  ),
  CONSTRAINT "leave_requests_half_day_period_needs_half_day" CHECK (
    "half_day_period" IS NULL OR "is_half_day"
  ),

  -- A rejection says why. The action checks this; so does the table.
  CONSTRAINT "leave_requests_rejection_has_a_reason" CHECK (
    "status" <> 'rejected' OR btrim(COALESCE("rejection_reason", '')) <> ''
  ),

  -- Nobody covers for themselves.
  CONSTRAINT "leave_requests_handover_is_somebody_else" CHECK (
    "handover_employee_id" IS NULL OR "handover_employee_id" <> "employee_id"
  ),

  /*
   * ONE PERSON CANNOT BE ON TWO LEAVES AT ONCE.
   *
   * Applies to requests that are live — submitted, approved or completed.
   * Drafts, rejections and cancellations do not reserve the days.
   *
   * The source asks this with a countDocuments() before inserting, which two
   * concurrent submissions both pass.
   */
  CONSTRAINT "leave_requests_no_overlap" EXCLUDE USING gist (
    "employee_id" WITH =,
    daterange("from_date", "to_date", '[]') WITH &&
  ) WHERE ("status" IN ('submitted', 'approved', 'completed'))
);--> statement-breakpoint

CREATE INDEX "leave_requests_company_status_idx"
  ON "leave_requests" ("company_id", "status", "from_date" DESC);--> statement-breakpoint
CREATE INDEX "leave_requests_employee_idx"
  ON "leave_requests" ("employee_id", "from_date" DESC);--> statement-breakpoint
CREATE INDEX "leave_requests_company_range_idx"
  ON "leave_requests" ("company_id", "from_date", "to_date");--> statement-breakpoint
CREATE INDEX "leave_requests_type_idx" ON "leave_requests" ("leave_type_id");--> statement-breakpoint

-- Sick notes and the like.
CREATE TABLE "leave_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "leave_request_id" uuid NOT NULL,

  "name" text NOT NULL,
  "url" text NOT NULL,
  "public_id" text,
  "resource_type" text NOT NULL DEFAULT 'raw',

  "uploaded_by_id" text,
  "uploaded_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "leave_attachments_request_fk"
    FOREIGN KEY ("leave_request_id", "company_id")
    REFERENCES "leave_requests"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "leave_attachments_resource_type_valid"
    CHECK ("resource_type" IN ('image', 'raw', 'video'))
);--> statement-breakpoint

CREATE INDEX "leave_attachments_request_idx"
  ON "leave_attachments" ("leave_request_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- THE BALANCE.
--
-- One row per employee, leave type and year that has either an entitlement or
-- a request against it. Everything but the grant is counted from the requests.
--
--   taken     approved and completed leave
--   pending   submitted, awaiting a decision
--   available entitled + carried over - encashed - taken - pending
--
-- `available` is what a new request is checked against, which is exactly what
-- the source computes as `balanceDays - pendingDays` — the difference being
-- that here it cannot disagree with the requests it is made of.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "leave_balances" AS
WITH grants AS (
  SELECT company_id, employee_id, leave_type_id, year,
         entitled_days, carry_over_days, encashed_days
    FROM leave_entitlements
),
usage AS (
  SELECT r.company_id,
         r.employee_id,
         r.leave_type_id,
         EXTRACT(YEAR FROM r.from_date)::int AS year,
         COALESCE(SUM(r.total_days) FILTER (
           WHERE r.status IN ('approved', 'completed')), 0) AS taken,
         COALESCE(SUM(r.total_days) FILTER (
           WHERE r.status = 'submitted'), 0) AS pending
    FROM leave_requests r
   GROUP BY r.company_id, r.employee_id, r.leave_type_id,
            EXTRACT(YEAR FROM r.from_date)::int
)
SELECT COALESCE(g.company_id, u.company_id)       AS company_id,
       COALESCE(g.employee_id, u.employee_id)     AS employee_id,
       COALESCE(g.leave_type_id, u.leave_type_id) AS leave_type_id,
       COALESCE(g.year, u.year)                   AS year,
       COALESCE(g.entitled_days, 0)::numeric(8,2)   AS entitled_days,
       COALESCE(g.carry_over_days, 0)::numeric(8,2) AS carry_over_days,
       COALESCE(g.encashed_days, 0)::numeric(8,2)   AS encashed_days,
       COALESCE(u.taken, 0)::numeric(8,2)           AS taken_days,
       COALESCE(u.pending, 0)::numeric(8,2)         AS pending_days,
       (COALESCE(g.entitled_days, 0) + COALESCE(g.carry_over_days, 0)
        - COALESCE(g.encashed_days, 0) - COALESCE(u.taken, 0)
       )::numeric(8,2) AS balance_days,
       (COALESCE(g.entitled_days, 0) + COALESCE(g.carry_over_days, 0)
        - COALESCE(g.encashed_days, 0) - COALESCE(u.taken, 0)
        - COALESCE(u.pending, 0)
       )::numeric(8,2) AS available_days
  FROM grants g
  FULL OUTER JOIN usage u
    ON u.company_id = g.company_id
   AND u.employee_id = g.employee_id
   AND u.leave_type_id = g.leave_type_id
   AND u.year = g.year;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Who is on leave today.
--
-- The source keeps this as a STATUS on the employee — approval sets
-- employment.status = 'on_leave', and a sweep called from the leave page puts
-- it back. So whether somebody shows as on leave depends on whether anybody
-- has opened that page recently, and an employee who was suspended before
-- their leave started comes back 'active'.
--
-- It is a question about dates, and the dates already know.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "employees_on_leave" AS
SELECT r.company_id,
       r.employee_id,
       r.id AS leave_request_id,
       r.leave_type_id,
       r.from_date,
       r.to_date
  FROM leave_requests r
 WHERE r.status IN ('approved', 'completed')
   AND CURRENT_DATE BETWEEN r.from_date AND r.to_date;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Approved leave whose end date has passed is completed.
--
-- The source does this in a sweep triggered by loading the leave list page —
-- so a tenant that does not open that page keeps requests 'approved' forever,
-- and any report counting current leave counts them. This is a plain function
-- the same sweep can call, but it is set-based and idempotent, and the
-- completion time is the request's own end date rather than whenever the page
-- happened to be opened.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION complete_finished_leave(p_company_id uuid)
RETURNS integer AS $$
DECLARE
  n integer;
BEGIN
  UPDATE leave_requests
     SET status = 'completed',
         completed_at = to_date::timestamptz,
         updated_at = now()
   WHERE company_id = p_company_id
     AND status = 'approved'
     AND to_date < CURRENT_DATE;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'leave_types', 'leave_entitlements', 'leave_requests', 'leave_attachments'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "leave_types" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "leave_entitlements" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "leave_requests" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "leave_attachments" TO app_user;--> statement-breakpoint
GRANT SELECT ON "leave_balances" TO app_user;--> statement-breakpoint
GRANT SELECT ON "employees_on_leave" TO app_user;
