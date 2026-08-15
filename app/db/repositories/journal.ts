import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { journalEntries, journalLines, accounts } from "../schema";

/**
 * Journal repository — all SQL for the double-entry ledger lives here.
 *
 * Contract with the layer above (see docs/POSTGRES-MIGRATION-PLAN.md §4.1):
 *   - Every function takes a `tx` obtained from withTenant(), so RLS is active.
 *   - Nothing here reads the session or checks permissions; that is the
 *     server-action layer's job.
 *   - MONEY IS PASSED AND RETURNED AS STRINGS. numeric(19,4) maps to string in
 *     Drizzle precisely so values never round-trip through float64. Do not
 *     Number() these — format them, or use a decimal library for arithmetic.
 */

export type MoneyString = string;

export interface JournalLineInput {
  accountId: string;
  debit?: MoneyString;
  credit?: MoneyString;
  description?: string | null;
}

export interface CreateJournalEntryInput {
  companyId: string;
  entryDate: string; // YYYY-MM-DD
  entryType: (typeof journalEntries.entryType.enumValues)[number];
  description: string;
  reference?: string | null;
  notes?: string | null;
  partyType?: (typeof journalEntries.partyType.enumValues)[number] | null;
  partyId?: string | null;
  dueDate?: string | null;
  sourceType?: (typeof journalEntries.sourceType.enumValues)[number] | null;
  sourceId?: string | null;
  lines: JournalLineInput[];
  createdById?: string | null;
  postImmediately?: boolean;
}

/**
 * Creates an entry and its lines in one transaction.
 *
 * Note what is NOT here compared to the Mongo version: no balance check, no
 * "at least 2 lines" check, no both-debit-and-credit check, no fiscal-period
 * lookup. Those are database constraints now (migration 0001) and fire at
 * COMMIT whether or not this function remembers them. The Zod schema in the
 * action layer still validates for a friendly error message — but it is no
 * longer the thing standing between a bad entry and the ledger.
 */
export async function createJournalEntry(
  tx: Tx,
  input: CreateJournalEntryInput,
) {
  const status = input.postImmediately ? "posted" : "draft";

  // Atomic per-company counter — replaces the string-sort-and-increment scan
  // that raced under concurrency.
  const prefix = input.postImmediately ? "JE" : "JE-DRAFT";
  const [{ entry_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, ${prefix}) AS entry_number`,
  )) as unknown as Array<{ entry_number: string }>;

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      companyId: input.companyId,
      entryNumber: entry_number,
      entryDate: input.entryDate,
      entryType: input.entryType,
      description: input.description,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      partyType: input.partyType ?? null,
      partyId: input.partyId ?? null,
      dueDate: input.dueDate ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      status,
      postedAt: input.postImmediately ? new Date() : null,
      postedById: input.postImmediately ? (input.createdById ?? null) : null,
      createdById: input.createdById ?? null,
    })
    .returning();

  await tx.insert(journalLines).values(
    input.lines.map((line, i) => ({
      companyId: input.companyId,
      entryId: entry.id,
      accountId: line.accountId,
      lineNumber: i + 1,
      debit: line.debit ?? "0",
      credit: line.credit ?? "0",
      description: line.description ?? null,
    })),
  );

  return entry;
}

/**
 * Draft -> posted. The balance and fiscal-period triggers do the validating;
 * a failure surfaces as a Postgres check_violation with a readable message.
 */
export async function postJournalEntry(
  tx: Tx,
  entryId: string,
  postedById: string,
) {
  const [updated] = await tx
    .update(journalEntries)
    .set({ status: "posted", postedAt: new Date(), postedById, updatedAt: new Date() })
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.status, "draft")))
    .returning();

  if (!updated) {
    throw new Error("Entry not found, or not in draft status");
  }
  return updated;
}

/**
 * Reversal: mirrors every line with debit/credit swapped, dated today.
 *
 * The Mongo implementation copied the original's fiscal period, letting a
 * reversal post into a closed period. Here the reversal is simply dated today
 * and the fiscal-period trigger resolves and enforces the period from that
 * date — the closed-period bypass is not expressible.
 */
export async function reverseJournalEntry(
  tx: Tx,
  entryId: string,
  reversedById: string,
  reason: string,
) {
  const [original] = await tx
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.status, "posted")));

  if (!original) throw new Error("Can only reverse a posted journal entry");
  if (original.reversedAt) throw new Error("Journal entry is already reversed");

  const lines = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, entryId))
    .orderBy(journalLines.lineNumber);

  const [{ entry_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${original.companyId}::uuid, 'JE-REV') AS entry_number`,
  )) as unknown as Array<{ entry_number: string }>;

  const today = new Date().toISOString().slice(0, 10);

  const [reversal] = await tx
    .insert(journalEntries)
    .values({
      companyId: original.companyId,
      entryNumber: entry_number,
      entryDate: today,
      entryType: "adjustment",
      description: `Reversal of ${original.entryNumber}: ${reason || "No reason provided"}`,
      partyType: original.partyType,
      partyId: original.partyId,
      status: "posted",
      postedAt: new Date(),
      postedById: reversedById,
      originalEntryId: original.id,
      createdById: reversedById,
    })
    .returning();

  await tx.insert(journalLines).values(
    lines.map((line, i) => ({
      companyId: original.companyId,
      entryId: reversal.id,
      accountId: line.accountId,
      lineNumber: i + 1,
      debit: line.credit, // swapped
      credit: line.debit,
      description: `Reversal: ${line.description ?? ""}`,
    })),
  );

  await tx
    .update(journalEntries)
    .set({
      status: "reversed",
      reversedAt: new Date(),
      reversedById,
      reversalEntryId: reversal.id,
      updatedAt: new Date(),
    })
    .where(eq(journalEntries.id, original.id));

  return reversal;
}

export async function deleteDraftJournalEntry(tx: Tx, entryId: string) {
  // Lines cascade via the composite FK.
  const deleted = await tx
    .delete(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.status, "draft")))
    .returning({ id: journalEntries.id });

  if (deleted.length === 0) {
    throw new Error("Entry not found, or not in draft status (only drafts can be deleted)");
  }
}

/**
 * One entry with its lines and account names joined in.
 *
 * The Mongo document cached accountCode/accountName on every line to avoid
 * this join. That cache went stale whenever an account was renamed; the join
 * costs an index seek and is always right.
 */
export async function getJournalEntry(tx: Tx, entryId: string) {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, entryId));

  if (!entry) return null;

  const lines = await tx
    .select({
      id: journalLines.id,
      lineNumber: journalLines.lineNumber,
      accountId: journalLines.accountId,
      accountCode: accounts.accountCode,
      accountName: accounts.accountName,
      accountType: accounts.accountType,
      debit: journalLines.debit,
      credit: journalLines.credit,
      description: journalLines.description,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.entryId, entryId))
    .orderBy(journalLines.lineNumber);

  return { ...entry, lines };
}

export async function listJournalEntries(
  tx: Tx,
  opts: { limit?: number; offset?: number; status?: "draft" | "posted" | "reversed" } = {},
) {
  // Capped so a UI bug cannot ask for the whole ledger.
  const limit = Math.min(opts.limit ?? 50, 200);

  const where = opts.status ? eq(journalEntries.status, opts.status) : undefined;

  return tx
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.entryDate,
      entryType: journalEntries.entryType,
      description: journalEntries.description,
      status: journalEntries.status,
      total: sql<string>`(
        SELECT COALESCE(SUM(l.debit), 0)::numeric(19,4)
        FROM ${journalLines} l WHERE l.entry_id = ${journalEntries.id}
      )`.as("total"),
    })
    .from(journalEntries)
    .where(where)
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.entryNumber))
    .limit(limit)
    .offset(opts.offset ?? 0);
}
