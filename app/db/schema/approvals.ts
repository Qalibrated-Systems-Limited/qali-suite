import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import {
  approvalTypeEnum,
  approvalStatusEnum,
  approvalTargetKindEnum,
} from "./enums";

/**
 * The approval engine — 0101.
 *
 * The last cross-cutting Mongo module, and the only one that genuinely worked:
 * a Postgres action raised a MONGO request, the page read Mongo, and approving
 * it applied back into Postgres. What that cost is that Postgres money paths
 * could not run without a Mongo connection — `requestApprovalIfOverThreshold`
 * is awaited inside the expense and payment actions, so an expense over the
 * threshold did not skip its approval, it THREW.
 *
 * Only the request document is here. Every applier already reaches into
 * Postgres and has since its own module ported.
 */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    requestNumber: text("request_number").notNull(),
    type: approvalTypeEnum("type").notNull(),
    status: approvalStatusEnum("status").notNull().default("submitted"),

    /**
     * TEXT, and deliberately. A request points at a Product, an adjustment, a
     * payment, an expense or a credit note — across two stores — so this is a
     * uuid or a 24-character ObjectId. The Mongo schema typed it ObjectId and
     * threw a CastError on every approval raised against a Postgres row.
     */
    targetKind: approvalTargetKindEnum("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    targetLabel: text("target_label"),

    payload: jsonb("payload").notNull().default({}),
    context: jsonb("context").notNull().default({}),

    reason: text("reason").notNull().default(""),
    requesterNote: text("requester_note").notNull().default(""),

    /** Frozen at submission, so widening the matrix cannot reopen a request. */
    requiredApproverRoles: text("required_approver_roles")
      .array()
      .notNull()
      .default([]),

    submittedById: text("submitted_by_id").notNull(),
    submittedByName: text("submitted_by_name").notNull(),
    submittedByRole: text("submitted_by_role"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Set together or not at all — `approval_requests_decision_pair`. */
    decisionAction: approvalStatusEnum("decision_action"),
    decidedById: text("decided_by_id"),
    decidedByName: text("decided_by_name"),
    decidedByRole: text("decided_by_role"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),

    appliedAt: timestamp("applied_at", { withTimezone: true }),
    appliedKind: text("applied_kind"),
    appliedId: text("applied_id"),

    /* The chain (stock_changes_pass_three_approvers_who_tick_every_line). */
    currentStep: integer("current_step").notNull().default(1),
    totalSteps: integer("total_steps").notNull().default(1),
    currentStepLabel: text("current_step_label").notNull().default(""),
    currentStepRoles: text("current_step_roles").array().notNull().default([]),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("approval_requests_company_number_uq").on(
      t.companyId,
      t.requestNumber,
    ),
    index("approval_requests_queue_idx").on(
      t.companyId,
      t.status,
      t.createdAt.desc(),
    ),
    index("approval_requests_type_idx").on(t.companyId, t.type, t.status),
    index("approval_requests_submitter_idx").on(
      t.companyId,
      t.submittedById,
      t.status,
    ),
    index("approval_requests_target_idx").on(
      t.companyId,
      t.targetKind,
      t.targetId,
    ),
  ],
);

/** One approver's signature on one step, with the lines they ticked. */
export const approvalStepDecisions = pgTable(
  "approval_step_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    approvalId: uuid("approval_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
    stepNo: integer("step_no").notNull(),
    stepLabel: text("step_label").notNull(),
    decidedById: text("decided_by_id").notNull(),
    decidedByName: text("decided_by_name").notNull(),
    decidedByRole: text("decided_by_role"),
    note: text("note").notNull().default(""),
    confirmedLines: jsonb("confirmed_lines").notNull().default([]),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("approval_step_decisions_step_idx").on(t.approvalId, t.stepNo),
    uniqueIndex("approval_step_decisions_one_signature_idx").on(t.approvalId, t.decidedById),
  ],
);

/** A company's own chain for an approval type. No rows: the defaults. */
export const approvalStepPolicies = pgTable(
  "approval_step_policies",
  {
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    stepNo: integer("step_no").notNull(),
    label: text("label").notNull(),
    roles: text("roles").array().notNull(),
    updatedByName: text("updated_by_name").notNull().default("System"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.type, t.stepNo] })],
);
