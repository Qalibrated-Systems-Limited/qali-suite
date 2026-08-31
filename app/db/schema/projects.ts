/**
 * Projects — 0070.
 *
 * The cost dimension, and only that. `docs/PROJECTS-QALITRACK-PLAN.md` argues
 * that a general-ERP project (cost centre, budget, profitability) and a
 * construction contract administration system are two products that share a
 * project record and almost nothing else. This is the first; `contracts` — the
 * registers, the notices, the IPCs, retention — is the second and is not here.
 *
 * THERE ARE NO CACHED FINANCIALS. `financials.{totalRevenue,totalCosts,
 * totalCommitted}` were three stored numbers on the Mongo document maintained
 * by an `$inc` helper that no module has ever called, so they have read zero
 * since the module shipped. Revenue, cost and commitment are computed from the
 * documents by `getProjectFinancialSummaryPg`. See migration 0070, decision 1.
 *
 * AND THERE IS NO STORED BUDGET TOTAL. `project_budgets` has no `total_amount`
 * and approving a budget writes nothing back to `projects.budget_amount` — the
 * lines are the total, and `budget_amount` stays the advisory figure the create
 * form collects. The repository reads whichever exists. Decision 5.
 */
import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  date,
  timestamp,
  index,
  uniqueIndex,
  check,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { parties } from "./parties";
import { users } from "./users";
import { accounts } from "./accounts";
import {
  projectStatusEnum,
  projectPriorityEnum,
  projectBillingModelEnum,
  projectBudgetStatusEnum,
  projectAssignmentStatusEnum,
  projectRateUnitEnum,
  projectPartyTypeEnum,
  projectTaskStatusEnum,
  projectBoqStatusEnum,
} from "./enums";

/** `ltree` has no Drizzle builder. Declared as `categories` declares it. */
const ltree = customType<{ data: string }>({
  dataType() {
    return "ltree";
  },
});

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    /** PRJ-00001, from `next_entry_number` — see 0070 for what was dropped. */
    projectNumber: text("project_number").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),

    clientPartyId: uuid("client_party_id").references(() => parties.id, {
      onDelete: "set null",
    }),
    clientName: text("client_name"),
    clientEmail: text("client_email"),

    projectManagerUserId: text("project_manager_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    projectManagerName: text("project_manager_name"),

    /**
     * `set null`, never cascade: deleting a parent must not take its
     * children's costs with it. Cycles are refused by a trigger, because a
     * CHECK cannot see past one row.
     */
    parentProjectId: uuid("parent_project_id"),

    billingModel: projectBillingModelEnum("billing_model"),
    contractValue: money("contract_value"),

    /** Typed in by hand until there is measured work to derive it from. */
    progressPercent: integer("progress_percent").notNull().default(0),

    status: projectStatusEnum("status").notNull().default("planning"),
    priority: projectPriorityEnum("priority").notNull().default("normal"),

    startDate: date("start_date"),
    endDate: date("end_date"),
    /** Stamped by the status trigger on the way out of `active`. */
    actualEndDate: date("actual_end_date"),

    /** Advisory: the module warns at 90% and never blocks. */
    budgetAmount: money("budget_amount").notNull().default("0"),
    budgetCurrency: text("budget_currency").notNull().default("KES"),

    tags: text("tags").array().notNull().default(sql`'{}'`),

    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name").notNull().default("System"),
    lastModifiedById: text("last_modified_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_company_number_idx").on(t.companyId, t.projectNumber),
    index("projects_company_status_idx").on(t.companyId, t.status, t.createdAt),
    index("projects_company_client_idx").on(t.companyId, t.clientPartyId),
    index("projects_company_manager_idx").on(
      t.companyId,
      t.projectManagerUserId,
    ),
    index("projects_company_parent_idx")
      .on(t.companyId, t.parentProjectId)
      .where(sql`${t.parentProjectId} IS NOT NULL`),

    check("projects_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check(
      "projects_progress_in_range",
      sql`${t.progressPercent} BETWEEN 0 AND 100`,
    ),
    check(
      "projects_amounts_non_negative",
      sql`${t.budgetAmount} >= 0 AND (${t.contractValue} IS NULL OR ${t.contractValue} >= 0)`,
    ),
    /** An id with no name beside it is a link nothing can render. */
    check(
      "projects_client_pair",
      sql`${t.clientPartyId} IS NULL OR length(btrim(COALESCE(${t.clientName}, ''))) > 0`,
    ),
    check(
      "projects_manager_pair",
      sql`${t.projectManagerUserId} IS NULL OR length(btrim(COALESCE(${t.projectManagerName}, ''))) > 0`,
    ),
    check(
      "projects_actual_end_needs_an_end",
      sql`${t.actualEndDate} IS NULL OR ${t.status} IN ('completed', 'closed')`,
    ),
    check(
      "projects_dates_ordered",
      sql`${t.startDate} IS NULL OR ${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`,
    ),
    check(
      "projects_not_own_parent",
      sql`${t.parentProjectId} IS NULL OR ${t.parentProjectId} <> ${t.id}`,
    ),
  ],
);

export const projectBudgets = pgTable(
  "project_budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: projectBudgetStatusEnum("status").notNull().default("draft"),

    approvedById: text("approved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedByName: text("approved_by_name"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    revisionNotes: text("revision_notes").notNull().default(""),

    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name").notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("project_budgets_version_idx").on(t.projectId, t.version),
    /** One approved budget per project, as an index rather than a read-then-write. */
    uniqueIndex("project_budgets_one_approved")
      .on(t.projectId)
      .where(sql`${t.status} = 'approved'`),
    index("project_budgets_company_project_idx").on(
      t.companyId,
      t.projectId,
      t.version,
    ),

    check("project_budgets_version_positive", sql`${t.version} >= 1`),
    /** A superseded budget was approved and keeps its stamp — so: draft. */
    check(
      "project_budgets_approval_pair",
      sql`(${t.status} = 'draft') = (${t.approvedAt} IS NULL)`,
    ),
    check(
      "project_budgets_approver_pair",
      sql`(${t.approvedAt} IS NULL) = (length(btrim(COALESCE(${t.approvedByName}, ''))) = 0)`,
    ),
  ],
);

export const projectCostCodes = pgTable(
  "project_cost_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /**
     * What this code charges — 0073.
     *
     * A cost code is the vocabulary the budget-holder works in; the account is
     * the mapping finance owns. Procore, Candy, Odoo, Intacct and SAP all draw
     * the line in the same place, and this schema had the codes since 0070
     * without ever saying where they land.
     *
     * SEVERAL CODES MAY SHARE ONE ACCOUNT — "Labour, site" and "Labour,
     * office" both charging 6200 Wages is normal. What they may not do is both
     * appear on one budget: budget-versus-actual matches by account, so two
     * lines on one account each show the full spend.
     *
     * `project_cost_code_charges_an_expense` refuses anything that is not a
     * postable expense account.
     */
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    /** NULL = available to every project in the company. */
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    isActive: boolean("is_active").notNull().default(true),

    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name").notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * TWO indexes, because NULLs are distinct in a Postgres unique index and
     * Mongo's single `{ companyId, code, projectId }` therefore does not
     * translate — it would let a company hold ten codes all called `LAB`.
     */
    uniqueIndex("project_cost_codes_company_code_idx")
      .on(t.companyId, t.code)
      .where(sql`${t.projectId} IS NULL`),
    uniqueIndex("project_cost_codes_project_code_idx")
      .on(t.companyId, t.projectId, t.code)
      .where(sql`${t.projectId} IS NOT NULL`),
    index("project_cost_codes_active_idx").on(t.companyId, t.isActive),
    index("project_cost_codes_account_idx").on(t.companyId, t.accountId),

    check("project_cost_codes_code_not_blank", sql`length(btrim(${t.code})) > 0`),
    check("project_cost_codes_name_not_blank", sql`length(btrim(${t.name})) > 0`),
  ],
);

export const projectBudgetLines = pgTable(
  "project_budget_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => projectBudgets.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),

    /**
     * What the budget-holder picked — 0073. The account below is DERIVED from
     * it by `project_budget_lines_derive_account`, so a caller supplies a cost
     * code and cannot supply an account that disagrees with it.
     */
    costCodeId: uuid("cost_code_id")
      .notNull()
      .references(() => projectCostCodes.id, { onDelete: "restrict" }),

    /**
     * WRITTEN BY THE TRIGGER, not by the application. It stays on the line
     * because budget-versus-actual matches actuals by account — claims, bills
     * and expenses all post to one — and because a budget signed against an
     * account should still name that account after finance re-maps the code.
     */
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    /** Also trigger-written: what the account was called when it was signed. */
    accountCodeAtBudget: text("account_code_at_budget").notNull().default(""),
    accountNameAtBudget: text("account_name_at_budget").notNull().default(""),

    description: text("description").notNull().default(""),
    amount: money("amount").notNull(),
  },
  (t) => [
    uniqueIndex("project_budget_lines_number_idx").on(t.budgetId, t.lineNumber),
    /**
     * Budget-vs-actual reads the actual per ACCOUNT, so a second line on the
     * same account would display the same spend twice and the project would
     * look twice as far over budget as it is.
     */
    uniqueIndex("project_budget_lines_one_per_account").on(
      t.budgetId,
      t.accountId,
    ),
    /** And once per code, which is the rule in the budget-holder's own terms. */
    uniqueIndex("project_budget_lines_one_per_cost_code").on(
      t.budgetId,
      t.costCodeId,
    ),
    check("project_budget_lines_amount_non_negative", sql`${t.amount} >= 0`),
  ],
);

/**
 * The labour roster — who is on a project, without needing the HR module.
 *
 * Assigning somebody posts nothing. Cost arrives when they are paid, through
 * an expense or a bill carrying this project, which is why the rate here is
 * nullable planning metadata and has no ledger meaning.
 */
export const projectAssignments = pgTable(
  "project_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "restrict" }),
    partyName: text("party_name").notNull(),
    partyType: projectPartyTypeEnum("party_type").notNull().default("employee"),

    role: text("role").notNull().default(""),

    rateAmount: money("rate_amount"),
    rateUnit: projectRateUnitEnum("rate_unit"),

    status: projectAssignmentStatusEnum("status").notNull().default("active"),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    assignedById: text("assigned_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedByName: text("assigned_by_name"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** Re-assigning reactivates the row; it does not add a second one. */
    uniqueIndex("project_assignments_party_once").on(t.projectId, t.partyId),
    index("project_assignments_roster_idx").on(
      t.companyId,
      t.projectId,
      t.status,
    ),
    index("project_assignments_party_idx").on(
      t.companyId,
      t.partyId,
      t.status,
    ),

    /** An amount with no unit is not a rate. */
    check(
      "project_assignments_rate_pair",
      sql`(${t.rateAmount} IS NULL) = (${t.rateUnit} IS NULL)`,
    ),
    check(
      "project_assignments_rate_non_negative",
      sql`${t.rateAmount} IS NULL OR ${t.rateAmount} >= 0`,
    ),
    check(
      "project_assignments_removal_pair",
      sql`(${t.status} = 'removed') = (${t.removedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * The work breakdown — 0071.
 *
 * The end of `projects.progress_percent` being the answer. That column stays
 * exactly as it was and becomes the FALLBACK: a project with no tasks reports
 * what somebody typed, and a project with tasks reports the weighted roll-up
 * of its leaves. Procore, Candy and MS Project all derive it; a typed
 * percentage is how a project reports 90% complete for four months.
 *
 * NOTHING HERE IS A STORED ROLL-UP. The parent's progress is computed on read
 * from `leaf.path <@ task.path` — same reasoning as the budget total (0070
 * decision 5) and the cached financials (decision 1). This codebase has three
 * stored aggregates in its history and all three were wrong.
 *
 * NO `actualHours` COLUMN, though the MD's template lists one. Actual hours
 * are the sum of a task's timesheets, and timesheets are step 4 — storing the
 * total now is storing a number with no writer, which is the `financials`
 * mistake again. `estimatedHours` stays: a plan is typed.
 */
export const projectTasks = pgTable(
  "project_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    /**
     * `restrict`, never cascade: deleting a summary task must not silently
     * take the work underneath it. The composite
     * `project_tasks_parent_same_project_fk` (0071) additionally ties a
     * subtask to its parent's project — a WBS spanning two projects makes both
     * roll-ups wrong at once.
     */
    parentTaskId: uuid("parent_task_id"),

    /**
     * Trigger-maintained ltree of ids. NEVER ASSIGN THIS — `project_tasks_
     * path_before` overwrites whatever is supplied, and `..._path_after` moves
     * the descendants with it.
     */
    path: ltree("path").notNull().default(sql`''::ltree`),
    /** GENERATED from `nlevel(path) - 1`. A root task is 0. */
    depth: integer("depth").generatedAlwaysAs(sql`nlevel(path) - 1`),

    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: projectTaskStatusEnum("status").notNull().default("todo"),

    /**
     * A party, not a user: the roster and the task list should name the same
     * people, and a subcontractor doing the work has no login.
     */
    assignedPartyId: uuid("assigned_party_id").references(() => parties.id, {
      onDelete: "set null",
    }),
    assignedName: text("assigned_name"),

    plannedStart: date("planned_start"),
    plannedEnd: date("planned_end"),
    actualStart: date("actual_start"),
    actualEnd: date("actual_end"),

    estimatedHours: numeric("estimated_hours", { precision: 12, scale: 2, mode: "string" }),
    /**
     * How much this task counts for. NULL means "use estimated hours, then an
     * equal share". Never zero — a zero-weight task is invisible to the
     * average while still appearing on the page.
     */
    weight: numeric("weight", { precision: 12, scale: 4, mode: "string" }),
    /** LEAVES ONLY. A summary task takes its number from its subtasks. */
    progressPercent: integer("progress_percent").notNull().default(0),

    costCodeId: uuid("cost_code_id").references(() => projectCostCodes.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").notNull().default(0),

    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name").notNull().default("System"),
    lastModifiedById: text("last_modified_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("project_tasks_id_project_uq").on(t.id, t.projectId),
    index("project_tasks_project_idx").on(t.companyId, t.projectId, t.sortOrder),
    index("project_tasks_parent_idx")
      .on(t.parentTaskId)
      .where(sql`${t.parentTaskId} IS NOT NULL`),
    index("project_tasks_assignee_idx")
      .on(t.companyId, t.assignedPartyId, t.status)
      .where(sql`${t.assignedPartyId} IS NOT NULL`),

    check("project_tasks_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check(
      "project_tasks_progress_in_range",
      sql`${t.progressPercent} BETWEEN 0 AND 100`,
    ),
    check(
      "project_tasks_hours_non_negative",
      sql`${t.estimatedHours} IS NULL OR ${t.estimatedHours} >= 0`,
    ),
    check(
      "project_tasks_weight_positive",
      sql`${t.weight} IS NULL OR ${t.weight} > 0`,
    ),
    check(
      "project_tasks_planned_dates_ordered",
      sql`${t.plannedStart} IS NULL OR ${t.plannedEnd} IS NULL OR ${t.plannedEnd} >= ${t.plannedStart}`,
    ),
    check(
      "project_tasks_actual_dates_ordered",
      sql`${t.actualStart} IS NULL OR ${t.actualEnd} IS NULL OR ${t.actualEnd} >= ${t.actualStart}`,
    ),
    check(
      "project_tasks_assignee_pair",
      sql`${t.assignedPartyId} IS NULL OR length(btrim(COALESCE(${t.assignedName}, ''))) > 0`,
    ),
    /** Both directions. See the enum's note. */
    check(
      "project_tasks_done_is_complete",
      sql`${t.status} = 'cancelled' OR (${t.status} = 'done') = (${t.progressPercent} = 100)`,
    ),
    check(
      "project_tasks_todo_has_not_started",
      sql`${t.status} <> 'todo' OR (${t.progressPercent} = 0 AND ${t.actualStart} IS NULL)`,
    ),
    check(
      "project_tasks_finished_has_ended",
      sql`${t.actualEnd} IS NULL OR ${t.status} IN ('done', 'cancelled')`,
    ),
    check(
      "project_tasks_not_own_parent",
      sql`${t.parentTaskId} IS NULL OR ${t.parentTaskId} <> ${t.id}`,
    ),
  ],
);

/**
 * The bill header — 0076. Versioned, one awarded at a time.
 *
 * §8 of `docs/PROJECTS-QALITRACK-PLAN.md` described two tables; building it
 * showed the bill-level facts have nowhere to live in the items. The precedent
 * is in this same file: `projectBudgets` / `projectBudgetLines`, versioned, one
 * live at a time, lines frozen once signed. A bill of quantities is that shape
 * with quantities.
 */
export const projectBoqs = pgTable(
  "project_boqs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    version: integer("version").notNull().default(1),
    status: projectBoqStatusEnum("status").notNull().default("draft"),

    /**
     * CESMM4, SMM7, POMI, a national standard, or nothing. TEXT, never an
     * enum: this is multi-tenant, the standards are not interchangeable, and
     * whichever one our own bills use would look like the obvious default.
     * The form offers a list; the column takes what the contract says.
     */
    methodOfMeasurement: text("method_of_measurement"),
    currency: text("currency").notNull().default("KES"),
    notes: text("notes").notNull().default(""),

    awardedById: text("awarded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    awardedByName: text("awarded_by_name"),
    awardedAt: timestamp("awarded_at", { withTimezone: true }),

    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name").notNull().default("System"),
    lastModifiedById: text("last_modified_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("project_boqs_version_uq").on(t.projectId, t.version),
    /** The partial unique index, not a check-then-write. See 0070 decision 3. */
    uniqueIndex("project_boqs_one_awarded")
      .on(t.projectId)
      .where(sql`${t.status} = 'awarded'`),
    uniqueIndex("project_boqs_id_project_uq").on(t.id, t.projectId),
    index("project_boqs_project_idx").on(t.companyId, t.projectId, t.status),

    check("project_boqs_version_positive", sql`${t.version} > 0`),
    /**
     * Against `draft`, not against `awarded`: a SUPERSEDED bill was awarded
     * once and keeps its stamp. Same reasoning as `project_budgets`.
     */
    check(
      "project_boqs_draft_is_unawarded",
      sql`(${t.status} = 'draft') = (${t.awardedAt} IS NULL)`,
    ),
    check(
      "project_boqs_award_pair",
      sql`(${t.awardedAt} IS NULL) = (length(btrim(COALESCE(${t.awardedByName}, ''))) = 0)`,
    ),
  ],
);

/**
 * The bill itself — an ltree tree, like `categories` (0062) and `projectTasks`
 * (0071). A bill of quantities is numbered hierarchically and the figures a QS
 * reads are the section totals, which are roll-ups of the leaves.
 *
 * ONLY A LEAF IS PRICED (0076 decision 4). A section takes its amount from what
 * is under it; `project_boq_items_leaf_owns_quantity` refuses a rate on a row
 * with sub-items, and `project_boq_items_refuse_child_of_priced` refuses the
 * other direction rather than silently discarding a contractual figure.
 *
 * QUANTITY TO DATE IS NOT HERE. It is the sum of
 * `projectBoqMeasurements.quantity`, computed on read — decision 2, and the
 * same rule as every other roll-up in this module.
 */
export const projectBoqItems = pgTable(
  "project_boq_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    boqId: uuid("boq_id")
      .notNull()
      .references(() => projectBoqs.id, { onDelete: "cascade" }),
    /** Denormalised from the header, so the composite key to a task can say
     *  "the same project" without a join. */
    projectId: uuid("project_id").notNull(),

    /** `restrict`. Deleting a section must not take the items priced under it. */
    parentItemId: uuid("parent_item_id"),

    /** Trigger-maintained. NEVER ASSIGN THIS. */
    path: ltree("path").notNull().default(sql`''::ltree`),
    depth: integer("depth").generatedAlwaysAs(sql`nlevel(path) - 1`),

    /** The reference as printed — "B.2.14". Nullable: a narrative line has none. */
    itemCode: text("item_code"),
    description: text("description").notNull(),
    isHeading: boolean("is_heading").notNull().default(false),

    /** Free text — see `methodOfMeasurement`. m, m2, m3, kg, t, no, sum, item. */
    unit: text("unit"),
    quantity: numeric("quantity", { precision: 19, scale: 4, mode: "string" }),
    rate: money("rate"),
    /** GENERATED from quantity × rate. Arithmetic is the database's job. */
    amount: money("amount").generatedAlwaysAs(
      sql`(quantity * rate)::numeric(19,4)`,
    ),

    costCodeId: uuid("cost_code_id").references(() => projectCostCodes.id, {
      onDelete: "set null",
    }),
    /**
     * The programme activity this item measures. Optional, and the composite
     * `project_boq_items_task_same_project_fk` keeps it in the same project —
     * NULL skips the check under MATCH SIMPLE, which is what makes it optional.
     */
    taskId: uuid("task_id"),

    sortOrder: integer("sort_order").notNull().default(0),

    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name").notNull().default("System"),
    lastModifiedById: text("last_modified_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("project_boq_items_id_boq_uq").on(t.id, t.boqId),
    /** Partial: two items numbered B.2.14 make every reference ambiguous, and
     *  an unnumbered narrative line is legitimate. */
    uniqueIndex("project_boq_items_code_uq")
      .on(t.boqId, t.itemCode)
      .where(sql`${t.itemCode} IS NOT NULL`),
    index("project_boq_items_boq_idx").on(t.companyId, t.boqId, t.sortOrder),
    index("project_boq_items_parent_idx")
      .on(t.parentItemId)
      .where(sql`${t.parentItemId} IS NOT NULL`),
    index("project_boq_items_task_idx")
      .on(t.taskId)
      .where(sql`${t.taskId} IS NOT NULL`),
    index("project_boq_items_cost_code_idx")
      .on(t.costCodeId)
      .where(sql`${t.costCodeId} IS NOT NULL`),

    check(
      "project_boq_items_description_not_blank",
      sql`length(btrim(${t.description})) > 0`,
    ),
    check(
      "project_boq_items_code_not_blank",
      sql`${t.itemCode} IS NULL OR length(btrim(${t.itemCode})) > 0`,
    ),
    check(
      "project_boq_items_heading_is_unpriced",
      sql`NOT ${t.isHeading} OR (${t.unit} IS NULL AND ${t.quantity} IS NULL AND ${t.rate} IS NULL)`,
    ),
    /** Both-or-neither, written as a conditional on the quantity. */
    check(
      "project_boq_items_quantity_needs_unit",
      sql`${t.quantity} IS NULL OR length(btrim(COALESCE(${t.unit}, ''))) > 0`,
    ),
    check(
      "project_boq_items_quantity_non_negative",
      sql`${t.quantity} IS NULL OR ${t.quantity} >= 0`,
    ),
    check(
      "project_boq_items_rate_non_negative",
      sql`${t.rate} IS NULL OR ${t.rate} >= 0`,
    ),
    check(
      "project_boq_items_rate_needs_quantity",
      sql`${t.rate} IS NULL OR ${t.quantity} IS NOT NULL`,
    ),
    check(
      "project_boq_items_not_own_parent",
      sql`${t.parentItemId} IS NULL OR ${t.parentItemId} <> ${t.id}`,
    ),
  ],
);

/**
 * One row per measurement event — 0076 decision 2. NEVER a running total.
 *
 * The quantity measured to date is `SUM(quantity)` over these rows. Last
 * month's over-measure is corrected by a NEGATIVE row rather than by editing
 * what was certified, which is how the trade fixes a certificate it has
 * already issued.
 *
 * There is no `certificateId` yet, deliberately: certificates are step 5, and a
 * column with no writer is the cached `financials` that 0070 spent a migration
 * undoing.
 */
export const projectBoqMeasurements = pgTable(
  "project_boq_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    boqItemId: uuid("boq_item_id")
      .notNull()
      .references(() => projectBoqItems.id, { onDelete: "cascade" }),

    measuredOn: date("measured_on").notNull().default(sql`CURRENT_DATE`),
    /** Signed, and never zero. Over-measure is information, not an error. */
    quantity: numeric("quantity", { precision: 19, scale: 4, mode: "string" }).notNull(),

    /**
     * Chainage, grid reference, sheet number, level — what makes a remeasure
     * checkable two years later, which is when a final account is argued.
     */
    reference: text("reference").notNull().default(""),
    notes: text("notes").notNull().default(""),

    measuredById: text("measured_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    measuredByName: text("measured_by_name").notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("project_boq_measurements_item_idx").on(t.boqItemId, t.measuredOn),
    index("project_boq_measurements_company_idx").on(t.companyId, t.measuredOn),
    check("project_boq_measurements_quantity_not_zero", sql`${t.quantity} <> 0`),
  ],
);
