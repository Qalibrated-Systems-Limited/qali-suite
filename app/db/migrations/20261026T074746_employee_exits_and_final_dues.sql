-- ============================================================================
-- EMPLOYEE EXITS AND FINAL DUES
--
-- Termination was one button: it set the status and the date and stopped. What
-- a Kenyan employer owes on the way out was nowhere:
--
--   * PAY UP TO THE LAST DAY. Payroll selects only active, probation, on-leave
--     and suspended staff, so a terminated employee drops out of the run for
--     the month they leave, and the days they worked that month are paid by
--     nothing.
--   * NOTICE (s.35/36), UNTAKEN LEAVE (s.28) and, on a redundancy, SEVERANCE
--     of at least fifteen days' pay per completed year (s.40(1)(g)).
--   * THE CERTIFICATE OF SERVICE (s.51), which the employer must issue.
--   * A CLEARANCE: property returned, access revoked, advances settled, before
--     the dues are released.
--
-- An exit is that whole case. It is prepared as a draft (clearance and dues
-- both editable), APPROVED (dues frozen, the employment ends, the accrual
-- posts, loan instalments are recovered), then PAID (the payment posts).
--
-- The dues lines are stored rather than derived. They are a statement given to
-- a person and posted to the ledger, and must read the same next year whatever
-- happens to the salary, the leave or the loans they were computed from.
-- ============================================================================

CREATE TABLE "employee_exits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "exit_number" text NOT NULL,
  "employee_id" uuid NOT NULL,

  "exit_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',

  /* The day notice was given, by either side. NULL: none was given. */
  "notice_date" date,
  "last_working_date" date NOT NULL,
  /* s.35(1)(c): 28 days for a monthly-paid contract unless it says more. */
  "notice_period_days" integer NOT NULL DEFAULT 28,
  /* A resignation without full notice may be charged for the shortfall
     (s.36). Off unless HR decides to. */
  "recover_notice_shortfall" boolean NOT NULL DEFAULT false,
  /* NULL means derived: monthly gross / 30. */
  "daily_rate" numeric(19,4),
  /* NULL means derived from the annual leave balance. */
  "leave_days_override" numeric(9,2),

  /* Internal. Never printed on the certificate of service. */
  "reason" text,
  "exit_interview_notes" text,

  /* Snapshot at approval; zero while a draft. */
  "gross_earnings" numeric(19,4) NOT NULL DEFAULT 0,
  "paye" numeric(19,4) NOT NULL DEFAULT 0,
  "nssf" numeric(19,4) NOT NULL DEFAULT 0,
  "shif" numeric(19,4) NOT NULL DEFAULT 0,
  "housing_levy" numeric(19,4) NOT NULL DEFAULT 0,
  "employer_nssf" numeric(19,4) NOT NULL DEFAULT 0,
  "employer_housing_levy" numeric(19,4) NOT NULL DEFAULT 0,
  "other_deductions" numeric(19,4) NOT NULL DEFAULT 0,
  "net_pay" numeric(19,4) NOT NULL DEFAULT 0,

  "accrual_journal_entry_id" uuid,
  "payment_journal_entry_id" uuid,
  "payment_reference" text,

  "approved_at" timestamp with time zone,
  "approved_by_id" text,
  "approved_by_name" text,
  "paid_at" timestamp with time zone,
  "paid_by_id" text,
  "paid_by_name" text,
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

  CONSTRAINT "employee_exits_id_company_uq" UNIQUE ("id", "company_id"),
  CONSTRAINT "employee_exits_company_number_uq" UNIQUE ("company_id", "exit_number"),
  CONSTRAINT "employee_exits_employee_fk"
    FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "employee_exits_accrual_fk"
    FOREIGN KEY ("accrual_journal_entry_id", "company_id")
    REFERENCES "journal_entries"("id", "company_id"),
  CONSTRAINT "employee_exits_payment_fk"
    FOREIGN KEY ("payment_journal_entry_id", "company_id")
    REFERENCES "journal_entries"("id", "company_id"),

  CONSTRAINT "employee_exits_type_valid" CHECK ("exit_type" IN (
    'resignation', 'termination', 'summary_dismissal', 'redundancy',
    'retirement', 'contract_end', 'death', 'mutual_separation'
  )),
  CONSTRAINT "employee_exits_status_valid"
    CHECK ("status" IN ('draft', 'approved', 'paid', 'cancelled')),
  CONSTRAINT "employee_exits_notice_before_exit"
    CHECK ("notice_date" IS NULL OR "notice_date" <= "last_working_date"),
  CONSTRAINT "employee_exits_notice_period_sane"
    CHECK ("notice_period_days" BETWEEN 0 AND 365),
  CONSTRAINT "employee_exits_daily_rate_positive"
    CHECK ("daily_rate" IS NULL OR "daily_rate" > 0),
  CONSTRAINT "employee_exits_net_not_negative" CHECK ("net_pay" >= 0),
  /* Approved means posted. Paid means both entries. */
  CONSTRAINT "employee_exits_approved_has_accrual" CHECK (
    "status" NOT IN ('approved', 'paid') OR "accrual_journal_entry_id" IS NOT NULL
  ),
  /* A net of nil is settled with nothing to pay. */
  CONSTRAINT "employee_exits_paid_has_payment" CHECK (
    "status" <> 'paid' OR "payment_journal_entry_id" IS NOT NULL OR "net_pay" = 0
  ),
  CONSTRAINT "employee_exits_cancel_has_reason" CHECK (
    "status" <> 'cancelled' OR "cancellation_reason" IS NOT NULL
  )
);--> statement-breakpoint

/* One live exit per employee: a second would pay the same dues twice. */
CREATE UNIQUE INDEX "employee_exits_one_live_per_employee"
  ON "employee_exits" ("employee_id") WHERE "status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "employee_exits_company_status_idx"
  ON "employee_exits" ("company_id", "status", "last_working_date" DESC);--> statement-breakpoint

CREATE TABLE "employee_exit_clearance_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "exit_id" uuid NOT NULL,
  "area" text NOT NULL,
  "item" text NOT NULL,
  /* Set when the item is a company asset in the employee's custody. */
  "asset_id" uuid REFERENCES "assets"("id") ON DELETE SET NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'pending',
  "note" text,
  "cleared_at" timestamp with time zone,
  "cleared_by_id" text,
  "cleared_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "employee_exit_clearance_exit_fk"
    FOREIGN KEY ("exit_id", "company_id")
    REFERENCES "employee_exits"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "employee_exit_clearance_status_valid"
    CHECK ("status" IN ('pending', 'cleared', 'waived')),
  CONSTRAINT "employee_exit_clearance_item_not_blank"
    CHECK (length(btrim("item")) > 0 AND length(btrim("area")) > 0),
  /* Waiving an item is a decision somebody has to explain. */
  CONSTRAINT "employee_exit_clearance_waiver_explained"
    CHECK ("status" <> 'waived' OR length(btrim(coalesce("note", ''))) > 0),
  CONSTRAINT "employee_exit_clearance_cleared_is_signed"
    CHECK ("status" = 'pending' OR "cleared_at" IS NOT NULL)
);--> statement-breakpoint

CREATE INDEX "employee_exit_clearance_exit_idx"
  ON "employee_exit_clearance_items" ("exit_id", "sort_order");--> statement-breakpoint

CREATE TABLE "employee_exit_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "exit_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "code" text NOT NULL,
  "description" text NOT NULL,
  /* Days, for the lines that are days times a rate; NULL otherwise. */
  "quantity" numeric(9,2),
  "rate" numeric(19,4),
  "amount" numeric(19,4) NOT NULL,
  /* Subject to PAYE. */
  "taxable" boolean NOT NULL DEFAULT true,
  /* Pay that NSSF, SHIF and the housing levy are charged on. Severance is
     compensation for the job, not pay for work, and is not. */
  "pensionable" boolean NOT NULL DEFAULT true,
  /* A manual deduction says where it is credited; computed lines use the
     payroll mapping. */
  "account_id" uuid,
  "is_manual" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "employee_exit_lines_exit_fk"
    FOREIGN KEY ("exit_id", "company_id")
    REFERENCES "employee_exits"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "employee_exit_lines_account_fk"
    FOREIGN KEY ("account_id", "company_id")
    REFERENCES "accounts"("id", "company_id"),
  CONSTRAINT "employee_exit_lines_kind_valid"
    CHECK ("kind" IN ('earning', 'deduction')),
  CONSTRAINT "employee_exit_lines_code_valid" CHECK ("code" IN (
    'unpaid_salary', 'notice_pay', 'leave_pay', 'severance',
    'overpaid_salary', 'notice_recovery', 'leave_recovery', 'loan_recovery',
    'manual'
  )),
  CONSTRAINT "employee_exit_lines_amount_not_negative" CHECK ("amount" >= 0),
  CONSTRAINT "employee_exit_lines_description_not_blank"
    CHECK (length(btrim("description")) > 0),
  CONSTRAINT "employee_exit_lines_manual_deduction_has_account" CHECK (
    NOT ("is_manual" AND "kind" = 'deduction') OR "account_id" IS NOT NULL
  )
);--> statement-breakpoint

CREATE INDEX "employee_exit_lines_exit_idx"
  ON "employee_exit_lines" ("exit_id", "sort_order");--> statement-breakpoint

/*
 * Once approved, the statement is what was posted. Its lines cannot change,
 * from any path, because the journal entry would no longer match it.
 */
CREATE OR REPLACE FUNCTION employee_exit_lines_frozen() RETURNS trigger AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM employee_exits
   WHERE id = COALESCE(NEW.exit_id, OLD.exit_id);
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'This exit is % and its final dues can no longer be changed.', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "employee_exit_lines_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "employee_exit_lines"
  FOR EACH ROW EXECUTE FUNCTION employee_exit_lines_frozen();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A loan instalment can be settled from final dues as well as by a payroll run.
-- The existing rule — a deducted instalment names what deducted it — keeps its
-- point and widens to name either.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "loan_installments" ADD COLUMN "exit_id" uuid;--> statement-breakpoint
ALTER TABLE "loan_installments"
  ADD CONSTRAINT "loan_installments_exit_fk"
  FOREIGN KEY ("exit_id", "company_id")
  REFERENCES "employee_exits"("id", "company_id");--> statement-breakpoint
ALTER TABLE "loan_installments"
  DROP CONSTRAINT "loan_installments_deducted_names_a_run";--> statement-breakpoint
ALTER TABLE "loan_installments"
  ADD CONSTRAINT "loan_installments_deducted_names_a_run" CHECK (
    "status" <> 'deducted' OR "payroll_run_id" IS NOT NULL OR "exit_id" IS NOT NULL
  );--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employee_exits', 'employee_exit_clearance_items', 'employee_exit_lines'
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

GRANT SELECT, INSERT, UPDATE ON "employee_exits" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_exit_clearance_items" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_exit_lines" TO app_user;
