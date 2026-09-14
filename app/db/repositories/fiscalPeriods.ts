import { sql } from "drizzle-orm";
import type { Tx } from "../client";
import { createJournalEntry } from "./journal";

/**
 * Fiscal periods — the calendar the ledger closes against.
 *
 * MOST OF THE MONGO SERVICE'S GUARDS ARE ALREADY IN THE DATABASE, and are
 * better there:
 *
 *   overlapping periods      `fiscal_periods_company_year_month_uq`
 *   duplicate period codes   `fiscal_periods_company_code_uq`
 *   end before start         `fiscal_periods_date_order`
 *   posting into a closed
 *   or locked period         trigger `trg_resolve_fiscal_period` (0001, 0030),
 *                            which refuses the INSERT rather than trusting the
 *                            application to check first
 *
 * What is left here is the part SQL cannot state: that a period with unposted
 * work in it is not finished, and that closing one moves the year's profit to
 * retained earnings.
 */

export interface FiscalPeriodRow {
  id: string;
  year: number;
  month: number;
  periodName: string;
  periodCode: string;
  startDate: string;
  endDate: string;
  status: string;
  closedAt: Date | null;
  lockedAt: Date | null;
}

function shape(r: Record<string, unknown>): FiscalPeriodRow {
  return {
    id: String(r.id),
    year: Number(r.year),
    month: Number(r.month),
    periodName: String(r.period_name),
    periodCode: String(r.period_code),
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    status: String(r.status),
    closedAt: (r.closed_at as Date) ?? null,
    lockedAt: (r.locked_at as Date) ?? null,
  };
}

export async function listPeriods(
  tx: Tx,
  opts: { year?: number; status?: string; limit?: number } = {},
) {
  const where = [sql`TRUE`];
  if (opts.year) where.push(sql`year = ${opts.year}`);
  if (opts.status && opts.status !== "all") {
    where.push(sql`status = ${opts.status}::fiscal_period_status`);
  }

  const rows = (await tx.execute(sql`
    SELECT * FROM fiscal_periods
     WHERE ${sql.join(where, sql` AND `)}
     ORDER BY year DESC, month DESC
     LIMIT ${Math.min(opts.limit ?? 100, 500)}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(shape);
}

export async function getPeriod(tx: Tx, periodId: string) {
  const [row] = (await tx.execute(sql`
    SELECT * FROM fiscal_periods WHERE id = ${periodId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  return row ? shape(row) : null;
}

/** The period containing today, which is what "current" means to a ledger. */
export async function getCurrentPeriod(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT * FROM fiscal_periods
     WHERE CURRENT_DATE BETWEEN start_date AND end_date
     LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  return row ? shape(row) : null;
}

/** The tiles above the fiscal periods page. */
export async function getPeriodStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT count(*)::int                                        AS total,
           count(*) FILTER (WHERE status = 'open')::int         AS open,
           count(*) FILTER (WHERE status = 'closed')::int       AS closed,
           count(*) FILTER (WHERE status = 'locked')::int       AS locked,
           count(*) FILTER (WHERE status = 'future')::int       AS future,
           count(*) FILTER (
             WHERE status = 'open' AND end_date < CURRENT_DATE
           )::int                                               AS overdue
      FROM fiscal_periods
  `)) as unknown as Array<Record<string, unknown>>;

  // The accountant dashboard prints `currentPeriod.name`, so the field is
  // `name` and not `periodName` — the Mongo shape, kept.
  const current = await getCurrentPeriod(tx);

  return {
    total: Number(row.total),
    open: Number(row.open),
    closed: Number(row.closed),
    locked: Number(row.locked),
    future: Number(row.future),
    // Open but past its end date — the month somebody forgot to close.
    overdue: Number(row.overdue),
    /**
     * THE DATES ARE HERE BECAUSE A CALLER PRINTS THEM.
     *
     * This returned `{ id, name, status }` and the fiscal periods page did
     * `format(new Date(currentPeriod.startDate), "MMM d")` — on a field that
     * was never in the object. `new Date(undefined)` is an Invalid Date and
     * date-fns throws `RangeError: Invalid time value` on one, uncaught, in a
     * server component. The whole page became "Oops! Something went wrong".
     *
     * It only broke for companies that HAVE a period covering today: without
     * one, `currentPeriod` is null and the page takes its "No Active Period"
     * branch and renders. So the page worked until a tenant had a current
     * period, which is to say it worked until it mattered.
     *
     * The test asserted `typeof stats.currentPeriod.name === "string"` and the
     * status, and passed throughout — a shape test proves the query, not that
     * the caller can read what came back.
     */
    currentPeriod: current
      ? {
          id: current.id,
          name: current.periodName,
          status: current.status,
          startDate: current.startDate,
          endDate: current.endDate,
        }
      : null,
  };
}

/**
 * What a period holds, derived rather than stored.
 *
 * The Mongo period document carried `statistics` and `closingBalances` fields
 * written at close time, which is a cache of the ledger that can disagree with
 * it. Counted here on demand instead.
 */
export async function getPeriodSummary(tx: Tx, periodId: string) {
  const period = await getPeriod(tx, periodId);
  if (!period) throw new Error("Fiscal period not found");

  const [row] = (await tx.execute(sql`
    SELECT
      -- DISTINCT because the join multiplies by lines: a two-line entry
      -- would otherwise report as two entries, and the close guard would
      -- tell the user there are twice as many drafts as there are.
      count(DISTINCT e.id) FILTER (WHERE e.status = 'posted')::int AS posted,
      count(DISTINCT e.id) FILTER (WHERE e.status = 'draft')::int  AS drafts,
      COALESCE(SUM(l.debit), 0)::numeric(19,4)          AS total_debit,
      COALESCE(SUM(l.credit), 0)::numeric(19,4)         AS total_credit,
      COALESCE(SUM(l.credit - l.debit) FILTER (
        WHERE a.account_type = 'revenue' AND e.status = 'posted'
      ), 0)::numeric(19,4)                              AS revenue,
      COALESCE(SUM(l.debit - l.credit) FILTER (
        WHERE a.account_type = 'expense' AND e.status = 'posted'
      ), 0)::numeric(19,4)                              AS expenses
      FROM journal_entries e
      LEFT JOIN journal_lines l ON l.entry_id = e.id
      LEFT JOIN accounts a ON a.id = l.account_id
     WHERE e.entry_date BETWEEN ${period.startDate}::date AND ${period.endDate}::date
  `)) as unknown as Array<Record<string, unknown>>;

  const revenue = Number(row.revenue);
  const expenses = Number(row.expenses);
  return {
    period,
    postedEntries: Number(row.posted),
    draftEntries: Number(row.drafts),
    totalDebit: String(row.total_debit),
    totalCredit: String(row.total_credit),
    revenue,
    expenses,
    netResult: revenue - expenses,
  };
}

/** What still stands between this period and being closed. */
export async function getClosingChecklist(tx: Tx, periodId: string) {
  const summary = await getPeriodSummary(tx, periodId);
  return [
    {
      id: "status",
      label: "Period is open",
      done: summary.period.status === "open",
      blocking: true,
    },
    {
      id: "drafts",
      label: "No unposted journal entries",
      done: summary.draftEntries === 0,
      blocking: true,
      detail:
        summary.draftEntries > 0
          ? `${summary.draftEntries} draft ${summary.draftEntries === 1 ? "entry" : "entries"}`
          : undefined,
    },
    {
      id: "balanced",
      label: "Debits equal credits",
      done: Number(summary.totalDebit) === Number(summary.totalCredit),
      blocking: false,
    },
  ];
}

/**
 * Creates one period.
 *
 * `periodCode` and `periodName` are derived from the dates rather than typed,
 * so the two cannot disagree — and the unique index on (company, code) then
 * means the same month cannot be created twice under two different names.
 */
export async function createPeriod(
  tx: Tx,
  input: {
    companyId: string;
    startDate: string;
    endDate: string;
    periodType?: "month" | "quarter";
    status?: "open" | "future";
  },
) {
  const start = new Date(input.startDate);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + 1;
  const quarter = Math.ceil(month / 3);
  const isQuarter = input.periodType === "quarter";

  const periodCode = isQuarter
    ? `${year}-Q${quarter}`
    : `${year}-${String(month).padStart(2, "0")}`;
  const periodName = isQuarter
    ? `Q${quarter} ${year}`
    : `${start.toLocaleString("en", { month: "long", timeZone: "UTC" })} ${year}`;

  const [row] = (await tx.execute(sql`
    INSERT INTO fiscal_periods
      (company_id, year, month, period_name, period_code,
       start_date, end_date, status)
    VALUES (${input.companyId}::uuid, ${year}, ${month}, ${periodName},
            ${periodCode}, ${input.startDate}::date, ${input.endDate}::date,
            ${input.status ?? "open"}::fiscal_period_status)
    RETURNING *
  `)) as unknown as Array<Record<string, unknown>>;

  return shape(row);
}

/**
 * Twelve months, or four quarters, in one go.
 *
 * ON CONFLICT DO NOTHING so running it twice for the same year adds what is
 * missing rather than failing on the first month that already exists — the
 * Mongo version aborted halfway and left a part-built year behind.
 */
export async function createYearPeriods(
  tx: Tx,
  companyId: string,
  year: number,
  periodType: "month" | "quarter" = "month",
) {
  const created: FiscalPeriodRow[] = [];
  const spans =
    periodType === "quarter"
      ? [0, 3, 6, 9].map((m) => ({ start: m, end: m + 2 }))
      : Array.from({ length: 12 }, (_, m) => ({ start: m, end: m }));

  for (const s of spans) {
    const startDate = new Date(Date.UTC(year, s.start, 1));
    const endDate = new Date(Date.UTC(year, s.end + 1, 0));
    const month = s.start + 1;
    const quarter = Math.ceil(month / 3);
    const code =
      periodType === "quarter"
        ? `${year}-Q${quarter}`
        : `${year}-${String(month).padStart(2, "0")}`;
    const name =
      periodType === "quarter"
        ? `Q${quarter} ${year}`
        : `${startDate.toLocaleString("en", { month: "long", timeZone: "UTC" })} ${year}`;

    const rows = (await tx.execute(sql`
      INSERT INTO fiscal_periods
        (company_id, year, month, period_name, period_code,
         start_date, end_date, status)
      VALUES (${companyId}::uuid, ${year}, ${month}, ${name}, ${code},
              ${startDate.toISOString().slice(0, 10)}::date,
              ${endDate.toISOString().slice(0, 10)}::date,
              'open'::fiscal_period_status)
      ON CONFLICT DO NOTHING
      RETURNING *
    `)) as unknown as Array<Record<string, unknown>>;

    if (rows.length) created.push(shape(rows[0]));
  }

  return created;
}

/** Renames or re-dates a period. A closed one is not editable. */
export async function updatePeriod(
  tx: Tx,
  periodId: string,
  input: { periodName?: string | null; startDate?: string | null; endDate?: string | null },
) {
  const period = await getPeriod(tx, periodId);
  if (!period) throw new Error("Fiscal period not found");
  if (period.status !== "open" && period.status !== "future") {
    throw new Error(
      `This period is ${period.status}. Reopen it before editing.`,
    );
  }

  const [row] = (await tx.execute(sql`
    UPDATE fiscal_periods
       SET period_name = COALESCE(${input.periodName ?? null}, period_name),
           start_date  = COALESCE(${input.startDate ?? null}::date, start_date),
           end_date    = COALESCE(${input.endDate ?? null}::date, end_date),
           updated_at  = now()
     WHERE id = ${periodId}::uuid
    RETURNING *
  `)) as unknown as Array<Record<string, unknown>>;

  return shape(row);
}

/**
 * Closes a period, and posts the result of the year to retained earnings.
 *
 * TWO THINGS HAVE TO BE TRUE and only one of them is expressible in SQL. The
 * database already refuses to POST into a closed period; what it cannot know
 * is that a period with drafts still in it is not finished. An unposted entry
 * after the close would have nowhere to go.
 *
 * The closing entry moves revenue and expenses to retained earnings so the
 * income statement starts the next period at zero, which is what closing a
 * period means. It carries entry_type 'closing', so it can be told apart from
 * trading activity in any report.
 */
export async function closePeriod(
  tx: Tx,
  periodId: string,
  actor: { id?: string | null; name?: string | null },
) {
  const period = await getPeriod(tx, periodId);
  if (!period) throw new Error("Fiscal period not found");
  if (period.status !== "open") {
    throw new Error(`Cannot close a period that is ${period.status}.`);
  }

  const summary = await getPeriodSummary(tx, periodId);
  if (summary.draftEntries > 0) {
    throw new Error(
      `Cannot close: ${summary.draftEntries} unposted journal ` +
        `${summary.draftEntries === 1 ? "entry" : "entries"} in this period. ` +
        `Post or delete them first.`,
    );
  }

  // Only when there is something to close. A period with no trading needs no
  // entry, and posting a zero one would be noise in the ledger.
  let closingEntryId: string | null = null;
  if (summary.revenue !== 0 || summary.expenses !== 0) {
    const [retained] = (await tx.execute(sql`
      SELECT id FROM accounts WHERE system_account = 'retained_earnings'
    `)) as unknown as Array<{ id: string }>;
    if (!retained) {
      throw new Error(
        "The chart of accounts has no Retained Earnings account, so this " +
          "period cannot be closed.",
      );
    }

    const balances = (await tx.execute(sql`
      SELECT a.id,
             a.account_type,
             SUM(l.credit - l.debit)::numeric(19,4) AS net
        FROM journal_entries e
        JOIN journal_lines l ON l.entry_id = e.id
        JOIN accounts a ON a.id = l.account_id
       WHERE e.status = 'posted'
         AND a.account_type IN ('revenue', 'expense')
         AND e.entry_date BETWEEN ${period.startDate}::date AND ${period.endDate}::date
       GROUP BY a.id, a.account_type
      HAVING SUM(l.credit - l.debit) <> 0
    `)) as unknown as Array<Record<string, unknown>>;

    if (balances.length) {
      // Each account is taken back to zero: whatever its net is, post the
      // opposite. Retained earnings absorbs the difference, which is the
      // period's profit or loss.
      const lines = balances.map((b) => {
        const net = Number(b.net);
        return net > 0
          ? { accountId: String(b.id), debit: net.toFixed(4), description: "Period close" }
          : { accountId: String(b.id), credit: Math.abs(net).toFixed(4), description: "Period close" };
      });

      const result = summary.revenue - summary.expenses;
      lines.push(
        result >= 0
          ? {
              accountId: retained.id,
              credit: result.toFixed(4),
              description: `Result for ${period.periodName}`,
            }
          : {
              accountId: retained.id,
              debit: Math.abs(result).toFixed(4),
              description: `Result for ${period.periodName}`,
            },
      );

      const entry = await createJournalEntry(tx, {
        companyId: (await companyOf(tx, periodId)) as string,
        entryDate: period.endDate,
        entryType: "closing",
        description: `Closing entry — ${period.periodName}`,
        reference: period.periodCode,
        lines,
        createdById: actor.id ?? null,
        postImmediately: true,
      });
      closingEntryId = entry?.id ?? null;
    }
  }

  const [row] = (await tx.execute(sql`
    UPDATE fiscal_periods
       SET status = 'closed', closed_at = now(),
           closed_by_id = ${actor.id ?? null}, updated_at = now()
     WHERE id = ${periodId}::uuid
    RETURNING *
  `)) as unknown as Array<Record<string, unknown>>;

  return { period: shape(row), closingEntryId };
}

async function companyOf(tx: Tx, periodId: string) {
  const [row] = (await tx.execute(sql`
    SELECT company_id FROM fiscal_periods WHERE id = ${periodId}::uuid
  `)) as unknown as Array<{ company_id: string }>;
  return row?.company_id;
}

/**
 * Reopens a closed period.
 *
 * The closing entry is NOT deleted — it is history, and a period may be closed
 * and reopened more than once. Closing again posts another, which is why the
 * balances query above measures the period rather than assuming it starts
 * empty. A locked period cannot be reopened; that is what locking is for.
 */
export async function reopenPeriod(
  tx: Tx,
  periodId: string,
  actor: { id?: string | null },
) {
  const period = await getPeriod(tx, periodId);
  if (!period) throw new Error("Fiscal period not found");
  if (period.status === "locked") {
    throw new Error("This period is locked and cannot be reopened.");
  }
  if (period.status !== "closed") {
    throw new Error(`Only a closed period can be reopened; this one is ${period.status}.`);
  }

  const [row] = (await tx.execute(sql`
    UPDATE fiscal_periods
       SET status = 'open', closed_at = NULL, closed_by_id = NULL,
           updated_at = now()
     WHERE id = ${periodId}::uuid
    RETURNING *
  `)) as unknown as Array<Record<string, unknown>>;
  void actor;
  return shape(row);
}

/** Locks a closed period permanently. There is no unlock. */
export async function lockPeriod(
  tx: Tx,
  periodId: string,
  actor: { id?: string | null },
) {
  const period = await getPeriod(tx, periodId);
  if (!period) throw new Error("Fiscal period not found");
  if (period.status !== "closed") {
    throw new Error("Close the period before locking it.");
  }

  const [row] = (await tx.execute(sql`
    UPDATE fiscal_periods
       SET status = 'locked', locked_at = now(),
           locked_by_id = ${actor.id ?? null}, updated_at = now()
     WHERE id = ${periodId}::uuid
    RETURNING *
  `)) as unknown as Array<Record<string, unknown>>;
  return shape(row);
}
