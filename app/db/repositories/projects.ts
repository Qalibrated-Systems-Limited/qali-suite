import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { anyOf, arrayOf } from "./sqlHelpers";
import type { Tx } from "../client";
import {
  projects,
  projectBudgets,
  projectBudgetLines,
  projectCostCodes,
  projectAssignments,
  projectTasks,
  accounts,
} from "../schema";
import { getProjectClaimsByAccount, listClaims } from "./claims";
import { getProjectExpensesByAccount, listProjectExpenses } from "./expenses";

/**
 * Project repository — 0070.
 *
 * Contract with the layer above (§4.1): every function takes a `tx` from
 * withTenant(), so RLS is active; nothing here reads the session or checks
 * permissions. MONEY IS A STRING everywhere except the financial summary,
 * which returns numbers because `computeProjectActuals` always has and the
 * screens do arithmetic on them.
 *
 * ── What this does that Mongo did not ───────────────────────────────────────
 *
 * IT READS A STORE THAT IS WRITTEN TO. `computeProjectActuals` in
 * `projectQueries.js` aggregates the Mongo `Invoice`, `Bill`, `StockRequest`
 * and `StockMovement` collections. All four moved to Postgres, and none of
 * them has been written to since. So every project's revenue, bill cost and
 * stock commitment has read zero for as long as those modules have been
 * ported, and nothing showed it, because the cached `financials.*` beside them
 * were zero too — nothing has ever called the `$inc` helper that maintains
 * them. Both halves of the number were wrong in the same direction.
 *
 * THE DELETE GUARD COUNTS ALL FIVE LINKS. `deleteProject` counts CLAIMS, and
 * the Mongo module's own gap list says so: "Delete only checks claims". A
 * project with invoices against it and no claims was deletable, and the
 * invoices lost their project silently.
 *
 * THE PARENT PICKER EXCLUDES DESCENDANTS. `getProjectsForParentPicker`'s
 * docstring claims it "excludes self and own children" and its query excludes
 * self. Picking your own child as your parent builds a cycle that
 * `getSubprojects` walks for ever.
 *
 * THE BUDGET IS ONE NUMBER, NOT THREE. See 0070 decision 5: the lines are the
 * total, `projects.budget_amount` is the advisory figure typed on the create
 * form, and `effectiveBudget` is COALESCE of the two in that order. Approving
 * a budget writes nothing back to the project.
 */

const PAGE_SIZE = 20;

/** float8 out of Postgres arrives as a number already; this is for `null`. */
const num = (v: unknown) => Number(v ?? 0);

export interface ProjectFilters {
  search?: string;
  status?: string;
  priority?: string;
  page?: number;
  limit?: number;
}

function filterConditions(opts: ProjectFilters) {
  const conditions = [];
  if (opts.status && opts.status !== "all") {
    conditions.push(eq(projects.status, opts.status as never));
  }
  if (opts.priority && opts.priority !== "all") {
    conditions.push(eq(projects.priority, opts.priority as never));
  }
  const search = opts.search?.trim();
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(
        ilike(projects.projectNumber, term),
        ilike(projects.name, term),
        ilike(projects.clientName, term),
        ilike(projects.projectManagerName, term),
      )!,
    );
  }
  return conditions;
}

/** The list page. Same four search fields Mongo regexed, as one ILIKE each. */
export async function listProjects(tx: Tx, opts: ProjectFilters = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(opts.limit ?? PAGE_SIZE, 200);
  const conditions = filterConditions(opts);
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await tx
    .select()
    .from(projects)
    .where(where)
    .orderBy(desc(projects.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  const [{ total }] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(projects)
    .where(where);

  // The card on each row draws a budget bar, so it needs the same three
  // figures the detail page does. TWO queries for the page, not six per row.
  const ids = rows.map((r) => r.id);
  const [actuals, budgets, progress] = await Promise.all([
    computeActualsFor(tx, ids),
    getBudgetsFor(tx, ids),
    computeProgressFor(tx, ids),
  ]);

  return {
    projects: rows.map((row) => ({
      ...row,
      actuals: actuals.get(row.id) ?? { ...ZERO_ACTUALS },
      effectiveBudget:
        budgets.get(row.id) ?? { amount: 0, currency: row.budgetCurrency, fromApprovedBudget: false },
      progress: progress.get(row.id) ?? {
        percent: row.progressPercent,
        source: "typed" as const,
        taskCount: 0,
        doneCount: 0,
      },
    })),
    total: Number(total ?? 0),
    page,
    pageSize: limit,
  };
}

export async function countProjectPages(tx: Tx, opts: ProjectFilters = {}) {
  const conditions = filterConditions(opts);
  const [{ total }] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(projects)
    .where(conditions.length ? and(...conditions) : undefined);
  return Math.ceil(Number(total ?? 0) / (opts.limit ?? PAGE_SIZE));
}

/**
 * The stats cards.
 *
 * The budget half is the change: Mongo summed `financials.*` across active and
 * on-hold projects, which is three cached zeros. This sums the LIVE actuals,
 * so the header agrees with every project page under it.
 */
export async function getProjectStats(tx: Tx) {
  const [counts] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      planning: sql<number>`count(*) FILTER (WHERE ${projects.status} = 'planning')::int`,
      active: sql<number>`count(*) FILTER (WHERE ${projects.status} = 'active')::int`,
      onHold: sql<number>`count(*) FILTER (WHERE ${projects.status} = 'on_hold')::int`,
      completed: sql<number>`count(*) FILTER (WHERE ${projects.status} = 'completed')::int`,
      closed: sql<number>`count(*) FILTER (WHERE ${projects.status} = 'closed')::int`,
    })
    .from(projects);

  const running = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(inArray(projects.status, ["active", "on_hold"]));

  const ids = running.map((p) => p.id);
  const [actuals, budgets] = await Promise.all([
    computeActualsFor(tx, ids),
    getBudgetsFor(tx, ids),
  ]);

  let totalBudget = 0;
  let totalRevenue = 0;
  let totalCosts = 0;
  let totalCommitted = 0;

  for (const id of ids) {
    const a = actuals.get(id);
    totalBudget += budgets.get(id)?.amount ?? 0;
    totalRevenue += a?.revenue ?? 0;
    totalCosts += a?.costs ?? 0;
    totalCommitted += a?.committed ?? 0;
  }

  return {
    total: Number(counts?.total ?? 0),
    planning: Number(counts?.planning ?? 0),
    active: Number(counts?.active ?? 0),
    onHold: Number(counts?.onHold ?? 0),
    completed: Number(counts?.completed ?? 0),
    closed: Number(counts?.closed ?? 0),
    totalBudget,
    totalRevenue,
    totalCosts,
    totalCommitted,
  };
}

export async function getProjectById(tx: Tx, projectId: string) {
  const [row] = await tx
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  return row ?? null;
}

/** The picker every other module renders: planning and active only. */
export async function getActiveProjects(tx: Tx) {
  return tx
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      name: projects.name,
      status: projects.status,
      budgetAmount: projects.budgetAmount,
      budgetCurrency: projects.budgetCurrency,
    })
    .from(projects)
    .where(inArray(projects.status, ["planning", "active"]))
    .orderBy(asc(projects.name));
}

export async function getSubprojects(tx: Tx, parentProjectId: string) {
  return tx
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      name: projects.name,
      status: projects.status,
      progressPercent: projects.progressPercent,
      budgetAmount: projects.budgetAmount,
    })
    .from(projects)
    .where(eq(projects.parentProjectId, parentProjectId))
    .orderBy(asc(projects.projectNumber));
}

/**
 * Candidates for "this project's parent" — excluding the project itself AND
 * everything beneath it.
 *
 * The Mongo query excludes self only, which is how a cycle gets built: A's
 * parent set to B, where B's parent is already A. The database refuses it now
 * (`project_parent_is_acyclic`), but a picker that offers an option the save
 * will reject is a bug of its own.
 */
export async function getProjectsForParentPicker(
  tx: Tx,
  excludeProjectId?: string | null,
) {
  if (!excludeProjectId) {
    return tx
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        name: projects.name,
      })
      .from(projects)
      .where(inArray(projects.status, ["planning", "active"]))
      .orderBy(asc(projects.name));
  }

  const rows = (await tx.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT id FROM projects WHERE id = ${excludeProjectId}
      UNION ALL
      SELECT p.id FROM projects p JOIN descendants d ON p.parent_project_id = d.id
    )
    SELECT p.id::text AS id, p.project_number AS "projectNumber", p.name
      FROM projects p
     WHERE p.status IN ('planning', 'active')
       AND p.id NOT IN (SELECT id FROM descendants)
     ORDER BY p.name ASC
  `)) as unknown as Array<{
    id: string;
    projectNumber: string;
    name: string;
  }>;
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// The money
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `{ revenue, costs, committed }` for one project, from the documents.
 *
 * The single source of truth for a project's economics — the detail page, the
 * stats cards and the budget bar all read this one function, so they cannot
 * disagree with each other.
 *
 * `committed` is why this cannot be a `journal_lines` query: an approved stock
 * request has no ledger entry at all — nothing has been received and nothing is
 * owed — and it is exactly the number a budget is checked against. See 0070
 * decision 2.
 *
 * PETTY CASH IS NOT COUNTED HERE, deliberately. Petty cash spend is recorded
 * as Expenses paid from the petty cash account, so it is already in the
 * expense arm; counting the disbursements as well would double it.
 */
export interface ProjectActuals {
  revenue: number;
  costs: number;
  committed: number;
}

const ZERO_ACTUALS: ProjectActuals = { revenue: 0, costs: 0, committed: 0 };

/**
 * The same figures for MANY projects, in one query.
 *
 * The list page draws a budget bar per row and the stats cards sum across
 * every running project. Asking per project would be six round trips each —
 * twenty rows is a hundred and twenty queries for one page. Every arm below
 * groups by project instead.
 *
 * THE FILTERS ARE COPIED FROM THEIR OWN MODULES and must not drift:
 *   claims   — getProjectClaimTotals (claims.ts). advance_return excluded: a
 *              return reconciles an advance whose cost was counted when paid.
 *              actual = paid|closed, committed = submitted|approved.
 *   expenses — getProjectExpenseTotals (expenses.ts). void excluded;
 *              committed is the accrual, posted and unpaid.
 * If either of those changes, change it here in the same commit.
 */
export async function computeActualsFor(
  tx: Tx,
  projectIds: readonly string[],
): Promise<Map<string, ProjectActuals>> {
  const result = new Map<string, ProjectActuals>();
  if (!projectIds.length) return result;

  const ids = arrayOf([...new Set(projectIds)], "uuid[]");

  const rows = (await tx.execute(sql`
    WITH ids AS (SELECT unnest(${ids}) AS project_id),

    -- Revenue: recognised invoices, net of the credit notes raised against
    -- them. A credit note references the INVOICE, not the project, which is
    -- why the second arm joins rather than filtering.
    -- completed ONLY. computeProjectActuals asks for
    -- status IN ('completed', 'posted') and posted is not a status an
    -- invoice can hold — app/models/invoice.js lists draft, sent, completed,
    -- cancelled, void, expired, and the Postgres enum lists five of those. So
    -- that arm has never matched anything in either store; here it is a hard
    -- error rather than a silent no-op, which is how it was found. Same shape
    -- as the claims port's settled.
    invoice_revenue AS (
      SELECT i.project_id, SUM(i.total)::float8 AS amount
        FROM invoices i
       WHERE i.project_id IN (SELECT project_id FROM ids)
         AND i.status = 'completed'
       GROUP BY i.project_id
    ),
    credited AS (
      SELECT i.project_id, SUM(cn.total)::float8 AS amount
        FROM credit_notes cn
        JOIN invoices i ON i.id = cn.invoice_id
       WHERE i.project_id IN (SELECT project_id FROM ids)
         AND cn.status IN ('issued', 'applied')
       GROUP BY i.project_id
    ),

    -- Bills: paid is cost, approved-and-unpaid is commitment. A bill
    -- cancelled after payment is neither.
    bill_totals AS (
      SELECT b.project_id,
             SUM(b.net_payable) FILTER (
               WHERE b.payment_status = 'paid' AND b.status <> 'cancelled'
             )::float8                                              AS paid,
             SUM(b.net_payable) FILTER (
               WHERE b.status = 'approved' AND b.payment_status <> 'paid'
             )::float8                                              AS committed
        FROM bills b
       WHERE b.project_id IN (SELECT project_id FROM ids)
       GROUP BY b.project_id
    ),

    claim_totals AS (
      SELECT c.project_id,
             SUM(s.total_amount) FILTER (
               WHERE c.status IN ('paid', 'closed')
             )::float8                                              AS actual,
             SUM(s.total_amount) FILTER (
               WHERE c.status IN ('submitted', 'approved')
             )::float8                                              AS committed
        FROM employee_claims c
        JOIN employee_claim_state s ON s.claim_id = c.id
       WHERE c.project_id IN (SELECT project_id FROM ids)
         AND c.claim_type <> 'advance_return'
       GROUP BY c.project_id
    ),

    expense_totals AS (
      SELECT e.project_id,
             SUM(e.total) FILTER (WHERE e.payment_status = 'paid')::float8   AS paid,
             SUM(e.total) FILTER (WHERE e.payment_status = 'unpaid')::float8 AS committed
        FROM expenses e
       WHERE e.project_id IN (SELECT project_id FROM ids)
         AND e.status <> 'void'
       GROUP BY e.project_id
    ),

    -- Stock requested for the project, split at the point it leaves the
    -- warehouse.
    --
    -- THE MONGO VERSION LOSES IT. It counts approved and
    -- partially_fulfilled as committed and stops there — so the moment a
    -- request is fully fulfilled its commitment disappears and NOTHING takes
    -- its place. The stock is on site, the project has consumed it, and the
    -- project's cost FALLS by the value of what was just delivered. Nothing
    -- downstream restores it: fulfilment posts DR Technician Stock, an asset
    -- rather than a cost, and the checkout that later expenses it carries no
    -- project at all.
    --
    -- Issued is ACTUAL, at the movement's cost — the real number, not the
    -- request's price. Outstanding is COMMITTED, at the request's price,
    -- because an estimate is all an unissued line has.
    request_issued AS (
      SELECT r.project_id, SUM(m.total_cost)::float8 AS amount
        FROM stock_requests r
        JOIN stock_request_items i ON i.request_id = r.id
        JOIN stock_request_fulfilments f ON f.item_id = i.id
        JOIN stock_movements m ON m.id = f.movement_id
       WHERE r.project_id IN (SELECT project_id FROM ids)
         -- completed, not posted. movement_status is pending | completed |
         -- reversed, and Mongo's own returned-COGS arm asks for
         -- status: "posted" — a second dead filter in the same function.
         AND m.status = 'completed'
       GROUP BY r.project_id
    ),
    request_outstanding AS (
      SELECT r.project_id,
             SUM(
               GREATEST(COALESCE(i.approved_quantity, i.requested_quantity)
                        - COALESCE(i.total_fulfilled, 0), 0)
               * COALESCE(i.unit_price, 0)
             )::float8 AS amount
        FROM stock_requests r
        JOIN stock_request_items i ON i.request_id = r.id
       WHERE r.project_id IN (SELECT project_id FROM ids)
         AND r.status IN ('approved', 'partially_fulfilled')
       GROUP BY r.project_id
    ),

    -- COGS on what was sold against this project. cogs_postings is what
    -- actually reached the ledger, which beats re-deriving it from the line's
    -- stored cost. Lines fulfilled from a stock request or a technician
    -- checkout are EXCLUDED: that stock is already in the project through the
    -- request that issued it, so counting the sale as well doubles it.
    invoice_cogs AS (
      SELECT i.project_id, SUM(cp.total_cost)::float8 AS amount
        FROM cogs_postings cp
        JOIN invoice_lines il ON il.id = cp.invoice_line_id
        JOIN invoices i ON i.id = il.invoice_id
       WHERE i.project_id IN (SELECT project_id FROM ids)
         AND i.status = 'completed'
         AND il.stock_request_id IS NULL
         AND il.checkout_id IS NULL
       GROUP BY i.project_id
    ),

    -- Stock that came back. issueCreditNote restores inventory with a
    -- DR Inventory / CR COGS entry, so the debit side of that entry is the
    -- cost to take back out of the project.
    returned_cogs AS (
      SELECT i.project_id, SUM(jl.debit)::float8 AS amount
        FROM credit_notes cn
        JOIN invoices i ON i.id = cn.invoice_id
        JOIN journal_lines jl ON jl.entry_id = cn.inventory_journal_entry_id
       WHERE i.project_id IN (SELECT project_id FROM ids)
         AND cn.status IN ('issued', 'applied')
       GROUP BY i.project_id
    )

    SELECT ids.project_id::text                        AS project_id,
           COALESCE(ir.amount, 0)                      AS invoice_revenue,
           COALESCE(cr.amount, 0)                      AS credited,
           COALESCE(bt.paid, 0)                        AS bill_paid,
           COALESCE(bt.committed, 0)                   AS bill_committed,
           COALESCE(ct.actual, 0)                      AS claim_actual,
           COALESCE(ct.committed, 0)                   AS claim_committed,
           COALESCE(et.paid, 0)                        AS expense_paid,
           COALESCE(et.committed, 0)                   AS expense_committed,
           COALESCE(ri.amount, 0)                      AS request_issued,
           COALESCE(ro.amount, 0)                      AS request_committed,
           COALESCE(ic.amount, 0)                      AS invoice_cogs,
           COALESCE(rc.amount, 0)                      AS returned_cogs
      FROM ids
      LEFT JOIN invoice_revenue ir ON ir.project_id = ids.project_id
      LEFT JOIN credited       cr ON cr.project_id = ids.project_id
      LEFT JOIN bill_totals    bt ON bt.project_id = ids.project_id
      LEFT JOIN claim_totals   ct ON ct.project_id = ids.project_id
      LEFT JOIN expense_totals et ON et.project_id = ids.project_id
      LEFT JOIN request_issued      ri ON ri.project_id = ids.project_id
      LEFT JOIN request_outstanding ro ON ro.project_id = ids.project_id
      LEFT JOIN invoice_cogs   ic ON ic.project_id = ids.project_id
      LEFT JOIN returned_cogs  rc ON rc.project_id = ids.project_id
  `)) as unknown as Array<Record<string, unknown>>;

  for (const r of rows) {
    result.set(String(r.project_id), {
      // Never negative: a project credited for more than it invoiced has a
      // presentation problem, not negative revenue.
      revenue: Math.max(0, num(r.invoice_revenue) - num(r.credited)),
      costs: Math.max(
        0,
        num(r.claim_actual) +
          num(r.expense_paid) +
          num(r.bill_paid) +
          num(r.request_issued) +
          num(r.invoice_cogs) -
          num(r.returned_cogs),
      ),
      committed:
        num(r.claim_committed) +
        num(r.expense_committed) +
        num(r.bill_committed) +
        num(r.request_committed),
    });
  }

  return result;
}

/**
 * `{ revenue, costs, committed }` for one project, from the documents.
 *
 * The single source of truth for a project's economics — the detail page, the
 * list rows, the stats cards and the budget bar all read this, so they cannot
 * disagree with each other.
 *
 * `committed` is why this cannot be a journal_lines query: an approved stock
 * request has no ledger entry at all — nothing has been received and nothing
 * is owed — and it is exactly the number a budget is checked against. See
 * 0070 decision 2.
 *
 * PETTY CASH IS NOT COUNTED, deliberately. Petty cash spend is recorded as
 * Expenses paid from the petty cash account, so it is already in the expense
 * arm; counting the disbursements as well would double it.
 */
export async function computeProjectActuals(tx: Tx, projectId: string) {
  const map = await computeActualsFor(tx, [projectId]);
  return map.get(projectId) ?? { ...ZERO_ACTUALS };
}

/**
 * What each project is being measured against, for many at once.
 *
 * The approved budget's lines when there is one, and the advisory figure from
 * the project form when there is not. One rule, and no third copy of the
 * number to go stale — 0070 decision 5.
 */
export async function getBudgetsFor(
  tx: Tx,
  projectIds: readonly string[],
): Promise<Map<string, { amount: number; currency: string; fromApprovedBudget: boolean }>> {
  const result = new Map<
    string,
    { amount: number; currency: string; fromApprovedBudget: boolean }
  >();
  if (!projectIds.length) return result;

  const rows = (await tx.execute(sql`
    SELECT p.id::text                                      AS project_id,
           COALESCE(b.line_total, p.budget_amount)::float8 AS amount,
           p.budget_currency                               AS currency,
           (b.line_total IS NOT NULL)                      AS from_approved_budget
      FROM projects p
      LEFT JOIN (
        SELECT b.project_id, SUM(l.amount) AS line_total
          FROM project_budgets b
          JOIN project_budget_lines l ON l.budget_id = b.id
         WHERE b.status = 'approved'
         GROUP BY b.project_id
      ) b ON b.project_id = p.id
     WHERE p.id = ${anyOf([...new Set(projectIds)], "uuid[]")}
  `)) as unknown as Array<{
    project_id: string;
    amount: number;
    currency: string;
    from_approved_budget: boolean;
  }>;

  for (const r of rows) {
    result.set(r.project_id, {
      amount: num(r.amount),
      currency: r.currency ?? "KES",
      fromApprovedBudget: Boolean(r.from_approved_budget),
    });
  }
  return result;
}

export async function getEffectiveBudget(tx: Tx, projectId: string) {
  const map = await getBudgetsFor(tx, [projectId]);
  return (
    map.get(projectId) ?? { amount: 0, currency: "KES", fromApprovedBudget: false }
  );
}

/** Revenue, cost, commitment, the budget and everything derived from them. */
export async function getProjectFinancialSummary(tx: Tx, projectId: string) {
  const [actuals, budget] = await Promise.all([
    computeProjectActuals(tx, projectId),
    getEffectiveBudget(tx, projectId),
  ]);

  const used = actuals.costs + actuals.committed;
  return {
    ...actuals,
    budget: budget.amount,
    budgetCurrency: budget.currency,
    budgetFromApproved: budget.fromApprovedBudget,
    available: budget.amount - used,
    // Advisory: the module warns and never blocks.
    budgetUtilization: budget.amount > 0 ? Math.round((used / budget.amount) * 100) : 0,
    margin: actuals.revenue - actuals.costs,
    marginPercent:
      actuals.revenue > 0
        ? Math.round(((actuals.revenue - actuals.costs) / actuals.revenue) * 100)
        : 0,
  };
}

/**
 * Budget versus actual, per GL account.
 *
 * Only bills, claims and expenses break down by account — an invoice's COGS
 * and a stock request's value have no expense account on them, so they are in
 * the project total and not in this table. That was true in Mongo too; it is
 * said out loud here because a reader comparing the two figures deserves to
 * know why they differ.
 */
export async function getProjectBudgetVsActual(tx: Tx, projectId: string) {
  const [budget] = await tx
    .select()
    .from(projectBudgets)
    .where(
      and(
        eq(projectBudgets.projectId, projectId),
        eq(projectBudgets.status, "approved"),
      ),
    );
  if (!budget) return null;

  const lines = await tx
    .select()
    .from(projectBudgetLines)
    .where(eq(projectBudgetLines.budgetId, budget.id))
    .orderBy(asc(projectBudgetLines.lineNumber));
  if (!lines.length) return null;

  const [claimsByAccount, expensesByAccount, billRows] = await Promise.all([
    getProjectClaimsByAccount(tx, projectId),
    getProjectExpensesByAccount(tx, projectId),
    tx.execute(sql`
      SELECT bl.account_id::text                                     AS account_id,
             COALESCE(SUM(bl.amount) FILTER (
               WHERE b.payment_status = 'paid' AND b.status <> 'cancelled'
             ), 0)::float8                                           AS actual,
             COALESCE(SUM(bl.amount) FILTER (
               WHERE b.status = 'approved' AND b.payment_status <> 'paid'
             ), 0)::float8                                           AS committed
        FROM bill_lines bl
        JOIN bills b ON b.id = bl.bill_id
       WHERE b.project_id = ${projectId}
         AND bl.account_id IS NOT NULL
       GROUP BY bl.account_id
    `),
  ]);

  const actual = new Map<string, number>();
  const committed = new Map<string, number>();
  const add = (map: Map<string, number>, key: string | null, value: number) => {
    if (!key || !value) return;
    map.set(key, (map.get(key) ?? 0) + value);
  };

  for (const e of claimsByAccount.actuals) add(actual, e._id, e.total);
  for (const e of claimsByAccount.committed) add(committed, e._id, e.total);
  for (const e of expensesByAccount) {
    add(actual, e.accountId, Number(e.actual ?? 0));
    add(committed, e.accountId, Number(e.committed ?? 0));
  }
  for (const b of billRows as unknown as Array<{
    account_id: string;
    actual: number;
    committed: number;
  }>) {
    add(actual, b.account_id, num(b.actual));
    add(committed, b.account_id, num(b.committed));
  }

  const comparison = lines.map((line) => {
    const budgeted = Number(line.amount);
    const spent = actual.get(line.accountId) ?? 0;
    const pledged = committed.get(line.accountId) ?? 0;
    return {
      accountId: line.accountId,
      accountCode: line.accountCodeAtBudget,
      accountName: line.accountNameAtBudget,
      description: line.description,
      budgeted,
      actual: spent,
      committed: pledged,
      available: budgeted - spent - pledged,
      percentUsed:
        budgeted > 0 ? Math.round(((spent + pledged) / budgeted) * 100) : 0,
    };
  });

  return {
    budgetId: budget.id,
    version: budget.version,
    totalBudgeted: comparison.reduce((sum, l) => sum + l.budgeted, 0),
    lines: comparison,
  };
}

/** The five link types, for the detail page's drill-down. */
export async function getProjectTransactions(
  tx: Tx,
  projectId: string,
  type: "all" | "claims" | "invoices" | "bills" | "expenses" | "requests" = "all",
  limit = 20,
) {
  const cap = Math.min(limit, 200);
  const results: Record<string, unknown[]> = {};
  const wants = (kind: string) => type === "all" || type === kind;

  if (wants("claims")) {
    /**
     * DELEGATED, not re-derived.
     *
     * The hand-written version of this selected `c.employee_name`, which is
     * not a column — the employee is a party and the name comes from a join
     * that `listClaims` already does. It threw on every project detail page
     * that had a claim against it, and no test caught it because
     * `getProjectTransactions` had none: the Mongo function this replaces
     * called `listClaimsPg({ projectId })` for exactly this reason, and the
     * port should have kept doing so.
     */
    const { claims } = await listClaims(tx, { projectId, limit: cap });
    results.claims = claims;
  }

  if (wants("invoices")) {
    results.invoices = (await tx.execute(sql`
      SELECT i.id::text, i.invoice_number AS "invoiceNumber", i.status,
             i.total::float8 AS total, p.name AS "customerName",
             i.invoice_date AS "invoiceDate"
        FROM invoices i
        LEFT JOIN parties p ON p.id = i.customer_id
       WHERE i.project_id = ${projectId}
       ORDER BY i.invoice_date DESC
       LIMIT ${cap}
    `)) as unknown as unknown[];
  }

  if (wants("bills")) {
    results.bills = (await tx.execute(sql`
      SELECT b.id::text, b.bill_number AS "billNumber", b.status,
             b.payment_status AS "paymentStatus", b.total::float8 AS total,
             b.net_payable::float8 AS "netPayable",
             b.supplier_name_at_bill AS "vendorName", b.bill_date AS "billDate"
        FROM bills b
       WHERE b.project_id = ${projectId}
       ORDER BY b.bill_date DESC
       LIMIT ${cap}
    `)) as unknown as unknown[];
  }

  if (wants("expenses")) {
    results.expenses = await listProjectExpenses(tx, projectId, cap);
  }

  if (wants("requests")) {
    results.requests = (await tx.execute(sql`
      SELECT r.id::text, r.request_number AS "requestNumber",
             r.request_type AS "requestType", r.status,
             r.total_value::float8 AS "totalValue",
             r.requester_name_at_request AS "requesterName",
             r.created_at AS "createdAt"
        FROM stock_requests r
       WHERE r.project_id = ${projectId}
       ORDER BY r.created_at DESC
       LIMIT ${cap}
    `)) as unknown as unknown[];
  }

  return results;
}

/**
 * Everything pointing at this project, counted. The delete guard.
 *
 * Mongo counts claims and nothing else, which its own gap list admits. A
 * project with three invoices and no claims deleted cleanly and took the link
 * off all three.
 */
export async function countProjectLinks(tx: Tx, projectId: string) {
  const [row] = (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM employee_claims WHERE project_id = ${projectId})::int AS claims,
      (SELECT COUNT(*) FROM invoices        WHERE project_id = ${projectId})::int AS invoices,
      (SELECT COUNT(*) FROM bills           WHERE project_id = ${projectId})::int AS bills,
      (SELECT COUNT(*) FROM expenses        WHERE project_id = ${projectId})::int AS expenses,
      (SELECT COUNT(*) FROM stock_requests  WHERE project_id = ${projectId})::int AS requests,
      (SELECT COUNT(*) FROM projects        WHERE parent_project_id = ${projectId})::int AS subprojects
  `)) as unknown as Array<Record<string, number>>;

  const counts = {
    claims: Number(row?.claims ?? 0),
    invoices: Number(row?.invoices ?? 0),
    bills: Number(row?.bills ?? 0),
    expenses: Number(row?.expenses ?? 0),
    requests: Number(row?.requests ?? 0),
    subprojects: Number(row?.subprojects ?? 0),
  };
  return { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Budgets, cost codes, roster
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every version, newest first, WITH its lines.
 *
 * The budget page renders each version's lines inline, and in Mongo they were
 * an embedded array so they arrived for free. Here they are rows, and a page
 * that fetched the versions and then a query per version would be the N+1 the
 * list page just stopped doing — so this is two queries whatever the count.
 */
export async function getProjectBudgets(tx: Tx, projectId: string) {
  const budgets = await tx
    .select()
    .from(projectBudgets)
    .where(eq(projectBudgets.projectId, projectId))
    .orderBy(desc(projectBudgets.version));
  if (!budgets.length) return [];

  const lines = await tx
    .select()
    .from(projectBudgetLines)
    .where(
      inArray(
        projectBudgetLines.budgetId,
        budgets.map((b) => b.id),
      ),
    )
    .orderBy(asc(projectBudgetLines.lineNumber));

  const byBudget = new Map<string, typeof lines>();
  for (const line of lines) {
    const bucket = byBudget.get(line.budgetId) ?? [];
    bucket.push(line);
    byBudget.set(line.budgetId, bucket);
  }

  return budgets.map((b) => {
    const own = byBudget.get(b.id) ?? [];
    return {
      ...b,
      lines: own,
      totalAmount: own.reduce((sum, l) => sum + Number(l.amount), 0),
    };
  });
}

export async function getBudgetWithLines(tx: Tx, budgetId: string) {
  const [budget] = await tx
    .select()
    .from(projectBudgets)
    .where(eq(projectBudgets.id, budgetId));
  if (!budget) return null;

  const lines = await tx
    .select()
    .from(projectBudgetLines)
    .where(eq(projectBudgetLines.budgetId, budgetId))
    .orderBy(asc(projectBudgetLines.lineNumber));

  return {
    ...budget,
    lines,
    totalAmount: lines.reduce((sum, l) => sum + Number(l.amount), 0),
  };
}

export interface BudgetLineInput {
  accountId: string;
  description?: string | null;
  amount: string;
}

/**
 * A new version. `version` is MAX + 1 taken inside the caller's transaction,
 * and `project_budgets_version_idx` catches the race the read cannot.
 *
 * Account code and name are read from the chart HERE rather than trusted from
 * the form — Mongo takes `accountCode` and `accountName` off the posted body,
 * so a crafted request could label a budget line with any account it liked.
 */
export async function createBudget(
  tx: Tx,
  input: {
    companyId: string;
    projectId: string;
    revisionNotes?: string | null;
    lines: BudgetLineInput[];
    createdById?: string | null;
    createdByName: string;
  },
) {
  const [{ next_version }] = (await tx.execute(sql`
    SELECT COALESCE(MAX(version), 0) + 1 AS next_version
      FROM project_budgets WHERE project_id = ${input.projectId}
  `)) as unknown as Array<{ next_version: number }>;

  const [budget] = await tx
    .insert(projectBudgets)
    .values({
      companyId: input.companyId,
      projectId: input.projectId,
      version: Number(next_version),
      status: "draft",
      revisionNotes: input.revisionNotes ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();

  await replaceBudgetLines(tx, budget.id, input.companyId, input.lines);
  return budget;
}

/**
 * Draft lines, replaced wholesale.
 *
 * `project_budget_lines_frozen` refuses this on anything that is not a draft,
 * so a caller that forgets to check gets an error rather than a rewritten
 * approval.
 */
export async function replaceBudgetLines(
  tx: Tx,
  budgetId: string,
  companyId: string,
  lines: BudgetLineInput[],
) {
  await tx
    .delete(projectBudgetLines)
    .where(eq(projectBudgetLines.budgetId, budgetId));

  if (!lines.length) return [];

  const ids = [...new Set(lines.map((l) => l.accountId))];
  const chart = await tx
    .select({
      id: accounts.id,
      code: accounts.accountCode,
      name: accounts.accountName,
    })
    .from(accounts)
    .where(inArray(accounts.id, ids));
  const byId = new Map(chart.map((a) => [a.id, a]));

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error("A budget line names an account that is not in this company's chart.");
  }

  return tx
    .insert(projectBudgetLines)
    .values(
      lines.map((line, i) => ({
        companyId,
        budgetId,
        lineNumber: i + 1,
        accountId: line.accountId,
        accountCodeAtBudget: byId.get(line.accountId)!.code ?? "",
        accountNameAtBudget: byId.get(line.accountId)!.name ?? "",
        description: line.description ?? "",
        amount: line.amount,
      })),
    )
    .returning();
}

/**
 * Approve, superseding whatever was approved before.
 *
 * The order is supersede-then-approve because `project_budgets_one_approved`
 * is a unique index: approving first would collide with the incumbent. And it
 * writes NOTHING to `projects` — decision 5. The budget total lives in the
 * lines.
 */
export async function approveBudget(
  tx: Tx,
  budgetId: string,
  approver: { id?: string | null; name: string },
) {
  const [budget] = await tx
    .select()
    .from(projectBudgets)
    .where(eq(projectBudgets.id, budgetId));
  if (!budget) throw new Error("Budget not found");
  if (budget.status !== "draft") {
    throw new Error("Only a draft budget can be approved.");
  }

  await tx
    .update(projectBudgets)
    .set({ status: "superseded", updatedAt: new Date() })
    .where(
      and(
        eq(projectBudgets.projectId, budget.projectId),
        eq(projectBudgets.status, "approved"),
      ),
    );

  const [approved] = await tx
    .update(projectBudgets)
    .set({
      status: "approved",
      approvedById: approver.id ?? null,
      approvedByName: approver.name,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectBudgets.id, budgetId))
    .returning();

  return approved;
}

/** Company-wide codes, plus this project's own when one is named. */
export async function getCostCodes(tx: Tx, projectId?: string | null) {
  const scope = projectId
    ? or(isNull(projectCostCodes.projectId), eq(projectCostCodes.projectId, projectId))!
    : isNull(projectCostCodes.projectId);

  return tx
    .select()
    .from(projectCostCodes)
    .where(and(eq(projectCostCodes.isActive, true), scope))
    .orderBy(asc(projectCostCodes.code));
}

/** The management page, inactive codes included. */
export async function getAllCostCodes(tx: Tx) {
  return tx
    .select()
    .from(projectCostCodes)
    .orderBy(asc(projectCostCodes.code));
}

/** Active and inactive members; soft-removed rows are not the roster. */
export async function getProjectAssignments(tx: Tx, projectId: string) {
  return tx
    .select()
    .from(projectAssignments)
    .where(
      and(
        eq(projectAssignments.projectId, projectId),
        sql`${projectAssignments.status} <> 'removed'`,
      ),
    )
    .orderBy(asc(projectAssignments.status), asc(projectAssignments.partyName));
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/** PRJ-00001. See 0070 for what the Mongo number format was buying. */
async function nextProjectNumber(tx: Tx, companyId: string) {
  const [{ project_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'PRJ') AS project_number`,
  )) as unknown as Array<{ project_number: string }>;
  return project_number;
}

export interface CreateProjectInput {
  companyId: string;
  name: string;
  description?: string | null;
  clientPartyId?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  projectManagerUserId?: string | null;
  projectManagerName?: string | null;
  parentProjectId?: string | null;
  billingModel?: "fixed" | "milestone" | "time_material" | null;
  contractValue?: string | null;
  progressPercent?: number;
  priority?: "low" | "normal" | "high" | "critical";
  startDate?: string | null;
  endDate?: string | null;
  budgetAmount?: string;
  budgetCurrency?: string;
  tags?: string[];
  createdById?: string | null;
  createdByName: string;
}

export async function createProject(tx: Tx, input: CreateProjectInput) {
  const projectNumber = await nextProjectNumber(tx, input.companyId);

  const [row] = await tx
    .insert(projects)
    .values({
      companyId: input.companyId,
      projectNumber,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      clientPartyId: input.clientPartyId || null,
      clientName: input.clientName?.trim() || null,
      clientEmail: input.clientEmail?.trim() || null,
      projectManagerUserId: input.projectManagerUserId || null,
      projectManagerName: input.projectManagerName?.trim() || null,
      parentProjectId: input.parentProjectId || null,
      billingModel: input.billingModel ?? null,
      contractValue: input.contractValue ?? null,
      progressPercent: input.progressPercent ?? 0,
      priority: input.priority ?? "normal",
      startDate: input.startDate || null,
      endDate: input.endDate || null,
      budgetAmount: input.budgetAmount ?? "0",
      budgetCurrency: input.budgetCurrency || "KES",
      tags: input.tags ?? [],
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();

  return row;
}

export type UpdateProjectInput = Partial<
  Omit<CreateProjectInput, "companyId" | "createdById" | "createdByName">
> & {
  lastModifiedById?: string | null;
  lastModifiedByName?: string | null;
};

/**
 * Everything the edit form may change — and NOT `status`, which moves only
 * through `setProjectStatus`. Mongo's `updateProject` writes with
 * `findOneAndUpdate`, so a `status` key reaching it would slip past the state
 * machine entirely; here there is no key to reach.
 */
export async function updateProject(
  tx: Tx,
  projectId: string,
  input: UpdateProjectInput,
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const set = <K extends keyof UpdateProjectInput>(key: K, column: string) => {
    if (input[key] !== undefined) patch[column] = input[key];
  };

  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description?.trim() ?? "";
  set("clientPartyId", "clientPartyId");
  if (input.clientName !== undefined) patch.clientName = input.clientName?.trim() || null;
  if (input.clientEmail !== undefined) patch.clientEmail = input.clientEmail?.trim() || null;
  set("projectManagerUserId", "projectManagerUserId");
  if (input.projectManagerName !== undefined) {
    patch.projectManagerName = input.projectManagerName?.trim() || null;
  }
  set("parentProjectId", "parentProjectId");
  set("billingModel", "billingModel");
  set("contractValue", "contractValue");
  set("progressPercent", "progressPercent");
  set("priority", "priority");
  set("startDate", "startDate");
  set("endDate", "endDate");
  set("budgetAmount", "budgetAmount");
  set("budgetCurrency", "budgetCurrency");
  set("tags", "tags");
  set("lastModifiedById", "lastModifiedById");
  set("lastModifiedByName", "lastModifiedByName");

  // Empty strings out of a form are "not set", not "" — the pair CHECKs would
  // otherwise refuse a project whose client was cleared.
  if (patch.clientPartyId === "") patch.clientPartyId = null;
  if (patch.projectManagerUserId === "") patch.projectManagerUserId = null;
  if (patch.parentProjectId === "") patch.parentProjectId = null;

  const [row] = await tx
    .update(projects)
    .set(patch)
    .where(eq(projects.id, projectId))
    .returning();
  return row ?? null;
}

/**
 * The only way status moves. The transition itself is checked by
 * `project_status_transition`, which also stamps `actual_end_date`.
 */
export async function setProjectStatus(
  tx: Tx,
  projectId: string,
  status: "planning" | "active" | "on_hold" | "completed" | "closed",
  actor: { id?: string | null; name: string },
) {
  const [row] = await tx
    .update(projects)
    .set({
      status,
      lastModifiedById: actor.id ?? null,
      lastModifiedByName: actor.name,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();
  return row ?? null;
}

export async function setProjectProgress(
  tx: Tx,
  projectId: string,
  progressPercent: number,
  actor: { id?: string | null; name: string },
) {
  const pct = Math.max(0, Math.min(100, Math.round(progressPercent) || 0));
  const [row] = await tx
    .update(projects)
    .set({
      progressPercent: pct,
      lastModifiedById: actor.id ?? null,
      lastModifiedByName: actor.name,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();
  return row ?? null;
}

export async function deleteProject(tx: Tx, projectId: string) {
  const [row] = await tx
    .delete(projects)
    .where(eq(projects.id, projectId))
    .returning();
  return row ?? null;
}

export async function createCostCode(
  tx: Tx,
  input: {
    companyId: string;
    code: string;
    name: string;
    description?: string | null;
    projectId?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const [row] = await tx
    .insert(projectCostCodes)
    .values({
      companyId: input.companyId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      projectId: input.projectId || null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function updateCostCode(
  tx: Tx,
  costCodeId: string,
  input: {
    code?: string;
    name?: string;
    description?: string | null;
    projectId?: string | null;
  },
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.code !== undefined) patch.code = input.code.trim().toUpperCase();
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description?.trim() ?? "";
  if (input.projectId !== undefined) patch.projectId = input.projectId || null;

  const [row] = await tx
    .update(projectCostCodes)
    .set(patch)
    .where(eq(projectCostCodes.id, costCodeId))
    .returning();
  return row ?? null;
}

export async function setCostCodeActive(
  tx: Tx,
  costCodeId: string,
  isActive: boolean,
) {
  const [row] = await tx
    .update(projectCostCodes)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(projectCostCodes.id, costCodeId))
    .returning();
  return row ?? null;
}

/**
 * Assign somebody, or bring them back.
 *
 * `project_assignments_party_once` means re-assigning is an UPDATE, not a
 * second row — the Mongo index says the same thing and its action has to
 * `findOneAndUpdate` with an upsert to honour it.
 */
export async function upsertAssignment(
  tx: Tx,
  input: {
    companyId: string;
    projectId: string;
    partyId: string;
    partyName: string;
    partyType?: "employee" | "supplier" | "both";
    role?: string | null;
    rateAmount?: string | null;
    rateUnit?: "hour" | "day" | "month" | "fixed" | null;
    assignedById?: string | null;
    assignedByName?: string | null;
  },
) {
  // An amount with no unit is not a rate — the CHECK says so, so default the
  // unit rather than letting the form's blank select reach the database.
  const rateAmount = input.rateAmount || null;
  const rateUnit = rateAmount ? (input.rateUnit ?? "day") : null;

  const [row] = await tx
    .insert(projectAssignments)
    .values({
      companyId: input.companyId,
      projectId: input.projectId,
      partyId: input.partyId,
      partyName: input.partyName,
      partyType: input.partyType ?? "employee",
      role: input.role?.trim() ?? "",
      rateAmount,
      rateUnit,
      assignedById: input.assignedById ?? null,
      assignedByName: input.assignedByName ?? null,
    })
    .onConflictDoUpdate({
      target: [projectAssignments.projectId, projectAssignments.partyId],
      set: {
        partyName: input.partyName,
        partyType: input.partyType ?? "employee",
        role: input.role?.trim() ?? "",
        rateAmount,
        rateUnit,
        status: "active",
        removedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

/** Role, rate and status — the three things the roster card can change. */
export async function updateAssignment(
  tx: Tx,
  assignmentId: string,
  input: {
    role?: string;
    rate?: { amount?: number | string | null; unit?: string | null } | null;
    status?: "active" | "inactive";
  },
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.role !== undefined) patch.role = input.role.trim().slice(0, 100);
  if (input.status !== undefined) {
    patch.status = input.status;
    patch.removedAt = null;
  }
  if (input.rate !== undefined) {
    const amount =
      input.rate?.amount === null || input.rate?.amount === undefined ||
      String(input.rate.amount).trim() === ""
        ? null
        : Number(input.rate.amount).toFixed(4);
    // An amount with no unit is not a rate — the CHECK says so, so the default
    // is applied here rather than letting a blank select reach the database.
    patch.rateAmount = amount;
    patch.rateUnit = amount ? (input.rate?.unit ?? "day") : null;
  }

  const [row] = await tx
    .update(projectAssignments)
    .set(patch)
    .where(eq(projectAssignments.id, assignmentId))
    .returning();
  return row ?? null;
}

export async function setAssignmentStatus(
  tx: Tx,
  assignmentId: string,
  status: "active" | "inactive" | "removed",
) {
  const [row] = await tx
    .update(projectAssignments)
    .set({
      status,
      removedAt: status === "removed" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(projectAssignments.id, assignmentId))
    .returning();
  return row ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The work breakdown — 0071
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Leaves of a project's WBS, with the weight each one carries.
 *
 * A LEAF is a task with no live children — a cancelled subtask does not make
 * its parent a summary, because a summary with nothing under it has nothing to
 * roll up and would report zero for ever.
 *
 * `COALESCE(weight, estimated_hours, 1)` is decision 3: an unweighted average
 * makes "order the cable" worth as much as "lay 8km of subbase", which is how
 * a project reads 50% complete having done none of the work.
 */
const LEAVES = sql`
  SELECT t.id, t.project_id, t.path,
         COALESCE(t.weight, t.estimated_hours, 1)::numeric AS w,
         t.progress_percent::numeric                       AS p
    FROM project_tasks t
   WHERE t.status <> 'cancelled'
     AND NOT EXISTS (
           SELECT 1 FROM project_tasks c
            WHERE c.parent_task_id = t.id AND c.status <> 'cancelled')
`;

export interface ProjectProgress {
  /** 0–100. */
  percent: number;
  /** Where the number came from — `tasks` is earned, `typed` is asserted. */
  source: "tasks" | "typed";
  taskCount: number;
  doneCount: number;
}

/**
 * Progress for many projects at once — decision 1.
 *
 * The weighted roll-up where a project has a WBS, and the number somebody
 * typed where it does not. `projects.progress_percent` is not dropped and not
 * maintained by a trigger; it is the fallback, and `source` says which answer
 * the caller is looking at so a screen can be honest about it.
 */
export async function computeProgressFor(
  tx: Tx,
  projectIds: readonly string[],
): Promise<Map<string, ProjectProgress>> {
  const result = new Map<string, ProjectProgress>();
  if (!projectIds.length) return result;

  const ids = anyOf([...new Set(projectIds)], "uuid[]");

  const rows = (await tx.execute(sql`
    WITH leaves AS (${LEAVES})
    SELECT p.id::text                                          AS project_id,
           p.progress_percent                                  AS typed,
           (SUM(l.w * l.p) / NULLIF(SUM(l.w), 0))::float8      AS rolled_up,
           COUNT(l.id)::int                                     AS leaf_count,
           (SELECT COUNT(*) FROM project_tasks t
             WHERE t.project_id = p.id AND t.status <> 'cancelled')::int AS task_count,
           (SELECT COUNT(*) FROM project_tasks t
             WHERE t.project_id = p.id AND t.status = 'done')::int       AS done_count
      FROM projects p
      LEFT JOIN leaves l ON l.project_id = p.id
     WHERE p.id = ${ids}
     GROUP BY p.id
  `)) as unknown as Array<Record<string, unknown>>;

  for (const r of rows) {
    const rolled = r.rolled_up === null || r.rolled_up === undefined
      ? null
      : num(r.rolled_up);
    result.set(String(r.project_id), {
      percent: Math.round(rolled ?? num(r.typed)),
      source: rolled === null ? "typed" : "tasks",
      taskCount: Number(r.task_count ?? 0),
      doneCount: Number(r.done_count ?? 0),
    });
  }
  return result;
}

export async function getProjectProgress(tx: Tx, projectId: string) {
  const map = await computeProgressFor(tx, [projectId]);
  return (
    map.get(projectId) ?? {
      percent: 0,
      source: "typed" as const,
      taskCount: 0,
      doneCount: 0,
    }
  );
}

/**
 * One project's WBS, depth-first, siblings in `sort_order`.
 *
 * `path` alone orders the tree depth-first but by ID, which is arbitrary — so
 * the recursive CTE builds a SORT key per node from its ancestors' sort orders.
 * The offset keeps a negative `sort_order` ordering correctly under `lpad`.
 *
 * Each row carries `rolledUpProgress`: its own percentage if it is a leaf, and
 * the weighted average of its leaf descendants if it is a summary. That is the
 * whole point — `progressPercent` on a summary row is always 0 and is not the
 * number to render.
 */
export async function listProjectTasks(tx: Tx, projectId: string) {
  const rows = (await tx.execute(sql`
    WITH RECURSIVE leaves AS (${LEAVES}),
    tree AS (
      SELECT t.id,
             ARRAY[lpad((t.sort_order + 1000000)::text, 12, '0') || '|' || t.title] AS ord
        FROM project_tasks t
       WHERE t.project_id = ${projectId} AND t.parent_task_id IS NULL
      UNION ALL
      SELECT c.id,
             p.ord || (lpad((c.sort_order + 1000000)::text, 12, '0') || '|' || c.title)
        FROM project_tasks c
        JOIN tree p ON c.parent_task_id = p.id
       WHERE c.project_id = ${projectId}
    )
    SELECT t.id::text                                  AS id,
           t.parent_task_id::text                      AS "parentTaskId",
           t.depth,
           t.title,
           t.description,
           t.status,
           t.assigned_party_id::text                   AS "assignedPartyId",
           t.assigned_name                             AS "assignedName",
           t.planned_start                             AS "plannedStart",
           t.planned_end                               AS "plannedEnd",
           t.actual_start                              AS "actualStart",
           t.actual_end                                AS "actualEnd",
           t.estimated_hours::float8                   AS "estimatedHours",
           t.weight::float8                            AS weight,
           t.progress_percent                          AS "progressPercent",
           t.cost_code_id::text                        AS "costCodeId",
           t.sort_order                                AS "sortOrder",
           (SELECT COUNT(*) FROM project_tasks c
             WHERE c.parent_task_id = t.id)::int       AS "childCount",
           COALESCE(
             (SELECT SUM(l.w * l.p) / NULLIF(SUM(l.w), 0)
                FROM leaves l WHERE l.path <@ t.path),
             t.progress_percent
           )::float8                                   AS "rolledUpProgress",
           COALESCE(t.weight, t.estimated_hours, 1)::float8 AS "effectiveWeight"
      FROM project_tasks t
      JOIN tree ON tree.id = t.id
     WHERE t.project_id = ${projectId}
     ORDER BY tree.ord
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    ...r,
    id: String(r.id),
    rolledUpProgress: Math.round(num(r.rolledUpProgress)),
  })) as Array<Record<string, unknown> & { id: string; rolledUpProgress: number }>;
}

export async function getTaskById(tx: Tx, taskId: string) {
  const [row] = await tx
    .select()
    .from(projectTasks)
    .where(eq(projectTasks.id, taskId));
  return row ?? null;
}

export interface CreateTaskInput {
  companyId: string;
  projectId: string;
  parentTaskId?: string | null;
  title: string;
  description?: string | null;
  assignedPartyId?: string | null;
  assignedName?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  estimatedHours?: string | null;
  weight?: string | null;
  costCodeId?: string | null;
  sortOrder?: number;
  createdById?: string | null;
  createdByName: string;
}

/**
 * A new task, always at `todo` and 0%.
 *
 * Nothing is created part-done: `project_tasks_todo_has_not_started` says so,
 * and a WBS whose rows arrive with progress already on them is a WBS nobody
 * can audit. `path` is not supplied — the trigger owns it.
 */
export async function createTask(tx: Tx, input: CreateTaskInput) {
  const [row] = await tx
    .insert(projectTasks)
    .values({
      companyId: input.companyId,
      projectId: input.projectId,
      parentTaskId: input.parentTaskId || null,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      assignedPartyId: input.assignedPartyId || null,
      assignedName: input.assignedName?.trim() || null,
      plannedStart: input.plannedStart || null,
      plannedEnd: input.plannedEnd || null,
      estimatedHours: input.estimatedHours ?? null,
      weight: input.weight ?? null,
      costCodeId: input.costCodeId || null,
      sortOrder: input.sortOrder ?? 0,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}

export type UpdateTaskInput = Partial<
  Omit<CreateTaskInput, "companyId" | "projectId" | "createdById" | "createdByName">
> & {
  lastModifiedById?: string | null;
  lastModifiedByName?: string | null;
};

/**
 * The plan, not the progress.
 *
 * `status` and `progressPercent` are deliberately not here — they move
 * together through `setTaskProgress`, because the database refuses every
 * combination where they disagree and a partial update would hit that.
 */
export async function updateTask(
  tx: Tx,
  taskId: string,
  input: UpdateTaskInput,
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.description !== undefined) {
    patch.description = input.description?.trim() ?? "";
  }
  if (input.parentTaskId !== undefined) {
    patch.parentTaskId = input.parentTaskId || null;
  }
  if (input.assignedPartyId !== undefined) {
    patch.assignedPartyId = input.assignedPartyId || null;
  }
  if (input.assignedName !== undefined) {
    patch.assignedName = input.assignedName?.trim() || null;
  }
  if (input.plannedStart !== undefined) patch.plannedStart = input.plannedStart || null;
  if (input.plannedEnd !== undefined) patch.plannedEnd = input.plannedEnd || null;
  if (input.estimatedHours !== undefined) patch.estimatedHours = input.estimatedHours ?? null;
  if (input.weight !== undefined) patch.weight = input.weight ?? null;
  if (input.costCodeId !== undefined) patch.costCodeId = input.costCodeId || null;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (input.lastModifiedById !== undefined) patch.lastModifiedById = input.lastModifiedById;
  if (input.lastModifiedByName !== undefined) {
    patch.lastModifiedByName = input.lastModifiedByName;
  }

  const [row] = await tx
    .update(projectTasks)
    .set(patch)
    .where(eq(projectTasks.id, taskId))
    .returning();
  return row ?? null;
}

/**
 * Progress and status, moved together and kept consistent.
 *
 * The database holds three rules the caller would otherwise have to remember —
 * `done` is 100, 100 is `done`, and `todo` has not started — so this derives
 * whichever of the pair was not given rather than letting a form post half of
 * it and hit a CHECK. The dates follow: work that started has a start date,
 * work that finished has an end date.
 *
 * `project_tasks_leaf_owns_progress` refuses this entirely on a summary task.
 */
export async function setTaskProgress(
  tx: Tx,
  taskId: string,
  input: {
    progressPercent?: number;
    status?: "todo" | "in_progress" | "blocked" | "done" | "cancelled";
  },
  actor: { id?: string | null; name: string },
) {
  const current = await getTaskById(tx, taskId);
  if (!current) return null;

  let status = input.status ?? current.status;
  let percent =
    input.progressPercent === undefined
      ? current.progressPercent
      : Math.max(0, Math.min(100, Math.round(input.progressPercent)));

  if (status !== "cancelled") {
    // Whichever half the caller gave, the other follows it.
    if (input.status === "done") percent = 100;
    else if (input.status === "todo") percent = 0;
    else if (input.progressPercent !== undefined) {
      if (percent === 100) status = "done";
      else if (percent === 0 && status === "done") status = "in_progress";
      else if (percent > 0 && status === "todo") status = "in_progress";
    } else if (percent === 100) {
      /**
       * REOPENING, and the one case that cannot be derived.
       *
       * The task is at 100 and the caller is moving it off `done` without
       * saying what it is now. Anything this function picked would be
       * invented — 0 throws away what was done, 99 is a fiction — so it asks.
       * The alternative is `project_tasks_done_is_complete` refusing the write
       * with a message about a CHECK, which tells the user nothing.
       */
      throw new Error(
        "Reopening a completed task needs the percentage it is now at.",
      );
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const patch: Record<string, unknown> = {
    status,
    progressPercent: status === "cancelled" ? current.progressPercent : percent,
    lastModifiedById: actor.id ?? null,
    lastModifiedByName: actor.name,
    updatedAt: new Date(),
  };

  if (status === "todo") {
    patch.actualStart = null;
    patch.actualEnd = null;
  } else {
    if (!current.actualStart && status !== "cancelled") {
      patch.actualStart = today;
    }
    patch.actualEnd =
      status === "done" || status === "cancelled"
        ? (current.actualEnd ?? today)
        : null;
  }

  const [row] = await tx
    .update(projectTasks)
    .set(patch)
    .where(eq(projectTasks.id, taskId))
    .returning();
  return row ?? null;
}

/** Refused by the foreign key while the task still has subtasks. */
export async function deleteTask(tx: Tx, taskId: string) {
  const [row] = await tx
    .delete(projectTasks)
    .where(eq(projectTasks.id, taskId))
    .returning();
  return row ?? null;
}

export async function countTasks(tx: Tx, projectId: string) {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(projectTasks)
    .where(eq(projectTasks.projectId, projectId));
  return Number(row?.total ?? 0);
}
