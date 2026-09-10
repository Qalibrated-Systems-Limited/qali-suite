"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import * as bankFeed from "../repositories/bankFeed";
import { requirePlanAccess } from "@/lib/plan-gate";
import { parseCSV } from "@/lib/bank-feed-parsing";

/**
 * The bank feed on Postgres — 0100.
 *
 * The module was carried as "stays on Mongo by decision … not currently
 * broken". It read Mongo `Account`, `Invoice` and `Bill`, all of which moved,
 * so the bank picker was empty, every account picker in the allocation dialog
 * was empty, and no line could be matched to anything. It was inert.
 *
 * RESULT SHAPES ARE THE SCREENS' — `{ success, data }` with `_id`,
 * `stats.unallocatedLines`, `matchedDocument`, `suggestions[]` — so the eight
 * screens move over by changing an import path.
 *
 * WHO MAY DO WHAT. Allocating a bank line posts to the ledger, so the write
 * gate is FINANCE_WRITE_ROLES, spelled out rather than taken from a nav
 * predicate — the mistake the sales-orders port found. Reads are open to
 * anyone who can see the module.
 */

const FINANCE_ROLES = [
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
];

type ActionResult<T = unknown> =
  | { success: true; data?: T; message?: string }
  | { success: false; error: string };

function revalidateBanking(statementId?: string | null) {
  revalidatePath("/dashboard/banking");
  revalidatePath("/dashboard/banking/unallocated");
  revalidatePath("/dashboard/dashboard");
  if (statementId) revalidatePath(`/dashboard/banking/${statementId}`);
}

/** Allocation moves money, so the ledger screens change with it. */
function revalidateLedger() {
  revalidatePath("/dashboard/payments");
  revalidatePath("/dashboard/invoices");
  revalidatePath("/dashboard/bills");
  revalidatePath("/dashboard/journal");
  revalidatePath("/dashboard/reports");
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function getBankAccounts() {
  try {
    return await withAuthorizedTenant([], (tx) => bankFeed.listBankAccounts(tx));
  } catch {
    return [];
  }
}

export async function getBankStatements(page = 1, limit = 20) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      bankFeed.listStatements(tx, page, limit),
    );
  } catch {
    /**
     * The fallback must be the SAME SHAPE as the success path, or it is not a
     * fallback. This returned a flat `{ statements, total, page, totalPages }`
     * while the page destructures `{ pagination }` — so a failure here did not
     * degrade to an empty list, it crashed the render with "Cannot read
     * properties of undefined (reading 'total')" and hid the real error behind
     * the bare `catch`.
     */
    return {
      statements: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    };
  }
}

export async function getBankStatementById(statementId: string) {
  if (!statementId) return null;
  return withAuthorizedTenant([], (tx) => bankFeed.getStatement(tx, statementId));
}

export async function getStatementSummary(statementId: string) {
  if (!statementId) return null;
  return withAuthorizedTenant([], (tx) =>
    bankFeed.getStatementSummary(tx, statementId),
  );
}

/**
 * Takes a FILTERS OBJECT, because that is what its only caller has always
 * passed: `getBankFeedLines(id, { status, type, search }, page, 50)`.
 *
 * The signature used to be `(statementId, status, page, limit, search)`, so
 * that call bound the whole object to `status` and left `search` undefined.
 * The object is truthy, so it reached `l.status = $1::bank_line_status` — and
 * the filter was broken rather than ignored.
 *
 * `type` is the page's name for the direction; both spellings are accepted so
 * neither caller has to change.
 */
export async function getBankFeedLines(
  statementId: string,
  filters: { status?: string; type?: string; direction?: string; search?: string } = {},
  page = 1,
  limit = 50,
) {
  const direction = filters.direction ?? filters.type ?? null;
  return withAuthorizedTenant([], (tx) =>
    bankFeed.listLines(tx, statementId, {
      status: filters.status || null,
      search: filters.search || null,
      direction: direction === "in" || direction === "out" ? direction : null,
      page,
      limit,
    }),
  );
}

export async function getBankFeedLineById(lineId: string) {
  if (!lineId) return null;
  return withAuthorizedTenant([], (tx) => bankFeed.getLine(tx, lineId));
}

/**
 * The dashboard badge.
 *
 * Degrades to zero rather than taking the accountant's home screen down —
 * the same reasoning the pipeline and backlog tiles carry.
 */
export async function getUnallocatedCount() {
  try {
    return await withAuthorizedTenant([], (tx) =>
      bankFeed.getUnallocatedCount(tx),
    );
  } catch {
    return 0;
  }
}

export async function getAllUnallocatedLines(
  filters: Record<string, string | null> = {},
  page = 1,
  limit = 50,
) {
  return withAuthorizedTenant([], (tx) =>
    bankFeed.listAllUnallocated(
      tx,
      {
        bankAccountId: filters.bankAccountId ?? null,
        // `type` is what the unallocated page sends; `direction` is what this
        // read before. Only the second was ever checked, so the in/out filter
        // on that screen did nothing at all.
        direction: ((filters.direction ?? filters.type) as "in" | "out" | null) ?? null,
        search: filters.search ?? null,
        from: filters.from ?? null,
        to: filters.to ?? null,
      },
      page,
      limit,
    ),
  );
}

/** The allocation dialog's account pickers — all of them empty until now. */
export async function getExpenseAccounts() {
  return withAuthorizedTenant([], (tx) =>
    bankFeed.listPostableAccounts(tx, "expense"),
  );
}

export async function getIncomeAccounts() {
  return withAuthorizedTenant([], (tx) =>
    bankFeed.listPostableAccounts(tx, "revenue"),
  );
}

export async function getLiabilityAccounts() {
  return withAuthorizedTenant([], (tx) =>
    bankFeed.listPostableAccounts(tx, "liability"),
  );
}

export async function getEquityAccounts() {
  return withAuthorizedTenant([], (tx) =>
    bankFeed.listPostableAccounts(tx, "equity"),
  );
}

export async function getAllPostableAccounts() {
  return withAuthorizedTenant([], (tx) =>
    bankFeed.listPostableAccounts(tx, "all"),
  );
}

/** Where a transfer can go — every cash-like account except this one. */
export async function getTransferAccounts(excludeAccountId?: string) {
  return withAuthorizedTenant([], (tx) =>
    bankFeed.listPostableAccounts(tx, "asset", {
      excludeId: excludeAccountId ?? null,
      cashOnly: true,
    }),
  );
}

export async function searchMatchingInvoices(_amount?: number, searchTerm = "") {
  return withAuthorizedTenant([], (tx) =>
    bankFeed.listOpenDocuments(tx, "invoice", { search: searchTerm || null }),
  );
}

export async function searchMatchingBills(_amount?: number, searchTerm = "") {
  return withAuthorizedTenant([], (tx) =>
    bankFeed.listOpenDocuments(tx, "bill", { search: searchTerm || null }),
  );
}

export async function searchPartiesForAllocation(
  type: "customer" | "supplier",
  searchTerm = "",
) {
  return withAuthorizedTenant([], async (tx) => {
    const { searchParties } = await import("../repositories/parties");
    return searchParties(tx, { query: searchTerm, type, perPage: 20 });
  });
}

// ── Import ──────────────────────────────────────────────────────────────────

/**
 * Parse an uploaded CSV and store its lines.
 *
 * The diagnostics survive now. `parseCSV` used to hang them off the returned
 * ARRAY (`parsedLines.diagnostics = {...}`), which does not survive `.map()`,
 * `.filter()` or serialisation — so the specific "your date format is wrong"
 * message was one array operation away from silently becoming the generic one.
 * It returns `{ lines, diagnostics }` now.
 */
export async function importBankStatement(
  formData: FormData,
): Promise<ActionResult<{ statementId: string; imported: number; duplicates: number }>> {
  try {
    await requirePlanAccess("finance");

    const bankAccountId = String(formData.get("bankAccountId") ?? "");
    const fileName = String(formData.get("fileName") ?? "statement.csv");
    const csvContent = String(formData.get("csvContent") ?? "");
    const dateFormat = String(formData.get("dateFormat") || "DD/MM/YYYY");
    const rawMapping = formData.get("columnMapping");

    if (!bankAccountId || !csvContent || !rawMapping) {
      return { success: false, error: "Choose a bank account and a file first." };
    }

    let columnMapping: Record<string, string>;
    try {
      columnMapping = JSON.parse(String(rawMapping));
    } catch {
      return { success: false, error: "The column mapping could not be read." };
    }

    const { lines, diagnostics } = parseCSV(csvContent, columnMapping, dateFormat);

    if (lines.length === 0) {
      if (
        diagnostics.droppedDateInvalid > 0 &&
        diagnostics.droppedDateInvalid === diagnostics.totalDataRows
      ) {
        return {
          success: false,
          error: `Could not read a date on any row. The file does not look like "${dateFormat}" — change the date format on the previous step.`,
        };
      }
      if (
        diagnostics.droppedZeroAmount > 0 &&
        diagnostics.droppedZeroAmount === diagnostics.totalDataRows
      ) {
        return {
          success: false,
          error:
            "Every row came out at zero, or with money in both directions. Check the debit and credit column mapping.",
        };
      }
      return {
        success: false,
        error: "No usable transactions in that file. Check the date format and the column mapping.",
      };
    }

    const result = await withAuthorizedTenant(
      FINANCE_ROLES,
      async (tx, { user, companyId }) => {
        const { generateContentHash } = await import("@/lib/bank-feed-parsing");

        const statement = await bankFeed.createStatement(tx, {
          companyId,
          bankAccountId,
          fileName,
          columnMapping,
          dateFormat,
          contentHash: generateContentHash(csvContent),
          uploadedById: user.id,
          uploadedByName: user.name ?? "System",
        });

        const imported = await bankFeed.importLines(tx, statement.id, lines, {
          companyId,
          bankAccountId,
        });

        /*
         * Matching runs INSIDE the transaction, not in a fire-and-forget
         * promise. Mongo called `autoMatchLines(...).catch(console.error)`
         * from the importer, so the suggestions arrived some time after the
         * page did — and a failure went to a server log while the screen said
         * the import had worked.
         */
        const matched = await bankFeed.autoMatch(tx, statement.id);

        return { statement, imported, matched };
      },
    );

    revalidateBanking(result.statement.id);
    return {
      success: true,
      data: {
        statementId: result.statement.id,
        imported: result.imported.insertedCount,
        duplicates: result.imported.duplicatesSkipped,
      },
      message: result.imported.message,
    };
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to import the statement") };
  }
}

export async function deleteBankStatement(
  statementId: string,
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(FINANCE_ROLES, (tx) =>
      bankFeed.deleteStatement(tx, statementId),
    );
    revalidateBanking();
    return { success: true, message: "Statement deleted." };
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to delete the statement") };
  }
}

export async function rerunAutoMatch(statementId: string): Promise<ActionResult> {
  try {
    const result = await withAuthorizedTenant(FINANCE_ROLES, (tx) =>
      bankFeed.autoMatch(tx, statementId),
    );
    revalidateBanking(statementId);
    return {
      success: true,
      message: `Scored ${result.scored} line${result.scored === 1 ? "" : "s"} — ${result.suggested} suggestion${result.suggested === 1 ? "" : "s"}, ${result.confident} of them confident.`,
    };
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to re-run matching") };
  }
}

// ── Allocation ──────────────────────────────────────────────────────────────

async function allocateDocument(
  lineId: string,
  documentType: "invoice" | "bill",
  documentId: string,
): Promise<ActionResult> {
  try {
    const result = await withAuthorizedTenant(FINANCE_ROLES, (tx, { user }) =>
      bankFeed.allocateToDocument(
        tx,
        lineId,
        { documentType, documentId },
        { id: user.id, name: user.name ?? null },
      ),
    );
    revalidateBanking();
    revalidateLedger();
    return { success: true, message: result.message, data: result };
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to allocate the line") };
  }
}

export async function allocateToInvoice(lineId: string, invoiceId: string) {
  return allocateDocument(lineId, "invoice", invoiceId);
}

export async function allocateToBill(lineId: string, billId: string) {
  return allocateDocument(lineId, "bill", billId);
}

interface LegInput {
  accountId: string;
  amount?: number;
  description?: string | null;
  taxAmount?: number | null;
  taxAccountId?: string | null;
  partyId?: string | null;
  partyName?: string | null;
}

async function allocateAccounts(
  lineId: string,
  legs: LegInput[],
  kind: "expense" | "income" | "liability" | "split",
  meta: { description?: string | null; partyId?: string | null; partyName?: string | null },
): Promise<ActionResult> {
  try {
    const result = await withAuthorizedTenant(FINANCE_ROLES, async (tx, { user }) => {
      /*
       * A single-account allocation does not say its amount — it is the whole
       * line, whichever direction that is. Resolved here rather than trusting
       * the caller, because the repository refuses a total that does not match
       * and the dialog has never sent one.
       */
      const line = await bankFeed.getLine(tx, lineId);
      if (!line) throw new Error("Bank feed line not found.");
      const whole = line.debitAmount > 0 ? line.debitAmount : line.creditAmount;

      const resolved = legs.map((l) => ({
        accountId: l.accountId,
        amount: l.amount == null ? whole : Number(l.amount),
        description: l.description ?? null,
        taxAmount: l.taxAmount ?? null,
        taxAccountId: l.taxAccountId ?? null,
      }));

      return bankFeed.allocateToAccounts(
        tx,
        lineId,
        resolved,
        { allocationType: kind, ...meta },
        { id: user.id, name: user.name ?? null },
      );
    });

    revalidateBanking();
    revalidateLedger();
    return { success: true, message: result.message, data: result };
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to allocate the line") };
  }
}

export async function allocateToExpense(lineId: string, allocationData: LegInput) {
  return allocateAccounts(lineId, [allocationData], "expense", {
    description: allocationData.description ?? null,
    partyId: allocationData.partyId ?? null,
    partyName: allocationData.partyName ?? null,
  });
}

export async function allocateToIncome(lineId: string, allocationData: LegInput) {
  return allocateAccounts(lineId, [allocationData], "income", {
    description: allocationData.description ?? null,
    partyId: allocationData.partyId ?? null,
    partyName: allocationData.partyName ?? null,
  });
}

export async function allocateToLiability(lineId: string, allocationData: LegInput) {
  return allocateAccounts(lineId, [allocationData], "liability", {
    description: allocationData.description ?? null,
    partyId: allocationData.partyId ?? null,
    partyName: allocationData.partyName ?? null,
  });
}

export async function allocateWithSplit(lineId: string, splits: LegInput[]) {
  if (!Array.isArray(splits) || splits.length === 0) {
    return { success: false as const, error: "A split needs at least one line." };
  }
  return allocateAccounts(lineId, splits, "split", { description: null });
}

export async function allocateAsTransfer(
  lineId: string,
  targetAccountId: string,
  description = "",
): Promise<ActionResult> {
  try {
    const result = await withAuthorizedTenant(FINANCE_ROLES, (tx, { user }) =>
      bankFeed.allocateAsTransfer(tx, lineId, targetAccountId, description || null, {
        id: user.id,
        name: user.name ?? null,
      }),
    );
    revalidateBanking();
    revalidateLedger();
    return { success: true, message: result.message, data: result };
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to record the transfer") };
  }
}

async function allocateMany(
  lineId: string,
  documentType: "invoice" | "bill",
  allocations: Array<{ documentId?: string; invoiceId?: string; billId?: string; amount: number }>,
): Promise<ActionResult> {
  try {
    const normalised = (allocations ?? [])
      .map((a) => ({
        documentId: String(a.documentId ?? a.invoiceId ?? a.billId ?? ""),
        amount: Number(a.amount ?? 0),
      }))
      .filter((a) => a.documentId && a.amount > 0);

    if (normalised.length === 0) {
      return { success: false, error: "Choose at least one document and an amount." };
    }

    const result = await withAuthorizedTenant(FINANCE_ROLES, (tx, { user }) =>
      bankFeed.allocateToMultipleDocuments(tx, lineId, documentType, normalised, {
        id: user.id,
        name: user.name ?? null,
      }),
    );
    revalidateBanking();
    revalidateLedger();
    return { success: true, message: result.message, data: result };
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to allocate the line") };
  }
}

export async function allocateToMultipleInvoices(
  lineId: string,
  invoiceAllocations: Array<{ documentId?: string; invoiceId?: string; amount: number }>,
) {
  return allocateMany(lineId, "invoice", invoiceAllocations);
}

export async function allocateToMultipleBills(
  lineId: string,
  billAllocations: Array<{ documentId?: string; billId?: string; amount: number }>,
) {
  return allocateMany(lineId, "bill", billAllocations);
}

export async function excludeBankLine(
  lineId: string,
  reason: string,
  note = "",
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(FINANCE_ROLES, (tx, { user }) =>
      bankFeed.excludeLine(tx, lineId, reason, note || null, {
        id: user.id,
        name: user.name ?? null,
      }),
    );
    revalidateBanking();
    return { success: true, message: "Line excluded from the reconciliation." };
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to exclude the line") };
  }
}

/**
 * Put a line back, undoing what it did.
 *
 * A posted entry is REVERSED and a payment is CANCELLED through the payments
 * module's own path — never deleted. See the repository.
 */
export async function undoAllocation(lineId: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(FINANCE_ROLES, (tx, { user }) =>
      bankFeed.undoAllocation(tx, lineId, { id: user.id, name: user.name ?? null }),
    );
    revalidateBanking();
    revalidateLedger();
    return { success: true, message: "Allocation undone — the posting was reversed." };
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to undo the allocation") };
  }
}

/** The queue screen's bulk action: the same allocation, several lines. */
export async function bulkAllocate(
  allocations: Array<{ lineId: string; type: string; accountId?: string; documentId?: string }>,
): Promise<ActionResult<{ succeeded: number; failed: number; errors: string[] }>> {
  const succeeded: string[] = [];
  const errors: string[] = [];

  const runOne = async (a: {
    lineId: string;
    type: string;
    accountId?: string;
    documentId?: string;
  }): Promise<ActionResult> => {
    if (a.type === "invoice" && a.documentId) {
      return allocateDocument(a.lineId, "invoice", a.documentId);
    }
    if (a.type === "bill" && a.documentId) {
      return allocateDocument(a.lineId, "bill", a.documentId);
    }
    if (a.accountId) {
      return allocateAccounts(
        a.lineId,
        [{ accountId: a.accountId }],
        a.type === "income" ? "income" : "expense",
        { description: null },
      );
    }
    return { success: false, error: "Nothing to allocate to." };
  };

  for (const a of allocations ?? []) {
    const result = await runOne(a);
    if (result.success === true) {
      succeeded.push(a.lineId);
    } else {
      errors.push(`${a.lineId}: ${result.error}`);
    }
  }

  revalidateBanking();
  revalidateLedger();

  /*
   * ONE LINE AT A TIME, each in its own transaction. A bulk allocation that
   * rolled back wholesale on the fourteenth line would undo thirteen postings
   * somebody watched succeed; reporting which ones failed is the honest shape.
   */
  return {
    success: true,
    data: { succeeded: succeeded.length, failed: errors.length, errors },
    message: `Allocated ${succeeded.length} line${succeeded.length === 1 ? "" : "s"}${errors.length ? `, ${errors.length} failed.` : "."}`,
  };
}
