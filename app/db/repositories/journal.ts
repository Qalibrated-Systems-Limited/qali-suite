import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { journalEntries, journalLines, accounts } from "../schema";
import { anyOf, likeContains } from "./sqlHelpers";

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
  /**
   * The project dimension — 0084. Usually supplied once on the ENTRY and
   * applied to every line; set here only where the lines of one entry belong
   * to different projects.
   */
  projectId?: string | null;
  costCodeId?: string | null;
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
  /**
   * THE PROJECT THIS ENTRY IS FOR, applied to every line that does not name its
   * own — 0084.
   *
   * On the entry as a convenience and on the LINE as the truth: every posting
   * that has a project has it for the whole document (an invoice's receivable
   * and its revenue are both that job's), so making each of two dozen call
   * sites repeat it per line would be the kind of duplication that gets one
   * line wrong and nothing notices.
   */
  projectId?: string | null;
  costCodeId?: string | null;
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
    input.lines.map((line, i) => {
      /**
       * The line wins where it says something, the entry supplies the rest.
       * `undefined` means "not stated" and falls back; an explicit `null` on
       * the line means "deliberately no project", which is how one line of an
       * otherwise project-tagged entry opts out.
       */
      const projectId =
        line.projectId === undefined ? (input.projectId ?? null) : line.projectId;
      const costCodeId =
        line.costCodeId === undefined ? (input.costCodeId ?? null) : line.costCodeId;

      return {
        companyId: input.companyId,
        entryId: entry.id,
        accountId: line.accountId,
        lineNumber: i + 1,
        debit: line.debit ?? "0",
        credit: line.credit ?? "0",
        description: line.description ?? null,
        projectId,
        // `journal_lines_cost_code_needs_project` refuses a code with no
        // project; drop it rather than fail the posting, because a cost code
        // without its project is meaningless rather than fatal.
        costCodeId: projectId ? costCodeId : null,
      };
    }),
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

// ─────────────────────────────────────────────────────────────────────────────
// The journal browser
//
// `/dashboard/journal` read the MONGO ledger while `/dashboard/journal/create`
// wrote to this one — so a manual entry raised through the UI never appeared
// on the page it was raised from, and every automatic posting (invoices,
// bills, expenses, claims, payments) was invisible in the browser entirely.
// The §9E seam, in the one screen whose whole job is to show the ledger.
//
// `listJournalEntries` above was too thin to point the screen at: no filters,
// no cursor, no lines, no party. These are what the timeline actually needs.
// ─────────────────────────────────────────────────────────────────────────────

export interface JournalTimelineFilters {
  status?: string;
  entryType?: string;
  /** today | this_week | this_month | this_quarter | this_year | all */
  period?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

/** The named period the filter bar offers, as a half-open [start, end). */
function periodRange(period?: string): { from: string; to: string } | null {
  if (!period || period === "all") return null;

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const iso = (date: Date) => date.toISOString().slice(0, 10);

  switch (period) {
    case "today":
      return { from: iso(new Date(y, m, d)), to: iso(new Date(y, m, d + 1)) };
    case "this_week": {
      const start = new Date(y, m, d - now.getDay());
      return { from: iso(start), to: iso(new Date(y, m, d - now.getDay() + 7)) };
    }
    case "this_month":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 1)) };
    case "this_quarter": {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 1)) };
    }
    case "this_year":
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y + 1, 0, 1)) };
    default:
      return null;
  }
}

/**
 * `YYYY-MM-DD|uuid`, or null for anything that is not that.
 *
 * A cursor arrives from a query string, so it is whatever the caller sent.
 * Anything unparseable returns null and the reader starts from the top —
 * a bad cursor showing page one is a great deal better than a 500 on a
 * ledger page, and there is nothing a malformed cursor could mean instead.
 */
function parseCursor(cursor: string | null) {
  if (!cursor) return null;
  const [date, id] = String(cursor).split("|");
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "");
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? "");
  return isDate && isUuid ? { entryDate: date, id } : null;
}

/**
 * The timeline: entries newest first, each with its lines and its totals.
 *
 * CURSOR, NOT OFFSET, because the Mongo version paginated on `_id` and the
 * screen's "load more" hands the cursor straight back. Here the cursor is the
 * (entry_date, id) pair the sort is on — an id alone is not monotonic in date
 * order, so paging on it would skip and repeat rows the moment two entries
 * shared a date, which in a ledger is every day.
 *
 * IT IS A STRING, and opaque. `JournalPageClient` puts the cursor in a URL
 * query parameter — `params.set("cursor", cursor)` — so a structured cursor
 * would reach the route as "[object Object]" and page one for ever. The pair
 * is encoded here and parsed here; nothing between the two needs to know.
 */
export async function listJournalTimeline(
  tx: Tx,
  filters: JournalTimelineFilters = {},
  limit = 20,
  cursor: string | null = null,
) {
  const cap = Math.min(Math.max(limit, 1), 100);
  const after = parseCursor(cursor);
  const range = periodRange(filters.period);
  const from = range?.from ?? filters.dateFrom ?? null;
  const to = range?.to ?? (filters.dateTo ?? null);
  const search = filters.search?.trim() || null;

  const rows = (await tx.execute(sql`
    SELECT e.id::text                                   AS id,
           e.entry_number                               AS "entryNumber",
           e.entry_date                                 AS "entryDate",
           e.entry_type::text                           AS "entryType",
           e.description,
           e.reference,
           e.status::text                               AS status,
           e.posted_at                                  AS "postedAt",
           e.created_at                                 AS "createdAt",
           p.name                                       AS "partyName",
           e.party_type::text                           AS "partyType",
           COALESCE(t.debits, 0)::float8                AS "totalDebits",
           COALESCE(t.credits, 0)::float8               AS "totalCredits"
      FROM journal_entries e
      LEFT JOIN parties p ON p.id = e.party_id
      LEFT JOIN LATERAL (
        SELECT SUM(l.debit) AS debits, SUM(l.credit) AS credits
          FROM journal_lines l WHERE l.entry_id = e.id
      ) t ON true
     WHERE TRUE
       ${filters.status && filters.status !== "all"
         ? sql`AND e.status = ${filters.status}::journal_status`
         : sql``}
       ${filters.entryType && filters.entryType !== "all"
         ? sql`AND e.entry_type = ${filters.entryType}::journal_entry_type`
         : sql``}
       ${from ? sql`AND e.entry_date >= ${from}::date` : sql``}
       ${to
         ? range
           ? sql`AND e.entry_date < ${to}::date`
           // A typed-in "to" is inclusive of that day, as the Mongo filter was.
           : sql`AND e.entry_date <= ${to}::date`
         : sql``}
       ${search
         ? sql`AND (e.entry_number ILIKE ${likeContains(search)}
                 OR e.description ILIKE ${likeContains(search)}
                 OR e.reference ILIKE ${likeContains(search)}
                 OR p.name ILIKE ${likeContains(search)})`
         : sql``}
       ${after
         ? sql`AND (e.entry_date, e.id) < (${after.entryDate}::date, ${after.id}::uuid)`
         : sql``}
     ORDER BY e.entry_date DESC, e.id DESC
     LIMIT ${cap + 1}
  `)) as unknown as Array<Record<string, unknown>>;

  const hasMore = rows.length > cap;
  const page = rows.slice(0, cap);

  // The lines, for the whole page in one query rather than one per entry.
  const lines = page.length
    ? ((await tx.execute(sql`
        SELECT l.entry_id::text                AS "entryId",
               l.line_number                   AS "lineNumber",
               a.account_code                  AS "accountCode",
               a.account_name                  AS "accountName",
               l.debit::float8                 AS debit,
               l.credit::float8                AS credit,
               l.description
          FROM journal_lines l
          JOIN accounts a ON a.id = l.account_id
         WHERE l.entry_id = ${anyOf(page.map((r) => String(r.id)), "uuid[]")}
         ORDER BY l.entry_id, l.line_number
      `)) as unknown as Array<Record<string, unknown>>)
    : [];

  const byEntry = new Map<string, Array<Record<string, unknown>>>();
  for (const line of lines) {
    const key = String(line.entryId);
    const bucket = byEntry.get(key) ?? [];
    bucket.push(line);
    byEntry.set(key, bucket);
  }

  const last = page[page.length - 1];
  return {
    entries: page.map((e) => ({
      ...e,
      lines: byEntry.get(String(e.id)) ?? [],
      party: e.partyName ? { name: e.partyName, type: e.partyType } : null,
    })),
    hasMore,
    nextCursor:
      hasMore && last
        ? `${String(last.entryDate).slice(0, 10)}|${String(last.id)}`
        : null,
  };
}

/**
 * The four stat cards above the timeline.
 *
 * One query, not five. The Mongo version fires five in parallel, one of them
 * an `$unwind` over every line posted this month purely to count DISTINCT
 * entries — which is what `count(DISTINCT ...)` is for.
 */
export async function getJournalStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    WITH period AS (
      SELECT date_trunc('month', CURRENT_DATE)::date                        AS this_start,
             (date_trunc('month', CURRENT_DATE) - interval '1 month')::date AS last_start
    )
    SELECT
      COUNT(*)::int                                                AS total_entries,
      COUNT(*) FILTER (
        WHERE e.status = 'posted'
          AND e.entry_date >= (SELECT this_start FROM period)
      )::int                                                       AS this_month_entries,
      COUNT(*) FILTER (
        WHERE e.status = 'posted'
          AND e.entry_date >= (SELECT last_start FROM period)
          AND e.entry_date <  (SELECT this_start FROM period)
      )::int                                                       AS last_month_entries,
      COUNT(*) FILTER (WHERE e.status = 'draft')::int              AS draft_count,
      COUNT(*) FILTER (
        WHERE e.status = 'reversed'
          AND e.reversed_at >= (SELECT this_start FROM period)
      )::int                                                       AS reversal_count,
      COALESCE((
        SELECT SUM(l.debit)
          FROM journal_lines l
          JOIN journal_entries e2 ON e2.id = l.entry_id
         WHERE e2.status = 'posted'
           AND e2.entry_date >= (SELECT this_start FROM period)
      ), 0)::float8                                                AS this_month_volume
      FROM journal_entries e
  `)) as unknown as Array<Record<string, unknown>>;

  const n = (v: unknown) => Number(v ?? 0);
  const thisMonth = n(row?.this_month_entries);
  const lastMonth = n(row?.last_month_entries);

  return {
    totalEntries: n(row?.total_entries),
    thisMonthEntries: thisMonth,
    thisMonthVolume: n(row?.this_month_volume),
    draftCount: n(row?.draft_count),
    reversalCount: n(row?.reversal_count),
    // Against a zero base a percentage is undefined, not infinite — the tiles
    // render 0 as "no change", which is what the Mongo version returned too.
    trend: lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0,
  };
}

/**
 * One entry, in the shape the detail page renders — including the names behind
 * the ids and the source document's number.
 *
 * `getJournalEntry` above returns the row and its lines and is what the
 * actions use. This adds the joins that exist only for display, so the page
 * does not fetch a user and a party per entry it shows.
 */
export async function getJournalEntryDetail(tx: Tx, entryId: string) {
  const [entry] = (await tx.execute(sql`
    SELECT e.id::text                        AS id,
           e.entry_number                    AS "entryNumber",
           e.entry_date                      AS "entryDate",
           e.entry_type::text                AS "entryType",
           e.description,
           e.reference,
           e.notes,
           e.status::text                    AS status,
           e.fiscal_year                     AS "fiscalYear",
           e.fiscal_month                    AS "fiscalMonth",
           e.posted_at                       AS "postedAt",
           e.reversed_at                     AS "reversedAt",
           e.created_at                      AS "createdAt",
           e.reversal_entry_id::text         AS "reversalEntryId",
           e.original_entry_id::text         AS "originalEntryId",
           e.source_type::text               AS "sourceType",
           e.source_id::text                 AS "sourceId",
           party.name                        AS "partyName",
           e.party_type::text                AS "partyType",
           creator.name                      AS "createdByName",
           poster.name                       AS "postedByName",
           reverser.name                     AS "reversedByName",
           inv.invoice_number                AS "invoiceNumber",
           bill.bill_number                  AS "billNumber",
           pay.payment_number                AS "paymentNumber"
      FROM journal_entries e
      LEFT JOIN parties party ON party.id = e.party_id
      LEFT JOIN users creator  ON creator.id  = e.created_by_id
      LEFT JOIN users poster   ON poster.id   = e.posted_by_id
      LEFT JOIN users reverser ON reverser.id = e.reversed_by_id
      LEFT JOIN invoices inv ON e.source_type = 'invoice' AND inv.id = e.source_id
      LEFT JOIN bills bill   ON e.source_type = 'bill'    AND bill.id = e.source_id
      LEFT JOIN payments pay ON e.source_type = 'payment' AND pay.id = e.source_id
     WHERE e.id = ${entryId}
  `)) as unknown as Array<Record<string, unknown>>;

  if (!entry) return null;

  const lines = (await tx.execute(sql`
    SELECT l.line_number       AS "lineNumber",
           a.account_code      AS "accountCode",
           a.account_name      AS "accountName",
           a.account_type::text AS "accountType",
           l.debit::float8     AS debit,
           l.credit::float8    AS credit,
           l.description
      FROM journal_lines l
      JOIN accounts a ON a.id = l.account_id
     WHERE l.entry_id = ${entryId}
     ORDER BY l.line_number
  `)) as unknown as Array<Record<string, unknown>>;

  const debit = lines.reduce((sum, l) => sum + Number(l.debit ?? 0), 0);
  const credit = lines.reduce((sum, l) => sum + Number(l.credit ?? 0), 0);

  const relatedDocuments =
    entry.invoiceNumber || entry.billNumber || entry.paymentNumber
      ? {
          invoiceNumber: entry.invoiceNumber ?? null,
          billNumber: entry.billNumber ?? null,
          paymentNumber: entry.paymentNumber ?? null,
        }
      : null;

  return {
    ...entry,
    lines,
    party: entry.partyName ? { name: entry.partyName, type: entry.partyType } : null,
    createdBy: entry.createdByName ? { name: entry.createdByName } : null,
    postedBy: entry.postedByName ? { name: entry.postedByName } : null,
    reversedBy: entry.reversedByName ? { name: entry.reversedByName } : null,
    relatedDocuments,
    /**
     * Decided on the exact sums, not on a rounded comparison. A journal entry
     * out by half a cent is out — the same rule the balance sheet's
     * `isBalanced` follows.
     */
    totals: { debit, credit, isBalanced: debit === credit },
  };
}
