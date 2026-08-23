import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  expenses,
  expenseReceipts,
  accounts,
  parties,
  journalEntries,
  users,
} from "../schema";
import { alias } from "drizzle-orm/pg-core";
import {
  createJournalEntry,
  reverseJournalEntry,
  type JournalLineInput,
} from "./journal";
import { getSystemAccount } from "./accounts";

/**
 * Expense repository — the seventh module out of the Mongo ledger.
 *
 * Contract with the layer above (§4.1): every function takes a `tx` from
 * withTenant(), so RLS is active; nothing here reads the session or checks
 * permissions. MONEY IS A STRING — numeric(19,4) maps to string in Drizzle so
 * values never round-trip through float64. Do not Number() these.
 *
 * What the Mongo model did and this does not:
 *
 *   - create-then-post in two saves. `createExpense` writes a draft, then
 *     calls `expense.post()`, which writes the journal entry and saves again.
 *     Three writes, no transaction: a failure in the middle leaves a draft
 *     with no entry, or an entry with no expense pointing at it. Here it is
 *     one transaction and the intermediate state does not exist.
 *
 *   - a self-healing chart of accounts. post() will adopt an account named
 *     "Accrued Expenses", else CREATE code 2170, else on a duplicate key adopt
 *     whatever holds 2170 and retag it — three fallbacks that rewrite the COA
 *     from inside an expense posting. `lib/chart-of-accounts.js:278` seeds the
 *     account and `app/db/provisioning.ts` uses that list, so it is there; a
 *     company without it gets a readable error rather than a silent rewrite.
 */

export type MoneyString = string;

const money = (v: unknown): MoneyString => String(v ?? "0");

async function systemAccountOrThrow(tx: Tx, key: string, label: string) {
  const account = await getSystemAccount(tx, key);
  if (!account) {
    throw new Error(
      `${label} account not configured. Ask your admin to create a system account tagged '${key}'.`,
    );
  }
  return account;
}

/**
 * `EXP-00001`, per company.
 *
 * Mongo builds `EXP-{COMPANY_CODE}-{YYYYMM}-{0001}` through a counter with a
 * five-attempt retry loop, an exists() check after each, an exponential
 * backoff, a regex-scan fallback when the counter throws, and finally a
 * timestamp-plus-random number if all of that fails — 90 lines whose purpose
 * is to survive a counter that is not atomic. `next_entry_number` is atomic
 * (one INSERT .. ON CONFLICT DO UPDATE RETURNING), so there is nothing to
 * retry and no duplicate to detect. The company code and year-month were
 * decoration: the counter is already per-company, and the unique index is on
 * (company_id, expense_number).
 */
async function nextExpenseNumber(tx: Tx, companyId: string) {
  const [{ expense_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'EXP') AS expense_number`,
  )) as unknown as Array<{ expense_number: string }>;
  return expense_number;
}

export interface ExpenseReceiptInput {
  filename: string;
  url: string;
  publicId?: string | null;
  resourceType?: string | null;
  size?: number | null;
  mimeType?: string | null;
}

export interface CreateExpenseInput {
  companyId: string;
  expenseDate: string; // YYYY-MM-DD
  category: (typeof expenses.category.enumValues)[number];

  accountId: string;
  amount: MoneyString;
  taxAmount?: MoneyString;
  taxRate?: MoneyString;
  withholdingTax?: MoneyString;
  currency?: string;

  /** All three together, or none of them — see `expenses_payment_is_whole`. */
  paymentMethod?: (typeof expenses.paymentMethod.enumValues)[number] | null;
  paidFromAccountId?: string | null;
  paidAt?: Date | null;

  payeePartyId?: string | null;
  payeeType?: "supplier" | "employee";
  payeeName: string;
  payeePhone?: string | null;
  payeeEmail?: string | null;
  payeeTaxPin?: string | null;

  description: string;
  reference?: string | null;
  supplierInvoiceNumber?: string | null;
  notes?: string | null;

  projectId?: string | null;
  projectNumber?: string | null;
  projectName?: string | null;
  costCodeId?: string | null;
  costCode?: string | null;

  assetId?: string | null;
  assetNumber?: string | null;
  assetName?: string | null;

  isReimbursable?: boolean;
  employeePartyId?: string | null;
  employeeName?: string | null;

  receipts?: ExpenseReceiptInput[];
  createdById?: string | null;
}

/**
 * Creates the expense AND its journal entry, in one transaction.
 *
 *   paid    DR Expense [/ DR VAT Input]  CR Cash|Bank|Mpesa
 *   unpaid  DR Expense [/ DR VAT Input]  CR Accrued Expenses
 *
 * The VAT split is Mongo's, kept: when there is tax and a `vat_input` account
 * exists, the expense line is debited NET and the tax goes to VAT Input. When
 * no such account exists, Mongo silently debits the GROSS to the expense
 * account and claims no input VAT — the same behaviour here, because changing
 * it would change what a company's P&L says without being asked to.
 */
export async function createAndPostExpense(tx: Tx, input: CreateExpenseInput) {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.id, input.accountId));
  if (!account) throw new Error("Expense account not found");
  if (account.accountType !== "expense") {
    throw new Error(
      `Account must be an expense account. Got: ${account.accountType}`,
    );
  }
  if (account.canPost === false) {
    throw new Error(`Cannot post to header account: ${account.accountName}`);
  }
  if (account.isActive === false) {
    throw new Error(`Account ${account.accountName} is inactive`);
  }

  const isPaid = Boolean(input.paidFromAccountId && input.paymentMethod);

  // Only the id is needed downstream; holding the whole row would union two
  // differently-shaped selects for no gain.
  let creditAccountId: string;
  if (isPaid) {
    const [payFrom] = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.id, input.paidFromAccountId!));
    if (!payFrom) throw new Error("Payment account not found");
    if (payFrom.isActive === false) {
      throw new Error(`Payment account ${payFrom.accountName} is inactive`);
    }
    if (!["cash", "bank", "mpesa"].includes(payFrom.subType ?? "")) {
      throw new Error(
        `Invalid payment account type. Must be cash, bank, or mpesa. Got: ${payFrom.subType}`,
      );
    }
    creditAccountId = payFrom.id;
  } else {
    const accrued = await systemAccountOrThrow(
      tx,
      "accrued_expenses",
      "Accrued Expenses",
    );
    creditAccountId = accrued.id;
  }

  const amount = money(input.amount);
  const taxAmount = money(input.taxAmount ?? "0");
  const withholdingTax = money(input.withholdingTax ?? "0");
  const expenseNumber = await nextExpenseNumber(tx, input.companyId);

  const [row] = await tx
    .insert(expenses)
    .values({
      companyId: input.companyId,
      expenseNumber,
      expenseDate: input.expenseDate,
      category: input.category,
      accountId: account.id,
      accountCodeAtExpense: account.accountCode,
      accountNameAtExpense: account.accountName,
      amount,
      taxAmount,
      taxRate: money(input.taxRate ?? "0"),
      withholdingTax,
      currency: input.currency ?? "KES",
      paymentMethod: isPaid ? input.paymentMethod! : null,
      paidFromAccountId: isPaid ? input.paidFromAccountId! : null,
      paidAt: isPaid ? (input.paidAt ?? new Date()) : null,
      payeePartyId: input.payeePartyId ?? null,
      payeeType: input.payeeType ?? "supplier",
      payeeNameAtExpense: input.payeeName,
      payeePhoneAtExpense: input.payeePhone ?? null,
      payeeEmailAtExpense: input.payeeEmail ?? null,
      payeeTaxPinAtExpense: input.payeeTaxPin ?? null,
      description: input.description,
      reference: input.reference ?? null,
      supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
      notes: input.notes ?? null,
      projectId: input.projectId ?? null,
      projectNumberAtExpense: input.projectNumber ?? null,
      projectNameAtExpense: input.projectName ?? null,
      costCodeId: input.costCodeId ?? null,
      costCodeAtExpense: input.costCode ?? null,
      assetId: input.assetId ?? null,
      assetNumberAtExpense: input.assetNumber ?? null,
      assetNameAtExpense: input.assetName ?? null,
      isReimbursable: input.isReimbursable ?? false,
      employeePartyId: input.employeePartyId ?? null,
      employeeNameAtExpense: input.employeeName ?? null,
      // 'draft' for one statement only: the entry is created below and the row
      // updated to its real status inside the same transaction. The
      // `expenses_posted_has_entry` check is what forces that ordering.
      status: "draft",
      createdById: input.createdById ?? null,
    })
    .returning();

  if (input.receipts?.length) {
    await addReceipts(tx, {
      companyId: input.companyId,
      expenseId: row.id,
      receipts: input.receipts,
      uploadedById: input.createdById ?? null,
    });
  }

  const totalRow = await tx
    .select({ total: expenses.total })
    .from(expenses)
    .where(eq(expenses.id, row.id));
  const totalValue = totalRow[0].total as string;

  // ── Journal lines ────────────────────────────────────────────────────────
  const vatAccount =
    Number(taxAmount) > 0 ? await getSystemAccount(tx, "vat_input") : null;

  const lines: JournalLineInput[] = [
    {
      accountId: account.id,
      // Net of VAT when the input VAT is claimable, gross when it is not —
      // Mongo's rule, and the reason the two branches differ.
      debit: vatAccount
        ? String(Number(amount) - Number(withholdingTax))
        : totalValue,
      description: input.description,
    },
  ];

  if (vatAccount) {
    lines.push({
      accountId: vatAccount.id,
      debit: taxAmount,
      description: `VAT on expense — ${input.description}`,
    });
  }

  lines.push({
    accountId: creditAccountId,
    credit: totalValue,
    description: isPaid
      ? `Payment for ${input.description}`
      : `Accrued — ${input.description}`,
  });

  const entry = await createJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: input.expenseDate,
    entryType: "expense",
    description: `Expense: ${input.description}`,
    reference: input.reference ?? expenseNumber,
    // Both or neither — `journal_entries_party_pair`. The payee NAME is
    // required on an expense but the party is not (Mongo's `vendor.name` is
    // required, `vendor.id` is not), so a cash purchase from someone who is
    // not on file has a name and no party, and tagging the entry
    // 'supplier' with nothing to point at would fail the check.
    partyType: input.payeePartyId ? (input.payeeType ?? "supplier") : null,
    partyId: input.payeePartyId ?? null,
    sourceType: "expense",
    sourceId: row.id,
    lines,
    createdById: input.createdById ?? null,
    postImmediately: true,
  });

  const [posted] = await tx
    .update(expenses)
    .set({
      journalEntryId: entry.id,
      // "paid" = money already left the account; "posted" = accrual only.
      status: isPaid ? "paid" : "posted",
      postedAt: new Date(),
      postedById: input.createdById ?? null,
      updatedAt: new Date(),
    })
    .where(eq(expenses.id, row.id))
    .returning();

  return { expense: posted, entry };
}

export interface RecordPaymentInput {
  paymentMethod: (typeof expenses.paymentMethod.enumValues)[number];
  paidFromAccountId: string;
  paidAt?: Date | null;
  paidById?: string | null;
}

/**
 * Clears an accrual: DR Accrued Expenses / CR Cash|Bank|Mpesa.
 *
 * Only reachable from `posted` — an expense that was entered unpaid. Mongo
 * also accepts `approved`, one of the legacy statuses it says nothing creates.
 */
export async function recordExpensePayment(
  tx: Tx,
  expenseId: string,
  input: RecordPaymentInput,
) {
  const expense = await getExpense(tx, expenseId);
  if (!expense) throw new Error("Expense not found");
  if (expense.paymentStatus === "paid") {
    throw new Error("Expense is already paid");
  }
  if (expense.status !== "posted") {
    throw new Error(
      `Cannot record payment for an expense that is ${expense.status}.`,
    );
  }

  const accruedAccount = await systemAccountOrThrow(
    tx,
    "accrued_expenses",
    "Accrued Expenses",
  );
  const [paymentAccount] = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.id, input.paidFromAccountId));
  if (!paymentAccount) throw new Error("Payment account not found");
  if (paymentAccount.canPost === false) {
    throw new Error("Selected account cannot be posted to");
  }

  const paidAt = input.paidAt ?? new Date();
  const total = expense.total as string;

  const entry = await createJournalEntry(tx, {
    companyId: expense.companyId,
    entryDate: paidAt.toISOString().slice(0, 10),
    entryType: "expense",
    description: `Payment clearing — ${expense.expenseNumber}: ${expense.description}`,
    reference: expense.expenseNumber,
    partyType: expense.payeePartyId ? expense.payeeType : null,
    partyId: expense.payeePartyId,
    sourceType: "expense",
    sourceId: expense.id,
    lines: [
      {
        accountId: accruedAccount.id,
        debit: total,
        description: `Clear accrual — ${expense.description}`,
      },
      {
        accountId: paymentAccount.id,
        credit: total,
        description: `Payment for ${expense.description}`,
      },
    ],
    createdById: input.paidById ?? null,
    postImmediately: true,
  });

  const [updated] = await tx
    .update(expenses)
    .set({
      clearingJournalEntryId: entry.id,
      paymentMethod: input.paymentMethod,
      paidFromAccountId: input.paidFromAccountId,
      paidAt,
      status: "paid",
      updatedAt: new Date(),
    })
    .where(eq(expenses.id, expenseId))
    .returning();

  return { expense: updated, entry };
}

/**
 * Voids a posted expense by reversing every entry it raised.
 *
 * NEW. Mongo has the `void` status, `voidedAt`, `voidedBy` and `voidReason`,
 * and a comment on the status enum reading "void → reversed (JE reversed)" —
 * and nothing anywhere writes any of them. Meanwhile `deleteExpense` refuses
 * a posted expense with "Cannot delete posted expense — void it instead",
 * pointing at a feature that does not exist; and since every expense is
 * auto-posted the moment it is created, `deleteExpense` can never succeed
 * either. An expense, once entered, could not be removed or reversed by any
 * path in the application.
 *
 * The clearing entry is reversed first so the books never pass through a state
 * where the accrual is cleared but the expense that raised it is gone.
 */
export async function voidExpense(
  tx: Tx,
  expenseId: string,
  opts: { reason?: string | null; voidedById?: string | null } = {},
) {
  const expense = await getExpense(tx, expenseId);
  if (!expense) throw new Error("Expense not found");
  if (expense.status === "void") {
    throw new Error(`Expense ${expense.expenseNumber} is already void.`);
  }
  if (!expense.journalEntryId) {
    throw new Error("Expense has no journal entry to reverse.");
  }

  const reason = opts.reason?.trim() || `Void of expense ${expense.expenseNumber}`;

  const reversals = [];
  if (expense.clearingJournalEntryId) {
    reversals.push(
      await reverseJournalEntry(
        tx,
        expense.clearingJournalEntryId,
        opts.voidedById ?? "",
        reason,
      ),
    );
  }
  reversals.push(
    await reverseJournalEntry(
      tx,
      expense.journalEntryId,
      opts.voidedById ?? "",
      reason,
    ),
  );

  const [updated] = await tx
    .update(expenses)
    .set({
      status: "void",
      voidedAt: new Date(),
      voidedById: opts.voidedById ?? null,
      voidReason: opts.reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(expenses.id, expenseId))
    .returning();

  return { expense: updated, reversals };
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adds receipts. It does NOT replace them.
 *
 * `updateExpense` assigns `expense.receipts = receipts` wholesale, so editing
 * an expense and uploading nothing deleted every receipt already attached —
 * the evidence for the expense, removed by an edit that did not mention it.
 */
export async function addReceipts(
  tx: Tx,
  input: {
    companyId: string;
    expenseId: string;
    receipts: ExpenseReceiptInput[];
    uploadedById?: string | null;
  },
) {
  if (!input.receipts.length) return [];
  return tx
    .insert(expenseReceipts)
    .values(
      input.receipts.map((r) => ({
        companyId: input.companyId,
        expenseId: input.expenseId,
        filename: r.filename,
        url: r.url,
        publicId: r.publicId ?? null,
        resourceType: r.resourceType ?? null,
        size: r.size ?? null,
        mimeType: r.mimeType ?? null,
        uploadedById: input.uploadedById ?? null,
      })),
    )
    .returning();
}

export async function removeReceipt(tx: Tx, receiptId: string) {
  const [deleted] = await tx
    .delete(expenseReceipts)
    .where(eq(expenseReceipts.id, receiptId))
    .returning();
  if (!deleted) throw new Error("Receipt not found");
  return deleted;
}

export async function listReceipts(tx: Tx, expenseId: string) {
  return tx
    .select()
    .from(expenseReceipts)
    .where(eq(expenseReceipts.expenseId, expenseId))
    .orderBy(asc(expenseReceipts.uploadedAt));
}

/**
 * Deletes a DRAFT expense. A posted one is voided.
 *
 * Reachable only if a draft exists, which `createAndPostExpense` never leaves
 * behind — it is here for a caller that deliberately makes one, and so that
 * the action layer's guard has something honest to call.
 */
export async function deleteDraftExpense(tx: Tx, expenseId: string) {
  const [deleted] = await tx
    .delete(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.status, "draft")))
    .returning();
  if (!deleted) throw new Error("Only a draft expense can be deleted");
  return deleted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function getExpense(tx: Tx, expenseId: string) {
  const [row] = await tx
    .select()
    .from(expenses)
    .where(eq(expenses.id, expenseId));
  return row ?? null;
}

/**
 * The detail page's shape.
 *
 * Named for what it is: the PAGE shape, not the row. It is the distinction
 * that caught quote duplication out (§9E) — a screen reading `items[]` from a
 * function that returns `lines[]`, silently rendering nothing.
 */
export async function getExpenseForDisplay(tx: Tx, expenseId: string) {
  // Three aliases of `users`, because one row can name three different people
  // and a single join would pick whichever the planner reached first.
  const createdBy = alias(users, "created_by");
  const postedBy = alias(users, "posted_by");
  const voidedBy = alias(users, "voided_by");

  const [row] = await tx
    .select({
      expense: expenses,
      payeeName: parties.name,
      entryNumber: journalEntries.entryNumber,
      createdByName: createdBy.name,
      postedByName: postedBy.name,
      voidedByName: voidedBy.name,
    })
    .from(expenses)
    .leftJoin(parties, eq(parties.id, expenses.payeePartyId))
    .leftJoin(journalEntries, eq(journalEntries.id, expenses.journalEntryId))
    .leftJoin(createdBy, eq(createdBy.id, expenses.createdById))
    .leftJoin(postedBy, eq(postedBy.id, expenses.postedById))
    .leftJoin(voidedBy, eq(voidedBy.id, expenses.voidedById))
    .where(eq(expenses.id, expenseId));

  if (!row) return null;

  const receipts = await listReceipts(tx, expenseId);
  const e = row.expense;

  return {
    _id: e.id,
    id: e.id,
    companyId: e.companyId,
    expenseNumber: e.expenseNumber,
    expenseDate: e.expenseDate,
    category: e.category,
    status: e.status,
    paymentStatus: e.paymentStatus,

    account: {
      id: e.accountId,
      // The snapshot, not the live account — renaming an account must not
      // rewrite an expense already in the ledger (§9.4).
      accountCode: e.accountCodeAtExpense,
      accountName: e.accountNameAtExpense,
    },
    accountCode: e.accountCodeAtExpense,
    accountName: e.accountNameAtExpense,

    amount: e.amount,
    taxAmount: e.taxAmount,
    taxRate: e.taxRate,
    withholdingTax: e.withholdingTax,
    total: e.total,
    currency: e.currency,

    paymentMethod: e.paymentMethod,
    paidFrom: e.paidFromAccountId,
    paidAt: e.paidAt,

    /**
     * `vendor`, in the Mongo shape the screens already read. The payee's
     * CURRENT name is offered separately rather than substituted: the
     * document says what it said, and `payeeCurrentName` is for a screen that
     * wants to show the party has since been renamed.
     */
    vendor: {
      id: e.payeePartyId,
      partyType: e.payeeType,
      name: e.payeeNameAtExpense,
      phone: e.payeePhoneAtExpense,
      email: e.payeeEmailAtExpense,
      taxPin: e.payeeTaxPinAtExpense,
    },
    payeeCurrentName: row.payeeName,

    description: e.description,
    reference: e.reference,
    invoiceNumber: e.supplierInvoiceNumber,
    notes: e.notes,

    project: e.projectId
      ? {
          id: e.projectId,
          projectNumber: e.projectNumberAtExpense,
          name: e.projectNameAtExpense,
        }
      : null,
    projectId: e.projectId,
    costCode: e.costCodeId
      ? { id: e.costCodeId, code: e.costCodeAtExpense }
      : null,
    asset: e.assetId
      ? {
          id: e.assetId,
          assetNumber: e.assetNumberAtExpense,
          name: e.assetNameAtExpense,
        }
      : null,

    isReimbursable: e.isReimbursable,
    employeeId: e.employeePartyId,
    employeeName: e.employeeNameAtExpense,
    reimbursedAt: e.reimbursedAt,

    journalEntryId: e.journalEntryId,
    journalEntryNumber: row.entryNumber,
    clearingJournalEntryId: e.clearingJournalEntryId,

    /**
     * `{ name }` objects, because that is what the detail page renders
     * (`expense.createdBy?.name`). Mongo stored a denormalised name-and-id
     * pair on the document; here it is a join, so a user who is renamed is
     * named correctly on every expense they ever entered rather than only on
     * the ones entered after.
     */
    createdBy: row.createdByName ? { name: row.createdByName } : null,
    postedAt: e.postedAt,
    postedBy: row.postedByName ? { name: row.postedByName } : null,
    voidedAt: e.voidedAt,
    voidedBy: row.voidedByName ? { name: row.voidedByName } : null,
    voidReason: e.voidReason,

    receipts: receipts.map((r) => ({
      _id: r.id,
      id: r.id,
      filename: r.filename,
      url: r.url,
      size: r.size,
      mimeType: r.mimeType,
      uploadedAt: r.uploadedAt,
    })),
    // The Mongo virtual, kept so the screens do not have to change.
    hasReceipts: receipts.length > 0,
    isPaid: e.paymentStatus === "paid",

    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export interface ListExpensesOptions {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  category?: string;
  paymentStatus?: "paid" | "unpaid";
  startDate?: string;
  endDate?: string;
  payeePartyId?: string;
  projectId?: string;
  assetId?: string;
  isReimbursable?: boolean;
}

export async function listExpenses(tx: Tx, opts: ListExpensesOptions = {}) {
  const page = Math.max(1, opts.page ?? 1);
  // Capped, deliberately. The Mongo list takes whatever limit it is handed.
  const limit = Math.min(opts.limit ?? 20, 100);

  const conditions = [];
  if (opts.status) {
    conditions.push(
      eq(expenses.status, opts.status as (typeof expenses.status.enumValues)[number]),
    );
  }
  if (opts.category) {
    conditions.push(
      eq(
        expenses.category,
        opts.category as (typeof expenses.category.enumValues)[number],
      ),
    );
  }
  if (opts.paymentStatus) {
    conditions.push(eq(expenses.paymentStatus, opts.paymentStatus));
  }
  if (opts.startDate) conditions.push(gte(expenses.expenseDate, opts.startDate));
  if (opts.endDate) conditions.push(lte(expenses.expenseDate, opts.endDate));
  if (opts.payeePartyId) {
    conditions.push(eq(expenses.payeePartyId, opts.payeePartyId));
  }
  if (opts.projectId) conditions.push(eq(expenses.projectId, opts.projectId));
  if (opts.assetId) conditions.push(eq(expenses.assetId, opts.assetId));
  if (opts.isReimbursable !== undefined) {
    conditions.push(eq(expenses.isReimbursable, opts.isReimbursable));
  }
  if (opts.search) {
    const term = `%${opts.search}%`;
    conditions.push(
      or(
        ilike(expenses.expenseNumber, term),
        ilike(expenses.description, term),
        ilike(expenses.payeeNameAtExpense, term),
        ilike(expenses.reference, term),
      )!,
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await tx
    .select()
    .from(expenses)
    .where(where)
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  const [{ count }] = (await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(expenses)
    .where(where)) as Array<{ count: number }>;

  return {
    expenses: rows,
    pagination: {
      page,
      limit,
      total: count,
      pages: Math.max(1, Math.ceil(count / limit)),
    },
  };
}

/**
 * The list page's summary cards, in the shape `ExpenseList` already reads:
 * `{ period, byStatus, byCategory, totals }`.
 *
 * Two things change from the Mongo version.
 *
 * `byStatus` no longer carries `pending` and `approved`. Nothing creates
 * those statuses, so the screen's `(posted.count || 0) + (approved.count || 0)
 * + (pending.count || 0)` was two dead terms in a sum — see the enum comment
 * in schema/enums.ts. The screen is updated with it.
 *
 * `byCategory` covers everything not void, where Mongo filters
 * `status: "paid"` and so leaves ACCRUED expenses out of the breakdown
 * entirely. An unpaid expense is a cost the moment it is incurred; the P&L
 * already says so, and a category chart that disagrees with the P&L is worse
 * than no chart. Paid-versus-unpaid is reported alongside instead.
 *
 * `byStatus` is all-time and `totals`/`byCategory` are for the period — the
 * split the Mongo version has and the screen's labels assume ("This month").
 */
export async function getExpenseSummary(
  tx: Tx,
  opts: { startDate?: string; endDate?: string } = {},
) {
  const now = new Date();
  const startDate =
    opts.startDate ??
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const endDate =
    opts.endDate ??
    new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const periodWhere = and(
    sql`${expenses.status} <> 'void'`,
    gte(expenses.expenseDate, startDate),
    lte(expenses.expenseDate, endDate),
  );

  const [statusRows, byCategory, totalsRows] = await Promise.all([
    tx
      .select({
        status: expenses.status,
        count: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${expenses.total}), 0)::text`,
      })
      .from(expenses)
      .groupBy(expenses.status),

    tx
      .select({
        category: expenses.category,
        count: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${expenses.total}), 0)::text`,
      })
      .from(expenses)
      .where(periodWhere)
      .groupBy(expenses.category)
      .orderBy(sql`sum(${expenses.total}) DESC`),

    tx
      .select({
        count: sql<number>`count(*)::int`,
        totalAmount: sql<string>`coalesce(sum(${expenses.total}), 0)::text`,
        totalTax: sql<string>`coalesce(sum(${expenses.taxAmount}), 0)::text`,
        totalWHT: sql<string>`coalesce(sum(${expenses.withholdingTax}), 0)::text`,
        totalPaid: sql<string>`coalesce(sum(${expenses.total}) FILTER (WHERE ${expenses.paymentStatus} = 'paid'), 0)::text`,
        totalUnpaid: sql<string>`coalesce(sum(${expenses.total}) FILTER (WHERE ${expenses.paymentStatus} = 'unpaid'), 0)::text`,
      })
      .from(expenses)
      .where(periodWhere),
  ]);

  const byStatus: Record<string, { count: number; total: string }> = {};
  for (const row of statusRows) {
    byStatus[row.status] = { count: row.count, total: row.total };
  }

  return {
    period: { startDate, endDate },
    byStatus,
    byCategory: byCategory.map((c) => ({
      category: c.category,
      count: c.count,
      total: c.total,
    })),
    totals: totalsRows[0],
  };
}

/** Running costs for one asset — the roll-up `getAssetExpenses` does. */
export async function getExpensesByAsset(
  tx: Tx,
  assetId: string,
  opts: { startDate?: string; endDate?: string } = {},
) {
  const conditions = [
    eq(expenses.assetId, assetId),
    sql`${expenses.status} <> 'void'`,
  ];
  if (opts.startDate) conditions.push(gte(expenses.expenseDate, opts.startDate));
  if (opts.endDate) conditions.push(lte(expenses.expenseDate, opts.endDate));

  return tx
    .select()
    .from(expenses)
    .where(and(...conditions))
    .orderBy(desc(expenses.expenseDate));
}

/** What a project has spent, split the way the project screens read it. */
export async function getProjectExpenseTotals(tx: Tx, projectId: string) {
  const [row] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${expenses.total}), 0)::text`,
      paid: sql<string>`coalesce(sum(${expenses.total}) FILTER (WHERE ${expenses.paymentStatus} = 'paid'), 0)::text`,
      committed: sql<string>`coalesce(sum(${expenses.total}) FILTER (WHERE ${expenses.paymentStatus} = 'unpaid'), 0)::text`,
    })
    .from(expenses)
    .where(
      and(eq(expenses.projectId, projectId), sql`${expenses.status} <> 'void'`),
    );
  return row;
}

/** The categories the form offers, straight off the enum. */
export function getExpenseCategories() {
  return expenses.category.enumValues.map((value) => ({
    value,
    label: value
      .split("_")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" "),
  }));
}

/**
 * Project spend per expense ACCOUNT — the budget-versus-actual breakdown.
 *
 * `committed` is the accrual: posted and not yet paid. The Mongo version asks
 * for `status: "approved"` — one of the legacy statuses nothing produces — so
 * the committed column on the project budget page has always been zero, and
 * the variance against budget has always been wrong by exactly the accruals.
 */
export async function getProjectExpensesByAccount(tx: Tx, projectId: string) {
  return tx
    .select({
      accountId: expenses.accountId,
      accountCode: expenses.accountCodeAtExpense,
      accountName: expenses.accountNameAtExpense,
      actual: sql<string>`coalesce(sum(${expenses.total}) FILTER (WHERE ${expenses.paymentStatus} = 'paid'), 0)::text`,
      committed: sql<string>`coalesce(sum(${expenses.total}) FILTER (WHERE ${expenses.paymentStatus} = 'unpaid'), 0)::text`,
    })
    .from(expenses)
    .where(
      and(eq(expenses.projectId, projectId), sql`${expenses.status} <> 'void'`),
    )
    .groupBy(
      expenses.accountId,
      expenses.accountCodeAtExpense,
      expenses.accountNameAtExpense,
    );
}

/** The project drill-down list. */
export async function listProjectExpenses(
  tx: Tx,
  projectId: string,
  limit = 50,
) {
  return tx
    .select({
      id: expenses.id,
      expenseNumber: expenses.expenseNumber,
      status: expenses.status,
      paymentStatus: expenses.paymentStatus,
      total: expenses.total,
      accountName: expenses.accountNameAtExpense,
      category: expenses.category,
      expenseDate: expenses.expenseDate,
      payeeName: expenses.payeeNameAtExpense,
    })
    .from(expenses)
    .where(
      and(eq(expenses.projectId, projectId), sql`${expenses.status} <> 'void'`),
    )
    .orderBy(desc(expenses.expenseDate))
    .limit(Math.min(limit, 200));
}

/** Running cost per asset over a window — the fleet insights roll-up. */
export async function sumExpensesByAsset(
  tx: Tx,
  opts: { assetIds: string[]; since: string; until: string },
) {
  if (!opts.assetIds.length) return [];
  return tx
    .select({
      assetId: expenses.assetId,
      total: sql<string>`coalesce(sum(${expenses.total}), 0)::text`,
    })
    .from(expenses)
    .where(
      and(
        inArray(expenses.assetId, opts.assetIds),
        sql`${expenses.status} <> 'void'`,
        gte(expenses.expenseDate, opts.since),
        lte(expenses.expenseDate, opts.until),
      ),
    )
    .groupBy(expenses.assetId);
}

/**
 * Total operating spend over a window — the executive month-on-month card.
 *
 * Sums `total`, where the Mongo aggregate sums `amount` — so the executive
 * view has been reporting spend NET of VAT and gross of withholding, which is
 * neither the cash that left nor the cost that hit the P&L. And its status
 * filter includes "approved", which nothing produces.
 */
export async function sumExpensesForPeriod(
  tx: Tx,
  opts: { start: string; end: string },
) {
  const [row] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${expenses.total}), 0)::text`,
    })
    .from(expenses)
    .where(
      and(
        sql`${expenses.status} <> 'void'`,
        gte(expenses.expenseDate, opts.start),
        lte(expenses.expenseDate, opts.end),
      ),
    );
  return row;
}

/**
 * Expenses actually PAID out of one account, over a window.
 *
 * The petty cash statement's spend rows. Only paid expenses are money out: a
 * `posted` expense is an unpaid accrual, and counting one as cash disbursed
 * would understate the float. The Mongo query says the same thing by filtering
 * `status: "paid"`; here `payment_status` is a generated column, so it cannot
 * disagree with `paid_at`.
 */
export async function listExpensesPaidFrom(
  tx: Tx,
  accountId: string,
  opts: { from: string; to: string },
) {
  return tx
    .select({
      id: expenses.id,
      expenseNumber: expenses.expenseNumber,
      expenseDate: expenses.expenseDate,
      paidAt: expenses.paidAt,
      description: expenses.description,
      category: expenses.category,
      accountName: expenses.accountNameAtExpense,
      payeeName: expenses.payeeNameAtExpense,
      projectId: expenses.projectId,
      projectName: expenses.projectNameAtExpense,
      total: expenses.total,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.paidFromAccountId, accountId),
        eq(expenses.paymentStatus, "paid"),
        sql`${expenses.status} <> 'void'`,
        gte(expenses.expenseDate, opts.from),
        lte(expenses.expenseDate, opts.to),
      ),
    )
    .orderBy(asc(expenses.expenseDate));
}
