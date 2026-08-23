"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import {
  EXPENSE_CREATE_ROLES,
  EXPENSE_PAY_ROLES,
  EXPENSE_DELETE_ROLES,
  EXPENSE_VOID_ROLES,
} from "@/lib/utils/role-gates";
import * as expensesRepo from "../repositories/expenses";
import * as accountsRepo from "../repositories/accounts";
import * as partiesRepo from "../repositories/parties";
import * as assetsRepo from "../repositories/assets";
import {
  expenseSchema,
  expensePaymentSchema,
  expenseVoidSchema,
  toRepositoryInput,
} from "../validation/expenses";

/**
 * Expense actions on Postgres (§9J).
 *
 * Thin, like the quote and bill actions: parse, gate, call the repository,
 * revalidate. Every rule about what an expense may become lives in the
 * repository; every rule about money lives in the schema.
 *
 * WHAT CHANGES FOR THE CALLER. The Mongo `createExpense` and `updateExpense`
 * end in `redirect(...)`, so a caller cannot tell "saved" from "threw" and the
 * action can never report a field error alongside a success. These RETURN, the
 * way the quote and invoice actions do, and the form navigates. That is not a
 * style preference — it is what let the quote edit form sit on
 * "Redirecting..." forever once its action stopped redirecting.
 */

export type ActionResult =
  | {
      success: true;
      expenseId?: string;
      expenseNumber?: string;
      message?: string;
      /**
       * For the approval engine, which still has to move the cost from
       * committed to actual on a MONGO project. The amount comes from the
       * Postgres row so the two stores agree on what was paid.
       */
      projectId?: string | null;
      total?: string | null;
    }
  | {
      success: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
      values?: Record<string, unknown>;
      pendingApprovalId?: string;
      pendingApprovalNumber?: string;
    };

/**
 * Postgres phrases most of these for a user already — the account checks, the
 * system-account guard and the status guards all say what is wrong in words.
 * Surface those; hide anything else behind a generic message and a log line.
 */
function toActionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("not configured") ||
    message.includes("not found") ||
    message.includes("is inactive") ||
    message.includes("header account") ||
    message.includes("must be an expense account") ||
    message.includes("Invalid payment account") ||
    message.includes("already paid") ||
    message.includes("already void") ||
    message.includes("no journal entry") ||
    message.includes("Cannot record payment") ||
    message.includes("Only a draft") ||
    message.includes("permission") ||
    message.includes("not balanced") ||
    message.includes("fiscal period")
  ) {
    return message;
  }
  console.error("[expense-actions]", err);
  return "Something went wrong saving this expense.";
}

/** FormData → the shape the schema expects. Receipts arrive as JSON. */
function parsePayload(formData: FormData) {
  const raw = Object.fromEntries(formData.entries()) as Record<string, unknown>;

  let receipts: unknown = [];
  const receiptsJson = formData.get("receipts");
  if (receiptsJson) {
    try {
      const parsed = JSON.parse(String(receiptsJson));
      if (Array.isArray(parsed)) receipts = parsed;
    } catch {
      // A malformed receipts blob loses the attachments, not the expense —
      // the same call the Mongo parseReceipts makes with its bare `catch {}`.
    }
  }

  // The checkbox posts "on" when ticked and nothing at all when not.
  raw.isReimbursable = formData.get("isReimbursable") ? true : false;

  const result = expenseSchema.safeParse({ ...raw, receipts });
  if (!result.success) {
    const flat = result.error.flatten();
    return {
      ok: false as const,
      error:
        Object.values(flat.fieldErrors)[0]?.[0] ??
        flat.formErrors[0] ??
        "Check the highlighted fields.",
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
      values: raw,
    };
  }
  return { ok: true as const, data: result.data, values: raw };
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the expense and posts its journal entry, in ONE transaction.
 *
 * Mongo does this in three writes with no transaction — insert the draft, post
 * (which inserts the entry and saves the expense), then update the project's
 * financials. A failure between any two leaves the ledger and the document
 * disagreeing, which is what `postLegacyExpense`'s two branches exist to
 * repair. Here there is nothing to repair.
 */
export async function createExpensePg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parsePayload(formData);
  if (!parsed.ok) {
    return {
      success: false,
      error: parsed.error,
      fieldErrors: parsed.fieldErrors,
      values: parsed.values,
    };
  }

  try {
    const { expense } = await withAuthorizedTenant(
      [...EXPENSE_CREATE_ROLES],
      (tx, { user, companyId }) =>
        expensesRepo.createAndPostExpense(tx, {
          companyId,
          ...toRepositoryInput(parsed.data),
          createdById: user.id,
        }),
    );

    revalidatePath("/dashboard/expenses");
    revalidatePath("/dashboard/journal");
    if (parsed.data.projectId) {
      revalidatePath("/dashboard/projects");
      revalidatePath(`/dashboard/projects/${parsed.data.projectId}`);
    }

    return {
      success: true,
      expenseId: expense.id,
      expenseNumber: expense.expenseNumber,
      message: `Expense ${expense.expenseNumber} posted`,
    };
  } catch (err) {
    return {
      success: false,
      error: toActionError(err),
      values: parsed.values,
    };
  }
}

/**
 * Records payment against an expense that was posted unpaid.
 *
 * The approval threshold still routes through Mongo's ApprovalRequest —
 * approvals are their own unported module (§9K names the general shape). What
 * changed is which store the release writes to: `applyExpensePayment` calls
 * this, not `expense.recordPayment`.
 */
export async function recordExpensePaymentPg(
  expenseId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = expensePaymentSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    return {
      success: false,
      error:
        Object.values(flat.fieldErrors)[0]?.[0] ??
        "Payment method and account are required",
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
    };
  }

  try {
    // Read first, outside the write, so the threshold check has the amount,
    // the payee and the acting role before anything is committed. One
    // transaction, not two — the role comes back with the row.
    const { expense, role } = await withAuthorizedTenant(
      [...EXPENSE_PAY_ROLES],
      async (tx, { user }) => ({
        expense: await expensesRepo.getExpense(tx, expenseId),
        role: user.role,
      }),
    );
    if (!expense) return { success: false, error: "Expense not found" };
    if (expense.paymentStatus === "paid") {
      return { success: false, error: "Expense is already paid" };
    }

    const held = await requestApprovalIfOverThreshold(expense, parsed.data, role);
    if (held) return held;

    const { expense: updated } = await withAuthorizedTenant(
      [...EXPENSE_PAY_ROLES],
      (tx, { user }) =>
        expensesRepo.recordExpensePayment(tx, expenseId, {
          paymentMethod: parsed.data.paymentMethod,
          paidFromAccountId: parsed.data.paidFrom,
          paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : null,
          paidById: user.id,
        }),
    );

    revalidatePath("/dashboard/expenses");
    revalidatePath(`/dashboard/expenses/${expenseId}`);
    revalidatePath("/dashboard/journal");
    if (updated.projectId) {
      revalidatePath(`/dashboard/projects/${updated.projectId}`);
    }

    return {
      success: true,
      expenseId,
      message: `Payment recorded for ${updated.expenseNumber}`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * Releases a payment the approval engine has already signed off.
 *
 * Separate from `recordExpensePaymentPg` for one reason: it must NOT consult
 * the threshold. The threshold is what raised the approval in the first
 * place, and re-checking it here would refuse the payment on the grounds that
 * it needs the approval it just received.
 *
 * Called from `app/mongodb/actions/approval-actions.js` — the approval engine
 * is not ported, so this is the seam. It replaces a call to
 * `expense.recordPayment()`, which wrote the clearing entry into the MONGO
 * ledger: an approved payment was signed off, recorded, and then posted where
 * no ledger screen would ever show it.
 */
export async function applyApprovedExpensePaymentPg(
  expenseId: string,
  payment: { paymentMethod: string; paidFrom: string; paidAt?: string | null },
): Promise<ActionResult> {
  const parsed = expensePaymentSchema.safeParse({
    paymentMethod: payment.paymentMethod,
    paidFrom: payment.paidFrom,
    paidAt: payment.paidAt ?? undefined,
  });
  if (!parsed.success) {
    return {
      success: false,
      error:
        Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ??
        "The approved payment details are no longer valid.",
    };
  }

  try {
    const { expense } = await withAuthorizedTenant(
      [...EXPENSE_PAY_ROLES],
      (tx, { user }) =>
        expensesRepo.recordExpensePayment(tx, expenseId, {
          paymentMethod: parsed.data.paymentMethod,
          paidFromAccountId: parsed.data.paidFrom,
          paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : null,
          paidById: user.id,
        }),
    );

    revalidatePath("/dashboard/expenses");
    revalidatePath(`/dashboard/expenses/${expenseId}`);
    revalidatePath("/dashboard/journal");

    return {
      success: true,
      expenseId,
      expenseNumber: expense.expenseNumber,
      message: `Payment recorded for ${expense.expenseNumber}`,
      projectId: expense.projectId,
      total: expense.total,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * Voids a posted expense, reversing every entry it raised.
 *
 * NEW — see the repository. Mongo carries the `void` status and its three
 * audit fields and never writes any of them, while `deleteExpense` refuses a
 * posted expense with "void it instead". Since every expense is auto-posted at
 * creation, that left no way to undo one at all.
 */
export async function voidExpensePg(
  expenseId: string,
  reason: string,
): Promise<ActionResult> {
  const parsed = expenseVoidSchema.safeParse({ reason });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.flatten().fieldErrors.reason?.[0] ?? "A reason is required",
    };
  }

  try {
    const { expense } = await withAuthorizedTenant(
      [...EXPENSE_VOID_ROLES],
      (tx, { user }) =>
        expensesRepo.voidExpense(tx, expenseId, {
          reason: parsed.data.reason,
          voidedById: user.id,
        }),
    );

    revalidatePath("/dashboard/expenses");
    revalidatePath(`/dashboard/expenses/${expenseId}`);
    revalidatePath("/dashboard/journal");

    return {
      success: true,
      expenseId,
      message: `Expense ${expense.expenseNumber} voided`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function deleteExpensePg(expenseId: string): Promise<ActionResult> {
  try {
    const number = await withAuthorizedTenant(
      [...EXPENSE_DELETE_ROLES],
      async (tx) => {
        const expense = await expensesRepo.getExpense(tx, expenseId);
        if (!expense) throw new Error("Expense not found");
        if (expense.status !== "draft") {
          throw new Error(
            `Expense ${expense.expenseNumber} is ${expense.status} — void it instead of deleting it.`,
          );
        }
        await expensesRepo.deleteDraftExpense(tx, expenseId);
        return expense.expenseNumber;
      },
    );

    revalidatePath("/dashboard/expenses");
    return { success: true, message: `Expense ${number} deleted` };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * The payment approval threshold — the one place this module still reaches
 * into Mongo.
 *
 * Approvals are their own unported module: `ApprovalRequest`, the threshold
 * config and `submitApproval` all live there. Rather than pretend otherwise,
 * the seam is one function, imported dynamically so it is obvious in a stack
 * trace and easy to delete when approvals move.
 *
 * Returns an ActionResult when the payment must be held, or null to proceed.
 * Finance staff can release small payments directly; above the configured
 * threshold the release is routed for sign-off — segregation of duties on the
 * larger ones.
 */
const PAYMENT_APPROVAL_BYPASS = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
]);

async function requestApprovalIfOverThreshold(
  expense: { id: string; companyId: string; expenseNumber: string; total: string | null; payeeNameAtExpense: string },
  payment: { paymentMethod: string; paidFrom: string; paidAt?: string },
  userRole?: string,
): Promise<ActionResult | null> {
  if (userRole && PAYMENT_APPROVAL_BYPASS.has(userRole)) return null;

  const amount = Number(expense.total ?? 0);
  if (!(amount > 0)) return null;

  const { getCompanyThresholds } = await import(
    "@/app/mongodb/queries/threshold-queries"
  );
  const thresholds = await getCompanyThresholds(expense.companyId);
  const threshold = Number(thresholds?.expensePaymentValue) || 0;
  if (!(threshold > 0) || amount <= threshold) return null;

  const { submitApproval } = await import(
    "@/app/mongodb/actions/approval-actions"
  );
  const result = await submitApproval({
    type: "expense_payment",
    targetRef: {
      kind: "Expense",
      id: expense.id,
      label: `${expense.expenseNumber} — ${expense.payeeNameAtExpense} — KES ${amount.toLocaleString()}`,
    },
    payload: {
      expenseId: expense.id,
      paymentMethod: payment.paymentMethod,
      paidFrom: payment.paidFrom,
      paidAt: payment.paidAt || new Date().toISOString(),
    },
    reason: `Expense payment of KES ${amount.toLocaleString()} exceeds threshold of KES ${threshold.toLocaleString()}`,
    context: { amount, threshold },
  });

  if (!result?.success) {
    return { success: false, error: result?.error ?? "Could not raise the approval." };
  }

  revalidatePath(`/dashboard/expenses/${expense.id}`);
  return {
    success: false,
    error: `Payment exceeds the KES ${threshold.toLocaleString()} approval threshold. Approval ${result.approval.requestNumber} has been submitted.`,
    pendingApprovalId: String(result.approval._id),
    pendingApprovalNumber: result.approval.requestNumber,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function getExpensePg(expenseId: string) {
  return withAuthorizedTenant([], (tx) =>
    expensesRepo.getExpenseForDisplay(tx, expenseId),
  );
}

export async function listExpensesPg(
  opts: expensesRepo.ListExpensesOptions = {},
) {
  return withAuthorizedTenant([], (tx) => expensesRepo.listExpenses(tx, opts));
}

export async function getExpenseSummaryPg(
  opts: { startDate?: string; endDate?: string } = {},
) {
  return withAuthorizedTenant([], (tx) =>
    expensesRepo.getExpenseSummary(tx, opts),
  );
}

export async function getExpensesByAssetPg(
  assetId: string,
  opts: { startDate?: string; endDate?: string } = {},
) {
  return withAuthorizedTenant([], (tx) =>
    expensesRepo.getExpensesByAsset(tx, assetId, opts),
  );
}

/**
 * The three project reads below degrade rather than throw, matching
 * getProjectClaimTotalsPg / getProjectClaimsByAccountPg in claim-actions.ts.
 *
 * They are called from `app/mongodb/queries/projectQueries.js`, which is still
 * Mongo — so they are cross-store reads inside a page that has plenty of other
 * things to render. A project page that 500s because one figure could not be
 * fetched is worse than one showing that figure as zero.
 *
 * It DOES hide a failure, which is why each logs. If a project's expense
 * column reads zero and should not, look here first.
 */
async function orZero<T>(label: string, fn: () => Promise<T>, fallback: T) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[expense-actions] ${label} failed:`, err);
    return fallback;
  }
}

export async function getProjectExpenseTotalsPg(projectId: string) {
  return orZero(
    "getProjectExpenseTotals",
    () =>
      withAuthorizedTenant([], (tx) =>
        expensesRepo.getProjectExpenseTotals(tx, projectId),
      ),
    { count: 0, total: "0", paid: "0", committed: "0" },
  );
}

export async function getProjectExpensesByAccountPg(projectId: string) {
  return orZero(
    "getProjectExpensesByAccount",
    () =>
      withAuthorizedTenant([], (tx) =>
        expensesRepo.getProjectExpensesByAccount(tx, projectId),
      ),
    [] as Awaited<ReturnType<typeof expensesRepo.getProjectExpensesByAccount>>,
  );
}

export async function listProjectExpensesPg(projectId: string, limit = 50) {
  return orZero(
    "listProjectExpenses",
    () =>
      withAuthorizedTenant([], (tx) =>
        expensesRepo.listProjectExpenses(tx, projectId, limit),
      ),
    [] as Awaited<ReturnType<typeof expensesRepo.listProjectExpenses>>,
  );
}

export async function sumExpensesByAssetPg(opts: {
  assetIds: string[];
  since: string;
  until: string;
}) {
  return withAuthorizedTenant([], (tx) =>
    expensesRepo.sumExpensesByAsset(tx, opts),
  );
}

export async function sumExpensesForPeriodPg(opts: {
  start: string;
  end: string;
}) {
  return withAuthorizedTenant([], (tx) =>
    expensesRepo.sumExpensesForPeriod(tx, opts),
  );
}

export async function getExpenseCategoriesPg() {
  return expensesRepo.getExpenseCategories();
}

/**
 * The pickers on the create and edit forms.
 *
 * SCOPED, WHICH THE MONGO ONES WERE NOT. `create/page.jsx` builds its own
 * queries through `tenantFilter(companyId, isSuperAdmin)`, which returns `{}`
 * for a SuperAdmin — so signed in as platform staff, the expense-account
 * picker, the payment-account picker and the payee picker each listed every
 * tenant's records. Exactly the defect §9E fixed for invoices and the quote
 * form still carried until this week.
 *
 * Projects are NOT here: they are still Mongo, and the page fetches them
 * separately. That seam is real and stays visible rather than being hidden
 * behind a helper that reads two stores.
 */
export async function getExpenseFormData() {
  return withAuthorizedTenant([...EXPENSE_CREATE_ROLES], async (tx) => {
    const [expenseAccounts, paymentAccounts, suppliers, employees] =
      await Promise.all([
        accountsRepo.listAccounts(tx, {
          accountType: "expense",
          postableOnly: true,
        }),
        accountsRepo.listPaymentAccounts(tx),
        partiesRepo.listParties(tx, { role: "supplier", limit: 200 }),
        partiesRepo.listParties(tx, { role: "employee", limit: 200 }),
      ]);

    // Fixed assets, for tagging fuel/repairs/maintenance to the thing that
    // incurred them. Postgres since 0056 — this picker was already reading
    // the right store before the rest of the module did.
    const { assets: assetRows } = await assetsRepo.listAssets(tx, {
      status: ["active", "idle", "in_maintenance"],
      limit: 200,
    });

    const party = (p: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      taxPin: string | null;
    }) => ({
      _id: p.id,
      id: p.id,
      name: p.name,
      email: p.email ?? "",
      phone: p.phone ?? "",
      taxPin: p.taxPin ?? "",
    });

    // The key names are the page's: `accounts`, `paymentAccounts`, `vendors`,
    // `employees`, `assets`. Same shape in, same shape out — the screen moves
    // store without being rewritten.
    return {
      accounts: expenseAccounts.map((a) => ({
        _id: a.id,
        id: a.id,
        accountCode: a.accountCode,
        accountName: a.accountName,
        subType: a.subType ?? "",
      })),
      paymentAccounts: paymentAccounts.map((a) => ({
        _id: a._id,
        id: a._id,
        accountCode: a.code,
        accountName: a.name,
        subType: a.subType,
      })),
      vendors: suppliers.map(party),
      employees: employees.map(party),
      assets: assetRows.map((a) => ({
        _id: a.id,
        id: a.id,
        assetNumber: a.assetNumber,
        name: a.name,
        registrationNumber: a.registrationNumber ?? "",
      })),
      categories: expensesRepo.getExpenseCategories(),
    };
  });
}
