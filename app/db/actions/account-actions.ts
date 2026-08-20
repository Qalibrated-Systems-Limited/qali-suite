"use server";

import { revalidatePath } from "next/cache";
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
    parentId: formData.get("parentId") || null,
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
