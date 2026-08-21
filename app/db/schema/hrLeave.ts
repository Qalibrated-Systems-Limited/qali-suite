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
  unique,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";

/**
 * Leave (0046).
 *
 * Only the GRANT is stored. Days taken and days pending are questions about
 * `leave_requests`, answered by the `leave_balances` view — see the migration
 * for why the source's four $inc counters could not stay right.
 */

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),

    defaultEntitlement: numeric("default_entitlement", { precision: 6, scale: 2 })
      .notNull()
      .default("0"),
    maxCarryOver: numeric("max_carry_over", { precision: 6, scale: 2 })
      .notNull()
      .default("0"),

    isPaid: boolean("is_paid").notNull().default(true),
    /** Whether taking it consumes an entitlement. Replaces `code !== "unpaid"`. */
    affectsBalance: boolean("affects_balance").notNull().default(true),
    requiresDocument: boolean("requires_document").notNull().default(false),
    applicableGender: text("applicable_gender").notNull().default("all"),

    isActive: boolean("is_active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("leave_types_company_code_uq").on(t.companyId, t.code),
    index("leave_types_company_active_idx").on(t.companyId, t.isActive, t.sortOrder),
  ],
);

export const leaveEntitlements = pgTable(
  "leave_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull(),
    leaveTypeId: uuid("leave_type_id").notNull(),
    year: integer("year").notNull(),

    entitledDays: numeric("entitled_days", { precision: 6, scale: 2 })
      .notNull()
      .default("0"),
    carryOverDays: numeric("carry_over_days", { precision: 6, scale: 2 })
      .notNull()
      .default("0"),
    /** Days paid out instead of taken. */
    encashedDays: numeric("encashed_days", { precision: 6, scale: 2 })
      .notNull()
      .default("0"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("leave_entitlements_uq").on(
      t.companyId,
      t.employeeId,
      t.leaveTypeId,
      t.year,
    ),
    index("leave_entitlements_employee_year_idx").on(t.employeeId, t.year),
  ],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    leaveNumber: text("leave_number").notNull(),

    employeeId: uuid("employee_id").notNull(),
    leaveTypeId: uuid("leave_type_id").notNull(),

    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    /** Working days, counted at request time and kept — it is what was agreed. */
    totalDays: numeric("total_days", { precision: 6, scale: 2 }).notNull(),

    isHalfDay: boolean("is_half_day").notNull().default(false),
    halfDayPeriod: text("half_day_period"),

    reason: text("reason"),
    notes: text("notes"),

    handoverEmployeeId: uuid("handover_employee_id"),
    handoverNotes: text("handover_notes"),

    status: text("status").notNull().default("draft"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedById: text("submitted_by_id"),
    submittedByName: text("submitted_by_name"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: text("approved_by_id"),
    approvedByName: text("approved_by_name"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedById: text("rejected_by_id"),
    rejectedByName: text("rejected_by_name"),
    rejectionReason: text("rejection_reason"),
    recalledAt: timestamp("recalled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledById: text("cancelled_by_id"),
    cancelledByName: text("cancelled_by_name"),
    cancellationReason: text("cancellation_reason"),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("leave_requests_company_number_uq").on(t.companyId, t.leaveNumber),
    index("leave_requests_company_status_idx").on(t.companyId, t.status, t.fromDate),
    index("leave_requests_employee_idx").on(t.employeeId, t.fromDate),
  ],
);

export const leaveAttachments = pgTable(
  "leave_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    leaveRequestId: uuid("leave_request_id").notNull(),

    name: text("name").notNull(),
    url: text("url").notNull(),
    publicId: text("public_id"),
    resourceType: text("resource_type").notNull().default("raw"),

    uploadedById: text("uploaded_by_id"),
    uploadedByName: text("uploaded_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leave_attachments_request_idx").on(t.leaveRequestId)],
);
