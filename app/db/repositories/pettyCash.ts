import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "../client";
import { pettyCashReturns, accounts, users } from "../schema";
import { createJournalEntry } from "./journal";
import { getAccountPosition, listAccountDebits } from "./accounts";
import { listExpensesPaidFrom } from "./expenses";

/**
 * Petty cash returns — the last module out of the Mongo ledger (0060).
 *
 * The lines are DERIVED, not stored: `buildStatement` reads the GL for the
 * float over the period and the expenses paid out of it. That was the Mongo
 * design too and it is right — nothing is re-typed, so the statement cannot
 * disagree with the ledger.
 *
 * What is different is what happens when the return is signed. See
 * `freezeStatement`.
 *
 * MONEY IS A STRING — numeric(19,4). Do not Number() these.
 */

export type MoneyString = string;

const money = (v: unknown): MoneyString => String(v ?? "0");

async function nextDocumentNumber(tx: Tx, companyId: string) {
  const [{ document_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'PCRF') AS document_number`,
  )) as unknown as Array<{ document_number: string }>;
  return document_number;
}

// ─────────────────────────────────────────────────────────────────────────────
// The statement
// ─────────────────────────────────────────────────────────────────────────────

export interface StatementRow {
  kind: "topup" | "expense";
  date: string;
  name: string;
  description: string;
  projectLabel: string;
  direction: "debit" | "credit";
  amount: number;
  ref: string;
  expenseId?: string;
  balance?: number;
}

/**
 * The float's activity over a period, like a bank statement.
 *
 * DR = money in (any posted entry debiting the float — top-ups, transfers,
 * refunds). CR = money out (every expense actually PAID from the float; a
 * posted-but-unpaid expense is an accrual, not cash, and counting it would
 * understate the tin).
 */
export async function buildStatement(
  tx: Tx,
  floatAccountId: string,
  opts: { from: string; to: string; openingOverride?: MoneyString | null },
) {
  const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

  const [spend, topups, position] = await Promise.all([
    listExpensesPaidFrom(tx, floatAccountId, opts),
    listAccountDebits(tx, floatAccountId, opts),
    getAccountPosition(tx, floatAccountId, opts),
  ]);

  // The float is debit-normal.
  const glOpening = r2(position.opening);
  const glClosing = r2(position.closing);
  const openingBalance =
    opts.openingOverride != null ? r2(opts.openingOverride) : glOpening;

  const rows: StatementRow[] = [
    ...topups.map((t) => ({
      kind: "topup" as const,
      date: String(t.entryDate).slice(0, 10),
      name: "Float received",
      description: t.description || "Float top-up",
      projectLabel: "",
      direction: "debit" as const,
      amount: r2(t.amount),
      ref: t.entryNumber,
    })),
    ...spend.map((e) => ({
      kind: "expense" as const,
      date: String(e.expenseDate).slice(0, 10),
      name: e.payeeName || "",
      description: e.description || e.accountName || "",
      // The project name is snapshotted on the expense, so labelling a row no
      // longer means loading every project in the company — and a project
      // since renamed reads as it did at the time.
      projectLabel: e.projectName || e.category || "",
      direction: "credit" as const,
      amount: r2(e.total),
      ref: e.expenseNumber,
      expenseId: e.id,
    })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let balance = openingBalance;
  let debits = 0;
  let credits = 0;
  for (const row of rows) {
    if (row.direction === "debit") {
      balance += row.amount;
      debits += row.amount;
    } else {
      balance -= row.amount;
      credits += row.amount;
    }
    row.balance = r2(balance);
  }

  const accountedClosing = r2(openingBalance + debits - credits);

  return {
    rows,
    openingBalance,
    totals: {
      debits: r2(debits),
      credits: r2(credits),
      closing: accountedClosing,
      glClosing,
      // Over/short: cash movements the expense list does not capture.
      variance: r2(glClosing - accountedClosing),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateReturnInput {
  companyId: string;
  floatAccountId: string;
  from: string;
  to: string;
  custodianUserId?: string | null;
  custodianName?: string | null;
  notes?: string | null;
  createdById?: string | null;
}

/**
 * Opens a draft return for a period.
 *
 * The float must be a cash/bank/mpesa account that can be posted to — the
 * Mongo version only checked the account existed, so a return could be opened
 * against a revenue account and its "statement" would be that account's
 * ledger.
 *
 * Overlap is refused by `petty_cash_returns_no_overlap`, not by a check here:
 * two custodians opening the same period at the same moment would both pass a
 * SELECT and both insert. See 0060.
 */
export async function createReturn(tx: Tx, input: CreateReturnInput) {
  const [float] = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.id, input.floatAccountId));
  if (!float) throw new Error("Petty cash account not found");
  if (!["cash", "bank", "mpesa"].includes(float.subType ?? "")) {
    throw new Error(
      `${float.accountName} is not a cash account, so it cannot hold a float.`,
    );
  }
  if (float.canPost === false) {
    throw new Error(`${float.accountName} cannot be posted to`);
  }

  const documentNumber = await nextDocumentNumber(tx, input.companyId);

  const [row] = await tx
    .insert(pettyCashReturns)
    .values({
      companyId: input.companyId,
      documentNumber,
      floatAccountId: input.floatAccountId,
      custodianUserId: input.custodianUserId ?? null,
      custodianNameAtReturn: input.custodianName ?? null,
      periodFrom: input.from,
      periodTo: input.to,
      notes: input.notes ?? null,
      status: "draft",
      createdById: input.createdById ?? null,
    })
    .returning();

  return row;
}

/**
 * Moves cash from the bank into the tin: DR Petty Cash / CR Bank.
 *
 * THE ONE POSTING IN THIS MODULE, and the last one anywhere outside Postgres.
 * The Mongo path builds the lines by hand, snapshots each account onto them,
 * checks the two sides agree to within a cent — `Math.abs(totalD - totalC) >
 * 0.01`, one of §9.2's six tolerances — and posts through the Mongoose model.
 * None of that survives: the balance has been a database constraint since
 * 0001, and it is exact.
 */
export async function fundFloat(
  tx: Tx,
  returnId: string,
  input: {
    sourceAccountId: string;
    amount: MoneyString;
    date?: string | null;
    note?: string | null;
    fundedById?: string | null;
  },
) {
  const ret = await getReturn(tx, returnId);
  if (!ret) throw new Error("Return not found");
  if (ret.status !== "draft") {
    throw new Error("Funds can only be added to a draft return");
  }
  if (input.sourceAccountId === ret.floatAccountId) {
    throw new Error("Source must differ from the petty cash account");
  }
  if (!(Number(input.amount) > 0)) {
    throw new Error("Enter an amount greater than zero");
  }

  const [source] = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.id, input.sourceAccountId));
  if (!source) throw new Error("Source account not found");
  if (source.canPost === false) {
    throw new Error(`${source.accountName} cannot be posted to`);
  }

  const entryDate = (input.date ?? new Date().toISOString()).slice(0, 10);
  const amount = money(input.amount);

  const entry = await createJournalEntry(tx, {
    companyId: ret.companyId,
    entryDate,
    entryType: "transfer",
    description: `Petty cash float — ${ret.documentNumber}`,
    reference: ret.documentNumber,
    sourceType: "petty_cash_return",
    sourceId: ret.id,
    lines: [
      {
        accountId: ret.floatAccountId,
        debit: amount,
        description: input.note || "Float received",
      },
      {
        accountId: input.sourceAccountId,
        credit: amount,
        description: `To petty cash ${ret.documentNumber}`,
      },
    ],
    createdById: input.fundedById ?? null,
    postImmediately: true,
  });

  return entry;
}

/**
 * Freezes the statement onto the return.
 *
 * This is the whole point of the document, and the Mongo version defeats it:
 * it writes the frozen figures and then `getPettyCashReturnById` spreads the
 * return and OVERWRITES both with a live recomputation, so an approved
 * return's detail page shows figures nobody approved. Book an expense
 * afterwards dated inside the period and the signed return changes.
 *
 * Here the freeze is columns, and `getReturnForDisplay` returns the frozen
 * figures and the live statement side by side so the screen can show a drift
 * rather than hide it.
 */
async function freezeStatement(tx: Tx, ret: typeof pettyCashReturns.$inferSelect) {
  const statement = await buildStatement(tx, ret.floatAccountId, {
    from: ret.periodFrom,
    to: ret.periodTo,
  });
  return {
    openingBalance: statement.openingBalance.toFixed(4),
    totalDebits: statement.totals.debits.toFixed(4),
    totalCredits: statement.totals.credits.toFixed(4),
    glClosingBalance: statement.totals.glClosing.toFixed(4),
    frozenAt: new Date(),
  };
}

/** Custodian returns the form. Submittable from draft OR from rejected. */
export async function submitReturn(
  tx: Tx,
  returnId: string,
  opts: { preparedById?: string | null } = {},
) {
  const ret = await getReturn(tx, returnId);
  if (!ret) throw new Error("Return not found");
  if (!["draft", "rejected"].includes(ret.status)) {
    throw new Error(`Return is already ${ret.status}`);
  }

  const [updated] = await tx
    .update(pettyCashReturns)
    .set({
      ...(await freezeStatement(tx, ret)),
      status: "submitted",
      preparedById: opts.preparedById ?? null,
      preparedAt: new Date(),
      // Resubmitting clears the last rejection: the reason belonged to the
      // version that was sent back, not to this one.
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(pettyCashReturns.id, returnId))
    .returning();

  return updated;
}

/**
 * The MD signs.
 *
 * NO GL POSTING, correctly: the spends are Expenses that posted themselves and
 * the top-ups posted at fund time. Approval is a signature.
 *
 * It DOES re-freeze, as Mongo does — the figures signed are the figures as at
 * the moment of signing, not as at submission.
 */
export async function approveReturn(
  tx: Tx,
  returnId: string,
  opts: { approvedById?: string | null } = {},
) {
  const ret = await getReturn(tx, returnId);
  if (!ret) throw new Error("Return not found");
  if (ret.status !== "submitted") {
    throw new Error("Only a submitted return can be approved");
  }

  const [updated] = await tx
    .update(pettyCashReturns)
    .set({
      ...(await freezeStatement(tx, ret)),
      status: "approved",
      approvedById: opts.approvedById ?? null,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(pettyCashReturns.id, returnId))
    .returning();

  return updated;
}

/**
 * Sent back to the custodian.
 *
 * Status becomes `rejected`, where Mongo sets it to `draft` — so a rejected
 * return was indistinguishable from one never submitted, and the
 * `rejectionReason` it carried belonged to a state the document claimed not to
 * be in. The custodian resubmits from `rejected`.
 */
export async function rejectReturn(
  tx: Tx,
  returnId: string,
  opts: { reason: string; reviewedById?: string | null },
) {
  const ret = await getReturn(tx, returnId);
  if (!ret) throw new Error("Return not found");
  if (ret.status !== "submitted") {
    throw new Error("Only a submitted return can be rejected");
  }
  if (!opts.reason?.trim()) {
    throw new Error("Say why it is being sent back");
  }

  const [updated] = await tx
    .update(pettyCashReturns)
    .set({
      status: "rejected",
      rejectionReason: opts.reason.trim(),
      reviewedById: opts.reviewedById ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(pettyCashReturns.id, returnId))
    .returning();

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function getReturn(tx: Tx, returnId: string) {
  const [row] = await tx
    .select()
    .from(pettyCashReturns)
    .where(eq(pettyCashReturns.id, returnId));
  return row ?? null;
}

export async function listReturns(
  tx: Tx,
  opts: { status?: string; floatAccountId?: string; limit?: number } = {},
) {
  const conditions = [];
  if (opts.status) {
    conditions.push(
      eq(
        pettyCashReturns.status,
        opts.status as (typeof pettyCashReturns.status.enumValues)[number],
      ),
    );
  }
  if (opts.floatAccountId) {
    conditions.push(eq(pettyCashReturns.floatAccountId, opts.floatAccountId));
  }

  const rows = await tx
    .select({
      ret: pettyCashReturns,
      floatAccountName: accounts.accountName,
    })
    .from(pettyCashReturns)
    .leftJoin(accounts, eq(accounts.id, pettyCashReturns.floatAccountId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(pettyCashReturns.periodFrom), desc(pettyCashReturns.createdAt))
    .limit(Math.min(opts.limit ?? 200, 200));

  /**
   * Shaped for the list page — `period`, `custodian`, `totals` — so the screen
   * moves store without being rewritten.
   *
   * `totals` is NULL for a draft, and that is the honest answer: a draft has
   * no frozen figure, and the alternative is either a zero (which reads as
   * "nothing was spent") or a live statement per row, which is one query per
   * return on a page that shows two hundred.
   */
  return rows.map((r) => ({
    ...r.ret,
    _id: r.ret.id,
    floatAccountName: r.floatAccountName ?? "Petty Cash",
    period: { from: r.ret.periodFrom, to: r.ret.periodTo },
    custodian: { name: r.ret.custodianNameAtReturn },
    totals: r.ret.frozenAt
      ? {
          debits: Number(r.ret.totalDebits),
          credits: Number(r.ret.totalCredits),
          closing: Number(r.ret.closingBalance),
        }
      : null,
  }));
}

/**
 * The detail page's shape: the frozen figures AND the live statement.
 *
 * Both, deliberately. Mongo returns only the live one — under the frozen
 * one's key — so an approved return renders figures that were never approved
 * and there is nothing on the page to reveal it. `drift` is the difference,
 * and it is null for a draft, which has nothing to drift from.
 */
export async function getReturnForDisplay(tx: Tx, returnId: string) {
  const preparedBy = alias(users, "prepared_by");
  const reviewedBy = alias(users, "reviewed_by");
  const approvedBy = alias(users, "approved_by");

  const [row] = await tx
    .select({
      ret: pettyCashReturns,
      floatAccountName: accounts.accountName,
      floatAccountCode: accounts.accountCode,
      preparedByName: preparedBy.name,
      reviewedByName: reviewedBy.name,
      approvedByName: approvedBy.name,
    })
    .from(pettyCashReturns)
    .leftJoin(accounts, eq(accounts.id, pettyCashReturns.floatAccountId))
    .leftJoin(preparedBy, eq(preparedBy.id, pettyCashReturns.preparedById))
    .leftJoin(reviewedBy, eq(reviewedBy.id, pettyCashReturns.reviewedById))
    .leftJoin(approvedBy, eq(approvedBy.id, pettyCashReturns.approvedById))
    .where(eq(pettyCashReturns.id, returnId));

  if (!row) return null;
  const r = row.ret;

  const live = await buildStatement(tx, r.floatAccountId, {
    from: r.periodFrom,
    to: r.periodTo,
  });

  const isFrozen = r.frozenAt != null;
  const frozen = isFrozen
    ? {
        openingBalance: Number(r.openingBalance),
        debits: Number(r.totalDebits),
        credits: Number(r.totalCredits),
        closing: Number(r.closingBalance),
        glClosing: Number(r.glClosingBalance),
        variance:
          Math.round(
            (Number(r.glClosingBalance) - Number(r.closingBalance)) * 100,
          ) / 100,
        at: r.frozenAt,
      }
    : null;

  return {
    _id: r.id,
    id: r.id,
    companyId: r.companyId,
    documentNumber: r.documentNumber,
    status: r.status,
    period: { from: r.periodFrom, to: r.periodTo },
    custodian: {
      userId: r.custodianUserId,
      name: r.custodianNameAtReturn,
    },
    float: row.floatAccountName
      ? { accountName: row.floatAccountName, accountCode: row.floatAccountCode }
      : null,

    // The signed figures, or null while it is still a draft.
    frozen,

    // The statement as it stands right now. A draft shows this as its own;
    // a signed return shows it beside what was signed.
    live: {
      rows: live.rows,
      openingBalance: live.openingBalance,
      totals: live.totals,
    },

    /**
     * How far the ledger has moved since the signature. Non-null only when
     * there is a signature to move away from — and a non-zero value means
     * something was booked into a closed period after it was signed off,
     * which is exactly what the Mongo screen could not show because it
     * displayed the live figure under the frozen figure's name.
     */
    drift: isFrozen
      ? Math.round((live.totals.closing - Number(r.closingBalance)) * 100) / 100
      : null,

    preparedBy: row.preparedByName
      ? { name: row.preparedByName, at: r.preparedAt }
      : null,
    reviewedBy: row.reviewedByName
      ? { name: row.reviewedByName, at: r.reviewedAt }
      : null,
    approvedBy: row.approvedByName
      ? { name: row.approvedByName, at: r.approvedAt }
      : null,
    rejectionReason: r.rejectionReason,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Cash accounts that can hold a float. */
export async function listFloatAccounts(tx: Tx) {
  return tx
    .select({
      // `_id` as well as `id`: the pickers key and value off `_id`, and the
      // point of matching the old shape is that the screens do not change.
      _id: accounts.id,
      id: accounts.id,
      accountCode: accounts.accountCode,
      accountName: accounts.accountName,
      subType: accounts.subType,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.isActive, true),
        eq(accounts.canPost, true),
        sql`${accounts.subType} IN ('cash', 'bank', 'mpesa')`,
      ),
    )
    .orderBy(accounts.accountCode);
}
