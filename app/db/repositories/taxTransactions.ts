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
