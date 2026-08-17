"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedTenant, FINANCE_ROLES } from "../tenant";
import * as journal from "../repositories/journal";
import * as reports from "../repositories/reports";
import * as accountsRepo from "../repositories/accounts";

/**
 * Postgres-backed journal actions.
 *
 * Contrast with app/mongodb/actions/journal-actions.js: the Zod schema there
 * carries three refinements that reimplement accounting rules in JavaScript —
 * debits must equal credits (with a `Math.abs(...) < 0.01` tolerance), each
 * line must have a debit or a credit, and no line may have both.
 *
 * Those refinements are gone here, because the database enforces all three and
 * cannot be talked out of it (migration 0001). What remains is shape
 * validation, whose job is a friendly error message — not correctness.
 *
 * Money is handled as strings end to end. Never Number() these values.
 */

const MONEY = /^\d+(\.\d{1,4})?$/;

const lineSchema = z.object({
  accountId: z.string().uuid("Account is required"),
  debit: z.string().regex(MONEY, "Invalid amount").default("0"),
  credit: z.string().regex(MONEY, "Invalid amount").default("0"),
  description: z.string().optional(),
});

const createSchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  entryType: z.enum([
    "adjustment",
    "opening_balance",
    "closing",
    "transfer",
    "contra",
    "bank_entry",
    "cash_entry",
    "accrual",
    "depreciation",
    "write_off",
    "revaluation",
    "other",
  ]),
  description: z.string().min(1, "Description is required"),
  reference: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(2, "At least 2 lines required"),
  postImmediately: z.boolean().default(false),
});

/**
 * Deliberately identical to the shape app/mongodb/actions/journal-actions.js
 * returns — the form reads state.success / state.entryId / state.error /
 * state.fieldErrors. Matching it means the UI can switch data source without
 * any change to the component.
 */
export type ActionResult =
  | { success: true; entryId?: string; entryNumber?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Postgres raises accounting violations as check_violation with a readable
 * message (e.g. "Journal entry JE-00042 is not balanced: debits 100.0000 <>
 * credits 99.9950"). Surface those; hide anything else.
 */
function toActionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    // Accounting violations raised by the database, already phrased for a user.
    message.includes("not balanced") ||
    message.includes("must have at least 2 lines") ||
    message.includes("fiscal period") ||
    message.includes("system account") ||
    // Authorisation — telling the user they lack permission is the whole point
    // of the check. Swallowing it into "something went wrong" leaves them
    // retrying a thing that will never work.
    message.includes("permission") ||
    message.includes("Not authenticated") ||
    // Not surfaced verbatim, but distinguishable in logs from a generic fault.
    message.includes("row-level security")
  ) {
    return message;
  }
  console.error("journal action failed:", err);
  return "Something went wrong. Please try again.";
}

function parseLines(formData: FormData) {
  const lines = [];
  let i = 0;
  while (formData.has(`lines[${i}].accountId`)) {
    lines.push({
      accountId: String(formData.get(`lines[${i}].accountId`)),
      debit: String(formData.get(`lines[${i}].debit`) || "0"),
      credit: String(formData.get(`lines[${i}].credit`) || "0"),
      description: String(formData.get(`lines[${i}].description`) || ""),
    });
    i++;
  }
  return lines;
}

export async function createManualJournalEntry(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createSchema.safeParse({
    entryDate: formData.get("entryDate"),
    entryType: formData.get("entryType"),
    description: formData.get("description"),
    reference: formData.get("reference") || undefined,
    notes: formData.get("notes") || undefined,
    lines: parseLines(formData),
    postImmediately: formData.get("postImmediately") === "true",
  });

  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const entry = await withAuthorizedTenant(
      FINANCE_ROLES,
      (tx, { user, companyId }) =>
        journal.createJournalEntry(tx, {
          companyId,
          ...parsed.data,
          createdById: user.id,
        }),
    );

    revalidatePath("/dashboard/journal");
    return {
      success: true,
      entryId: entry.id,
      entryNumber: entry.entryNumber,
      message: `Journal entry ${entry.entryNumber} created`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function postJournalEntry(
  entryId: string,
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(FINANCE_ROLES, (tx, { user }) =>
      journal.postJournalEntry(tx, entryId, user.id),
    );
    revalidatePath("/dashboard/journal");
    return { success: true, message: "Journal entry posted" };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function reverseJournalEntry(
  entryId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const reversal = await withAuthorizedTenant(FINANCE_ROLES, (tx, { user }) =>
      journal.reverseJournalEntry(tx, entryId, user.id, reason),
    );
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      message: `Reversed with entry ${reversal.entryNumber}`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function deleteDraftJournalEntry(
  entryId: string,
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(FINANCE_ROLES, (tx) =>
      journal.deleteDraftJournalEntry(tx, entryId),
    );
    revalidatePath("/dashboard/journal");
    return { success: true, message: "Draft deleted" };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function getJournalEntries(opts: {
  limit?: number;
  offset?: number;
  status?: "draft" | "posted" | "reversed";
} = {}) {
  return withAuthorizedTenant(FINANCE_ROLES, (tx) =>
    journal.listJournalEntries(tx, opts),
  );
}

export async function getJournalEntry(entryId: string) {
  return withAuthorizedTenant(FINANCE_ROLES, (tx) =>
    journal.getJournalEntry(tx, entryId),
  );
}

// ── reports ──────────────────────────────────────────────────────────────────

export async function getTrialBalance() {
  return withAuthorizedTenant(FINANCE_ROLES, (tx) =>
    reports.getTrialBalance(tx),
  );
}

export async function getAgingReport(
  side: "receivable" | "payable",
  asOfDate: string,
) {
  return withAuthorizedTenant(FINANCE_ROLES, (tx) =>
    reports.getAgingReport(tx, side, asOfDate),
  );
}

export async function getStatementOfAccount(
  partyType: "customer" | "supplier",
  partyId: string,
  startDate: string,
  endDate: string,
) {
  return withAuthorizedTenant(FINANCE_ROLES, (tx) =>
    reports.getStatementOfAccount(tx, partyType, partyId, startDate, endDate),
  );
}

/**
 * Postable accounts for the journal entry form, shaped like the Mongo page's
 * getFormData() so the same component renders either source. Ids are Postgres
 * uuids, so a form loaded from this source must submit to the Postgres action.
 */
export async function getPostableAccountsPg() {
  return withAuthorizedTenant(FINANCE_ROLES, async (tx) => {
    const rows = await accountsRepo.listAccounts(tx, {
      activeOnly: true,
      postableOnly: true,
    });
    return rows.map((a) => ({
      _id: a.id,
      accountCode: a.accountCode,
      accountName: a.accountName,
      accountType: a.accountType,
      subType: a.subType ?? "",
    }));
  });
}
