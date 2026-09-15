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
  /**
   * THE PROJECT THIS ENTRY IS FOR — 0084, and the thing that could not be done
   * at all before it.
   *
   * A manual journal has no source document, so nothing could infer its
   * project from anywhere: `computeProjectActuals` scans invoices, bills,
   * claims, expenses and stock requests, and a journal is none of those. An
   * accrual, a reallocation or a correction against a job was invisible to the
   * project however carefully it was written.
   *
   * Optional, and empty means what it says — a general entry belonging to no
   * job, which is most of them.
   */
  projectId: z.string().uuid("Invalid project").optional(),
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
    message.includes("No company selected") ||
    message.includes("No company has been set up") ||
    // A deactivated tenant is something the person needs told, not hidden
    // behind a generic failure.
    message.includes("not active") ||
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
    projectId: formData.get("projectId") || undefined,
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

/** The chart of accounts for the accounts page — a tree per type, with balances. */
export async function getAccountsGroupedPg() {
  return withAuthorizedTenant([], (tx) => accountsRepo.getAccountsGrouped(tx));
}

// ─────────────────────────────────────────────────────────────────────────────
// The journal browser — the screens that were reading the other ledger.
//
// `/dashboard/journal/create` has written here since the ledger ported, while
// the list, the stats and the detail page all read the Mongo `JournalEntry`
// collection. A manual entry raised through the UI therefore never appeared on
// the page it was raised from, and every automatic posting was invisible in
// the browser entirely.
//
// SHAPES ARE THE SCREENS'. `_id` beside `id`, `party.name`, `totals.debit`,
// `createdBy.name` — the components read those, so they move over by changing
// an import and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

/** `_id` as well as `id`: the timeline keys on `_id` and links on it. */
function withMongoId(row: Record<string, unknown>) {
  return { ...row, _id: String(row.id) };
}

export async function getJournalEntriesForTimeline(
  filters: journal.JournalTimelineFilters = {},
  limit = 20,
  cursor: string | null = null,
) {
  return withAuthorizedTenant(FINANCE_ROLES, async (tx) => {
    const page = await journal.listJournalTimeline(tx, filters, limit, cursor);
    return { ...page, entries: page.entries.map(withMongoId) };
  });
}

export async function getJournalStatsForDashboard() {
  return withAuthorizedTenant(FINANCE_ROLES, (tx) => journal.getJournalStats(tx));
}

export async function getJournalEntryById(entryId: string) {
  if (!entryId) return null;
  return withAuthorizedTenant(FINANCE_ROLES, async (tx) => {
    const entry = await journal.getJournalEntryDetail(tx, entryId);
    return entry ? withMongoId(entry) : null;
  });
}
