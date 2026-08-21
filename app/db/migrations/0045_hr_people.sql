-- ============================================================================
-- 0045 — HR: the people, and the structure they sit in.
--
-- The first of four migrations moving the HR module. This one carries
-- departments, employees, the two histories, employee documents and the
-- holiday calendar; leave, attendance and payroll follow in 0046-0048.
--
-- Five decisions, made here once so the later three do not re-argue them.
--
-- 1. ONE EMPLOYEE RECORD, NOT THREE COPIES.
--    Mongo keeps the employee's name, number, department and designation on
--    the Party, on the EmployeeProfile AND on the User, and keeps them in step
--    by hand: hr-employee-actions.js:updateEmployee runs eighty lines of
--    "name didn't change but other fields did — still sync", and
--    terminateEmployee has its own copy of the same dance. Every one of those
--    is a place the three can disagree, and nothing notices when they do.
--
--    Here `employees` owns the employment relationship. `parties` keeps
--    identity, because the ledger references a party — claims, payroll
--    payments and journals all do — and a party may exist without HR (a plan
--    without the HR module still lets you name an employee on a stock
--    request). The overlap is maintained by the DATABASE, in one trigger, not
--    by four call sites: see sync_party_from_employee() below.
--
-- 2. THE DEPARTMENT IS A FOREIGN KEY (§8.6).
--    The source stores `employment.department` as a string beside
--    `employment.departmentId`, so renaming a department leaves every employee
--    hired before the rename filed under the old name. The name is joined, not
--    copied. Where a name genuinely had to be frozen — what a payslip SAID —
--    it is snapshotted on the payslip in 0048, which is §9.4, not this.
--
-- 3. THE MANAGER IS AN EMPLOYEE.
--    `employment.managerId` refs Party in Mongo, with `managerName` beside it.
--    A manager is an employee of this company; the reference says so, and a
--    self-reference cannot be another tenant's row because the foreign key is
--    composite.
--
-- 4. DOCUMENTS COME OUT OF THE ARRAY.
--    `documents[]` is capped at 50 with a validator, and uploading the 51st
--    fails with "Cannot store more than 50 documents per employee" — a limit
--    that exists because of how the data was stored, not because anyone
--    decided it. As a table there is no cap. It also carries `resource_type`,
--    which fixes a live bug: deleteEmployeeDocument always destroys the
--    Cloudinary asset with `resource_type: "raw"`, so every IMAGE ever
--    uploaded as a document is still sitting in Cloudinary after being
--    "deleted", and still billable.
--
-- 5. A HOLIDAY THAT NEVER HAPPENS IS A TYPO.
--    publicHoliday.js allows isRecurring = false with year = null, and
--    getDateSet() then skips it silently — a one-off holiday nobody can see is
--    not applied, so leave days and payroll working days are quietly wrong.
--    A CHECK makes the two states mean what they say.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- DEPARTMENTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "departments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,

  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,

  "parent_department_id" uuid,

  -- Where this department's payroll lands. A reference; the code and name that
  -- Mongo caches beside it are joined, not stored (§8.6).
  "cost_center_account_id" uuid,

  -- The head is added after `employees` exists — see the ALTER below.

  "is_active" boolean NOT NULL DEFAULT true,

  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "departments_id_company_uq" UNIQUE ("id", "company_id"),
  CONSTRAINT "departments_company_code_uq" UNIQUE ("company_id", "code"),
  CONSTRAINT "departments_company_name_uq" UNIQUE ("company_id", "name"),

  CONSTRAINT "departments_parent_fk"
    FOREIGN KEY ("parent_department_id", "company_id")
    REFERENCES "departments"("id", "company_id"),

  CONSTRAINT "departments_cost_center_fk"
    FOREIGN KEY ("cost_center_account_id", "company_id")
    REFERENCES "accounts"("id", "company_id"),

  -- A department is not its own parent. Deeper cycles are refused by
  -- assert_no_department_cycle() below; this catches the common one cheaply.
  CONSTRAINT "departments_parent_is_not_self"
    CHECK ("parent_department_id" IS NULL OR "parent_department_id" <> "id"),

  CONSTRAINT "departments_code_not_blank" CHECK (btrim("code") <> ''),
  CONSTRAINT "departments_name_not_blank" CHECK (btrim("name") <> '')
);--> statement-breakpoint

CREATE INDEX "departments_company_active_name_idx"
  ON "departments" ("company_id", "is_active", "name");--> statement-breakpoint
CREATE INDEX "departments_parent_idx"
  ON "departments" ("parent_department_id")
  WHERE "parent_department_id" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- EMPLOYEES
--
-- One row per employment relationship, keyed 1:1 to the party that carries the
-- person's financial identity.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "employees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,

  -- The financial identity. Payroll payments, claims and journals reference
  -- the PARTY, so it stays the thing the ledger knows about.
  "party_id" uuid NOT NULL,

  -- The login, if they have one. Text because users.id is text (0036).
  -- ON DELETE SET NULL: deleting a login must not delete an employment record.
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,

  "employee_number" text NOT NULL,

  -- ── Person ────────────────────────────────────────────────────────────────
  -- First and last are separate because a payslip, a P9A and an NSSF return
  -- all need them apart. `parties.name` is kept in step by trigger.
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "date_of_birth" date,
  "gender" text,
  "national_id" text,
  "kra_pin" text,
  "nssf_number" text,
  "sha_number" text,          -- Social Health Authority; replaced NHIF Oct 2024
  "passport_number" text,
  "nationality" text NOT NULL DEFAULT 'Kenyan',
  "photo_url" text,
  "photo_public_id" text,

  -- ── Employment ────────────────────────────────────────────────────────────
  "department_id" uuid,
  "designation" text,
  "employment_type" text NOT NULL DEFAULT 'full_time',
  "status" text NOT NULL DEFAULT 'probation',

  "hire_date" date NOT NULL,
  "confirmation_date" date,
  "termination_date" date,
  "termination_reason" text,

  "contract_start" date,
  "contract_end" date,
  "contract_type" text,

  "manager_id" uuid,
  "work_location" text,
  "job_grade" text,

  -- Per-employee shift override. NULL means "use the company's".
  "shift_start" text,
  "shift_end" text,

  -- ── Compensation ──────────────────────────────────────────────────────────
  -- numeric, not float (§2.1). The source's `basicSalary: Number` is a float64
  -- and every payroll figure descends from it.
  "basic_salary" numeric(19,4) NOT NULL DEFAULT 0,
  "currency" text NOT NULL DEFAULT 'KES',
  "allowance_housing" numeric(19,4) NOT NULL DEFAULT 0,
  "allowance_transport" numeric(19,4) NOT NULL DEFAULT 0,
  "allowance_medical" numeric(19,4) NOT NULL DEFAULT 0,
  "allowance_other" numeric(19,4) NOT NULL DEFAULT 0,

  "payment_method" text NOT NULL DEFAULT 'bank',
  "bank_name" text,
  "bank_account" text,
  "bank_branch" text,
  "mpesa_number" text,

  "last_review_date" date,
  "last_reviewed_by_id" text,
  "last_reviewed_by_name" text,

  -- ── Emergency contact ─────────────────────────────────────────────────────
  "emergency_name" text,
  "emergency_relationship" text,
  "emergency_phone" text,
  "emergency_alternate_phone" text,

  "notes" text,

  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "employees_id_company_uq" UNIQUE ("id", "company_id"),

  -- One employment record per party. The Mongo index says the same thing.
  CONSTRAINT "employees_company_party_uq" UNIQUE ("company_id", "party_id"),

  -- And one per login: two employment records sharing a login would make
  -- "whose leave is this" unanswerable.
  CONSTRAINT "employees_company_user_uq" UNIQUE ("company_id", "user_id"),

  CONSTRAINT "employees_company_number_uq" UNIQUE ("company_id", "employee_number"),

  CONSTRAINT "employees_party_fk"
    FOREIGN KEY ("party_id", "company_id")
    REFERENCES "parties"("id", "company_id"),

  CONSTRAINT "employees_department_fk"
    FOREIGN KEY ("department_id", "company_id")
    REFERENCES "departments"("id", "company_id"),

  CONSTRAINT "employees_manager_fk"
    FOREIGN KEY ("manager_id", "company_id")
    REFERENCES "employees"("id", "company_id"),

  CONSTRAINT "employees_manager_is_not_self"
    CHECK ("manager_id" IS NULL OR "manager_id" <> "id"),

  CONSTRAINT "employees_number_not_blank" CHECK (btrim("employee_number") <> ''),
  CONSTRAINT "employees_first_name_not_blank" CHECK (btrim("first_name") <> ''),
  CONSTRAINT "employees_last_name_not_blank" CHECK (btrim("last_name") <> ''),

  CONSTRAINT "employees_gender_valid"
    CHECK ("gender" IS NULL OR "gender" IN ('male', 'female', 'other')),

  CONSTRAINT "employees_employment_type_valid" CHECK ("employment_type" IN (
    'full_time', 'part_time', 'contract', 'intern', 'casual'
  )),

  CONSTRAINT "employees_status_valid" CHECK ("status" IN (
    'active', 'probation', 'on_leave', 'suspended', 'terminated'
  )),

  CONSTRAINT "employees_payment_method_valid"
    CHECK ("payment_method" IN ('bank', 'mpesa', 'cash')),

  CONSTRAINT "employees_contract_type_valid" CHECK (
    "contract_type" IS NULL
    OR "contract_type" IN ('fixed_term', 'renewable', 'project_based')
  ),

  -- Money does not go backwards.
  CONSTRAINT "employees_basic_salary_not_negative" CHECK ("basic_salary" >= 0),
  CONSTRAINT "employees_allowances_not_negative" CHECK (
    "allowance_housing" >= 0 AND "allowance_transport" >= 0
    AND "allowance_medical" >= 0 AND "allowance_other" >= 0
  ),

  -- Dates that describe one employment must be in order. The source checks
  -- none of these, and a termination date before the hire date makes every
  -- pro-rata payroll calculation return a negative fraction.
  CONSTRAINT "employees_confirmed_after_hire"
    CHECK ("confirmation_date" IS NULL OR "confirmation_date" >= "hire_date"),
  CONSTRAINT "employees_terminated_after_hire"
    CHECK ("termination_date" IS NULL OR "termination_date" >= "hire_date"),
  CONSTRAINT "employees_contract_ends_after_it_starts"
    CHECK ("contract_end" IS NULL OR "contract_start" IS NULL
           OR "contract_end" >= "contract_start"),

  -- Terminated means there is a date on it. Without this the status can say
  -- somebody has left while every report that filters on termination_date
  -- still counts them.
  CONSTRAINT "employees_terminated_has_a_date" CHECK (
    "status" <> 'terminated' OR "termination_date" IS NOT NULL
  ),

  -- "HH:MM", 24-hour. The shift drives lateness and auto-clock-out, and a
  -- malformed value there fails as NaN hours worked rather than as a bad time.
  CONSTRAINT "employees_shift_start_is_a_time"
    CHECK ("shift_start" IS NULL OR "shift_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT "employees_shift_end_is_a_time"
    CHECK ("shift_end" IS NULL OR "shift_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);--> statement-breakpoint

-- Gross is basic plus allowances, everywhere it is asked for. The Mongo
-- virtual computes it on read in five places; here it is one definition and it
-- can be filtered and sorted on.
ALTER TABLE "employees"
  ADD COLUMN "gross_salary" numeric(19,4)
  GENERATED ALWAYS AS (
    "basic_salary" + "allowance_housing" + "allowance_transport"
    + "allowance_medical" + "allowance_other"
  ) STORED;--> statement-breakpoint

-- Sorting and searching a staff list is by name, so the name is a column
-- rather than something the application concatenates after fetching.
ALTER TABLE "employees"
  ADD COLUMN "full_name" text
  GENERATED ALWAYS AS (btrim("first_name" || ' ' || "last_name")) STORED;--> statement-breakpoint

CREATE INDEX "employees_company_status_idx" ON "employees" ("company_id", "status");--> statement-breakpoint
CREATE INDEX "employees_company_department_status_idx"
  ON "employees" ("company_id", "department_id", "status");--> statement-breakpoint
CREATE INDEX "employees_company_name_idx" ON "employees" ("company_id", "full_name");--> statement-breakpoint
CREATE INDEX "employees_party_idx" ON "employees" ("party_id");--> statement-breakpoint
CREATE INDEX "employees_user_idx" ON "employees" ("user_id") WHERE "user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "employees_manager_idx" ON "employees" ("manager_id") WHERE "manager_id" IS NOT NULL;--> statement-breakpoint
-- Contract expiry alerting: "whose contract ends in the next 30 days".
CREATE INDEX "employees_company_contract_end_idx"
  ON "employees" ("company_id", "contract_end")
  WHERE "contract_end" IS NOT NULL;--> statement-breakpoint

-- The department head, now that employees exists.
ALTER TABLE "departments" ADD COLUMN "head_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_fk"
  FOREIGN KEY ("head_employee_id", "company_id")
  REFERENCES "employees"("id", "company_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- No cycles in the org chart.
--
-- Departments nest and so do reporting lines, and both are walked recursively
-- — by the org chart, and by any "everyone under this manager" query. A cycle
-- turns that walk into an infinite loop. The source has no check at all.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assert_no_department_cycle() RETURNS trigger AS $$
DECLARE
  cursor_id uuid := NEW.parent_department_id;
  hops int := 0;
BEGIN
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION
        'Department % cannot report to one of its own sub-departments', NEW.name
        USING ERRCODE = 'check_violation';
    END IF;
    hops := hops + 1;
    IF hops > 64 THEN
      RAISE EXCEPTION 'Department hierarchy is deeper than 64 levels'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_department_id INTO cursor_id FROM departments WHERE id = cursor_id;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER departments_no_cycle
BEFORE INSERT OR UPDATE OF "parent_department_id" ON "departments"
FOR EACH ROW WHEN (NEW.parent_department_id IS NOT NULL)
EXECUTE FUNCTION assert_no_department_cycle();--> statement-breakpoint

CREATE OR REPLACE FUNCTION assert_no_manager_cycle() RETURNS trigger AS $$
DECLARE
  cursor_id uuid := NEW.manager_id;
  hops int := 0;
BEGIN
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION
        '% cannot report to somebody who reports to them',
        btrim(NEW.first_name || ' ' || NEW.last_name)
        USING ERRCODE = 'check_violation';
    END IF;
    hops := hops + 1;
    IF hops > 64 THEN
      RAISE EXCEPTION 'Reporting line is deeper than 64 levels'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT manager_id INTO cursor_id FROM employees WHERE id = cursor_id;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER employees_no_manager_cycle
BEFORE INSERT OR UPDATE OF "manager_id" ON "employees"
FOR EACH ROW WHEN (NEW.manager_id IS NOT NULL)
EXECUTE FUNCTION assert_no_manager_cycle();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The party follows the employee. Decision 1, enforced.
--
-- `parties` carries name, employee_number, department and designation for an
-- employee, and screens outside HR read them directly. Rather than drop those
-- columns — the party form can still create an employee party on a plan
-- without HR — the HR record is made authoritative and the copy is maintained
-- HERE. There is one writer, it cannot be forgotten, and it runs inside the
-- caller's transaction, so the two rows are never briefly out of step.
--
-- `parties.department` is the department's NAME, so a rename has to reach the
-- party rows too: see sync_parties_on_department_rename() below.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_party_from_employee() RETURNS trigger AS $$
DECLARE
  v_department text;
BEGIN
  SELECT d.name INTO v_department FROM departments d WHERE d.id = NEW.department_id;

  UPDATE parties p
     SET name            = btrim(NEW.first_name || ' ' || NEW.last_name),
         employee_number = NEW.employee_number,
         department      = v_department,
         designation     = NEW.designation,
         is_employee     = true,
         updated_at      = now()
   WHERE p.id = NEW.party_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER employees_sync_party
AFTER INSERT OR UPDATE OF
  "first_name", "last_name", "employee_number", "department_id", "designation"
ON "employees"
FOR EACH ROW EXECUTE FUNCTION sync_party_from_employee();--> statement-breakpoint

CREATE OR REPLACE FUNCTION sync_parties_on_department_rename() RETURNS trigger AS $$
BEGIN
  UPDATE parties p
     SET department = NEW.name,
         updated_at = now()
    FROM employees e
   WHERE e.department_id = NEW.id
     AND p.id = e.party_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER departments_sync_parties_on_rename
AFTER UPDATE OF "name" ON "departments"
FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name)
EXECUTE FUNCTION sync_parties_on_department_rename();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- EMPLOYMENT EVENTS — hire, confirmation, promotion, transfer, termination.
--
-- The employee row says what is true now; this says how it got there. Mongo
-- copies employeeName and employeeNumber onto every event; both are joined.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "employment_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL,

  "event_type" text NOT NULL,
  "field" text,
  "previous_value" text,
  "new_value" text,
  "effective_date" date NOT NULL DEFAULT CURRENT_DATE,
  "reason" text,

  "changed_by_id" text,
  "changed_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "employment_events_employee_fk"
    FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id") ON DELETE CASCADE,

  CONSTRAINT "employment_events_type_valid" CHECK ("event_type" IN (
    'hire', 'probation_confirmation', 'promotion', 'department_change',
    'designation_change', 'grade_change', 'employment_type_change',
    'status_change', 'termination', 'contract_renewal', 'other'
  ))
);--> statement-breakpoint

CREATE INDEX "employment_events_employee_idx"
  ON "employment_events" ("employee_id", "effective_date" DESC);--> statement-breakpoint
CREATE INDEX "employment_events_company_date_idx"
  ON "employment_events" ("company_id", "effective_date" DESC);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- SALARY CHANGES — what compensation was, and what it became.
--
-- The deltas are GENERATED (§9.3): `basicSalaryChange` and `grossSalaryChange`
-- are stored in Mongo and computed by the one action that writes them, so any
-- other writer produces a record whose delta does not match its own before and
-- after.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "salary_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL,

  "previous_basic" numeric(19,4) NOT NULL DEFAULT 0,
  "previous_housing" numeric(19,4) NOT NULL DEFAULT 0,
  "previous_transport" numeric(19,4) NOT NULL DEFAULT 0,
  "previous_medical" numeric(19,4) NOT NULL DEFAULT 0,
  "previous_other" numeric(19,4) NOT NULL DEFAULT 0,

  "new_basic" numeric(19,4) NOT NULL DEFAULT 0,
  "new_housing" numeric(19,4) NOT NULL DEFAULT 0,
  "new_transport" numeric(19,4) NOT NULL DEFAULT 0,
  "new_medical" numeric(19,4) NOT NULL DEFAULT 0,
  "new_other" numeric(19,4) NOT NULL DEFAULT 0,

  "effective_date" date NOT NULL DEFAULT CURRENT_DATE,
  "reason" text,

  "changed_by_id" text,
  "changed_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "salary_changes_employee_fk"
    FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id") ON DELETE CASCADE,

  CONSTRAINT "salary_changes_not_negative" CHECK (
    "previous_basic" >= 0 AND "previous_housing" >= 0 AND "previous_transport" >= 0
    AND "previous_medical" >= 0 AND "previous_other" >= 0
    AND "new_basic" >= 0 AND "new_housing" >= 0 AND "new_transport" >= 0
    AND "new_medical" >= 0 AND "new_other" >= 0
  )
);--> statement-breakpoint

ALTER TABLE "salary_changes"
  ADD COLUMN "previous_gross" numeric(19,4)
  GENERATED ALWAYS AS (
    "previous_basic" + "previous_housing" + "previous_transport"
    + "previous_medical" + "previous_other"
  ) STORED;--> statement-breakpoint

ALTER TABLE "salary_changes"
  ADD COLUMN "new_gross" numeric(19,4)
  GENERATED ALWAYS AS (
    "new_basic" + "new_housing" + "new_transport" + "new_medical" + "new_other"
  ) STORED;--> statement-breakpoint

ALTER TABLE "salary_changes"
  ADD COLUMN "basic_change" numeric(19,4)
  GENERATED ALWAYS AS ("new_basic" - "previous_basic") STORED;--> statement-breakpoint

ALTER TABLE "salary_changes"
  ADD COLUMN "gross_change" numeric(19,4)
  GENERATED ALWAYS AS (
    ("new_basic" + "new_housing" + "new_transport" + "new_medical" + "new_other")
    - ("previous_basic" + "previous_housing" + "previous_transport"
       + "previous_medical" + "previous_other")
  ) STORED;--> statement-breakpoint

CREATE INDEX "salary_changes_employee_idx"
  ON "salary_changes" ("employee_id", "effective_date" DESC);--> statement-breakpoint
CREATE INDEX "salary_changes_company_date_idx"
  ON "salary_changes" ("company_id", "effective_date" DESC);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- EMPLOYEE DOCUMENTS — decision 4.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "employee_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL,

  "doc_type" text NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "public_id" text,

  -- Which Cloudinary namespace the asset lives in. Deleting with the wrong one
  -- silently does nothing, which is the live bug in deleteEmployeeDocument.
  "resource_type" text NOT NULL DEFAULT 'raw',

  "expiry_date" date,

  "uploaded_by_id" text,
  "uploaded_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "employee_documents_employee_fk"
    FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id") ON DELETE CASCADE,

  CONSTRAINT "employee_documents_resource_type_valid"
    CHECK ("resource_type" IN ('image', 'raw', 'video')),

  CONSTRAINT "employee_documents_type_not_blank" CHECK (btrim("doc_type") <> ''),
  CONSTRAINT "employee_documents_url_not_blank" CHECK (btrim("url") <> '')
);--> statement-breakpoint

CREATE INDEX "employee_documents_employee_idx"
  ON "employee_documents" ("employee_id", "created_at" DESC);--> statement-breakpoint
-- "Whose documents expire soon" — the alert HR actually wants.
CREATE INDEX "employee_documents_company_expiry_idx"
  ON "employee_documents" ("company_id", "expiry_date")
  WHERE "expiry_date" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- PUBLIC HOLIDAYS — decision 5.
--
-- Working days are counted off this in three places: leave day calculation,
-- payroll pro-rata, and the attendance roster. A wrong holiday calendar is a
-- wrong payslip.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "public_holidays" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,

  "name" text NOT NULL,
  "day" integer NOT NULL,
  "month" integer NOT NULL,

  -- Set for a one-off (an election, a gazetted day of mourning); NULL for one
  -- that recurs every year.
  "year" integer,
  "is_recurring" boolean NOT NULL DEFAULT true,

  "created_by_id" text,
  "created_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "public_holidays_name_not_blank" CHECK (btrim("name") <> ''),
  CONSTRAINT "public_holidays_month_valid" CHECK ("month" BETWEEN 1 AND 12),
  CONSTRAINT "public_holidays_day_valid" CHECK ("day" BETWEEN 1 AND 31),

  -- 31 April is not a date. The source accepts it and the day simply never
  -- matches anything.
  CONSTRAINT "public_holidays_day_exists_in_month" CHECK (
    NOT ("month" IN (4, 6, 9, 11) AND "day" = 31)
    AND NOT ("month" = 2 AND "day" > 29)
  ),

  -- Recurring means every year, so a year on it is a contradiction; one-off
  -- means a particular year, so the absence of one makes it unreachable.
  CONSTRAINT "public_holidays_recurrence_matches_year" CHECK (
    ("is_recurring" AND "year" IS NULL)
    OR (NOT "is_recurring" AND "year" IS NOT NULL)
  ),

  CONSTRAINT "public_holidays_year_sane"
    CHECK ("year" IS NULL OR "year" BETWEEN 1900 AND 2200),

  -- One-off holidays: one per company per actual date.
  CONSTRAINT "public_holidays_unique_one_off"
    UNIQUE ("company_id", "year", "month", "day")
);--> statement-breakpoint

-- Recurring ones need their own index: `year` is NULL for all of them, and two
-- NULLs are DISTINCT to a plain UNIQUE — so the constraint above would happily
-- accept Christmas twice, and every working-day count would then be one short.
CREATE UNIQUE INDEX "public_holidays_unique_recurring"
  ON "public_holidays" ("company_id", "month", "day")
  WHERE "is_recurring";--> statement-breakpoint

CREATE INDEX "public_holidays_company_idx" ON "public_holidays" ("company_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The holidays falling inside a window, as actual dates.
--
-- Mongo does this in JavaScript: fetch every holiday for the company, loop the
-- years in the range, build a Set of "YYYY-MM-DD". Three callers each fetch
-- their own copy. Here it is one function the SQL can join against, and
-- counting working days becomes a query rather than a loop.
--
-- 29 February on a non-leap year yields nothing, which is correct: it did not
-- happen that year.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION holiday_dates(p_company_id uuid, p_from date, p_to date)
RETURNS TABLE (holiday_date date, name text) AS $$
  SELECT gen.d, h.name
    FROM public_holidays h
    CROSS JOIN LATERAL (
      SELECT CASE
               -- 29 February exists only in a leap year. CASE short-circuits,
               -- so make_date is never asked for a date that is not real —
               -- it would raise, and take the whole leave calculation with it.
               WHEN h.month = 2 AND h.day = 29
                    AND NOT (y % 4 = 0 AND (y % 100 <> 0 OR y % 400 = 0))
                 THEN NULL
               ELSE make_date(y, h.month, h.day)
             END AS d
        FROM generate_series(
               EXTRACT(YEAR FROM p_from)::int,
               EXTRACT(YEAR FROM p_to)::int
             ) AS y
       WHERE h.is_recurring OR y = h.year
    ) gen
   WHERE h.company_id = p_company_id
     AND gen.d IS NOT NULL
     AND gen.d BETWEEN p_from AND p_to;
$$ LANGUAGE sql STABLE;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Working days between two dates: weekdays that are not public holidays.
--
-- The same count is open-coded three times in the source —
-- hr-leave-actions.calcWorkingDays, hr-payroll-actions.countWorkingDays, and
-- again inside the payroll LWOP loop — each with its own copy of the weekend
-- rule. One definition, and payroll and leave can no longer disagree about how
-- long a month is.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION working_days(p_company_id uuid, p_from date, p_to date)
RETURNS integer AS $$
  WITH hols AS (
    SELECT holiday_date FROM holiday_dates(p_company_id, p_from, p_to)
  )
  SELECT COALESCE(COUNT(*), 0)::int
    FROM generate_series(p_from, p_to, interval '1 day') AS d
   WHERE EXTRACT(ISODOW FROM d) < 6            -- Mon-Fri
     AND d::date NOT IN (SELECT holiday_date FROM hols);
$$ LANGUAGE sql STABLE;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security, same shape as every other tenant-scoped table.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'departments', 'employees', 'employment_events', 'salary_changes',
    'employee_documents', 'public_holidays'
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

GRANT SELECT, INSERT, UPDATE, DELETE ON "departments" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employees" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON "employment_events" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON "salary_changes" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "employee_documents" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "public_holidays" TO app_user;
