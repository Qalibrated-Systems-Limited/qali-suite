import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  taxTransactions,
  parties,
  accounts,
  invoices,
  bills,
} from "../schema";

/**
 * Statutory tax records — VAT, withholding, payroll — and their filing state.
 *
 * Per docs/POSTGRES-MIGRATION-PLAN.md §9.6 step 4. §9.5 keeps the tax
 * transaction structure as-is, so this is a faithful port: the same records,
 * raised from the same documents, with the references made real and the
 * filing/remittance ordering moved into the database (migration 0019) where
 * a caller cannot route around it.
 */

export type TaxType =
  | "vat_input"
  | "vat_output"
  | "wht"
  | "wht_received"
  | "paye"
  | "nssf"
  | "shif"
  | "nhif"
  | "housing_levy"
  | "excise_duty"
  | "advance_tax"
  | "dst"
  | "turnover_tax"
  | "cgt"
  | "other";

export interface RecordTaxInput {
  companyId: string;
  transactionNumber: string;
  transactionDate: string;
  taxType: TaxType;
  taxCode: string;
  taxRate: string;
  baseAmount: string;
  taxAmount: string;
  totalAmount: string;
  partyId: string;
  partyType: "customer" | "supplier" | "employee" | "other";
  sourceDocumentType: "invoice" | "bill" | "journal_entry" | "other";
  sourceDocumentId: string;
  sourceDocumentNumber?: string | null;
  sourceDocumentDate?: string | null;
  accountId: string;
  journalEntryId?: string | null;
  /** YYYY-MM. Defaults to the month of `transactionDate`. */
  filingPeriod?: string;
  currency?: string;
  description?: string | null;
  createdById?: string | null;
}

/**
 * Records one tax transaction, resolving the party and account snapshots.
 *
 * The snapshots are read once here and refused on update: a return states what
 * was filed, and a supplier renamed next year must not rewrite a submission
 * already made.
 */
export async function recordTaxTransaction(tx: Tx, input: RecordTaxInput) {
  const [party] = await tx
    .select({
      name: parties.name,
      taxPin: parties.taxPin,
      email: parties.email,
      phone: parties.phone,
    })
    .from(parties)
    .where(eq(parties.id, input.partyId));
  if (!party) throw new Error("Party not found");

  const [account] = await tx
    .select({ code: accounts.accountCode, name: accounts.accountName })
    .from(accounts)
    .where(eq(accounts.id, input.accountId));
  if (!account) throw new Error("Account not found");

  const [created] = await tx
    .insert(taxTransactions)
    .values({
      companyId: input.companyId,
      transactionNumber: input.transactionNumber,
      transactionDate: input.transactionDate,
      taxType: input.taxType,
      taxCode: input.taxCode,
      taxRate: input.taxRate,
      baseAmount: input.baseAmount,
      taxAmount: input.taxAmount,
      totalAmount: input.totalAmount,
      currency: input.currency ?? "KES",
      partyId: input.partyId,
      partyType: input.partyType,
      partyNameAtTransaction: party.name,
      partyTaxPinAtTransaction: party.taxPin,
      partyEmailAtTransaction: party.email,
      partyPhoneAtTransaction: party.phone,
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      sourceDocumentNumber: input.sourceDocumentNumber ?? null,
      sourceDocumentDate: input.sourceDocumentDate ?? null,
      // "2026-08-01" -> "2026-08". String slicing, not date arithmetic: the
      // column is a DATE rendered as ISO, so there is no timezone in play and
      // nothing to get wrong. Mongo rebuilds this with getFullYear/getMonth at
      // four separate call sites.
      filingPeriod: input.filingPeriod ?? input.transactionDate.slice(0, 7),
      journalEntryId: input.journalEntryId ?? null,
      accountId: input.accountId,
      accountCodeAtTransaction: account.code,
      accountNameAtTransaction: account.name,
      description: input.description ?? null,
      createdById: input.createdById ?? null,
    })
    .returning();

  return created;
}

const isZero = (v: string | null) => v === null || /^-?0(\.0*)?$/.test(v);

/**
 * Raises the VAT Output record for a completed invoice.
 *
 * Returns null when the invoice carries no tax — there is nothing to file, and
 * that is not an error.
 *
 * `transaction_number` is derived from the invoice number rather than drawn
 * from a counter, so calling this twice for the same invoice takes a unique
 * violation instead of double-counting the sale on the return.
 */
export async function recordInvoiceVatOutput(
  tx: Tx,
  input: {
    companyId: string;
    invoiceId: string;
    vatOutputAccountId: string;
    taxRate?: string;
    createdById?: string | null;
  },
) {
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, input.invoiceId));
  if (!invoice) throw new Error("Invoice not found");

  if (isZero(invoice.taxAmount)) return null;

  return recordTaxTransaction(tx, {
    companyId: input.companyId,
    transactionNumber: `VAT-OUT-${invoice.invoiceNumber}`,
    transactionDate: invoice.invoiceDate,
    taxType: "vat_output",
    taxCode: `VAT-${input.taxRate ?? "16"}`,
    taxRate: input.taxRate ?? "16",
    baseAmount: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    totalAmount: invoice.total,
    currency: invoice.currency,
    partyId: invoice.customerId,
    partyType: "customer",
    sourceDocumentType: "invoice",
    sourceDocumentId: invoice.id,
    sourceDocumentNumber: invoice.invoiceNumber,
    sourceDocumentDate: invoice.invoiceDate,
    journalEntryId: invoice.revenueEntryId,
    accountId: input.vatOutputAccountId,
    description: `VAT Output on sale`,
    createdById: input.createdById ?? null,
  });
}

/**
 * Raises the VAT Input and WHT records for an approved bill — one, both or
 * neither, depending on what the bill carries.
 *
 * The effective VAT rate is computed in Postgres from the bill's own amounts.
 * Mongo does `Math.round((vatAmount / subtotal) * 100)` in float64 and rounds
 * to a whole number, so a 16% VAT on an awkward subtotal could be filed as 15
 * or 17. Here the division is exact decimal and the rate keeps two places.
 */
export async function recordBillTaxes(
  tx: Tx,
  input: {
    companyId: string;
    billId: string;
    vatInputAccountId?: string | null;
    whtPayableAccountId?: string | null;
    createdById?: string | null;
  },
) {
  const [bill] = await tx.select().from(bills).where(eq(bills.id, input.billId));
  if (!bill) throw new Error("Bill not found");

  const raised = [];

  if (!isZero(bill.vatAmount)) {
    if (!input.vatInputAccountId) {
      throw new Error("Bill carries VAT but no VAT Input account was supplied");
    }

    const [{ effective_rate }] = (await tx.execute(sql`
      SELECT CASE WHEN ${bill.subtotal}::numeric(19,4) > 0
                  THEN ROUND(${bill.vatAmount}::numeric(19,4)
                             / ${bill.subtotal}::numeric(19,4) * 100, 2)
                  ELSE 16 END AS effective_rate
    `)) as unknown as Array<{ effective_rate: string }>;

    raised.push(
      await recordTaxTransaction(tx, {
        companyId: input.companyId,
        transactionNumber: `VAT-IN-${bill.billNumber}`,
        transactionDate: bill.billDate,
        taxType: "vat_input",
        taxCode: `VAT-${effective_rate}`,
        taxRate: effective_rate,
        baseAmount: bill.subtotal,
        taxAmount: bill.vatAmount,
        totalAmount: bill.total!,
        currency: bill.currency,
        partyId: bill.supplierId,
        partyType: "supplier",
        sourceDocumentType: "bill",
        sourceDocumentId: bill.id,
        sourceDocumentNumber: bill.billNumber,
        sourceDocumentDate: bill.billDate,
        journalEntryId: bill.journalEntryId,
        accountId: input.vatInputAccountId,
        description: `VAT Input on purchase from ${bill.supplierNameAtBill}`,
        createdById: input.createdById ?? null,
      }),
    );
  }

  if (bill.whtApplicable && !isZero(bill.whtAmount)) {
    if (!input.whtPayableAccountId) {
      throw new Error(
        "Bill withholds tax but no WHT Payable account was supplied",
      );
    }

    raised.push(
      await recordTaxTransaction(tx, {
        companyId: input.companyId,
        transactionNumber: `WHT-${bill.billNumber}`,
        transactionDate: bill.billDate,
        taxType: "wht",
        taxCode: `WHT-${bill.whtRate}`,
        taxRate: bill.whtRate,
        baseAmount: bill.subtotal,
        taxAmount: bill.whtAmount,
        // See the note on tax_transactions.total_amount: this is the bill's
        // net payable, as in Mongo, not base - tax.
        totalAmount: bill.netPayable!,
        currency: bill.currency,
        partyId: bill.supplierId,
        partyType: "supplier",
        sourceDocumentType: "bill",
        sourceDocumentId: bill.id,
        sourceDocumentNumber: bill.billNumber,
        sourceDocumentDate: bill.billDate,
        journalEntryId: bill.journalEntryId,
        accountId: input.whtPayableAccountId,
        description: `WHT ${bill.whtRate}% withheld on payment to ${bill.supplierNameAtBill}`,
        createdById: input.createdById ?? null,
      }),
    );
  }

  return raised;
}

export async function getTaxTransaction(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(taxTransactions)
    .where(eq(taxTransactions.id, id));
  return row ?? null;
}

/**
 * Marks a return as filed with KRA.
 *
 * Un-filing is refused by the database (migration 0019): a return that was
 * wrong is corrected with an adjusting transaction, not by editing the record
 * of what was submitted.
 */
export async function markAsFiled(
  tx: Tx,
  id: string,
  filedById: string,
  filingReference: string,
) {
  const [updated] = await tx
    .update(taxTransactions)
    .set({
      filed: true,
      filedAt: new Date(),
      filedById,
      filingReference,
      updatedAt: new Date(),
    })
    .where(and(eq(taxTransactions.id, id), eq(taxTransactions.filed, false)))
    .returning();

  if (!updated) throw new Error("Tax transaction not found, or already filed");
  return updated;
}

/**
 * Marks withheld or payroll tax as remitted.
 *
 * The "only remittable taxes" rule is enforced by a trigger, not here — Mongo
 * checks it in markAsRemitted(), which only protects callers who use that
 * method.
 */
export async function markAsRemitted(
  tx: Tx,
  id: string,
  remittedById: string,
  remittanceReference: string,
) {
  const [updated] = await tx
    .update(taxTransactions)
    .set({
      remitted: true,
      remittedAt: new Date(),
      remittedById,
      remittanceReference,
      updatedAt: new Date(),
    })
    .where(and(eq(taxTransactions.id, id), eq(taxTransactions.remitted, false)))
    .returning();

  if (!updated) throw new Error("Tax transaction not found, or already remitted");
  return updated;
}

/** Issues a WHT certificate. Only after remittance, and only once — by trigger. */
export async function issueCertificate(
  tx: Tx,
  id: string,
  certificateNumber: string,
) {
  const [updated] = await tx
    .update(taxTransactions)
    .set({
      certificateIssued: true,
      certificateNumber,
      certificateIssuedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(taxTransactions.id, id))
    .returning();

  if (!updated) throw new Error("Tax transaction not found");
  return updated;
}

export async function reconcile(
  tx: Tx,
  id: string,
  reconciledById: string,
  notes?: string,
) {
  const [updated] = await tx
    .update(taxTransactions)
    .set({
      reconciled: true,
      reconciledAt: new Date(),
      reconciledById,
      reconciliationNotes: notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(taxTransactions.id, id))
    .returning();

  if (!updated) throw new Error("Tax transaction not found");
  return updated;
}

/**
 * The VAT return for a filing period, from the view.
 *
 * `vat_payable` is signed: negative means refundable. Mongo returns
 * `vatPayable` alongside `vatRefundable: Math.abs(...)`, two numbers that have
 * to be read together to know which direction the money goes.
 */
export async function getVatReturn(tx: Tx, filingPeriod: string) {
  const [row] = (await tx.execute(sql`
    SELECT filing_period, input_base, input_tax, input_count,
           output_base, output_tax, output_count, vat_payable
      FROM vat_return WHERE filing_period = ${filingPeriod}
  `)) as unknown as Array<Record<string, string>>;
  return row ?? null;
}

/** Tax still to be filed — the queries with a statutory deadline attached. */
export async function getUnfiled(
  tx: Tx,
  opts: { taxType?: TaxType; limit?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 100, 500);
  return tx
    .select()
    .from(taxTransactions)
    .where(
      opts.taxType
        ? and(
            eq(taxTransactions.filed, false),
            eq(taxTransactions.taxType, opts.taxType),
          )
        : eq(taxTransactions.filed, false),
    )
    .orderBy(taxTransactions.filingPeriod, taxTransactions.transactionDate)
    .limit(limit);
}

/** Withheld tax not yet paid over to KRA. */
export async function getUnremittedWht(tx: Tx, limit = 100) {
  return tx
    .select()
    .from(taxTransactions)
    .where(
      and(
        eq(taxTransactions.taxType, "wht"),
        eq(taxTransactions.remitted, false),
      ),
    )
    .orderBy(taxTransactions.transactionDate)
    .limit(Math.min(limit, 500));
}

/**
 * WHT totalled by party over a date range — the basis for issuing certificates.
 *
 * One grouped query, replacing an aggregation pipeline plus a JavaScript
 * reduce.
 */
export async function getWhtReportByParty(
  tx: Tx,
  startDate: string,
  endDate: string,
) {
  return tx.execute(sql`
    SELECT party_id,
           party_name_at_transaction AS party_name,
           party_tax_pin_at_transaction AS party_tax_pin,
           COUNT(*)                        AS transaction_count,
           SUM(base_amount)::numeric(19,4) AS total_base,
           SUM(tax_amount)::numeric(19,4)  AS total_withheld,
           COUNT(*) FILTER (WHERE remitted)            AS remitted_count,
           COUNT(*) FILTER (WHERE certificate_issued)  AS certificate_count
      FROM tax_transactions
     WHERE tax_type = 'wht'
       AND transaction_date BETWEEN ${startDate} AND ${endDate}
     GROUP BY party_id, party_name_at_transaction, party_tax_pin_at_transaction
     ORDER BY total_withheld DESC
  `);
}

/** WHT totalled by rate — the shape KRA's return wants. */
export async function getWhtReportByRate(
  tx: Tx,
  startDate: string,
  endDate: string,
) {
  return tx.execute(sql`
    SELECT tax_rate,
           -- The code as STORED, not rebuilt from the rate. recordBillTaxes
           -- derives it from the rate on the way in, so one rate cannot carry
           -- two codes and MIN is the only one there is. Reconstructing it
           -- here would round the label: a bill saved with whtRate "5" stores
           -- "WHT-5.00", because the rate round-trips through numeric(5,2) --
           -- and rebuilding it from that rate prints "WHT-5".
           MIN(tax_code)                   AS tax_code,
           COUNT(*)                        AS transaction_count,
           SUM(base_amount)::numeric(19,4) AS total_base,
           SUM(tax_amount)::numeric(19,4)  AS total_withheld
      FROM tax_transactions
     WHERE tax_type = 'wht'
       AND transaction_date BETWEEN ${startDate} AND ${endDate}
     GROUP BY tax_rate
     ORDER BY tax_rate
  `);
}

export async function listTaxTransactions(
  tx: Tx,
  opts: {
    taxType?: TaxType;
    filingPeriod?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const filters = [
    opts.taxType ? eq(taxTransactions.taxType, opts.taxType) : undefined,
    opts.filingPeriod
      ? eq(taxTransactions.filingPeriod, opts.filingPeriod)
      : undefined,
  ].filter(Boolean);

  return tx
    .select({
      id: taxTransactions.id,
      transactionNumber: taxTransactions.transactionNumber,
      transactionDate: taxTransactions.transactionDate,
      taxType: taxTransactions.taxType,
      taxCode: taxTransactions.taxCode,
      baseAmount: taxTransactions.baseAmount,
      taxAmount: taxTransactions.taxAmount,
      partyName: taxTransactions.partyNameAtTransaction,
      filingPeriod: taxTransactions.filingPeriod,
      filed: taxTransactions.filed,
      remitted: taxTransactions.remitted,
    })
    .from(taxTransactions)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(
      desc(taxTransactions.transactionDate),
      desc(taxTransactions.transactionNumber),
    )
    .limit(limit)
    .offset(opts.offset ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// The screen queries.
//
// Everything above this line was written with the table in 0018/0019 and had
// no callers: the tax pages went on reading the Mongo collection while
// Postgres invoices and bills wrote here. These are the reads those eight
// screens actually need — the filtered list, the four dashboards and the
// period dropdown — added rather than invented, each one transcribed from a
// named function in app/mongodb/queries/taxQueries.js.
//
// No company filter appears in any of them. RLS supplies it (0019), as it does
// for the rest of this file.
// ─────────────────────────────────────────────────────────────────────────────

export interface TaxListFilters {
  taxType?: string;
  filingPeriod?: string;
  /** Tri-state: undefined means "either". */
  filed?: boolean;
  remitted?: boolean;
  startDate?: string;
  endDate?: string;
  sourceType?: string;
  search?: string;
}

/**
 * The WHERE the list, the count and the stats cards all share.
 *
 * One builder, so a filter cannot mean one thing to the table and another to
 * the tiles above it — which is how the aging pages came to disagree with the
 * executive tiles that link to them.
 */
function listFilterSql(f: TaxListFilters) {
  const parts = [sql`TRUE`];

  if (f.taxType) parts.push(sql`tax_type = ${f.taxType}`);
  if (f.filingPeriod) parts.push(sql`filing_period = ${f.filingPeriod}`);
  if (f.filed !== undefined) parts.push(sql`filed = ${f.filed}`);
  if (f.remitted !== undefined) parts.push(sql`remitted = ${f.remitted}`);
  if (f.startDate) parts.push(sql`transaction_date >= ${f.startDate}::date`);
  if (f.endDate) parts.push(sql`transaction_date <= ${f.endDate}::date`);
  if (f.sourceType) parts.push(sql`source_document_type = ${f.sourceType}`);

  // Mongo ran four case-insensitive $regex, which is a full scan with the
  // search string interpolated into a pattern. ILIKE over an escaped literal
  // is the same four columns without the injection surface: a supplier named
  // "A.*B" matches itself here and matched everything there.
  if (f.search) {
    const term = `%${f.search.replace(/([%_\\])/g, "\\$1")}%`;
    parts.push(sql`(
      transaction_number ILIKE ${term}
      OR party_name_at_transaction ILIKE ${term}
      OR party_tax_pin_at_transaction ILIKE ${term}
      OR description ILIKE ${term}
    )`);
  }

  return sql.join(parts, sql` AND `);
}

/** One page of tax transactions, with the total the pager needs. */
export async function listTaxTransactionsPaged(
  tx: Tx,
  filters: TaxListFilters,
  page: number,
  perPage: number,
) {
  const where = listFilterSql(filters);
  const offset = (Math.max(page, 1) - 1) * perPage;

  const rows = (await tx.execute(sql`
    SELECT id, transaction_number, transaction_date, tax_type, tax_code,
           tax_rate, base_amount, tax_amount, total_amount, currency,
           party_id, party_type, party_name_at_transaction,
           party_tax_pin_at_transaction,
           source_document_type, source_document_id, source_document_number,
           filing_period, filed, remitted,
           account_code_at_transaction, account_name_at_transaction,
           description
      FROM tax_transactions
     WHERE ${where}
     ORDER BY transaction_date DESC, transaction_number DESC
     LIMIT ${perPage} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;

  const [countRow] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS total FROM tax_transactions WHERE ${where}
  `)) as unknown as Array<{ total: number }>;

  return { rows, total: Number(countRow?.total ?? 0) };
}

/** Totals and filed/unfiled split over the same filters as the list. */
export async function getTaxTransactionStats(
  tx: Tx,
  filters: TaxListFilters,
) {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int                                  AS total_transactions,
           COALESCE(SUM(tax_amount), 0)::numeric(19,4)     AS total_tax_amount,
           COALESCE(SUM(base_amount), 0)::numeric(19,4)    AS total_base_amount,
           COUNT(*) FILTER (WHERE filed)::int              AS filed_count,
           COUNT(*) FILTER (WHERE NOT filed)::int          AS unfiled_count
      FROM tax_transactions
     WHERE ${listFilterSql(filters)}
  `)) as unknown as Array<Record<string, unknown>>;
  return row ?? null;
}

/**
 * Unfiled VAT counts for one filing period, split by direction.
 *
 * SEPARATE FROM `getVatReturn` DELIBERATELY, and this is the bug it fixes.
 * Mongo's getVATDashboard has two branches: an aggregation that counts unfiled
 * properly, and a call to the `getVATReturn` model static that hardcodes
 * `unfiledCount: 0` with the comment "static method doesn't track this". The
 * static exists (taxTransactions.js:565), so the first branch is unreachable
 * and BOTH counts have always been zero — which renders the VAT page's
 * compliance card as "Compliant" and suppresses the two "N transactions not
 * yet filed" warnings, whatever is actually outstanding.
 *
 * The `vat_return` view has the same shape as the static and would have
 * reproduced it. Counting is a second query rather than a change to the view,
 * because the view is the RETURN — what is owed for a period — and filing
 * state is not part of that number.
 */
export async function getVatUnfiledCounts(tx: Tx, filingPeriod: string) {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*) FILTER (WHERE tax_type = 'vat_input')::int  AS input_unfiled,
           COUNT(*) FILTER (WHERE tax_type = 'vat_output')::int AS output_unfiled
      FROM tax_transactions
     WHERE filing_period = ${filingPeriod}
       AND tax_type IN ('vat_input', 'vat_output')
       AND NOT filed
  `)) as unknown as Array<{ input_unfiled: number; output_unfiled: number }>;
  return row ?? { input_unfiled: 0, output_unfiled: 0 };
}

/**
 * WHT totals for a date range.
 *
 * `unremitted` here is the WHOLE outstanding balance, not the range's share of
 * it — as in Mongo, where the unremitted aggregation carries no date filter at
 * all while the total does. That asymmetry is deliberate and is what the card
 * means: money still owed to KRA does not stop being owed because the reader
 * narrowed the dates.
 */
export async function getWhtSummary(
  tx: Tx,
  startDate: string,
  endDate: string,
) {
  const [row] = (await tx.execute(sql`
    SELECT COALESCE(SUM(tax_amount), 0)::numeric(19,4)                     AS total_wht,
           COALESCE(SUM(tax_amount) FILTER (WHERE remitted), 0)::numeric(19,4) AS remitted,
           COUNT(*)::int                                                   AS transaction_count
      FROM tax_transactions
     WHERE tax_type = 'wht'
       AND transaction_date BETWEEN ${startDate}::date AND ${endDate}::date
  `)) as unknown as Array<Record<string, unknown>>;

  const [outstanding] = (await tx.execute(sql`
    SELECT COALESCE(SUM(tax_amount), 0)::numeric(19,4) AS unremitted,
           COUNT(*)::int                               AS unremitted_count
      FROM tax_transactions
     WHERE tax_type = 'wht' AND NOT remitted
  `)) as unknown as Array<Record<string, unknown>>;

  return { ...(row ?? {}), ...(outstanding ?? {}) } as Record<string, unknown>;
}

/**
 * VAT and WHT for a date range, plus how much of it is still to be filed.
 *
 * THE SHAPE IS NOT MONGO'S, and that is the point. `TaxService.getTaxSummary`
 * returns `{ period, vat: {input, output, netPayable}, wht: {...} }`, while its
 * only real consumer — KRAStatsCards — reads `summary.unfiled.vat`,
 * `summary.filed.vat`, `summary.unremittedWHT` and `summary.totalTax`. Not one
 * of those four fields has ever existed on the object, so all four KRA tiles
 * have always rendered 0 and KES 0. Porting the Mongo shape faithfully would
 * have reproduced four zeroes against a live table.
 *
 * So this returns what the card reads. The unfiled and filed counts carry no
 * date filter, for the same reason `unremitted` does not: a return that missed
 * its deadline last quarter is still unfiled today.
 */
export async function getTaxSummary(
  tx: Tx,
  startDate: string,
  endDate: string,
) {
  const [totals] = (await tx.execute(sql`
    SELECT COALESCE(SUM(tax_amount) FILTER (WHERE tax_type = 'vat_input'), 0)::numeric(19,4)  AS vat_input,
           COALESCE(SUM(tax_amount) FILTER (WHERE tax_type = 'vat_output'), 0)::numeric(19,4) AS vat_output,
           COALESCE(SUM(tax_amount) FILTER (WHERE tax_type = 'wht'), 0)::numeric(19,4)        AS wht_total,
           COALESCE(SUM(tax_amount), 0)::numeric(19,4)                                        AS total_tax
      FROM tax_transactions
     WHERE transaction_date BETWEEN ${startDate}::date AND ${endDate}::date
  `)) as unknown as Array<Record<string, unknown>>;

  const [state] = (await tx.execute(sql`
    SELECT COUNT(*) FILTER (WHERE NOT filed AND tax_type IN ('vat_input','vat_output'))::int AS unfiled_vat,
           COUNT(*) FILTER (WHERE NOT filed AND tax_type = 'wht')::int                       AS unfiled_wht,
           COUNT(*) FILTER (WHERE filed AND tax_type IN ('vat_input','vat_output'))::int     AS filed_vat,
           COUNT(*) FILTER (WHERE filed AND tax_type = 'wht')::int                           AS filed_wht,
           COALESCE(SUM(tax_amount) FILTER (WHERE tax_type = 'wht' AND NOT remitted), 0)::numeric(19,4) AS unremitted_wht
      FROM tax_transactions
  `)) as unknown as Array<Record<string, unknown>>;

  return { ...(totals ?? {}), ...(state ?? {}) } as Record<string, unknown>;
}

/**
 * The filing periods that exist, most recent first — the page dropdowns.
 *
 * `DISTINCT ... ORDER BY DESC LIMIT` in SQL rather than Mongo's `distinct()`
 * followed by sorting and slicing the whole list in JavaScript. The periods are
 * `YYYY-MM` text, so lexical order is chronological order.
 */
export async function getFilingPeriods(tx: Tx, limit = 12) {
  const rows = (await tx.execute(sql`
    SELECT DISTINCT filing_period
      FROM tax_transactions
     ORDER BY filing_period DESC
     LIMIT ${Math.min(Math.max(limit, 1), 120)}
  `)) as unknown as Array<{ filing_period: string }>;
  return rows.map((r) => r.filing_period);
}
