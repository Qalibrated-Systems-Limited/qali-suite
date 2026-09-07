import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";

/**
 * Payroll and staff loans (0048).
 *
 * Run totals are written by `recalc_payroll_run()` and by nothing else; an
 * entry's gross, deductions and net are generated columns; a loan's balance is
 * the `loan_balances` view over its instalments. Every one of those replaces a
 * stored number the application had to remember to refresh.
 */

export const payrollConfigs = pgTable(
  "payroll_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    /** Null means still in force. Ranges cannot overlap — see the migration. */
    effectiveTo: date("effective_to"),
    currency: text("currency").notNull().default("KES"),

    personalRelief: numeric("personal_relief", { precision: 19, scale: 4 }).notNull(),
    insuranceReliefRate: numeric("insurance_relief_rate", { precision: 6, scale: 4 })
      .notNull()
      .default("0.15"),
    insuranceReliefCap: numeric("insurance_relief_cap", { precision: 19, scale: 4 })
      .notNull()
      .default("5000"),

    nssfTierILimit: numeric("nssf_tier_i_limit", { precision: 19, scale: 4 }).notNull(),
    nssfTierIILimit: numeric("nssf_tier_ii_limit", { precision: 19, scale: 4 }).notNull(),
    nssfEmployeeRate: numeric("nssf_employee_rate", { precision: 6, scale: 4 }).notNull(),
    nssfEmployerRate: numeric("nssf_employer_rate", { precision: 6, scale: 4 }).notNull(),

    shifRate: numeric("shif_rate", { precision: 6, scale: 4 }).notNull(),
    /** The statutory floor, which the calculator used to hard-code. */
    shifMinimum: numeric("shif_minimum", { precision: 19, scale: 4 })
      .notNull()
      .default("300"),

    ahlEmployeeRate: numeric("ahl_employee_rate", { precision: 6, scale: 4 }).notNull(),
    ahlEmployerRate: numeric("ahl_employer_rate", { precision: 6, scale: 4 }).notNull(),

    salaryExpenseAccountId: uuid("salary_expense_account_id"),
    employerNssfExpenseAccountId: uuid("employer_nssf_expense_account_id"),
    employerAhlExpenseAccountId: uuid("employer_ahl_expense_account_id"),
    salaryPayableAccountId: uuid("salary_payable_account_id"),
    payePayableAccountId: uuid("paye_payable_account_id"),
    nssfPayableAccountId: uuid("nssf_payable_account_id"),
    shifPayableAccountId: uuid("shif_payable_account_id"),
    ahlPayableAccountId: uuid("ahl_payable_account_id"),
    bankAccountId: uuid("bank_account_id"),
    staffLoansReceivableAccountId: uuid("staff_loans_receivable_account_id"),
    interestIncomeAccountId: uuid("interest_income_account_id"),

    notes: text("notes"),
    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payroll_configs_company_from_idx").on(t.companyId, t.effectiveFrom)],
);

export const payeBrackets = pgTable(
  "paye_brackets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    payrollConfigId: uuid("payroll_config_id").notNull(),

    fromAmount: numeric("from_amount", { precision: 19, scale: 4 }).notNull(),
    /** Null is the top band. Bands may not overlap or leave a gap. */
    toAmount: numeric("to_amount", { precision: 19, scale: 4 }),
    rate: numeric("rate", { precision: 6, scale: 4 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("paye_brackets_config_idx").on(t.payrollConfigId, t.fromAmount)],
);

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    payrollNumber: text("payroll_number").notNull(),

    periodMonth: integer("period_month").notNull(),
    periodYear: integer("period_year").notNull(),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),

    departmentId: uuid("department_id"),
    status: text("status").notNull().default("draft"),
    currency: text("currency").notNull().default("KES"),
    /** Which rates this run was computed under, kept for later explanation. */
    payrollConfigId: uuid("payroll_config_id"),

    // Written by recalc_payroll_run() and by nothing else.
    employeeCount: integer("employee_count").notNull().default(0),
    totalBasic: numeric("total_basic", { precision: 19, scale: 4 }).notNull().default("0"),
    totalAllowances: numeric("total_allowances", { precision: 19, scale: 4 }).notNull().default("0"),
    totalGross: numeric("total_gross", { precision: 19, scale: 4 }).notNull().default("0"),
    totalPaye: numeric("total_paye", { precision: 19, scale: 4 }).notNull().default("0"),
    totalNssf: numeric("total_nssf", { precision: 19, scale: 4 }).notNull().default("0"),
    totalShif: numeric("total_shif", { precision: 19, scale: 4 }).notNull().default("0"),
    totalHousingLevy: numeric("total_housing_levy", { precision: 19, scale: 4 }).notNull().default("0"),
    totalOtherDeductions: numeric("total_other_deductions", { precision: 19, scale: 4 }).notNull().default("0"),
    totalDeductions: numeric("total_deductions", { precision: 19, scale: 4 }).notNull().default("0"),
    totalNet: numeric("total_net", { precision: 19, scale: 4 }).notNull().default("0"),
    totalEmployerNssf: numeric("total_employer_nssf", { precision: 19, scale: 4 }).notNull().default("0"),
    totalEmployerAhl: numeric("total_employer_ahl", { precision: 19, scale: 4 }).notNull().default("0"),

    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    preparedById: text("prepared_by_id"),
    preparedByName: text("prepared_by_name"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedById: text("reviewed_by_id"),
    reviewedByName: text("reviewed_by_name"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: text("approved_by_id"),
    approvedByName: text("approved_by_name"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidById: text("paid_by_id"),
    paidByName: text("paid_by_name"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedById: text("voided_by_id"),
    voidedByName: text("voided_by_name"),
    voidReason: text("void_reason"),

    notes: text("notes"),
    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payroll_runs_company_number_uq").on(t.companyId, t.payrollNumber),
    index("payroll_runs_company_period_idx").on(t.companyId, t.periodYear, t.periodMonth),
  ],
);

export const payrollRunJournals = pgTable(
  "payroll_run_journals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    payrollRunId: uuid("payroll_run_id").notNull(),
    journalEntryId: uuid("journal_entry_id").notNull(),
    /**
     * `reallocation` is 0090's: an entry that moves labour between projects
     * after the accrual posted, debiting and crediting the SAME account so it
     * nets to zero. A void must not mistake one for an accrual.
     */
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payroll_run_journals_run_idx").on(t.payrollRunId),
    /**
     * Declared here as well as in the DDL. It was in 0048 and NOT in this
     * file, so the constraint was invisible to anybody reading the schema —
     * which is how 0090 came to be written believing no migration was needed.
     */
    check(
      "payroll_run_journals_kind_valid",
      sql`${t.kind} IN ('accrual', 'payment', 'reversal', 'reallocation')`,
    ),
  ],
);

export const payrollEntries = pgTable(
  "payroll_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    payrollRunId: uuid("payroll_run_id").notNull(),
    employeeId: uuid("employee_id").notNull(),

    // Snapshots: a payslip must still read as it did when it was issued.
    employeeNumber: text("employee_number").notNull(),
    employeeName: text("employee_name").notNull(),
    department: text("department"),
    designation: text("designation"),
    employmentType: text("employment_type"),
    kraPin: text("kra_pin"),
    nssfNumber: text("nssf_number"),
    shaNumber: text("sha_number"),
    bankName: text("bank_name"),
    bankBranch: text("bank_branch"),
    bankAccount: text("bank_account"),
    mpesaNumber: text("mpesa_number"),
    paymentMethod: text("payment_method").notNull().default("bank"),

    basicSalary: numeric("basic_salary", { precision: 19, scale: 4 }).notNull().default("0"),
    housingAllowance: numeric("housing_allowance", { precision: 19, scale: 4 }).notNull().default("0"),
    transportAllowance: numeric("transport_allowance", { precision: 19, scale: 4 }).notNull().default("0"),
    medicalAllowance: numeric("medical_allowance", { precision: 19, scale: 4 }).notNull().default("0"),
    otherAllowance: numeric("other_allowance", { precision: 19, scale: 4 }).notNull().default("0"),
    overtimePay: numeric("overtime_pay", { precision: 19, scale: 4 }).notNull().default("0"),
    bonus: numeric("bonus", { precision: 19, scale: 4 }).notNull().default("0"),
    commission: numeric("commission", { precision: 19, scale: 4 }).notNull().default("0"),
    /** Maintained from payroll_entry_lines by trigger. */
    additionalEarnings: numeric("additional_earnings", { precision: 19, scale: 4 }).notNull().default("0"),

    paye: numeric("paye", { precision: 19, scale: 4 }).notNull().default("0"),
    nssf: numeric("nssf", { precision: 19, scale: 4 }).notNull().default("0"),
    shif: numeric("shif", { precision: 19, scale: 4 }).notNull().default("0"),
    housingLevy: numeric("housing_levy", { precision: 19, scale: 4 }).notNull().default("0"),
    /** Shown on the payslip; part of the PAYE working, not a deduction from pay. */
    insuranceRelief: numeric("insurance_relief", { precision: 19, scale: 4 }).notNull().default("0"),
    loanRepayment: numeric("loan_repayment", { precision: 19, scale: 4 }).notNull().default("0"),
    saccoDeduction: numeric("sacco_deduction", { precision: 19, scale: 4 }).notNull().default("0"),
    additionalDeductions: numeric("additional_deductions", { precision: 19, scale: 4 }).notNull().default("0"),

    employerNssf: numeric("employer_nssf", { precision: 19, scale: 4 }).notNull().default("0"),
    employerHousingLevy: numeric("employer_housing_levy", { precision: 19, scale: 4 }).notNull().default("0"),

    /** GENERATED. */
    grossPay: numeric("gross_pay", { precision: 19, scale: 4 }),
    totalDeductions: numeric("total_deductions", { precision: 19, scale: 4 }),
    netPay: numeric("net_pay", { precision: 19, scale: 4 }),

    currency: text("currency").notNull().default("KES"),

    workingDaysTotal: integer("working_days_total"),
    workingDaysWorked: integer("working_days_worked"),
    unpaidLeaveDays: numeric("unpaid_leave_days", { precision: 6, scale: 2 }).notNull().default("0"),

    paymentStatus: text("payment_status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentReference: text("payment_reference"),

    notes: text("notes"),
    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payroll_entries_run_employee_uq").on(t.payrollRunId, t.employeeId),
    index("payroll_entries_run_idx").on(t.payrollRunId),
    index("payroll_entries_employee_idx").on(t.employeeId),
  ],
);

export const payrollEntryLines = pgTable(
  "payroll_entry_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    payrollEntryId: uuid("payroll_entry_id").notNull(),

    kind: text("kind").notNull(),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    accountId: uuid("account_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payroll_entry_lines_entry_idx").on(t.payrollEntryId)],
);

export const loans = pgTable(
  "loans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    loanNumber: text("loan_number").notNull(),

    employeeId: uuid("employee_id").notNull(),
    loanType: text("loan_type").notNull(),

    principalAmount: numeric("principal_amount", { precision: 19, scale: 4 }).notNull(),
    interestRate: numeric("interest_rate", { precision: 6, scale: 4 }).notNull().default("0"),
    interestType: text("interest_type").notNull().default("none"),
    tenureMonths: integer("tenure_months").notNull(),
    startMonth: integer("start_month").notNull(),
    startYear: integer("start_year").notNull(),

    status: text("status").notNull().default("pending_approval"),
    currency: text("currency").notNull().default("KES"),
    purpose: text("purpose"),
    notes: text("notes"),

    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    requestedById: text("requested_by_id"),
    requestedByName: text("requested_by_name"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: text("approved_by_id"),
    approvedByName: text("approved_by_name"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedById: text("rejected_by_id"),
    rejectedByName: text("rejected_by_name"),
    rejectionReason: text("rejection_reason"),
    disbursedAt: timestamp("disbursed_at", { withTimezone: true }),
    disbursedById: text("disbursed_by_id"),
    disbursedByName: text("disbursed_by_name"),
    disbursementMethod: text("disbursement_method"),
    disbursementReference: text("disbursement_reference"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledById: text("cancelled_by_id"),
    cancelledByName: text("cancelled_by_name"),

    staffLoansAccountId: uuid("staff_loans_account_id"),
    bankAccountId: uuid("bank_account_id"),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("loans_company_number_uq").on(t.companyId, t.loanNumber),
    index("loans_company_status_idx").on(t.companyId, t.status),
    index("loans_employee_idx").on(t.employeeId),
  ],
);

export const loanInstallments = pgTable(
  "loan_installments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    loanId: uuid("loan_id").notNull(),

    periodMonth: integer("period_month").notNull(),
    periodYear: integer("period_year").notNull(),
    sequence: integer("sequence").notNull(),

    principal: numeric("principal", { precision: 19, scale: 4 }).notNull(),
    interest: numeric("interest", { precision: 19, scale: 4 }).notNull().default("0"),
    /** GENERATED: principal + interest. */
    total: numeric("total", { precision: 19, scale: 4 }),

    status: text("status").notNull().default("pending"),
    payrollRunId: uuid("payroll_run_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("loan_installments_period_uq").on(t.loanId, t.periodYear, t.periodMonth),
    index("loan_installments_loan_idx").on(t.loanId, t.periodYear, t.periodMonth),
  ],
);
