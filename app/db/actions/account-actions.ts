"use server";

import { revalidatePath } from "next/cache";
import { userMessage } from "../errors";
import { z } from "zod";
import { withAuthorizedTenant } from "../tenant";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as accountsRepo from "../repositories/accounts";

/**
 * The chart of accounts on Postgres.
 *
 * Reads are scoped by the tenant policy; writes are gated on
 * FINANCE_WRITE_ROLES, which is who may shape the ledger. The rules about what
 * an account may become live in the repository, next to the data they protect.
 */

export type ActionResult =
  | { success: true; accountId?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;

const accountSchema = z.object({
  accountCode: z.string().min(1, "Account code is required"),
  accountName: z.string().min(2, "Account name is required"),
  accountType: z.enum(ACCOUNT_TYPES),
  subType: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  canPost: z.coerce.boolean().optional(),
});

function fail(err: unknown): ActionResult {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("not found") ||
    message.includes("must be") ||
    message.includes("must match") ||
    message.includes("posted line") ||
    message.includes("permission") ||
    message.includes("already")
  ) {
    return { success: false, error: message };
  }
  console.error("[account-action]", err);
  return { success: false, error: "Something went wrong. Please try again." };
}

function parse(formData: FormData) {
  return accountSchema.safeParse({
    accountCode: formData.get("accountCode"),
    accountName: formData.get("accountName"),
    accountType: formData.get("accountType"),
    subType: formData.get("subType") || null,
    // accountForm posts `parentAccount`, NOT `parentId` — and deliberately:
    // its own comment records that the name was changed to match the Mongoose
    // schema path, because `parentId` "the model has no path for, so Mongoose
    // dropped it on save and the parent never persisted". The Postgres action
    // then read `parentId` again, so the parent stopped persisting again.
    // Both names are accepted so neither side can break the other.
    parentId:
      formData.get("parentAccount") || formData.get("parentId") || null,
    description: formData.get("description") || null,
    canPost: formData.get("canPost") ?? undefined,
  });
}

export async function createAccountPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    return await withAuthorizedTenant(
      [...FINANCE_WRITE_ROLES],
      async (tx, { companyId }) => {
        const created = await accountsRepo.createAccount(tx, {
          companyId,
          ...parsed.data,
          parentId: parsed.data.parentId || null,
        });
        revalidatePath("/dashboard/accounts");
        return {
          success: true as const,
          accountId: created.id,
          message: `${created.accountCode} ${created.accountName} created`,
        };
      },
    );
  } catch (err) {
    return fail(err);
  }
}

/**
 * The expense-account combobox's inline "create".
 *
 * POSTGRES since 0060. It called `quickCreateExpenseAccount` in
 * app/mongodb/actions/account-actions.js, which writes to the MONGO Account
 * collection — and the chart of accounts has been Postgres since 0001. So
 * creating an account from the expense form, a project budget, a claim
 * settlement or a checkout dialog put it in a store no picker reads: the user
 * created an account, the combobox did not list it, and nothing said why.
 *
 * The code range rules come from lib/coa-codes.js, which is shared, so the
 * numbering is unchanged: cost-of-sales subtypes book to 5xxx and every other
 * expense to 6xxx, and a blank code takes the next free one in range.
 *
 * The RETURN SHAPE is the combobox's — `{ success, account: { _id,
 * accountCode, accountName } }` — so the component does not change.
 */
export async function quickCreateExpenseAccountPg(formData: FormData) {
  const accountCode = String(formData.get("accountCode") ?? "").trim();
  const accountName = String(formData.get("accountName") ?? "").trim();
  const subType = String(formData.get("subType") ?? "operating_expense");
  const values = { accountCode, accountName, subType };

  if (accountCode && !/^[0-9]+$/.test(accountCode)) {
    return { success: false as const, error: "Account code must be numeric", values };
  }
  if (!accountName) {
    return { success: false as const, error: "Account name is required", values };
  }

  const { DIRECT_COST_SUBTYPES, COA_RANGES, nextCodeInRange } = await import(
    "@/lib/coa-codes"
  );
  // lib/coa-codes.js is plain JS, so the tuple shape has to be asserted.
  const range = (
    DIRECT_COST_SUBTYPES.has(subType) ? COA_RANGES.direct_cost : COA_RANGES.expense
  ) as [number, number];

  try {
    return await withAuthorizedTenant(
      [...FINANCE_WRITE_ROLES],
      async (tx, { companyId }) => {
        let finalCode = accountCode;
        if (!finalCode) {
          const existing = await accountsRepo.listAccounts(tx, {
            activeOnly: false,
          });
          finalCode = nextCodeInRange(
            existing.map((a) => a.accountCode),
            range,
          );
          if (!finalCode) {
            return {
              success: false as const,
              error: "No free codes left in this range — enter one manually.",
              values,
            };
          }
        } else {
          const codeNum = parseInt(finalCode, 10);
          if (codeNum < range[0] || codeNum > range[1]) {
            return {
              success: false as const,
              error: `${
                DIRECT_COST_SUBTYPES.has(subType) ? "Direct cost/COGS" : "Expense"
              } account codes must be between ${range[0]} and ${range[1]}`,
              values,
            };
          }
        }

        // Uniqueness is a unique index, not a SELECT-then-INSERT: two people
        // adding "Site Fuel" at once both passed the Mongo check.
        const created = await accountsRepo.createAccount(tx, {
          companyId,
          accountCode: finalCode,
          accountName,
          accountType: "expense",
          subType,
          // canPost and isActive both default to true on the column, which is
          // what the Mongo path set them to by hand.
        });

        revalidatePath("/dashboard/accounts");
        return {
          success: true as const,
          account: {
            _id: created.id,
            id: created.id,
            accountCode: created.accountCode,
            accountName: created.accountName,
          },
        };
      },
    );
  } catch (err) {
    return { success: false as const, error: userMessage(err), values };
  }
}

export async function updateAccountPg(
  accountId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    return await withAuthorizedTenant([...FINANCE_WRITE_ROLES], async (tx) => {
      await accountsRepo.updateAccount(tx, accountId, {
        accountName: parsed.data.accountName,
        subType: parsed.data.subType,
        description: parsed.data.description,
        accountType: parsed.data.accountType,
        accountCode: parsed.data.accountCode,
      });
      revalidatePath("/dashboard/accounts");
      revalidatePath(`/dashboard/accounts/${accountId}`);
      return { success: true as const, accountId, message: "Account updated" };
    });
  } catch (err) {
    return fail(err);
  }
}

export async function deactivateAccountPg(accountId: string): Promise<ActionResult> {
  try {
    return await withAuthorizedTenant([...FINANCE_WRITE_ROLES], async (tx) => {
      await accountsRepo.deactivateAccount(tx, accountId);
      revalidatePath("/dashboard/accounts");
      return { success: true as const, accountId, message: "Account deactivated" };
    });
  } catch (err) {
    return fail(err);
  }
}

export async function activateAccountPg(accountId: string): Promise<ActionResult> {
  try {
    return await withAuthorizedTenant([...FINANCE_WRITE_ROLES], async (tx) => {
      await accountsRepo.activateAccount(tx, accountId);
      revalidatePath("/dashboard/accounts");
      return { success: true as const, accountId, message: "Account activated" };
    });
  } catch (err) {
    return fail(err);
  }
}

/**
 * What the old "recalculate balance" button did.
 *
 * There is nothing to recalculate: the balance is a view over the journal
 * lines (§4.4), so it is already whatever the entries say. This returns the
 * current figure so the button can report it rather than pretending to repair
 * something.
 */
export async function refreshAccountBalancePg(
  accountId: string,
): Promise<ActionResult> {
  try {
    return await withAuthorizedTenant([], async (tx) => {
      const account = await accountsRepo.getAccount(tx, accountId);
      if (!account) return { success: false as const, error: "Account not found" };
      revalidatePath("/dashboard/accounts");
      return {
        success: true as const,
        accountId,
        message: `Balance is ${account.cachedBalance.toFixed(2)} — derived from the ledger, always current`,
      };
    });
  } catch (err) {
    return fail(err);
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getAccountStatsPg() {
  return withAuthorizedTenant([], (tx) => accountsRepo.getAccountStats(tx));
}

export async function getAccountByIdPg(accountId: string) {
  return withAuthorizedTenant([], (tx) => accountsRepo.getAccount(tx, accountId));
}

export async function getAccountLedgerPg(
  accountId: string,
  opts: { limit?: number; startDate?: string; endDate?: string } = {},
) {
  return withAuthorizedTenant([], async (tx) => {
    const account = await accountsRepo.getAccount(tx, accountId);
    if (!account) return null;
    const entries = await accountsRepo.getAccountLedger(tx, accountId, opts);
    return { account, entries };
  });
}

export async function getAccountHierarchyPg() {
  return withAuthorizedTenant([], (tx) => accountsRepo.getAccountHierarchy(tx));
}
