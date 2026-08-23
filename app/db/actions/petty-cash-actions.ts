"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import {
  PETTY_CASH_CUSTODIAN_ROLES,
  PETTY_CASH_APPROVER_ROLES,
} from "@/lib/utils/role-gates";
import * as pettyCash from "../repositories/pettyCash";
import * as accountsRepo from "../repositories/accounts";
import {
  createReturnSchema,
  fundFloatSchema,
  rejectReturnSchema,
  toMoney,
} from "../validation/pettyCash";

/**
 * Petty cash on Postgres (0060) — the last module out of the Mongo ledger.
 *
 * Thin, like the expense and quote actions: parse, gate, call the repository,
 * revalidate. `fundFloat` is the one posting, and with it no Mongo module
 * holds a journal entry.
 */

export type ActionResult =
  | {
      success: true;
      returnId?: string;
      documentNumber?: string;
      entryNumber?: string;
      message?: string;
    }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * app/db/errors.ts already walks the `cause` chain and translates constraint
 * names — drizzle wraps a driver failure as "Failed query: insert into ..."
 * and hangs the PostgresError carrying `constraint_name` off `cause`, so a
 * check against `err.message` alone matches nothing.
 *
 * Found by the overlap test, which caught the constraint firing and the
 * translation not. The constraint names for this module are registered there
 * with the rest rather than kept in a second list here.
 */
function toActionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  // Errors the repository raises itself, which are already written for a
  // reader and carry no constraint name.
  if (
    message.includes("not found") ||
    message.includes("not a cash account") ||
    message.includes("cannot be posted to") ||
    message.includes("must differ") ||
    message.includes("greater than zero") ||
    message.includes("already") ||
    message.includes("Only a submitted") ||
    message.includes("can only be added") ||
    message.includes("Say why") ||
    message.includes("permission")
  ) {
    return message;
  }

  return userMessage(err, "Something went wrong with this petty cash return.");
}

function fieldErrorsOf(err: { flatten: () => { fieldErrors: unknown } }) {
  return err.flatten().fieldErrors as Record<string, string[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

export async function createPettyCashReturnPg(input: {
  floatAccountId: string;
  from: string;
  to: string;
  notes?: string;
}): Promise<ActionResult> {
  const parsed = createReturnSchema.safeParse(input);
  if (!parsed.success) {
    const fe = fieldErrorsOf(parsed.error);
    return {
      success: false,
      error: Object.values(fe)[0]?.[0] ?? "Check the period and the account.",
      fieldErrors: fe,
    };
  }

  try {
    const ret = await withAuthorizedTenant(
      [...PETTY_CASH_CUSTODIAN_ROLES],
      (tx, { user, companyId }) =>
        pettyCash.createReturn(tx, {
          companyId,
          floatAccountId: parsed.data.floatAccountId,
          from: parsed.data.from,
          to: parsed.data.to,
          custodianUserId: user.id,
          custodianName: user.name,
          notes: parsed.data.notes ?? null,
          createdById: user.id,
        }),
    );

    revalidatePath("/dashboard/petty-cash");
    return {
      success: true,
      returnId: ret.id,
      documentNumber: ret.documentNumber,
      message: `Return ${ret.documentNumber} opened`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * DR Petty Cash / CR Bank — the last journal posting to leave MongoDB.
 */
export async function fundPettyCashPg(
  returnId: string,
  input: { sourceAccountId: string; amount: number; date?: string; note?: string },
): Promise<ActionResult> {
  const parsed = fundFloatSchema.safeParse(input);
  if (!parsed.success) {
    const fe = fieldErrorsOf(parsed.error);
    return {
      success: false,
      error: Object.values(fe)[0]?.[0] ?? "Check the amount and the account.",
      fieldErrors: fe,
    };
  }

  try {
    const entry = await withAuthorizedTenant(
      [...PETTY_CASH_CUSTODIAN_ROLES],
      (tx, { user }) =>
        pettyCash.fundFloat(tx, returnId, {
          sourceAccountId: parsed.data.sourceAccountId,
          amount: toMoney(parsed.data.amount),
          date: parsed.data.date ?? null,
          note: parsed.data.note ?? null,
          fundedById: user.id,
        }),
    );

    revalidatePath("/dashboard/petty-cash");
    revalidatePath(`/dashboard/petty-cash/${returnId}`);
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      returnId,
      entryNumber: entry.entryNumber,
      message: `Float posted — ${entry.entryNumber}`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function submitPettyCashReturnPg(
  returnId: string,
): Promise<ActionResult> {
  try {
    const ret = await withAuthorizedTenant(
      [...PETTY_CASH_CUSTODIAN_ROLES],
      (tx, { user }) =>
        pettyCash.submitReturn(tx, returnId, { preparedById: user.id }),
    );

    revalidatePath("/dashboard/petty-cash");
    revalidatePath(`/dashboard/petty-cash/${returnId}`);
    return {
      success: true,
      returnId,
      message: `${ret.documentNumber} submitted for sign-off`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function approvePettyCashReturnPg(
  returnId: string,
): Promise<ActionResult> {
  try {
    const ret = await withAuthorizedTenant(
      [...PETTY_CASH_APPROVER_ROLES],
      (tx, { user }) =>
        pettyCash.approveReturn(tx, returnId, { approvedById: user.id }),
    );

    revalidatePath("/dashboard/petty-cash");
    revalidatePath(`/dashboard/petty-cash/${returnId}`);
    return {
      success: true,
      returnId,
      message: `${ret.documentNumber} approved`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function rejectPettyCashReturnPg(
  returnId: string,
  reason: string,
): Promise<ActionResult> {
  const parsed = rejectReturnSchema.safeParse({ reason });
  if (!parsed.success) {
    return {
      success: false,
      error: fieldErrorsOf(parsed.error).reason?.[0] ?? "A reason is required",
    };
  }

  try {
    const ret = await withAuthorizedTenant(
      [...PETTY_CASH_APPROVER_ROLES],
      (tx, { user }) =>
        pettyCash.rejectReturn(tx, returnId, {
          reason: parsed.data.reason,
          reviewedById: user.id,
        }),
    );

    revalidatePath("/dashboard/petty-cash");
    revalidatePath(`/dashboard/petty-cash/${returnId}`);
    return {
      success: true,
      returnId,
      message: `${ret.documentNumber} sent back to the custodian`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function getPettyCashReturnsPg(
  opts: { status?: string; floatAccountId?: string } = {},
) {
  return withAuthorizedTenant([], (tx) => pettyCash.listReturns(tx, opts));
}

export async function getPettyCashReturnByIdPg(returnId: string) {
  return withAuthorizedTenant([], (tx) =>
    pettyCash.getReturnForDisplay(tx, returnId),
  );
}

export async function getPettyCashFloatAccountsPg() {
  return withAuthorizedTenant([], (tx) => pettyCash.listFloatAccounts(tx));
}

/** The COA expense accounts a spend can be booked against. */
export async function getPettyCashExpenseAccountsPg() {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await accountsRepo.listAccounts(tx, {
      accountType: "expense",
      postableOnly: true,
    });
    return rows.map((a) => ({
      _id: a.id,
      id: a.id,
      accountCode: a.accountCode,
      accountName: a.accountName,
    }));
  });
}
