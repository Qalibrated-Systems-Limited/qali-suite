-- ============================================================================
-- 0048 — HR: payroll, and the staff loans that are deducted through it.
--
-- Last of four. This is the module's centre of gravity: payroll is usually the
-- largest recurring entry a business posts, and every figure on it descends
-- from a rate in a config and a salary on an employee.
--
-- FIVE CORRECTIONS, all of them defects rather than preferences.
--
-- 1. TOTALS FOLLOW THE PAYSLIPS.
--    payrollRun.totals is twelve stored numbers that hr-payroll-actions.js
--    recomputes by aggregation whenever it remembers to call syncRunTotals().
--    The accrual journal is built FROM those totals, so a run whose entries
--    were edited by any path that skipped the call posts a journal that does
--    not match its own payslips. A trigger owns them here, exactly as it owns
--    quote totals (0041).
--
-- 2. GROSS, DEDUCTIONS AND NET ARE ARITHMETIC.
--    payrollEntry.recalculate() runs in a pre-save hook, so every write that
--    is not a full document save — and generatePayrollEntries uses
--    findOneAndUpdate, which is exactly that — leaves them stale. Generated
--    columns cannot be stale.
--
-- 3. ONE CONFIG GOVERNS ANY GIVEN MONTH.
--    payrollConfig.getForPeriod() finds configs whose range contains the
--    period and takes the first by effectiveFrom. Two overlapping configs is
--    not an error there, it is a silent choice — and which set of PAYE
--    brackets a payslip was computed under becomes unanswerable. An exclusion
--    constraint makes overlap impossible; the same for the brackets inside a
--    config, which currently may overlap or leave a gap that taxes nothing.
--
-- 4. A LOAN'S BALANCE IS ITS UNPAID INSTALMENTS.
--    loan.js stores totalRepaid, totalInterestPaid and outstandingBalance and
--    moves them in recordRepayment(). voidPayrollRun() reverses the journal
--    but NOT the instalments — so voiding an approved payroll leaves every
--    loan in it showing a repayment that was reversed out of the books, and
--    the next run deducts a month that was already deducted. Derived here, and
--    voiding simply returns the instalments to pending.
--
-- 5. THE STATUTORY MINIMUM IS DATA.
--    lib/payroll/kenya-tax.js hard-codes the KES 300 SHIF floor while every
--    other rate comes from the config, so the one number that changes by
--    Gazette notice is the one that needs a deploy.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYROLL CONFIG — statutory rates, effective-dated.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "payroll_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,

  "name" text NOT NULL,
  "effective_from" date NOT NULL,
  /* NULL means "still in force". */
  "effective_to" date,
  "currency" text NOT NULL DEFAULT 'KES',

  -- ── PAYE ────────────────────────────────────────────────────────────────
  /* Monthly amount that reduces PAYE directly. */
  "personal_relief" numeric(19,4) NOT NULL,
  "insurance_relief_rate" numeric(6,4) NOT NULL DEFAULT 0.15,
  "insurance_relief_cap" numeric(19,4) NOT NULL DEFAULT 5000,

  -- ── NSSF ────────────────────────────────────────────────────────────────
  "nssf_tier_i_limit" numeric(19,4) NOT NULL,
  "nssf_tier_ii_limit" numeric(19,4) NOT NULL,
  "nssf_employee_rate" numeric(6,4) NOT NULL,
  "nssf_employer_rate" numeric(6,4) NOT NULL,

  -- ── SHIF (replaced NHIF, October 2024) ──────────────────────────────────
  "shif_rate" numeric(6,4) NOT NULL,
  /* The statutory floor. Hard-coded in the calculator before this. */
  "shif_minimum" numeric(19,4) NOT NULL DEFAULT 300,

  -- ── Affordable Housing Levy ─────────────────────────────────────────────
  "ahl_employee_rate" numeric(6,4) NOT NULL,
  "ahl_employer_rate" numeric(6,4) NOT NULL,

  -- ── GL mapping ──────────────────────────────────────────────────────────
  -- Where each component of the accrual and payment journals lands. Composite
  -- foreign keys, so a mapping can never name another tenant's account.
  "salary_expense_account_id" uuid,
  "employer_nssf_expense_account_id" uuid,
  "employer_ahl_expense_account_id" uuid,
  "salary_payable_account_id" uuid,
  "paye_payable_account_id" uuid,
  "nssf_payable_account_id" uuid,
  "shif_payable_account_id" uuid,
  "ahl_payable_account_id" uuid,
  "bank_account_id" uuid,
  "staff_loans_receivable_account_id" uuid,
  "interest_income_account_id" uuid,

  "notes" text,
  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "payroll_configs_id_company_uq" UNIQUE ("id", "company_id"),

  CONSTRAINT "payroll_configs_salary_expense_fk" FOREIGN KEY
    ("salary_expense_account_id", "company_id") REFERENCES "accounts"("id", "company_id"),
  CONSTRAINT "payroll_configs_employer_nssf_fk" FOREIGN KEY
    ("employer_nssf_expense_account_id", "company_id") REFERENCES "accounts"("id", "company_id"),
  CONSTRAINT "payroll_configs_employer_ahl_fk" FOREIGN KEY
    ("employer_ahl_expense_account_id", "company_id") REFERENCES "accounts"("id", "company_id"),
  CONSTRAINT "payroll_configs_salary_payable_fk" FOREIGN KEY
    ("salary_payable_account_id", "company_id") REFERENCES "accounts"("id", "company_id"),
  CONSTRAINT "payroll_configs_paye_payable_fk" FOREIGN KEY
    ("paye_payable_account_id", "company_id") REFERENCES "accounts"("id", "company_id"),
  CONSTRAINT "payroll_configs_nssf_payable_fk" FOREIGN KEY
    ("nssf_payable_account_id", "company_id") REFERENCES "accounts"("id", "company_id"),
  CONSTRAINT "payroll_configs_shif_payable_fk" FOREIGN KEY
    ("shif_payable_account_id", "company_id") REFERENCES "accounts"("id", "company_id"),
  CONSTRAINT "payroll_configs_ahl_payable_fk" FOREIGN KEY
    ("ahl_payable_account_id", "company_id") REFERENCES "accounts"("id", "company_id"),
  CONSTRAINT "payroll_configs_bank_fk" FOREIGN KEY
    ("bank_account_id", "company_id") REFERENCES "accounts"("id", "company_id"),
  CONSTRAINT "payroll_configs_staff_loans_fk" FOREIGN KEY
    ("staff_loans_receivable_account_id", "company_id") REFERENCES "accounts"("id", "company_id"),
  CONSTRAINT "payroll_configs_interest_income_fk" FOREIGN KEY
    ("interest_income_account_id", "company_id") REFERENCES "accounts"("id", "company_id"),

  CONSTRAINT "payroll_configs_name_not_blank" CHECK (btrim("name") <> ''),
  CONSTRAINT "payroll_configs_period_in_order"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),

  CONSTRAINT "payroll_configs_rates_are_fractions" CHECK (
    "insurance_relief_rate" BETWEEN 0 AND 1
    AND "nssf_employee_rate" BETWEEN 0 AND 1
    AND "nssf_employer_rate" BETWEEN 0 AND 1
    AND "shif_rate" BETWEEN 0 AND 1
    AND "ahl_employee_rate" BETWEEN 0 AND 1
    AND "ahl_employer_rate" BETWEEN 0 AND 1
  ),
  CONSTRAINT "payroll_configs_amounts_not_negative" CHECK (
    "personal_relief" >= 0 AND "insurance_relief_cap" >= 0
    AND "nssf_tier_i_limit" >= 0 AND "nssf_tier_ii_limit" >= 0
    AND "shif_minimum" >= 0
  ),
  /* Tier II is the band ABOVE Tier I. Reversed, NSSF comes out negative. */
  CONSTRAINT "payroll_configs_nssf_tiers_in_order"
    CHECK ("nssf_tier_ii_limit" >= "nssf_tier_i_limit"),

  /*
   * ONE CONFIG PER MOMENT. Correction 3.
   *
   * An open-ended config (effective_to NULL) runs to 'infinity', so a second
   * one cannot be opened without closing the first.
   */
  CONSTRAINT "payroll_configs_no_overlap" EXCLUDE USING gist (
    "company_id" WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  )
);--> statement-breakpoint

CREATE INDEX "payroll_configs_company_from_idx"
  ON "payroll_configs" ("company_id", "effective_from" DESC);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYE BRACKETS — annual taxable income bands.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "paye_brackets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "payroll_config_id" uuid NOT NULL,

  "from_amount" numeric(19,4) NOT NULL,
  /* NULL is the top band: everything above from_amount. */
  "to_amount" numeric(19,4),
  "rate" numeric(6,4) NOT NULL,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "paye_brackets_config_fk"
    FOREIGN KEY ("payroll_config_id", "company_id")
    REFERENCES "payroll_configs"("id", "company_id") ON DELETE CASCADE,

  CONSTRAINT "paye_brackets_bounds_in_order"
    CHECK ("to_amount" IS NULL OR "to_amount" > "from_amount"),
  CONSTRAINT "paye_brackets_from_not_negative" CHECK ("from_amount" >= 0),
  CONSTRAINT "paye_brackets_rate_is_a_fraction" CHECK ("rate" BETWEEN 0 AND 1),

  /*
   * Bands cannot overlap. Two bands covering 288,000 means the tax on that
   * shilling depends on which row the loop reaches first — and the source's
   * schema permits it, with no validation anywhere.
   */
  CONSTRAINT "paye_brackets_no_overlap" EXCLUDE USING gist (
    "payroll_config_id" WITH =,
    numrange("from_amount", "to_amount", '[)') WITH &&
  )
);--> statement-breakpoint

CREATE INDEX "paye_brackets_config_idx"
  ON "paye_brackets" ("payroll_config_id", "from_amount");--> statement-breakpoint

/*
 * The bands must also COVER the income line, with no gap.
 *
 * Overlap is refused above; a gap is the other half, and it is worse — income
 * that falls in one is taxed at nothing at all, silently. Checked when a
 * config is put to use rather than per row, because a set of bands is only
 * complete once every row is in.
 */
CREATE OR REPLACE FUNCTION assert_paye_brackets_cover(p_config_id uuid)
RETURNS void AS $$
DECLARE
  r record;
  expected numeric := 0;
  rows_seen int := 0;
BEGIN
  FOR r IN
    SELECT from_amount, to_amount
      FROM paye_brackets
     WHERE payroll_config_id = p_config_id
     ORDER BY from_amount
  LOOP
    rows_seen := rows_seen + 1;
    IF r.from_amount <> expected THEN
      RAISE EXCEPTION
        'PAYE bands leave a gap: nothing covers income from % to %',
        expected, r.from_amount
        USING ERRCODE = 'check_violation';
    END IF;
    IF r.to_amount IS NULL THEN
      RETURN;  -- open-ended top band: covered to infinity
    END IF;
    expected := r.to_amount;
  END LOOP;

  IF rows_seen = 0 THEN
    RAISE EXCEPTION 'This payroll configuration has no PAYE bands'
      USING ERRCODE = 'check_violation';
  END IF;

  RAISE EXCEPTION
    'PAYE bands stop at %; the highest band must be open-ended', expected
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYROLL RUNS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "payroll_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "payroll_number" text NOT NULL,

  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,
  "period_from" date NOT NULL,
  "period_to" date NOT NULL,

  /* Optional: run payroll for one department only. */
  "department_id" uuid,

  "status" text NOT NULL DEFAULT 'draft',
  "currency" text NOT NULL DEFAULT 'KES',

  /* Which rates this run was computed under. Kept so a historical payslip can
     be explained (§9.4) — the source re-resolves the config on every read. */
  "payroll_config_id" uuid,

  -- ── Totals. Written by recalc_payroll_run() only. Correction 1. ─────────
  "employee_count" integer NOT NULL DEFAULT 0,
  "total_basic" numeric(19,4) NOT NULL DEFAULT 0,
  "total_allowances" numeric(19,4) NOT NULL DEFAULT 0,
  "total_gross" numeric(19,4) NOT NULL DEFAULT 0,
  "total_paye" numeric(19,4) NOT NULL DEFAULT 0,
  "total_nssf" numeric(19,4) NOT NULL DEFAULT 0,
  "total_shif" numeric(19,4) NOT NULL DEFAULT 0,
  "total_housing_levy" numeric(19,4) NOT NULL DEFAULT 0,
  "total_other_deductions" numeric(19,4) NOT NULL DEFAULT 0,
  "total_deductions" numeric(19,4) NOT NULL DEFAULT 0,
  "total_net" numeric(19,4) NOT NULL DEFAULT 0,
  "total_employer_nssf" numeric(19,4) NOT NULL DEFAULT 0,
  "total_employer_ahl" numeric(19,4) NOT NULL DEFAULT 0,

  -- ── Workflow ────────────────────────────────────────────────────────────
  "prepared_at" timestamp with time zone,
  "prepared_by_id" text,
  "prepared_by_name" text,
  "reviewed_at" timestamp with time zone,
  "reviewed_by_id" text,
  "reviewed_by_name" text,
  "approved_at" timestamp with time zone,
  "approved_by_id" text,
  "approved_by_name" text,
  "paid_at" timestamp with time zone,
  "paid_by_id" text,
  "paid_by_name" text,
  "voided_at" timestamp with time zone,
  "voided_by_id" text,
  "voided_by_name" text,
  "void_reason" text,

  "notes" text,
  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "payroll_runs_id_company_uq" UNIQUE ("id", "company_id"),
  CONSTRAINT "payroll_runs_company_number_uq"
    UNIQUE ("company_id", "payroll_number"),

  CONSTRAINT "payroll_runs_department_fk"
    FOREIGN KEY ("department_id", "company_id")
    REFERENCES "departments"("id", "company_id"),
  CONSTRAINT "payroll_runs_config_fk"
    FOREIGN KEY ("payroll_config_id", "company_id")
    REFERENCES "payroll_configs"("id", "company_id"),

  CONSTRAINT "payroll_runs_month_valid" CHECK ("period_month" BETWEEN 1 AND 12),
  CONSTRAINT "payroll_runs_year_valid" CHECK ("period_year" BETWEEN 2000 AND 2200),
  CONSTRAINT "payroll_runs_period_in_order" CHECK ("period_to" >= "period_from"),

  /* 'processing' and 'review' from the source are kept; 'posted' is not — it
     was never reachable, since approve() goes straight to 'approved' and the
     journal posts there. */
  CONSTRAINT "payroll_runs_status_valid" CHECK ("status" IN (
    'draft', 'processing', 'review', 'approved', 'paid', 'voided'
  )),

  /* A void says why. */
  CONSTRAINT "payroll_runs_void_has_a_reason" CHECK (
    "status" <> 'voided' OR btrim(COALESCE("void_reason", '')) <> ''
  )
);--> statement-breakpoint

/*
 * One live run per month. A voided run does not block a replacement, which is
 * the whole point of voiding one.
 */
CREATE UNIQUE INDEX "payroll_runs_one_per_period"
  ON "payroll_runs" ("company_id", "period_year", "period_month")
  WHERE "status" <> 'voided';--> statement-breakpoint

CREATE INDEX "payroll_runs_company_period_idx"
  ON "payroll_runs" ("company_id", "period_year" DESC, "period_month" DESC);--> statement-breakpoint
CREATE INDEX "payroll_runs_company_status_idx"
  ON "payroll_runs" ("company_id", "status");--> statement-breakpoint

/* Which journal entries a run produced. A run posts an accrual on approval and
   a clearing entry on payment, and a reversal for each when voided — so this
   is a list, not a column. */
CREATE TABLE "payroll_run_journals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "payroll_run_id" uuid NOT NULL,
  "journal_entry_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "payroll_run_journals_run_fk"
    FOREIGN KEY ("payroll_run_id", "company_id")
    REFERENCES "payroll_runs"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "payroll_run_journals_entry_fk"
    FOREIGN KEY ("journal_entry_id", "company_id")
    REFERENCES "journal_entries"("id", "company_id"),
  CONSTRAINT "payroll_run_journals_kind_valid"
    CHECK ("kind" IN ('accrual', 'payment', 'reversal')),
  CONSTRAINT "payroll_run_journals_entry_uq" UNIQUE ("journal_entry_id")
);--> statement-breakpoint

CREATE INDEX "payroll_run_journals_run_idx"
  ON "payroll_run_journals" ("payroll_run_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYROLL ENTRIES — one payslip.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "payroll_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "payroll_run_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,

  /*
   * SNAPSHOTS (§9.4). A payslip is a document that was issued: it must still
   * read as it did after a transfer, a promotion or a change of bank. These
   * are what it SAID, not a cache of what is now true.
   */
  "employee_number" text NOT NULL,
  "employee_name" text NOT NULL,
  "department" text,
  "designation" text,
  "employment_type" text,
  "kra_pin" text,
  "nssf_number" text,
  "sha_number" text,
  "bank_name" text,
  "bank_branch" text,
  "bank_account" text,
  "mpesa_number" text,
  "payment_method" text NOT NULL DEFAULT 'bank',

  -- ── Earnings ────────────────────────────────────────────────────────────
  "basic_salary" numeric(19,4) NOT NULL DEFAULT 0,
  "housing_allowance" numeric(19,4) NOT NULL DEFAULT 0,
  "transport_allowance" numeric(19,4) NOT NULL DEFAULT 0,
  "medical_allowance" numeric(19,4) NOT NULL DEFAULT 0,
  "other_allowance" numeric(19,4) NOT NULL DEFAULT 0,
  "overtime_pay" numeric(19,4) NOT NULL DEFAULT 0,
  "bonus" numeric(19,4) NOT NULL DEFAULT 0,
  "commission" numeric(19,4) NOT NULL DEFAULT 0,
  /* Maintained from payroll_entry_lines by trigger. */
  "additional_earnings" numeric(19,4) NOT NULL DEFAULT 0,

  -- ── Deductions ──────────────────────────────────────────────────────────
  "paye" numeric(19,4) NOT NULL DEFAULT 0,
  "nssf" numeric(19,4) NOT NULL DEFAULT 0,
  "shif" numeric(19,4) NOT NULL DEFAULT 0,
  "housing_levy" numeric(19,4) NOT NULL DEFAULT 0,
  /* Shown on the payslip and used in the PAYE working; not itself a deduction
     from pay, so it is NOT part of total_deductions. */
  "insurance_relief" numeric(19,4) NOT NULL DEFAULT 0,
  "loan_repayment" numeric(19,4) NOT NULL DEFAULT 0,
  "sacco_deduction" numeric(19,4) NOT NULL DEFAULT 0,
  "additional_deductions" numeric(19,4) NOT NULL DEFAULT 0,

  -- ── Employer contributions (remitted, not deducted) ─────────────────────
  "employer_nssf" numeric(19,4) NOT NULL DEFAULT 0,
  "employer_housing_levy" numeric(19,4) NOT NULL DEFAULT 0,

  "currency" text NOT NULL DEFAULT 'KES',

  -- ── Pro-rata working ────────────────────────────────────────────────────
  "working_days_total" integer,
  "working_days_worked" integer,
  "unpaid_leave_days" numeric(6,2) NOT NULL DEFAULT 0,

  "payment_status" text NOT NULL DEFAULT 'pending',
  "paid_at" timestamp with time zone,
  "payment_reference" text,

  "notes" text,
  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "payroll_entries_id_company_uq" UNIQUE ("id", "company_id"),
  /* One payslip per person per run. */
  CONSTRAINT "payroll_entries_run_employee_uq"
    UNIQUE ("payroll_run_id", "employee_id"),

  CONSTRAINT "payroll_entries_run_fk"
    FOREIGN KEY ("payroll_run_id", "company_id")
    REFERENCES "payroll_runs"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "payroll_entries_employee_fk"
    FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id"),

  CONSTRAINT "payroll_entries_payment_status_valid"
    CHECK ("payment_status" IN ('pending', 'paid', 'failed', 'on_hold')),
  CONSTRAINT "payroll_entries_payment_method_valid"
    CHECK ("payment_method" IN ('bank', 'mpesa', 'cash')),

  CONSTRAINT "payroll_entries_amounts_not_negative" CHECK (
    "basic_salary" >= 0 AND "housing_allowance" >= 0 AND "transport_allowance" >= 0
    AND "medical_allowance" >= 0 AND "other_allowance" >= 0 AND "overtime_pay" >= 0
    AND "bonus" >= 0 AND "commission" >= 0 AND "additional_earnings" >= 0
    AND "paye" >= 0 AND "nssf" >= 0 AND "shif" >= 0 AND "housing_levy" >= 0
    AND "insurance_relief" >= 0 AND "loan_repayment" >= 0 AND "sacco_deduction" >= 0
    AND "additional_deductions" >= 0 AND "employer_nssf" >= 0
    AND "employer_housing_levy" >= 0
  ),
  CONSTRAINT "payroll_entries_worked_days_within_period" CHECK (
    "working_days_worked" IS NULL OR "working_days_total" IS NULL
    OR ("working_days_worked" >= 0 AND "working_days_worked" <= "working_days_total")
  )
);--> statement-breakpoint

/* Correction 2: arithmetic, not a pre-save hook. */
ALTER TABLE "payroll_entries"
  ADD COLUMN "gross_pay" numeric(19,4)
  GENERATED ALWAYS AS (
    "basic_salary" + "housing_allowance" + "transport_allowance"
    + "medical_allowance" + "other_allowance" + "overtime_pay"
    + "bonus" + "commission" + "additional_earnings"
  ) STORED;--> statement-breakpoint

ALTER TABLE "payroll_entries"
  ADD COLUMN "total_deductions" numeric(19,4)
  GENERATED ALWAYS AS (
    "paye" + "nssf" + "shif" + "housing_levy"
    + "loan_repayment" + "sacco_deduction" + "additional_deductions"
  ) STORED;--> statement-breakpoint

/* Repeated rather than referencing the two above: Postgres will not let one
   generated column read another. */
ALTER TABLE "payroll_entries"
  ADD COLUMN "net_pay" numeric(19,4)
  GENERATED ALWAYS AS (
    ("basic_salary" + "housing_allowance" + "transport_allowance"
     + "medical_allowance" + "other_allowance" + "overtime_pay"
     + "bonus" + "commission" + "additional_earnings")
    - ("paye" + "nssf" + "shif" + "housing_levy"
       + "loan_repayment" + "sacco_deduction" + "additional_deductions")
  ) STORED;--> statement-breakpoint

CREATE INDEX "payroll_entries_run_idx" ON "payroll_entries" ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "payroll_entries_employee_idx"
  ON "payroll_entries" ("employee_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "payroll_entries_run_payment_idx"
  ON "payroll_entries" ("payroll_run_id", "payment_status");--> statement-breakpoint

/* One-off additions and deductions: a bonus line, a uniform charge, a fine.
   The source caps these at ten with a validator; there is no reason to. */
CREATE TABLE "payroll_entry_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "payroll_entry_id" uuid NOT NULL,

  "kind" text NOT NULL,
  "description" text NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  /* Optional: post this line to a specific account instead of the default. */
  "account_id" uuid,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "payroll_entry_lines_entry_fk"
    FOREIGN KEY ("payroll_entry_id", "company_id")
    REFERENCES "payroll_entries"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "payroll_entry_lines_account_fk"
    FOREIGN KEY ("account_id", "company_id")
    REFERENCES "accounts"("id", "company_id"),

  CONSTRAINT "payroll_entry_lines_kind_valid"
    CHECK ("kind" IN ('earning', 'deduction')),
  CONSTRAINT "payroll_entry_lines_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "payroll_entry_lines_description_not_blank"
    CHECK (btrim("description") <> '')
);--> statement-breakpoint

CREATE INDEX "payroll_entry_lines_entry_idx"
  ON "payroll_entry_lines" ("payroll_entry_id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION recalc_payroll_entry_lines() RETURNS trigger AS $$
DECLARE
  target uuid := COALESCE(NEW.payroll_entry_id, OLD.payroll_entry_id);
BEGIN
  UPDATE payroll_entries e
     SET additional_earnings = COALESCE(agg.earnings, 0),
         additional_deductions = COALESCE(agg.deductions, 0),
         updated_at = now()
    FROM (
      SELECT SUM(amount) FILTER (WHERE kind = 'earning')   AS earnings,
             SUM(amount) FILTER (WHERE kind = 'deduction') AS deductions
        FROM payroll_entry_lines
       WHERE payroll_entry_id = target
    ) agg
   WHERE e.id = target;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER recalc_payroll_entry_on_line_change
AFTER INSERT OR UPDATE OR DELETE ON "payroll_entry_lines"
FOR EACH ROW EXECUTE FUNCTION recalc_payroll_entry_lines();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The run's totals follow its payslips. Correction 1.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recalc_payroll_run() RETURNS trigger AS $$
DECLARE
  target uuid := COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);
BEGIN
  UPDATE payroll_runs r
     SET employee_count         = COALESCE(agg.n, 0),
         total_basic            = COALESCE(agg.basic, 0),
         total_allowances       = COALESCE(agg.allowances, 0),
         total_gross            = COALESCE(agg.gross, 0),
         total_paye             = COALESCE(agg.paye, 0),
         total_nssf             = COALESCE(agg.nssf, 0),
         total_shif             = COALESCE(agg.shif, 0),
         total_housing_levy     = COALESCE(agg.levy, 0),
         total_other_deductions = COALESCE(agg.other, 0),
         total_deductions       = COALESCE(agg.deductions, 0),
         total_net              = COALESCE(agg.net, 0),
         total_employer_nssf    = COALESCE(agg.emp_nssf, 0),
         total_employer_ahl     = COALESCE(agg.emp_ahl, 0),
         updated_at             = now()
    FROM (
      SELECT COUNT(*)                    AS n,
             SUM(basic_salary)           AS basic,
             SUM(housing_allowance + transport_allowance
                 + medical_allowance + other_allowance) AS allowances,
             SUM(gross_pay)              AS gross,
             SUM(paye)                   AS paye,
             SUM(nssf)                   AS nssf,
             SUM(shif)                   AS shif,
             SUM(housing_levy)           AS levy,
             SUM(loan_repayment + sacco_deduction + additional_deductions) AS other,
             SUM(total_deductions)       AS deductions,
             SUM(net_pay)                AS net,
             SUM(employer_nssf)          AS emp_nssf,
             SUM(employer_housing_levy)  AS emp_ahl
        FROM payroll_entries
       WHERE payroll_run_id = target
    ) agg
   WHERE r.id = target;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER recalc_payroll_run_on_entry_change
AFTER INSERT OR UPDATE OR DELETE ON "payroll_entries"
FOR EACH ROW EXECUTE FUNCTION recalc_payroll_run();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- STAFF LOANS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "loans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "loan_number" text NOT NULL,

  "employee_id" uuid NOT NULL,
  "loan_type" text NOT NULL,

  "principal_amount" numeric(19,4) NOT NULL,
  "interest_rate" numeric(6,4) NOT NULL DEFAULT 0,
  "interest_type" text NOT NULL DEFAULT 'none',
  "tenure_months" integer NOT NULL,
  "start_month" integer NOT NULL,
  "start_year" integer NOT NULL,

  "status" text NOT NULL DEFAULT 'pending_approval',
  "currency" text NOT NULL DEFAULT 'KES',
  "purpose" text,
  "notes" text,

  "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
  "requested_by_id" text,
  "requested_by_name" text,
  "approved_at" timestamp with time zone,
  "approved_by_id" text,
  "approved_by_name" text,
  "rejected_at" timestamp with time zone,
  "rejected_by_id" text,
  "rejected_by_name" text,
  "rejection_reason" text,
  "disbursed_at" timestamp with time zone,
  "disbursed_by_id" text,
  "disbursed_by_name" text,
  "disbursement_method" text,
  "disbursement_reference" text,
  "cancelled_at" timestamp with time zone,
  "cancelled_by_id" text,
  "cancelled_by_name" text,

  /* Optional overrides; otherwise the payroll config's mapping is used. */
  "staff_loans_account_id" uuid,
  "bank_account_id" uuid,

  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "loans_id_company_uq" UNIQUE ("id", "company_id"),
  CONSTRAINT "loans_company_number_uq" UNIQUE ("company_id", "loan_number"),

  CONSTRAINT "loans_employee_fk"
    FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id"),
  CONSTRAINT "loans_staff_loans_account_fk"
    FOREIGN KEY ("staff_loans_account_id", "company_id")
    REFERENCES "accounts"("id", "company_id"),
  CONSTRAINT "loans_bank_account_fk"
    FOREIGN KEY ("bank_account_id", "company_id")
    REFERENCES "accounts"("id", "company_id"),

  CONSTRAINT "loans_type_valid" CHECK ("loan_type" IN (
    'salary_advance', 'staff_loan', 'sacco_deduction'
  )),
  CONSTRAINT "loans_interest_type_valid" CHECK ("interest_type" IN (
    'none', 'flat', 'reducing_balance'
  )),
  CONSTRAINT "loans_status_valid" CHECK ("status" IN (
    'pending_approval', 'approved', 'disbursed', 'active',
    'fully_repaid', 'rejected', 'cancelled'
  )),
  CONSTRAINT "loans_disbursement_method_valid" CHECK (
    "disbursement_method" IS NULL
    OR "disbursement_method" IN ('bank', 'mpesa', 'cash', 'cheque')
  ),

  CONSTRAINT "loans_principal_positive" CHECK ("principal_amount" > 0),
  CONSTRAINT "loans_rate_is_a_fraction" CHECK ("interest_rate" BETWEEN 0 AND 1),
  CONSTRAINT "loans_tenure_sane" CHECK ("tenure_months" BETWEEN 1 AND 120),
  CONSTRAINT "loans_start_month_valid" CHECK ("start_month" BETWEEN 1 AND 12),
  CONSTRAINT "loans_start_year_valid" CHECK ("start_year" BETWEEN 2000 AND 2200),

  /* Interest without a rate, or a rate without interest, is one of the two
     fields not having been filled in. */
  CONSTRAINT "loans_interest_type_matches_rate" CHECK (
    ("interest_type" = 'none' AND "interest_rate" = 0)
    OR ("interest_type" <> 'none' AND "interest_rate" > 0)
  ),

  CONSTRAINT "loans_rejection_has_a_reason" CHECK (
    "status" <> 'rejected' OR btrim(COALESCE("rejection_reason", '')) <> ''
  )
);--> statement-breakpoint

CREATE INDEX "loans_company_status_idx" ON "loans" ("company_id", "status");--> statement-breakpoint
CREATE INDEX "loans_employee_idx" ON "loans" ("employee_id", "start_year", "start_month");--> statement-breakpoint

CREATE TABLE "loan_installments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "loan_id" uuid NOT NULL,

  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,
  "sequence" integer NOT NULL,

  "principal" numeric(19,4) NOT NULL,
  "interest" numeric(19,4) NOT NULL DEFAULT 0,

  "status" text NOT NULL DEFAULT 'pending',
  "payroll_run_id" uuid,
  "paid_at" timestamp with time zone,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "loan_installments_loan_fk"
    FOREIGN KEY ("loan_id", "company_id")
    REFERENCES "loans"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "loan_installments_run_fk"
    FOREIGN KEY ("payroll_run_id", "company_id")
    REFERENCES "payroll_runs"("id", "company_id"),

  /* One instalment per loan per month. */
  CONSTRAINT "loan_installments_period_uq"
    UNIQUE ("loan_id", "period_year", "period_month"),
  CONSTRAINT "loan_installments_sequence_uq" UNIQUE ("loan_id", "sequence"),

  CONSTRAINT "loan_installments_status_valid"
    CHECK ("status" IN ('pending', 'deducted', 'skipped')),
  CONSTRAINT "loan_installments_month_valid"
    CHECK ("period_month" BETWEEN 1 AND 12),
  CONSTRAINT "loan_installments_amounts_not_negative"
    CHECK ("principal" >= 0 AND "interest" >= 0),
  /* A deducted instalment names the run that deducted it. Without this, a
     repayment can be recorded with nothing to trace it back to. */
  CONSTRAINT "loan_installments_deducted_names_a_run" CHECK (
    "status" <> 'deducted' OR "payroll_run_id" IS NOT NULL
  )
);--> statement-breakpoint

ALTER TABLE "loan_installments"
  ADD COLUMN "total" numeric(19,4)
  GENERATED ALWAYS AS ("principal" + "interest") STORED;--> statement-breakpoint

CREATE INDEX "loan_installments_loan_idx"
  ON "loan_installments" ("loan_id", "period_year", "period_month");--> statement-breakpoint
/* The payroll query: what falls due this month and has not been taken. */
CREATE INDEX "loan_installments_due_idx"
  ON "loan_installments" ("company_id", "period_year", "period_month")
  WHERE "status" = 'pending';--> statement-breakpoint

/*
 * What a loan still owes. Correction 4.
 *
 * Derived from the instalments, so voiding a payroll — which returns them to
 * pending — puts the balance back with nothing to remember.
 */
CREATE VIEW "loan_balances" AS
SELECT l.id            AS loan_id,
       l.company_id,
       l.employee_id,
       l.principal_amount,
       COALESCE(SUM(i.total), 0)::numeric(19,4)      AS scheduled_total,
       COALESCE(SUM(i.principal) FILTER (WHERE i.status = 'deducted'), 0)::numeric(19,4)
         AS principal_repaid,
       COALESCE(SUM(i.interest) FILTER (WHERE i.status = 'deducted'), 0)::numeric(19,4)
         AS interest_paid,
       COALESCE(SUM(i.total) FILTER (WHERE i.status = 'deducted'), 0)::numeric(19,4)
         AS total_repaid,
       COALESCE(SUM(i.total) FILTER (WHERE i.status = 'pending'), 0)::numeric(19,4)
         AS outstanding_balance,
       COUNT(*) FILTER (WHERE i.status = 'pending')::int  AS installments_pending,
       COUNT(*) FILTER (WHERE i.status = 'deducted')::int AS installments_paid,
       MAX(i.total) FILTER (WHERE i.sequence = 1)::numeric(19,4) AS monthly_installment
  FROM loans l
  LEFT JOIN loan_installments i ON i.loan_id = l.id
 GROUP BY l.id, l.company_id, l.employee_id, l.principal_amount;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payroll_configs', 'paye_brackets', 'payroll_runs', 'payroll_run_journals',
    'payroll_entries', 'payroll_entry_lines', 'loans', 'loan_installments'
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

GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_configs" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "paye_brackets" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_runs" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "payroll_run_journals" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_entries" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_entry_lines" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "loans" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "loan_installments" TO app_user;--> statement-breakpoint
GRANT SELECT ON "loan_balances" TO app_user;
