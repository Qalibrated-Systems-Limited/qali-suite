import { sql } from "drizzle-orm";
import type { Tx } from "../client";

/**
 * GR/IR reconciliation — the reads behind the screen.
 *
 * WHAT GR/IR IS, in one line: the account that holds the value of goods
 * between the delivery and the invoice. A receipt credits it, a bill debits
 * it, and either order nets to zero once both documents exist.
 *
 *   goods first   accept()   DR Inventory  CR GR/IR
 *                 approve()  DR GR/IR      CR Accounts Payable
 *   bill first    approve()  DR GR/IR      CR Accounts Payable
 *                 accept()   DR Inventory  CR GR/IR
 *
 * It is a LIABILITY (`lib/chart-of-accounts.js`, code 2175), so its balance is
 * credits less debits and the sign reads the way the business does:
 *
 *   positive  goods received that nobody has billed us for yet
 *   negative  billed for goods we have not recorded as received
 *
 * NOBODY SHOULD HAVE TO KNOW THAT. Every figure below is returned as a
 * magnitude with the direction named, so the screen prints "KES 620,000
 * invoiced, not received" and never asks a procurement officer to interpret a
 * minus sign. `gr_ir_position` does the naming; this file does the arithmetic.
 *
 * AND IT RECONCILES AGAINST THE LEDGER, deliberately. The positions are built
 * on purchase order lines, and acceptance credits GR/IR for receipts raised
 * against a bill directly or with no source document at all — those postings
 * are in the account and not in the positions. Reporting the subtotal as if it
 * were the balance is how a reconciliation screen becomes a second, quieter
 * version of the problem it was built to solve, so `unattributed` is returned
 * as its own figure and the screen shows it.
 */

export type GrIrSummary = {
  awaitingInvoice: number;
  awaitingReceipt: number;
  matched: number;
  exceptions: number;
  /** Positions netted — comparable with `ledgerBalance`. */
  netPositions: number;
  /** The GR/IR account itself: credits less debits, posted entries only. */
  ledgerBalance: number;
  /** Ledger less positions: postings no purchase order line explains. */
  unattributed: number;
};

const n = (v: unknown) => Number(v ?? 0);

export async function getGrIrSummary(tx: Tx): Promise<GrIrSummary> {
  const [positions] = (await tx.execute(sql`
    SELECT
      -- MAGNITUDES, both of them. uninvoiced_value is negative on the
      -- awaiting-receipt side; a screen that adds the two directions together
      -- would report a net and call it an outstanding balance.
      COALESCE(SUM(uninvoiced_value) FILTER (WHERE direction = 'awaiting_invoice'), 0)::float8
        AS "awaitingInvoice",
      COALESCE(-SUM(uninvoiced_value) FILTER (WHERE direction = 'awaiting_receipt'), 0)::float8
        AS "awaitingReceipt",
      -- What HAS cleared, valued at what was received. The reassuring number,
      -- and the one that gives the exceptions their proportion: 23 exceptions
      -- against 18.4M matched is a different morning from 23 against 200K.
      COALESCE(SUM(received_value) FILTER (WHERE direction = 'matched'), 0)::float8
        AS "matched",
      COUNT(*) FILTER (WHERE direction <> 'matched')::int AS "exceptions",
      COALESCE(SUM(uninvoiced_value), 0)::float8 AS "netPositions"
    FROM gr_ir_position
  `)) as unknown as Array<Record<string, number>>;

  /*
   * BY `system_account`, never by code. An account code is a label a company
   * chooses and may change; 2175 is this chart's GR/IR and need not be
   * anybody else's. `account_balances` already signs the balance by account
   * type, so a liability comes back credits-less-debits without this having
   * to know that.
   */
  const [ledger] = (await tx.execute(sql`
    SELECT COALESCE(balance, 0)::float8 AS balance
      FROM account_balances
     WHERE system_account = 'grni'
  `)) as unknown as Array<{ balance: number }>;

  const ledgerBalance = n(ledger?.balance);
  const netPositions = n(positions?.netPositions);

  return {
    awaitingInvoice: n(positions?.awaitingInvoice),
    awaitingReceipt: n(positions?.awaitingReceipt),
    matched: n(positions?.matched),
    exceptions: n(positions?.exceptions),
    netPositions,
    ledgerBalance,
    // Rounded at four places, because two float8 sums that agree to the cent
    // should not be reported as a discrepancy of 0.0000000001.
    unattributed: Number((ledgerBalance - netPositions).toFixed(4)),
  };
}

/**
 * Value by direction and age.
 *
 * THE POINT OF THE SCREEN, and the thing a signed balance cannot tell you: a
 * position at three days is procurement working normally and the same figure
 * at ninety-five is a control failure. Management reads down the column and
 * sees which balances are becoming problematic, which is a question the
 * general ledger has never been able to answer.
 *
 * Buckets come from the view so the list and this agree on which bucket a row
 * is in — two different CASE expressions over the same dates is how a total
 * stops matching the rows behind it.
 */
export async function getGrIrAgeing(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT direction,
           age_bucket                                     AS "ageBucket",
           COUNT(*)::int                                  AS "count",
           COALESCE(ABS(SUM(uninvoiced_value)), 0)::float8 AS "amount"
      FROM gr_ir_position
     WHERE direction <> 'matched'
     GROUP BY direction, age_bucket
     ORDER BY direction,
              -- Not alphabetical: '0-30' sorts after '31-60' as text, which
              -- prints the ageing ladder upside down.
              CASE age_bucket
                WHEN '0-30' THEN 1 WHEN '31-60' THEN 2
                WHEN '61-90' THEN 3 WHEN '90+' THEN 4 ELSE 5
              END
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    direction: String(r.direction),
    ageBucket: String(r.ageBucket),
    count: n(r.count),
    amount: n(r.amount),
  }));
}

/**
 * The exception list — one row per order line that has not cleared.
 *
 * Carries the whole three-way match (ordered / received / billed) rather than
 * the difference alone, because "20,000 outstanding" is not actionable and
 * "ordered 100,000, received 100,000, billed 80,000" says which document to
 * go and look at.
 */
export async function listGrIrPositions(
  tx: Tx,
  opts: {
    direction?: "awaiting_invoice" | "awaiting_receipt" | "matched" | "all";
    supplierId?: string;
    limit?: number;
  } = {},
) {
  const where = [sql`TRUE`];
  if (!opts.direction || opts.direction === "all") {
    where.push(sql`direction <> 'matched'`);
  } else {
    where.push(sql`direction = ${opts.direction}`);
  }
  if (opts.supplierId) where.push(sql`supplier_id = ${opts.supplierId}::uuid`);

  const rows = (await tx.execute(sql`
    SELECT purchase_order_id   AS "purchaseOrderId",
           po_number           AS "poNumber",
           supplier_id         AS "supplierId",
           supplier_name       AS "supplierName",
           purchase_order_line_id AS "lineId",
           line_number         AS "lineNumber",
           description,
           ordered_value::float8  AS "orderedValue",
           received_value::float8 AS "receivedValue",
           billed_value::float8   AS "billedValue",
           uninvoiced_value::float8 AS "uninvoicedValue",
           direction,
           open_since::text    AS "openSince",
           age_days            AS "ageDays",
           age_bucket          AS "ageBucket"
      FROM gr_ir_position
     WHERE ${sql.join(where, sql` AND `)}
     -- Oldest first. A reconciliation worked from the top of a list sorted by
     -- value leaves the small, ancient positions for ever, and those are the
     -- ones that turn out to be a receipt nobody ever posted.
     ORDER BY age_days DESC NULLS LAST, ABS(uninvoiced_value) DESC
     LIMIT ${Math.min(opts.limit ?? 100, 500)}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    purchaseOrderId: r.purchaseOrderId as string,
    poNumber: r.poNumber as string,
    supplierId: r.supplierId as string | null,
    supplierName: (r.supplierName as string) ?? "—",
    lineId: r.lineId as string,
    lineNumber: n(r.lineNumber),
    description: (r.description as string) ?? "",
    orderedValue: n(r.orderedValue),
    receivedValue: n(r.receivedValue),
    billedValue: n(r.billedValue),
    /** Signed, as the ledger has it. The screen reads `direction` instead. */
    uninvoicedValue: n(r.uninvoicedValue),
    /** The magnitude, which is what every label prints. */
    outstanding: Math.abs(n(r.uninvoicedValue)),
    direction: String(r.direction),
    openSince: (r.openSince as string) ?? null,
    ageDays: r.ageDays == null ? null : n(r.ageDays),
    ageBucket: String(r.ageBucket),
  }));
}
