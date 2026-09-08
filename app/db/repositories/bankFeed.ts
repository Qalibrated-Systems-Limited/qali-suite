import { eq, sql } from "drizzle-orm";
import { anyOf, isUuid, likeContains } from "./sqlHelpers";
import type { Tx } from "../client";
import {
  bankStatements,
  bankFeedLines,
  bankFeedLineAllocations,
  bankFeedLineSuggestions,
} from "../schema";
import * as accountsRepo from "./accounts";
import * as paymentsRepo from "./payments";
import { createJournalEntry, reverseJournalEntry } from "./journal";
import {
  generateLineHash,
  deriveBalances,
  calculateMatchConfidence,
  getMatchReason,
  AUTO_ALLOCATE_THRESHOLD,
  SUGGEST_THRESHOLD,
} from "@/lib/bank-feed-parsing";

/**
 * The bank feed — 0100.
 *
 * Contract with the layer above: every function takes a `tx` from
 * withTenant(), so RLS is active; nothing here reads the session. MONEY IS A
 * NUMBER on the way out, because the banking screens format and total it.
 *
 * ── What is not a transcription ────────────────────────────────────────────
 *
 * A MATCHED RECEIPT IS A PAYMENT. Mongo's `allocateToInvoice` posted its own
 * journal entry and hand-updated `invoice.amountPaid`. The payments module has
 * done exactly that, correctly, since 0063 — with a deferred trigger refusing
 * over-allocation, a trigger owning `amount_paid`, and a reversal path. So a
 * bank line matched to an invoice creates a real payment and confirms it, and
 * the receipt is then indistinguishable from one typed in by hand: it is on
 * the payments screen, on the statement, in AR aging, and it is reversible by
 * the path that already exists.
 *
 * THE STATS ARE A VIEW. Mongo kept six counters on the statement and refreshed
 * them from nine call sites. `bank_statement_stats` cannot drift.
 *
 * ALLOCATION LEGS AND SUGGESTIONS ARE ROWS, not embedded arrays.
 */

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const money = (n: number) => n.toFixed(4);

const iso = (v: unknown) => (v == null ? null : String(v));

// ── Bank accounts ───────────────────────────────────────────────────────────

/**
 * The accounts a statement can be reconciled against.
 *
 * The Mongo query matched a sub-type family OR a cash/bank system handle, and
 * it read the MONGO `Account` collection — so this list has been EMPTY since
 * §9C, and with it the upload screen's only picker. The same predicate, over
 * the store the accounts are actually in.
 */
export async function listBankAccounts(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT id, account_code, account_name, sub_type, system_account,
           bank_name, bank_account_number, bank_branch
      FROM accounts
     WHERE is_active = true
       AND can_post = true
       AND (
         COALESCE(sub_type, '') IN ('bank', 'cash', 'mpesa', 'mobile_money')
         OR COALESCE(system_account, '') IN
            ('bank_main', 'cash_at_bank', 'cash', 'mpesa', 'petty_cash')
       )
     ORDER BY account_code
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((a) => ({
    _id: String(a.id),
    id: String(a.id),
    accountCode: String(a.account_code),
    accountName: String(a.account_name),
    subType: (a.sub_type as string) ?? null,
    bankDetails: {
      bankName: (a.bank_name as string) ?? null,
      accountNumber: (a.bank_account_number as string) ?? null,
      branch: (a.bank_branch as string) ?? null,
    },
  }));
}

/**
 * Postable accounts of one kind, for the allocation dialog's pickers.
 *
 * Every one of these read Mongo `Account` and returned nothing, which is why
 * the dialog could not complete an allocation of any kind. Note the Mongo
 * queries asked for `accountType: "Expense"` — capitalised, as that schema's
 * enum was. The Postgres enum is lowercase, so a transcription of the string
 * would have kept the list empty in a new and more confusing way.
 */
export async function listPostableAccounts(
  tx: Tx,
  kind: "expense" | "revenue" | "liability" | "equity" | "asset" | "all",
  opts: { excludeId?: string | null; cashOnly?: boolean } = {},
) {
  const filters = [sql`is_active = true`, sql`can_post = true`];
  if (kind !== "all") filters.push(sql`account_type = ${kind}::account_type`);
  if (opts.excludeId && isUuid(opts.excludeId)) {
    filters.push(sql`id <> ${opts.excludeId}::uuid`);
  }
  if (opts.cashOnly) {
    filters.push(sql`(
      COALESCE(sub_type, '') IN ('bank', 'cash', 'mpesa', 'mobile_money')
      OR COALESCE(system_account, '') IN
         ('bank_main', 'cash_at_bank', 'cash', 'mpesa', 'petty_cash')
    )`);
  }

  const rows = (await tx.execute(sql`
    SELECT id, account_code, account_name, account_type, sub_type
      FROM accounts
     WHERE ${sql.join(filters, sql` AND `)}
     ORDER BY account_code
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((a) => ({
    _id: String(a.id),
    id: String(a.id),
    accountCode: String(a.account_code),
    accountName: String(a.account_name),
    accountType: a.account_type as string,
    subType: (a.sub_type as string) ?? null,
  }));
}

// ── Statements ──────────────────────────────────────────────────────────────

/**
 * SNAKE_CASE IN, camelCase out — and that is not cosmetic.
 *
 * These rows come from `tx.execute(sql\`SELECT s.*\`)`, which returns the
 * database's own column names. Reading `r.fileName` off one yields undefined,
 * silently: the page renders, with a blank file name, a null opening balance
 * and — the one that mattered — an undefined `journalEntryId`, so nothing
 * could find the entry an allocation had just posted. A test caught it by
 * looking for the journal lines and finding none.
 */
function toScreenStatement(r: Record<string, unknown>) {
  return {
    _id: String(r.id),
    id: String(r.id),
    fileName: String(r.file_name ?? ""),
    status: r.status as string,
    bankAccountId: String(r.bank_account_id),
    bankAccount: r.account_name
      ? {
          _id: String(r.bank_account_id),
          accountCode: String(r.account_code ?? ""),
          accountName: String(r.account_name ?? ""),
        }
      : null,
    statementPeriod: {
      startDate: iso(r.period_start),
      endDate: iso(r.period_end),
    },
    openingBalance: r.opening_balance == null ? null : num(r.opening_balance),
    closingBalance: r.closing_balance == null ? null : num(r.closing_balance),
    balanceSource: r.balance_source as string,
    dateFormat: (r.date_format as string) ?? "DD/MM/YYYY",
    columnMapping: {
      date: (r.mapping_date as string) ?? "",
      description: (r.mapping_description as string) ?? "",
      reference: (r.mapping_reference as string) ?? "",
      debit: (r.mapping_debit as string) ?? "",
      credit: (r.mapping_credit as string) ?? "",
      amount: (r.mapping_amount as string) ?? "",
      balance: (r.mapping_balance as string) ?? "",
    },
    errorMessage: (r.error_message as string) ?? null,
    /** Derived, always — see the view. */
    stats: {
      totalLines: num(r.total_lines),
      allocatedLines: num(r.allocated_lines),
      excludedLines: num(r.excluded_lines),
      unallocatedLines: num(r.unallocated_lines),
      totalDebits: num(r.total_debits),
      totalCredits: num(r.total_credits),
    },
    uploadedBy: {
      id: (r.uploaded_by_id as string) ?? null,
      name: (r.uploaded_by_name as string) ?? "System",
    },
    createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
  };
}

export async function listStatements(tx: Tx, page = 1, limit = 20) {
  const take = Math.min(Math.max(limit, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;

  const rows = (await tx.execute(sql`
    SELECT s.*, a.account_name, a.account_code,
           st.total_lines, st.allocated_lines, st.excluded_lines,
           st.unallocated_lines, st.total_debits, st.total_credits
      FROM bank_statements s
      JOIN accounts a ON a.id = s.bank_account_id
      LEFT JOIN bank_statement_stats st ON st.statement_id = s.id
     ORDER BY s.created_at DESC
     LIMIT ${take} OFFSET ${skip}
  `)) as unknown as Array<Record<string, unknown>>;

  const [count] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM bank_statements
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    statements: rows.map(toScreenStatement),
    total: num(count?.n),
    page: Math.max(page, 1),
    totalPages: Math.max(1, Math.ceil(num(count?.n) / take)),
  };
}

export async function getStatement(tx: Tx, statementId: string) {
  if (!isUuid(statementId)) return null;
  const [row] = (await tx.execute(sql`
    SELECT s.*, a.account_name, a.account_code,
           st.total_lines, st.allocated_lines, st.excluded_lines,
           st.unallocated_lines, st.total_debits, st.total_credits
      FROM bank_statements s
      JOIN accounts a ON a.id = s.bank_account_id
      LEFT JOIN bank_statement_stats st ON st.statement_id = s.id
     WHERE s.id = ${statementId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;

  return row ? toScreenStatement(row) : null;
}

/**
 * A statement's summary, including the reconciliation difference.
 *
 * `difference` is what the whole document exists to answer: the bank says the
 * account closed at X, our lines move it by Y from the opening balance, and
 * anything left over is unexplained.
 */
export async function getStatementSummary(tx: Tx, statementId: string) {
  const statement = await getStatement(tx, statementId);
  if (!statement) return null;

  const net = statement.stats.totalCredits - statement.stats.totalDebits;
  const expectedClosing =
    statement.openingBalance == null ? null : statement.openingBalance + net;
  const difference =
    statement.closingBalance == null || expectedClosing == null
      ? null
      : Math.round((statement.closingBalance - expectedClosing) * 100) / 100;

  return {
    ...statement,
    netMovement: Math.round(net * 100) / 100,
    expectedClosing:
      expectedClosing == null ? null : Math.round(expectedClosing * 100) / 100,
    difference,
    reconciled: difference != null && Math.abs(difference) < 0.01,
  };
}

export interface CreateStatementInput {
  companyId: string;
  bankAccountId: string;
  fileName: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  columnMapping?: Record<string, string | undefined> | null;
  dateFormat?: string;
  contentHash?: string | null;
  uploadedById?: string | null;
  uploadedByName?: string | null;
}

export async function createStatement(tx: Tx, input: CreateStatementInput) {
  if (input.contentHash) {
    const [existing] = (await tx.execute(sql`
      SELECT created_at FROM bank_statements
       WHERE content_hash = ${input.contentHash}
       LIMIT 1
    `)) as unknown as Array<Record<string, unknown>>;
    if (existing) {
      throw new Error(
        `Duplicate statement. A file with identical content was uploaded on ${new Date(
          String(existing.created_at),
        ).toLocaleDateString("en-KE")}.`,
      );
    }
  }

  const m = input.columnMapping ?? {};
  const [row] = await tx
    .insert(bankStatements)
    .values({
      companyId: input.companyId,
      bankAccountId: input.bankAccountId,
      fileName: input.fileName,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      status: "processing",
      mappingDate: m.date ?? null,
      mappingDescription: m.description ?? null,
      mappingReference: m.reference ?? null,
      mappingDebit: m.debit ?? null,
      mappingCredit: m.credit ?? null,
      mappingAmount: m.amount ?? null,
      mappingBalance: m.balance ?? null,
      dateFormat: input.dateFormat ?? "DD/MM/YYYY",
      contentHash: input.contentHash ?? null,
      uploadedById: input.uploadedById ?? null,
      uploadedByName: input.uploadedByName ?? "System",
    })
    .returning();

  return row;
}

export interface ParsedLine {
  date: string;
  description: string;
  reference?: string;
  /** One of the two is set; `parseCSV` guarantees it and a CHECK enforces it. */
  debit?: number;
  credit?: number;
  balance?: number | null;
  raw?: unknown;
}

/**
 * Store the parsed rows, skipping any transaction already imported.
 *
 * Duplicates are decided by `bank_feed_lines_hash_uq`, not by a read-then-diff:
 * the Mongo version queried the existing hashes, filtered in JS, then relied on
 * `insertMany({ ordered: false })` and PARSED THE BULK ERROR to find out what
 * actually landed. `ON CONFLICT DO NOTHING` says the same thing without a
 * second code path that only runs when two uploads race.
 */
export async function importLines(
  tx: Tx,
  statementId: string,
  parsed: ParsedLine[],
  input: { companyId: string; bankAccountId: string },
) {
  if (parsed.length === 0) throw new Error("No transactions to import.");

  const withHashes = parsed.map((l, i) => ({
    ...l,
    rowNumber: i + 1,
    lineHash: generateLineHash(
      input.bankAccountId,
      l.date,
      l.description,
      l.debit || 0,
      l.credit || 0,
    ),
  }));

  const inserted: string[] = [];
  for (const l of withHashes) {
    const [row] = (await tx.execute(sql`
      INSERT INTO bank_feed_lines (
        company_id, statement_id, bank_account_id, transaction_date,
        description, reference, debit_amount, credit_amount, running_balance,
        raw_data, row_number, line_hash, status
      ) VALUES (
        ${input.companyId}::uuid, ${statementId}::uuid,
        ${input.bankAccountId}::uuid, ${l.date}::date,
        ${l.description}, ${l.reference ?? ""},
        ${money(l.debit || 0)}::numeric, ${money(l.credit || 0)}::numeric,
        ${l.balance == null ? null : money(l.balance)}::numeric,
        ${l.raw == null ? null : JSON.stringify(l.raw)}::jsonb,
        ${l.rowNumber}, ${l.lineHash}, 'unallocated'
      )
      ON CONFLICT (company_id, line_hash) WHERE line_hash IS NOT NULL
      DO NOTHING
      RETURNING id
    `)) as unknown as Array<Record<string, unknown>>;
    if (row) inserted.push(String(row.id));
  }

  const duplicatesSkipped = withHashes.length - inserted.length;
  if (inserted.length === 0) {
    throw new Error(
      `All ${withHashes.length} transactions already exist in the system. No new lines to import.`,
    );
  }

  const balances = deriveBalances(withHashes);
  await tx
    .update(bankStatements)
    .set({
      status: "ready",
      openingBalance:
        balances.openingBalance == null ? null : money(balances.openingBalance),
      closingBalance:
        balances.closingBalance == null ? null : money(balances.closingBalance),
      balanceSource: balances.balanceSource as never,
      updatedAt: new Date(),
    })
    .where(eq(bankStatements.id, statementId));

  return {
    insertedCount: inserted.length,
    insertedIds: inserted,
    duplicatesSkipped,
    message:
      duplicatesSkipped > 0
        ? `Imported ${inserted.length} new lines. Skipped ${duplicatesSkipped} duplicate transactions.`
        : `Imported ${inserted.length} lines.`,
  };
}

export async function deleteStatement(tx: Tx, statementId: string) {
  if (!isUuid(statementId)) throw new Error("Statement not found.");

  /*
   * A statement with an allocated line has reached the ledger through it, and
   * deleting the line would orphan the payment or the entry it raised. Undo
   * the allocation first — deliberately the user's decision, one line at a
   * time, because each undo REVERSES a posting.
   */
  const [allocated] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM bank_feed_lines
     WHERE statement_id = ${statementId}::uuid
       AND status IN ('allocated', 'matched')
  `)) as unknown as Array<Record<string, unknown>>;

  if (num(allocated?.n) > 0) {
    throw new Error(
      `This statement has ${num(allocated?.n)} allocated line(s). Undo those allocations before deleting it — each one has posted to the ledger.`,
    );
  }

  const [row] = (await tx.execute(sql`
    DELETE FROM bank_statements WHERE id = ${statementId}::uuid RETURNING id
  `)) as unknown as Array<Record<string, unknown>>;
  if (!row) throw new Error("Statement not found.");
  return { id: String(row.id) };
}

// ── Lines ───────────────────────────────────────────────────────────────────

function toScreenLine(
  r: Record<string, unknown>,
  extras: {
    allocations?: Array<Record<string, unknown>>;
    suggestions?: Array<Record<string, unknown>>;
  } = {},
) {
  const debit = num(r.debit_amount);
  const credit = num(r.credit_amount);

  return {
    _id: String(r.id),
    id: String(r.id),
    statementId: String(r.statement_id),
    bankAccountId: String(r.bank_account_id),
    transactionDate: iso(r.transaction_date),
    description: String(r.description ?? ""),
    reference: (r.reference as string) ?? "",
    debitAmount: debit,
    creditAmount: credit,
    netAmount: credit - debit,
    isDebit: debit > 0,
    isCredit: credit > 0,
    runningBalance: r.running_balance == null ? null : num(r.running_balance),
    rowNumber: r.row_number == null ? null : Number(r.row_number),
    status: r.status as string,
    excludeReason: (r.exclude_reason as string) ?? null,
    excludeNote: (r.exclude_note as string) ?? "",
    allocationType: (r.allocation_type as string) ?? null,
    matchedDocument: r.matched_document_type
      ? {
          type: r.matched_document_type as string,
          documentId: String(r.matched_invoice_id ?? r.matched_bill_id ?? ""),
          documentNumber: (r.matched_document_number as string) ?? "",
          partyId: r.matched_party_id ? String(r.matched_party_id) : null,
          partyName: (r.matched_party_name as string) ?? "",
          appliedAmount: r.applied_amount == null ? null : num(r.applied_amount),
          overpaymentAmount:
            r.overpayment_amount == null ? null : num(r.overpayment_amount),
        }
      : null,
    paymentId: r.payment_id ? String(r.payment_id) : null,
    journalEntryId: r.journal_entry_id ? String(r.journal_entry_id) : null,
    allocations: (extras.allocations ?? []).map((a) => ({
      _id: String(a.id),
      accountId: String(a.account_id),
      accountCode: (a.account_code as string) ?? "",
      accountName: (a.account_name as string) ?? "",
      amount: num(a.amount),
      description: (a.description as string) ?? "",
      taxAmount: a.tax_amount == null ? null : num(a.tax_amount),
      taxAccountId: a.tax_account_id ? String(a.tax_account_id) : null,
    })),
    suggestions: (extras.suggestions ?? []).map((sg) => ({
      type: sg.document_type as string,
      documentId: String(sg.invoice_id ?? sg.bill_id ?? ""),
      documentNumber: String(sg.document_number ?? ""),
      partyName: (sg.party_name as string) ?? "",
      amount: num(sg.amount),
      confidence: num(sg.confidence),
      matchReason: (sg.match_reason as string) ?? "",
    })),
    allocatedBy: r.allocated_by_name
      ? {
          id: (r.allocated_by_id as string) ?? null,
          name: r.allocated_by_name as string,
        }
      : null,
    allocatedAt: r.allocated_at
      ? new Date(String(r.allocated_at)).toISOString()
      : null,
  };
}

/** The matched document's number, joined rather than snapshotted. */
const LINE_COLUMNS = sql`
  l.*,
  COALESCE(i.invoice_number, b.bill_number) AS matched_document_number
`;
const LINE_FROM = sql`
  FROM bank_feed_lines l
  LEFT JOIN invoices i ON i.id = l.matched_invoice_id
  LEFT JOIN bills b ON b.id = l.matched_bill_id
`;

async function attachChildren(
  tx: Tx,
  rows: Array<Record<string, unknown>>,
) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => String(r.id));

  const allocations = (await tx.execute(sql`
    SELECT al.*, a.account_code, a.account_name
      FROM bank_feed_line_allocations al
      JOIN accounts a ON a.id = al.account_id
     WHERE al.line_id = ${anyOf(ids, "uuid[]")}
     ORDER BY al.created_at
  `)) as unknown as Array<Record<string, unknown>>;

  const suggestions = (await tx.execute(sql`
    SELECT * FROM bank_feed_line_suggestions
     WHERE line_id = ${anyOf(ids, "uuid[]")}
     ORDER BY confidence DESC
  `)) as unknown as Array<Record<string, unknown>>;

  const allocByLine = new Map<string, Array<Record<string, unknown>>>();
  for (const a of allocations) {
    const k = String(a.line_id);
    if (!allocByLine.has(k)) allocByLine.set(k, []);
    allocByLine.get(k)!.push(a);
  }
  const sugByLine = new Map<string, Array<Record<string, unknown>>>();
  for (const s of suggestions) {
    const k = String(s.line_id);
    if (!sugByLine.has(k)) sugByLine.set(k, []);
    sugByLine.get(k)!.push(s);
  }

  return rows.map((r) =>
    toScreenLine(r, {
      allocations: allocByLine.get(String(r.id)) ?? [],
      suggestions: sugByLine.get(String(r.id)) ?? [],
    }),
  );
}

export async function listLines(
  tx: Tx,
  statementId: string,
  opts: { status?: string | null; search?: string | null; page?: number; limit?: number } = {},
) {
  if (!isUuid(statementId)) {
    return { lines: [], total: 0, page: 1, totalPages: 1 };
  }
  const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const skip = (Math.max(opts.page ?? 1, 1) - 1) * take;

  const filters = [sql`l.statement_id = ${statementId}::uuid`];
  if (opts.status) filters.push(sql`l.status = ${opts.status}::bank_line_status`);
  if (opts.search?.trim()) {
    const like = likeContains(opts.search.trim());
    filters.push(
      sql`(l.description ILIKE ${like} OR COALESCE(l.reference,'') ILIKE ${like})`,
    );
  }
  const where = sql.join(filters, sql` AND `);

  const rows = (await tx.execute(sql`
    SELECT ${LINE_COLUMNS} ${LINE_FROM}
     WHERE ${where}
     ORDER BY l.transaction_date, l.row_number
     LIMIT ${take} OFFSET ${skip}
  `)) as unknown as Array<Record<string, unknown>>;

  const [count] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM bank_feed_lines l WHERE ${where}
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    lines: await attachChildren(tx, rows),
    total: num(count?.n),
    page: Math.max(opts.page ?? 1, 1),
    totalPages: Math.max(1, Math.ceil(num(count?.n) / take)),
  };
}

export async function getLine(tx: Tx, lineId: string) {
  if (!isUuid(lineId)) return null;
  const rows = (await tx.execute(sql`
    SELECT ${LINE_COLUMNS} ${LINE_FROM} WHERE l.id = ${lineId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  const [line] = await attachChildren(tx, rows);
  return line ?? null;
}

/** The badge on the dashboard: how much is still waiting. */
export async function getUnallocatedCount(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM bank_feed_lines WHERE status = 'unallocated'
  `)) as unknown as Array<Record<string, unknown>>;
  return num(row?.n);
}

/** Every unallocated line, across every statement — its own screen. */
export async function listAllUnallocated(
  tx: Tx,
  filters: {
    bankAccountId?: string | null;
    direction?: "in" | "out" | null;
    search?: string | null;
    from?: string | null;
    to?: string | null;
  } = {},
  page = 1,
  limit = 50,
) {
  const take = Math.min(Math.max(limit, 1), 200);
  const skip = (Math.max(page, 1) - 1) * take;

  const where = [sql`l.status = 'unallocated'`];
  if (filters.bankAccountId && isUuid(filters.bankAccountId)) {
    where.push(sql`l.bank_account_id = ${filters.bankAccountId}::uuid`);
  }
  if (filters.direction === "in") where.push(sql`l.credit_amount > 0`);
  if (filters.direction === "out") where.push(sql`l.debit_amount > 0`);
  if (filters.from) where.push(sql`l.transaction_date >= ${filters.from}::date`);
  if (filters.to) where.push(sql`l.transaction_date <= ${filters.to}::date`);
  if (filters.search?.trim()) {
    const like = likeContains(filters.search.trim());
    where.push(
      sql`(l.description ILIKE ${like} OR COALESCE(l.reference,'') ILIKE ${like})`,
    );
  }
  const clause = sql.join(where, sql` AND `);

  const rows = (await tx.execute(sql`
    SELECT ${LINE_COLUMNS} ${LINE_FROM}
     WHERE ${clause}
     ORDER BY l.transaction_date DESC, l.created_at DESC
     LIMIT ${take} OFFSET ${skip}
  `)) as unknown as Array<Record<string, unknown>>;

  const [count] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM bank_feed_lines l WHERE ${clause}
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    lines: await attachChildren(tx, rows),
    total: num(count?.n),
    page: Math.max(page, 1),
    totalPages: Math.max(1, Math.ceil(num(count?.n) / take)),
  };
}

// ── Matching ────────────────────────────────────────────────────────────────

/** Open invoices and bills, in one shape, for the matcher and the pickers. */
export async function listOpenDocuments(
  tx: Tx,
  documentType: "invoice" | "bill",
  opts: { search?: string | null; limit?: number } = {},
) {
  const take = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const like = opts.search?.trim() ? likeContains(opts.search.trim()) : null;

  if (documentType === "bill") {
    const rows = (await tx.execute(sql`
      SELECT b.id, b.bill_number AS document_number, b.bill_date AS document_date,
             b.balance AS due_amount, b.net_payable AS total,
             b.supplier_id AS party_id, p.name AS party_name
        FROM bills b
        LEFT JOIN parties p ON p.id = b.supplier_id
       WHERE b.status = 'approved' AND b.balance > 0
         ${like ? sql`AND (b.bill_number ILIKE ${like} OR p.name ILIKE ${like})` : sql``}
       ORDER BY b.bill_date DESC
       LIMIT ${take}
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map(shapeDocument("bill"));
  }

  const rows = (await tx.execute(sql`
    SELECT i.id, i.invoice_number AS document_number, i.invoice_date AS document_date,
           (i.total - i.amount_paid)::numeric(19,4) AS due_amount, i.total,
           i.customer_id AS party_id, p.name AS party_name
      FROM invoices i
      LEFT JOIN parties p ON p.id = i.customer_id
     WHERE i.status = 'completed' AND (i.total - i.amount_paid) > 0
       ${like ? sql`AND (i.invoice_number ILIKE ${like} OR p.name ILIKE ${like})` : sql``}
     ORDER BY i.invoice_date DESC
     LIMIT ${take}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(shapeDocument("invoice"));
}

const shapeDocument =
  (type: "invoice" | "bill") => (r: Record<string, unknown>) => ({
    _id: String(r.id),
    id: String(r.id),
    type,
    documentNumber: String(r.document_number),
    documentDate: iso(r.document_date),
    dueAmount: num(r.due_amount),
    total: num(r.total),
    partyId: r.party_id ? String(r.party_id) : null,
    partyName: (r.party_name as string) ?? "",
  });

/**
 * Score every unallocated line on a statement against the open documents.
 *
 * The suggestions are DELETED and rewritten, not merged: they are a cache of
 * this computation, and a stale suggestion that survives a re-run is worse
 * than no suggestion.
 *
 * Unlike Mongo, this does NOT auto-allocate. That version posted to the ledger
 * from a `.catch(console.error)` background promise fired by the importer —
 * so a ≥95% match raised a journal entry with nobody watching, and a failure
 * went to a server log. Money reaching the ledger is a decision; the threshold
 * is reported so the UI can offer it, and a person presses the button.
 */
export async function autoMatch(tx: Tx, statementId: string) {
  if (!isUuid(statementId)) return { scored: 0, suggested: 0, confident: 0 };

  const lines = (await tx.execute(sql`
    SELECT id, description, reference, debit_amount, credit_amount
      FROM bank_feed_lines
     WHERE statement_id = ${statementId}::uuid AND status = 'unallocated'
  `)) as unknown as Array<Record<string, unknown>>;

  if (lines.length === 0) return { scored: 0, suggested: 0, confident: 0 };

  await tx.execute(sql`
    DELETE FROM bank_feed_line_suggestions
     WHERE line_id IN (
       SELECT id FROM bank_feed_lines
        WHERE statement_id = ${statementId}::uuid AND status = 'unallocated'
     )
  `);

  const [invoices, bills] = await Promise.all([
    listOpenDocuments(tx, "invoice", { limit: 500 }),
    listOpenDocuments(tx, "bill", { limit: 500 }),
  ]);

  const [{ company_id: companyId }] = (await tx.execute(sql`
    SELECT company_id FROM bank_statements WHERE id = ${statementId}::uuid
  `)) as unknown as Array<Record<string, string>>;

  let suggested = 0;
  let confident = 0;

  for (const raw of lines) {
    const line = {
      description: String(raw.description ?? ""),
      reference: String(raw.reference ?? ""),
      debitAmount: num(raw.debit_amount),
      creditAmount: num(raw.credit_amount),
    };
    // Money in is a receipt against an invoice; money out pays a bill.
    const candidates = line.creditAmount > 0 ? invoices : bills;

    for (const doc of candidates) {
      const confidence = calculateMatchConfidence(line, doc);
      if (confidence <= SUGGEST_THRESHOLD) continue;

      await tx.execute(sql`
        INSERT INTO bank_feed_line_suggestions (
          company_id, line_id, document_type, invoice_id, bill_id,
          document_number, party_name, amount, confidence, match_reason
        ) VALUES (
          ${companyId}::uuid, ${String(raw.id)}::uuid,
          ${doc.type}::bank_match_document,
          ${doc.type === "invoice" ? doc.id : null}::uuid,
          ${doc.type === "bill" ? doc.id : null}::uuid,
          ${doc.documentNumber}, ${doc.partyName},
          ${money(doc.dueAmount)}::numeric, ${confidence},
          ${getMatchReason(line, doc)}
        )
        ON CONFLICT DO NOTHING
      `);
      suggested++;
      if (confidence >= AUTO_ALLOCATE_THRESHOLD) confident++;
    }
  }

  return { scored: lines.length, suggested, confident };
}

// ── Allocation ──────────────────────────────────────────────────────────────

interface Actor {
  id?: string | null;
  name?: string | null;
}

async function loadUnallocatedLine(tx: Tx, lineId: string) {
  if (!isUuid(lineId)) throw new Error("Bank feed line not found.");
  const [line] = await tx
    .select()
    .from(bankFeedLines)
    .where(eq(bankFeedLines.id, lineId));
  if (!line) throw new Error("Bank feed line not found.");
  if (line.status !== "unallocated") {
    throw new Error(`This line is already ${line.status}.`);
  }
  return line;
}

async function markAllocated(
  tx: Tx,
  lineId: string,
  patch: Record<string, unknown>,
  actor: Actor,
) {
  await tx
    .update(bankFeedLines)
    .set({
      status: "allocated",
      allocatedById: actor.id ?? null,
      allocatedByName: actor.name ?? null,
      allocatedAt: new Date(),
      updatedAt: new Date(),
      ...patch,
    })
    .where(eq(bankFeedLines.id, lineId));
}

async function controlAccountId(tx: Tx, kind: "received" | "made") {
  const key = kind === "received" ? "accounts_receivable" : "accounts_payable";
  const account = await accountsRepo.getSystemAccount(tx, key);
  if (!account) {
    throw new Error(
      `${kind === "received" ? "Accounts Receivable" : "Accounts Payable"} account is not configured.`,
    );
  }
  return String((account as Record<string, unknown>).id);
}

/**
 * Match a line to an invoice or a bill — by RAISING A PAYMENT.
 *
 * The whole of the reasoning is at the top of this file: the payments module
 * already does this correctly, so a bank match uses it rather than posting a
 * second, parallel version of the same entry. Over-allocation is refused by
 * the deferred trigger from 0063, and `invoices.amount_paid` is written by the
 * allocation trigger from 0016 — not by hand here, which is what Mongo did.
 *
 * OVERPAYMENT: the payment is raised for the full bank amount and only the
 * document's balance is allocated to it. The remainder stays as an UNAPPLIED
 * payment — visible on the payments screen, allocatable to the next invoice —
 * rather than being posted to a Customer Advance account as Mongo did. Both
 * are defensible; this one keeps the money attached to the customer who sent
 * it, and needs no second account to exist.
 */
export async function allocateToDocument(
  tx: Tx,
  lineId: string,
  input: { documentType: "invoice" | "bill"; documentId: string },
  actor: Actor = {},
) {
  const line = await loadUnallocatedLine(tx, lineId);
  const isReceipt = input.documentType === "invoice";

  const bankAmount = isReceipt ? num(line.creditAmount) : num(line.debitAmount);
  if (bankAmount <= 0) {
    throw new Error(
      isReceipt
        ? "This line is money out — it cannot pay a customer invoice."
        : "This line is money in — it cannot pay a supplier bill.",
    );
  }

  const [doc] = (await tx.execute(
    isReceipt
      ? sql`SELECT i.id, i.invoice_number AS number, i.customer_id AS party_id,
                   (i.total - i.amount_paid)::numeric(19,4) AS balance,
                   p.name AS party_name
              FROM invoices i LEFT JOIN parties p ON p.id = i.customer_id
             WHERE i.id = ${input.documentId}::uuid`
      : sql`SELECT b.id, b.bill_number AS number, b.supplier_id AS party_id,
                   b.balance, p.name AS party_name
              FROM bills b LEFT JOIN parties p ON p.id = b.supplier_id
             WHERE b.id = ${input.documentId}::uuid`,
  )) as unknown as Array<Record<string, unknown>>;

  if (!doc) {
    throw new Error(isReceipt ? "Invoice not found." : "Bill not found.");
  }
  if (!doc.party_id) {
    throw new Error(
      `That ${input.documentType} has no ${isReceipt ? "customer" : "supplier"} on it, so a payment cannot be raised against it.`,
    );
  }

  const balance = num(doc.balance);
  const applied = Math.min(bankAmount, balance);
  const overpayment = Math.round((bankAmount - applied) * 100) / 100;

  const payment = await paymentsRepo.createPayment(tx, {
    companyId: String(line.companyId),
    paymentType: isReceipt ? "received" : "made",
    paymentDate: String(line.transactionDate),
    paymentMethod: "bank_transfer",
    amount: money(bankAmount),
    partyId: String(doc.party_id),
    accountId: String(line.bankAccountId),
    reference: line.reference || line.description,
    description: `Bank feed: ${line.description}`,
    createdById: actor.id ?? null,
  });

  if (applied > 0) {
    if (isReceipt) {
      await paymentsRepo.allocateToInvoice(tx, {
        companyId: String(line.companyId),
        paymentId: payment.id,
        invoiceId: String(doc.id),
        amount: money(applied),
      });
    } else {
      await paymentsRepo.allocateToBill(tx, {
        companyId: String(line.companyId),
        paymentId: payment.id,
        billId: String(doc.id),
        amount: money(applied),
      });
    }
  }

  await paymentsRepo.confirmPayment(tx, payment.id, actor.id ?? "system");

  const entry = isReceipt
    ? await paymentsRepo.postPaymentReceipt(tx, payment.id, {
        arAccountId: await controlAccountId(tx, "received"),
        clearingAccountId: null,
        postedById: actor.id ?? "system",
      })
    : await paymentsRepo.postPaymentMade(tx, payment.id, {
        apAccountId: await controlAccountId(tx, "made"),
        postedById: actor.id ?? "system",
      });

  await tx.execute(sql`
    UPDATE payments SET source_line_id = ${lineId}::uuid WHERE id = ${payment.id}::uuid
  `);

  await markAllocated(
    tx,
    lineId,
    {
      allocationType: isReceipt ? "invoice_payment" : "bill_payment",
      matchedDocumentType: input.documentType,
      matchedInvoiceId: isReceipt ? String(doc.id) : null,
      matchedBillId: isReceipt ? null : String(doc.id),
      matchedPartyId: String(doc.party_id),
      matchedPartyName: (doc.party_name as string) ?? null,
      appliedAmount: money(applied),
      overpaymentAmount: money(overpayment),
      paymentId: payment.id,
      /* `postPaymentReceipt` / `postPaymentMade` return `{ payment, entry }`,
         not the entry — reading `.id` off the wrapper gave null, so the line
         could not point at the posting it had just made. */
      journalEntryId: entry?.entry?.id ? String(entry.entry.id) : null,
    },
    actor,
  );

  return {
    paymentId: payment.id,
    appliedAmount: applied,
    overpaymentAmount: overpayment,
    message:
      overpayment > 0
        ? `Payment of ${bankAmount.toFixed(2)} recorded. ${applied.toFixed(2)} applied to ${doc.number}; ${overpayment.toFixed(2)} left unapplied against the party.`
        : `Payment of ${applied.toFixed(2)} allocated to ${doc.number}.`,
  };
}

export interface AllocationLeg {
  accountId: string;
  amount: number;
  description?: string | null;
  taxAmount?: number | null;
  taxAccountId?: string | null;
}

/**
 * Allocate a line across one or more accounts — expense, income, liability,
 * or a free split.
 *
 * One function where Mongo had five that differed only in which side of the
 * entry the bank account sat on and what the allocation was labelled. The
 * direction is decided by the LINE, not by the caller: money out debits the
 * accounts and credits the bank, money in does the reverse. Mongo took the
 * caller's word for it, so calling `allocateToIncome` on a debit line posted
 * an entry backwards.
 */
export async function allocateToAccounts(
  tx: Tx,
  lineId: string,
  legs: AllocationLeg[],
  input: {
    allocationType: "expense" | "income" | "liability" | "split" | "transfer";
    description?: string | null;
    partyId?: string | null;
    partyName?: string | null;
  },
  actor: Actor = {},
) {
  const line = await loadUnallocatedLine(tx, lineId);
  if (legs.length === 0) throw new Error("An allocation needs at least one account.");

  const isMoneyOut = num(line.debitAmount) > 0;
  const lineAmount = isMoneyOut ? num(line.debitAmount) : num(line.creditAmount);

  const legTotal = legs.reduce((sum, l) => sum + num(l.amount), 0);
  if (Math.abs(legTotal - lineAmount) > 0.01) {
    throw new Error(
      `The allocation totals ${legTotal.toFixed(2)} but the line is ${lineAmount.toFixed(2)}. They have to match.`,
    );
  }

  /*
   * The entry. Each leg sits on the side the line's direction implies, and the
   * bank account takes the other side for the whole amount — so the entry
   * balances whatever the split is.
   */
  const entryLines: Array<Record<string, string>> = [];
  for (const leg of legs) {
    const tax = num(leg.taxAmount);
    const net = Math.round((num(leg.amount) - tax) * 100) / 100;

    entryLines.push({
      accountId: leg.accountId,
      debit: isMoneyOut ? money(net) : "0",
      credit: isMoneyOut ? "0" : money(net),
      description: leg.description || line.description,
    });

    if (tax > 0 && leg.taxAccountId) {
      entryLines.push({
        accountId: leg.taxAccountId,
        debit: isMoneyOut ? money(tax) : "0",
        credit: isMoneyOut ? "0" : money(tax),
        description: `VAT on ${leg.description || line.description}`,
      });
    }
  }

  entryLines.push({
    accountId: String(line.bankAccountId),
    debit: isMoneyOut ? "0" : money(lineAmount),
    credit: isMoneyOut ? money(lineAmount) : "0",
    description: input.description || line.description,
  });

  /*
   * `bank_entry` is a real entry type and has been since 0001 — it says what
   * this posting IS. Mongo typed every one of these 'expense', including the
   * money-in ones, so an income allocation and a supplier payment were
   * indistinguishable in the journal's own type column.
   */
  const entry = await createJournalEntry(tx, {
    companyId: String(line.companyId),
    entryType: input.allocationType === "transfer" ? "transfer" : "bank_entry",
    entryDate: String(line.transactionDate),
    description: input.description || line.description,
    reference: line.reference ?? null,
    partyType: input.partyId ? (isMoneyOut ? "supplier" : "customer") : null,
    partyId: input.partyId ?? null,
    sourceType: "bank_feed",
    sourceId: lineId,
    postImmediately: true,
    createdById: actor.id ?? null,
    lines: entryLines as never,
  });

  for (const leg of legs) {
    await tx.insert(bankFeedLineAllocations).values({
      companyId: String(line.companyId),
      lineId,
      accountId: leg.accountId,
      amount: money(num(leg.amount)),
      description: leg.description ?? null,
      taxAmount: leg.taxAmount == null ? null : money(num(leg.taxAmount)),
      taxAccountId: leg.taxAccountId ?? null,
    });
  }

  await markAllocated(
    tx,
    lineId,
    {
      allocationType: input.allocationType,
      matchedPartyId: input.partyId ?? null,
      matchedPartyName: input.partyName ?? null,
      journalEntryId: String((entry as Record<string, unknown>).id),
    },
    actor,
  );

  return {
    journalEntryId: String((entry as Record<string, unknown>).id),
    message: `Allocated ${lineAmount.toFixed(2)} across ${legs.length} account${legs.length === 1 ? "" : "s"}.`,
  };
}

/** A transfer to another of our own accounts — one leg, labelled. */
export async function allocateAsTransfer(
  tx: Tx,
  lineId: string,
  targetAccountId: string,
  description: string | null,
  actor: Actor = {},
) {
  const line = await loadUnallocatedLine(tx, lineId);
  if (targetAccountId === String(line.bankAccountId)) {
    throw new Error("A transfer needs a different account on the other side.");
  }
  const amount = num(line.debitAmount) > 0 ? num(line.debitAmount) : num(line.creditAmount);

  return allocateToAccounts(
    tx,
    lineId,
    [{ accountId: targetAccountId, amount, description }],
    { allocationType: "transfer", description },
    actor,
  );
}

/** Several documents settled by one line. */
export async function allocateToMultipleDocuments(
  tx: Tx,
  lineId: string,
  documentType: "invoice" | "bill",
  allocations: Array<{ documentId: string; amount: number }>,
  actor: Actor = {},
) {
  const line = await loadUnallocatedLine(tx, lineId);
  if (allocations.length === 0) {
    throw new Error("Choose at least one document to settle.");
  }

  const isReceipt = documentType === "invoice";
  const bankAmount = isReceipt ? num(line.creditAmount) : num(line.debitAmount);
  const total = allocations.reduce((s, a) => s + num(a.amount), 0);
  if (total - bankAmount > 0.01) {
    throw new Error(
      `The allocations total ${total.toFixed(2)}, which is more than the line's ${bankAmount.toFixed(2)}.`,
    );
  }

  const partyIds = new Set<string>();
  for (const a of allocations) {
    const [doc] = (await tx.execute(
      isReceipt
        ? sql`SELECT customer_id AS party_id FROM invoices WHERE id = ${a.documentId}::uuid`
        : sql`SELECT supplier_id AS party_id FROM bills WHERE id = ${a.documentId}::uuid`,
    )) as unknown as Array<Record<string, unknown>>;
    if (!doc) throw new Error("One of the documents no longer exists.");
    partyIds.add(String(doc.party_id));
  }

  /*
   * ONE PAYMENT, ONE PARTY. A payment names the party it came from, so a
   * single bank line settling two DIFFERENT customers' invoices cannot be one
   * payment. Mongo allowed it and produced a journal entry crediting two
   * parties' receivables against one receipt, which no statement can explain.
   */
  if (partyIds.size > 1) {
    throw new Error(
      "Those documents belong to different parties. One bank line settles one party's documents — split the line first.",
    );
  }
  const partyId = [...partyIds][0];

  const payment = await paymentsRepo.createPayment(tx, {
    companyId: String(line.companyId),
    paymentType: isReceipt ? "received" : "made",
    paymentDate: String(line.transactionDate),
    paymentMethod: "bank_transfer",
    amount: money(bankAmount),
    partyId,
    accountId: String(line.bankAccountId),
    reference: line.reference || line.description,
    description: `Bank feed: ${line.description}`,
    createdById: actor.id ?? null,
  });

  for (const a of allocations) {
    if (num(a.amount) <= 0) continue;
    if (isReceipt) {
      await paymentsRepo.allocateToInvoice(tx, {
        companyId: String(line.companyId),
        paymentId: payment.id,
        invoiceId: a.documentId,
        amount: money(num(a.amount)),
      });
    } else {
      await paymentsRepo.allocateToBill(tx, {
        companyId: String(line.companyId),
        paymentId: payment.id,
        billId: a.documentId,
        amount: money(num(a.amount)),
      });
    }
  }

  await paymentsRepo.confirmPayment(tx, payment.id, actor.id ?? "system");

  const entry = isReceipt
    ? await paymentsRepo.postPaymentReceipt(tx, payment.id, {
        arAccountId: await controlAccountId(tx, "received"),
        clearingAccountId: null,
        postedById: actor.id ?? "system",
      })
    : await paymentsRepo.postPaymentMade(tx, payment.id, {
        apAccountId: await controlAccountId(tx, "made"),
        postedById: actor.id ?? "system",
      });

  await tx.execute(sql`
    UPDATE payments SET source_line_id = ${lineId}::uuid WHERE id = ${payment.id}::uuid
  `);

  await markAllocated(
    tx,
    lineId,
    {
      allocationType: isReceipt ? "invoice_payment" : "bill_payment",
      matchedPartyId: partyId,
      paymentId: payment.id,
      appliedAmount: money(total),
      overpaymentAmount: money(Math.max(0, Math.round((bankAmount - total) * 100) / 100)),
      /* `postPaymentReceipt` / `postPaymentMade` return `{ payment, entry }`,
         not the entry — reading `.id` off the wrapper gave null, so the line
         could not point at the posting it had just made. */
      journalEntryId: entry?.entry?.id ? String(entry.entry.id) : null,
    },
    actor,
  );

  return {
    paymentId: payment.id,
    message: `Payment of ${bankAmount.toFixed(2)} settled ${allocations.length} ${documentType}${allocations.length === 1 ? "" : "s"}.`,
  };
}

/** Take a line out of the reconciliation, with a reason. */
export async function excludeLine(
  tx: Tx,
  lineId: string,
  reason: string,
  note: string | null,
  actor: Actor = {},
) {
  const line = await loadUnallocatedLine(tx, lineId);

  await tx
    .update(bankFeedLines)
    .set({
      status: "excluded",
      excludeReason: reason as never,
      excludeNote: note ?? null,
      allocatedById: actor.id ?? null,
      allocatedByName: actor.name ?? null,
      allocatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(bankFeedLines.id, line.id));

  return { id: String(line.id) };
}

/**
 * Put a line back to unallocated, undoing whatever it did.
 *
 * A POSTED ENTRY IS REVERSED, NEVER DELETED — Mongo's own comment says why,
 * and it is right: deleting a posted entry bypasses the closed-period guard,
 * drops the audit trail and leaves the balances it moved un-moved.
 *
 * A payment is CANCELLED rather than reversed by hand, because cancelling is
 * the path the payments module already has: it reverses the entry, deletes the
 * allocation rows so the invoice gets its balance back through the trigger
 * that owns `amount_paid`, and records who and why. Doing that here by hand
 * would be a second implementation of it.
 */
export async function undoAllocation(
  tx: Tx,
  lineId: string,
  actor: Actor = {},
) {
  if (!isUuid(lineId)) throw new Error("Bank feed line not found.");
  const [line] = await tx
    .select()
    .from(bankFeedLines)
    .where(eq(bankFeedLines.id, lineId));
  if (!line) throw new Error("Bank feed line not found.");
  if (line.status === "unallocated") {
    throw new Error("This line is not allocated.");
  }

  if (line.paymentId) {
    await paymentsRepo.cancelPayment(
      tx,
      String(line.paymentId),
      actor.id ?? "system",
      `Bank allocation undone (line ${line.id})`,
    );
  } else if (line.journalEntryId) {
    await reverseJournalEntry(
      tx,
      String(line.journalEntryId),
      actor.id ?? "system",
      `Bank allocation undone (line ${line.id})`,
    );
  }

  await tx
    .delete(bankFeedLineAllocations)
    .where(eq(bankFeedLineAllocations.lineId, lineId));

  await tx
    .update(bankFeedLines)
    .set({
      status: "unallocated",
      allocationType: null,
      matchedDocumentType: null,
      matchedInvoiceId: null,
      matchedBillId: null,
      matchedPartyId: null,
      matchedPartyName: null,
      appliedAmount: null,
      overpaymentAmount: null,
      paymentId: null,
      journalEntryId: null,
      excludeReason: null,
      excludeNote: null,
      allocatedById: null,
      allocatedByName: null,
      allocatedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(bankFeedLines.id, lineId));

  return { id: lineId };
}
