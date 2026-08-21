import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  date,
  timestamp,
  index,
  uniqueIndex,
  check,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { users } from "./users";

/**
 * HR: departments, employees, and the record of how each got to be what it is.
 *
 * Migration 0045 carries the reasoning; the short version is that `employees`
 * owns the employment relationship while `parties` keeps the financial
 * identity the ledger references, and the overlap between them is maintained
 * by a trigger rather than by the four hand-written sync blocks in
 * app/mongodb/actions/hr-employee-actions.js.
 *
 * Composite foreign keys — (id, company_id) — are declared in SQL, not here:
 * drizzle's `references()` is single-column. The tables below are the read and
 * write surface; the invariants live in the migration.
 */

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),

    parentDepartmentId: uuid("parent_department_id"),
    /** Where this department's payroll lands. Code and name are joined. */
    costCenterAccountId: uuid("cost_center_account_id"),
    headEmployeeId: uuid("head_employee_id"),

    isActive: boolean("is_active").notNull().default(true),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("departments_company_code_uq").on(t.companyId, t.code),
    unique("departments_company_name_uq").on(t.companyId, t.name),
    index("departments_company_active_name_idx").on(
      t.companyId,
      t.isActive,
      t.name,
    ),
  ],
);

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    /** The financial identity. Payroll, claims and journals reference this. */
    partyId: uuid("party_id").notNull(),
    /** The login, if there is one. Text because users.id is text (0036). */
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    employeeNumber: text("employee_number").notNull(),

    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"),
    nationalId: text("national_id"),
    kraPin: text("kra_pin"),
    nssfNumber: text("nssf_number"),
    /** Social Health Authority — replaced NHIF in October 2024. */
    shaNumber: text("sha_number"),
    passportNumber: text("passport_number"),
    nationality: text("nationality").notNull().default("Kenyan"),
    photoUrl: text("photo_url"),
    photoPublicId: text("photo_public_id"),

    departmentId: uuid("department_id"),
    designation: text("designation"),
    employmentType: text("employment_type").notNull().default("full_time"),
    status: text("status").notNull().default("probation"),

    hireDate: date("hire_date").notNull(),
    confirmationDate: date("confirmation_date"),
    terminationDate: date("termination_date"),
    terminationReason: text("termination_reason"),

    contractStart: date("contract_start"),
    contractEnd: date("contract_end"),
    contractType: text("contract_type"),

    /** Another employee of this company, not a bare party. */
    managerId: uuid("manager_id"),
    workLocation: text("work_location"),
    jobGrade: text("job_grade"),

    /** "HH:MM". Null means the company's shift applies. */
    shiftStart: text("shift_start"),
    shiftEnd: text("shift_end"),

    basicSalary: numeric("basic_salary", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    currency: text("currency").notNull().default("KES"),
    allowanceHousing: numeric("allowance_housing", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    allowanceTransport: numeric("allowance_transport", {
      precision: 19,
      scale: 4,
    })
      .notNull()
      .default("0"),
    allowanceMedical: numeric("allowance_medical", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    allowanceOther: numeric("allowance_other", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    /** GENERATED: basic + every allowance. */
    grossSalary: numeric("gross_salary", { precision: 19, scale: 4 }),

    paymentMethod: text("payment_method").notNull().default("bank"),
    bankName: text("bank_name"),
    bankAccount: text("bank_account"),
    bankBranch: text("bank_branch"),
    mpesaNumber: text("mpesa_number"),

    lastReviewDate: date("last_review_date"),
    lastReviewedById: text("last_reviewed_by_id"),
    lastReviewedByName: text("last_reviewed_by_name"),

    emergencyName: text("emergency_name"),
    emergencyRelationship: text("emergency_relationship"),
    emergencyPhone: text("emergency_phone"),
    emergencyAlternatePhone: text("emergency_alternate_phone"),

    notes: text("notes"),

    /** GENERATED: "First Last". Sorted and searched on. */
    fullName: text("full_name"),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("employees_company_party_uq").on(t.companyId, t.partyId),
    unique("employees_company_user_uq").on(t.companyId, t.userId),
    unique("employees_company_number_uq").on(t.companyId, t.employeeNumber),
    index("employees_company_status_idx").on(t.companyId, t.status),
    index("employees_company_department_status_idx").on(
      t.companyId,
      t.departmentId,
      t.status,
    ),
    index("employees_company_name_idx").on(t.companyId, t.fullName),
  ],
);

/** How the employee row came to say what it says. */
export const employmentEvents = pgTable(
  "employment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull(),

    eventType: text("event_type").notNull(),
    field: text("field"),
    previousValue: text("previous_value"),
    newValue: text("new_value"),
    effectiveDate: date("effective_date").notNull(),
    reason: text("reason"),

    changedById: text("changed_by_id"),
    changedByName: text("changed_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("employment_events_employee_idx").on(t.employeeId, t.effectiveDate),
  ],
);

/**
 * Compensation before and after. The deltas and both grosses are GENERATED —
 * a stored delta beside the numbers that define it is a second source of truth
 * for the same fact (§9.3).
 */
export const salaryChanges = pgTable(
  "salary_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull(),

    previousBasic: numeric("previous_basic", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    previousHousing: numeric("previous_housing", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    previousTransport: numeric("previous_transport", {
      precision: 19,
      scale: 4,
    })
      .notNull()
      .default("0"),
    previousMedical: numeric("previous_medical", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    previousOther: numeric("previous_other", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),

    newBasic: numeric("new_basic", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    newHousing: numeric("new_housing", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    newTransport: numeric("new_transport", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    newMedical: numeric("new_medical", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    newOther: numeric("new_other", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),

    previousGross: numeric("previous_gross", { precision: 19, scale: 4 }),
    newGross: numeric("new_gross", { precision: 19, scale: 4 }),
    basicChange: numeric("basic_change", { precision: 19, scale: 4 }),
    grossChange: numeric("gross_change", { precision: 19, scale: 4 }),

    effectiveDate: date("effective_date").notNull(),
    reason: text("reason"),

    changedById: text("changed_by_id"),
    changedByName: text("changed_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("salary_changes_employee_idx").on(t.employeeId, t.effectiveDate),
  ],
);

/**
 * Contracts, IDs, certificates.
 *
 * A table rather than the source's 50-item embedded array, and it carries
 * `resourceType` — Cloudinary needs it to delete, and the Mongo action always
 * passes "raw", so every image ever "deleted" is still stored and billable.
 */
export const employeeDocuments = pgTable(
  "employee_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull(),

    docType: text("doc_type").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    publicId: text("public_id"),
    resourceType: text("resource_type").notNull().default("raw"),
    expiryDate: date("expiry_date"),

    uploadedById: text("uploaded_by_id"),
    uploadedByName: text("uploaded_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("employee_documents_employee_idx").on(t.employeeId)],
);

/**
 * The company's holiday calendar. Leave days, payroll working days and the
 * attendance roster are all counted off it, so a wrong entry is a wrong
 * payslip. `holiday_dates()` and `working_days()` in 0045 read it.
 */
export const publicHolidays = pgTable(
  "public_holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    day: integer("day").notNull(),
    month: integer("month").notNull(),
    /** Set for a one-off; null for one that recurs every year. */
    year: integer("year"),
    isRecurring: boolean("is_recurring").notNull().default(true),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("public_holidays_company_idx").on(t.companyId)],
);
