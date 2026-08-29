"use server";

import { withAuthorizedTenant } from "../tenant";
import { TAX_VIEW_ROLES } from "@/lib/utils/role-gates";
import * as taxRepo from "../repositories/taxTransactions";

/**
 * Postgres-backed tax reads — VAT returns, WHT reports, KRA filing status.
 *
 * WHAT THIS REPLACES, and why it is not a greenfield port.
 * `tax_transactions` shipped with migrations 0018/0019, and Postgres invoices
 * and bills have been WRITING to it since they moved: `invoices.ts:679` calls
 * `recordInvoiceVatOutput`, `bills.ts:686` calls `recordBillTaxes`. The eight
 * screens under /dashboard/tax went on reading the Mongo `TaxTransaction`
 * collection, which nothing has written since. So Kenya's statutory returns
 * were being computed from a dead collection — and, showing zeroes rather than
 * failing, looked filed and compliant. This is §9E's seam inside the tax
 * module: the destination existed, and nothing was ever pointed at it.
 *
 * THIN BY DESIGN. Authorise, open an RLS-scoped transaction, delegate, shape.
 * The SQL is in app/db/repositories/taxTransactions.ts per §4.1.
 *
 * THE SHAPE IS KEPT — nested `party` and `kraTracking`, and `_id` rather than
 * `id` — so this is a change of source rather than a redesign of four pages,
 * the same call `statement-actions.ts` made. Two exceptions, both of them
 * defects that porting faithfully would have carried across:
 *
 *   1. `unfiledCount` is counted rather than hardcoded to 0 — see
 *      `getVatUnfiledCounts` in the repository.
 *   2. `getTaxSummaryPg` returns the fields KRAStatsCards actually reads,
 *      which are not the fields TaxService.getTaxSummary returned.
 *
 * TWO FUNCTIONS WERE NOT PORTED, deliberately. `getTaxTransactionById` has no
 * detail route to serve — /dashboard/tax/transactions renders a list whose rows
 * link nowhere — and `searchTaxTransactions` has no caller either; the command
 * palette searches through `global-search-action`, which does not include tax.
 * Both were already dead in Mongo, and porting dead code faithfully produces
 * dead code. `getTaxTransaction` and the search filter both remain in the
 * repository, so either is a four-line action when a screen wants one.
 *
 * Amounts come back as numbers. The columns are `numeric` and drizzle hands
 * those over as strings, while every screen does arithmetic on them
 * (`stats.netPosition > 0`, `formatCurrency(...)`) — a string there compares
 * and formats wrongly rather than throwing.
 */

const num = (v: unknown) => Number(v ?? 0);

const ITEMS_PER_PAGE = 20;

/** YYYY-MM for today, the default filing period on three of the screens. */
function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** The current calendar month, as the day strings the date columns take. */
function currentMonthRange() {
  const now = new Date();
  const first = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const last = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
  return { start: day(first), end: day(last) };
}

/**
 * Any of `Date`, an ISO string or a day string, as `YYYY-MM-DD`.
 *
 * The tax pages pass `Date` objects straight from `searchParams` parsing
 * (wht/page.jsx builds two), and a `Date` handed to a `::date` parameter does
 * not fail as a bad date — it fails inside postgres.js as "the string argument
 * must be of type string". Same boundary rule as report-actions.ts.
 */
function day(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value ?? "");
  return s.slice(0, 10);
}

/**
 * A tri-state filter off a query string.
 *
 * `?filed=` arrives as "", "true" or "false", and "false" is truthy — Mongo
 * guarded this with `filters.filed !== undefined` and then compared
 * `=== "true"`, which is the same intent spelled twice. Undefined means "do
 * not filter", which is not the same as false.
 */
function tri(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  return value === "true";
}

/** The row shape the four client components destructure. */
function serialize(r: Record<string, unknown>) {
  return {
    _id: String(r.id ?? ""),
    transactionNumber: r.transaction_number ?? null,
    transactionDate: r.transaction_date ? day(r.transaction_date) : null,
    taxType: r.tax_type ?? null,
    taxCode: r.tax_code ?? null,
    taxRate: num(r.tax_rate),
    baseAmount: num(r.base_amount),
    taxAmount: num(r.tax_amount),
    totalAmount: num(r.total_amount),
    currency: r.currency ?? "KES",
    party: {
      type: r.party_type ?? null,
      id: r.party_id ? String(r.party_id) : null,
      // The snapshot, not the party's name today: a return states what was
      // filed, and a supplier renamed since must not rewrite it. See the note
      // on the schema.
      name: r.party_name_at_transaction ?? null,
      taxPin: r.party_tax_pin_at_transaction ?? null,
    },
    sourceDocument: {
      type: r.source_document_type ?? null,
      id: r.source_document_id ? String(r.source_document_id) : null,
      number: r.source_document_number ?? null,
    },
    kraTracking: {
      filingPeriod: r.filing_period ?? null,
      filed: Boolean(r.filed),
      remitted: Boolean(r.remitted),
    },
    accountCode: r.account_code_at_transaction ?? null,
    accountName: r.account_name_at_transaction ?? null,
    description: r.description ?? null,
  };
}

/**
 * `getUnfiled` and `getUnremittedWht` are drizzle selects, so their rows are
 * camelCase where the raw queries are snake_case. One adapter rather than two
 * serializers.
 */
function fromDrizzleRow(r: Record<string, unknown>) {
  return serialize({
    id: r.id,
    transaction_number: r.transactionNumber,
    transaction_date: r.transactionDate,
    tax_type: r.taxType,
    tax_code: r.taxCode,
    tax_rate: r.taxRate,
    base_amount: r.baseAmount,
    tax_amount: r.taxAmount,
    total_amount: r.totalAmount,
    currency: r.currency,
    party_type: r.partyType,
    party_id: r.partyId,
    party_name_at_transaction: r.partyNameAtTransaction,
    party_tax_pin_at_transaction: r.partyTaxPinAtTransaction,
    source_document_type: r.sourceDocumentType,
    source_document_id: r.sourceDocumentId,
    source_document_number: r.sourceDocumentNumber,
    filing_period: r.filingPeriod,
    filed: r.filed,
    remitted: r.remitted,
    account_code_at_transaction: r.accountCodeAtTransaction,
    account_name_at_transaction: r.accountNameAtTransaction,
    description: r.description,
  });
}

/** Normalises the loose filter bag the transactions page builds from the URL. */
function toFilters(filters: Record<string, unknown> = {}): taxRepo.TaxListFilters {
  return {
    taxType: (filters.taxType as string) || undefined,
    filingPeriod: (filters.filingPeriod as string) || undefined,
    filed: tri(filters.filed),
    remitted: tri(filters.remitted),
    startDate: filters.startDate ? day(filters.startDate) : undefined,
    endDate: filters.endDate ? day(filters.endDate) : undefined,
    sourceType: (filters.sourceType as string) || undefined,
    search: (filters.search as string) || undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function getTaxTransactionsPg(
  page = 1,
  filters: Record<string, unknown> = {},
) {
  const requested = Math.max(Number(page) || 1, 1);

  return withAuthorizedTenant([...TAX_VIEW_ROLES], async (tx) => {
    const { rows, total } = await taxRepo.listTaxTransactionsPaged(
      tx,
      toFilters(filters),
      requested,
      ITEMS_PER_PAGE,
    );

    const transactions = rows.map(serialize);
    return {
      transactions,
      pagination: {
        page: requested,
        totalPages: Math.max(Math.ceil(total / ITEMS_PER_PAGE), 1),
        total,
        hasMore: (requested - 1) * ITEMS_PER_PAGE + transactions.length < total,
      },
    };
  });
}

/**
 * The VAT return for a filing period.
 *
 * `vatPayable` / `vatRefundable` / `netPosition` are all three derived from the
 * view's signed `vat_payable`, because the screens read all three: the client
 * branches on `netPosition`, the cards format `Math.abs(...)`. One number in
 * the database, three in the payload, and they cannot disagree.
 */
export async function getVATDashboardPg(filingPeriod?: string | null) {
  const period = filingPeriod || currentPeriod();

  return withAuthorizedTenant([...TAX_VIEW_ROLES], async (tx) => {
    const [ret, unfiled] = await Promise.all([
      taxRepo.getVatReturn(tx, period),
      taxRepo.getVatUnfiledCounts(tx, period),
    ]);

    const netPosition = num(ret?.vat_payable);

    return {
      filingPeriod: period,
      input: {
        totalPurchases: num(ret?.input_base),
        totalVAT: num(ret?.input_tax),
        transactionCount: num(ret?.input_count),
        unfiledCount: num(unfiled?.input_unfiled),
      },
      output: {
        totalSales: num(ret?.output_base),
        totalVAT: num(ret?.output_tax),
        transactionCount: num(ret?.output_count),
        unfiledCount: num(unfiled?.output_unfiled),
      },
      summary: {
        vatPayable: netPosition > 0 ? netPosition : 0,
        vatRefundable: netPosition < 0 ? Math.abs(netPosition) : 0,
        netPosition,
      },
    };
  });
}

export async function getWHTDashboardPg(
  startDate?: unknown,
  endDate?: unknown,
) {
  const fallback = currentMonthRange();
  const start = startDate ? day(startDate) : fallback.start;
  const end = endDate ? day(endDate) : fallback.end;

  return withAuthorizedTenant([...TAX_VIEW_ROLES], async (tx) => {
    const [byRateRows, byPartyRows, summary] = await Promise.all([
      taxRepo.getWhtReportByRate(tx, start, end),
      taxRepo.getWhtReportByParty(tx, start, end),
      taxRepo.getWhtSummary(tx, start, end),
    ]);

    const byRate = (byRateRows as unknown as Array<Record<string, unknown>>).map(
      (r) => ({
        // Mongo grouped by (taxCode, taxRate) and the screen prints both. The
        // repository groups by rate alone — the shape KRA's return wants — and
        // carries the stored code through, so the label is what was written
        // rather than a string rebuilt from the rate.
        taxCode: r.tax_code ?? `WHT-${num(r.tax_rate)}`,
        taxRate: num(r.tax_rate),
        totalBase: num(r.total_base),
        totalWHT: num(r.total_withheld),
        count: num(r.transaction_count),
      }),
    );

    const bySupplier = (byPartyRows as unknown as Array<Record<string, unknown>>)
      // Mongo capped this at the top 10 suppliers, and the screen renders it as
      // a "top suppliers" table. The cap is kept, in the action rather than the
      // query, so the repository stays a report and the page stays a summary.
      .slice(0, 10)
      .map((r) => ({
        supplierId: r.party_id ? String(r.party_id) : null,
        supplierName: r.party_name ?? null,
        taxPin: r.party_tax_pin ?? null,
        totalBase: num(r.total_base),
        totalWHT: num(r.total_withheld),
        transactions: num(r.transaction_count),
      }));

    return {
      period: { startDate: start, endDate: end },
      byRate,
      bySupplier,
      summary: {
        totalWHT: num(summary?.total_wht),
        remitted: num(summary?.remitted),
        unremitted: num(summary?.unremitted),
        transactionCount: num(summary?.transaction_count),
        unremittedCount: num(summary?.unremitted_count),
      },
    };
  });
}

export async function getUnfiledTransactionsPg(taxType?: string | null) {
  return withAuthorizedTenant([...TAX_VIEW_ROLES], async (tx) => {
    const rows = await taxRepo.getUnfiled(tx, {
      taxType: (taxType as taxRepo.TaxType) || undefined,
      limit: 500,
    });
    return rows.map((r) => fromDrizzleRow(r as unknown as Record<string, unknown>));
  });
}

export async function getUnremittedWHTPg() {
  return withAuthorizedTenant([...TAX_VIEW_ROLES], async (tx) => {
    const rows = await taxRepo.getUnremittedWht(tx, 500);
    return rows.map((r) => fromDrizzleRow(r as unknown as Record<string, unknown>));
  });
}

/**
 * The KRA filing-status tiles.
 *
 * SHAPE CHANGED DELIBERATELY — see the repository note. The Mongo version
 * returned `{ period, vat, wht }` and KRAStatsCards reads `unfiled`, `filed`,
 * `unremittedWHT` and `totalTax`, none of which it returned, so all four tiles
 * have always been zero. This returns the four the card reads. `vat` and `wht`
 * are kept alongside them so the shape is a superset rather than a swap.
 */
export async function getTaxSummaryPg(startDate?: unknown, endDate?: unknown) {
  const fallback = currentMonthRange();
  const start = startDate ? day(startDate) : fallback.start;
  const end = endDate ? day(endDate) : fallback.end;

  return withAuthorizedTenant([...TAX_VIEW_ROLES], async (tx) => {
    const s = await taxRepo.getTaxSummary(tx, start, end);

    return {
      period: { startDate: start, endDate: end },
      unfiled: { vat: num(s.unfiled_vat), wht: num(s.unfiled_wht) },
      filed: { vat: num(s.filed_vat), wht: num(s.filed_wht) },
      unremittedWHT: num(s.unremitted_wht),
      totalTax: num(s.total_tax),
      vat: {
        input: num(s.vat_input),
        output: num(s.vat_output),
        netPayable: num(s.vat_output) - num(s.vat_input),
      },
      wht: { total: num(s.wht_total) },
    };
  });
}

export async function getFilingPeriodsPg(limit = 12) {
  return withAuthorizedTenant([...TAX_VIEW_ROLES], (tx) =>
    taxRepo.getFilingPeriods(tx, limit),
  );
}

export async function getTaxTransactionStatsPg(
  filters: Record<string, unknown> = {},
) {
  return withAuthorizedTenant([...TAX_VIEW_ROLES], async (tx) => {
    const s = await taxRepo.getTaxTransactionStats(tx, toFilters(filters));
    return {
      totalTransactions: num(s?.total_transactions),
      totalTaxAmount: num(s?.total_tax_amount),
      totalBaseAmount: num(s?.total_base_amount),
      filedCount: num(s?.filed_count),
      unfiledCount: num(s?.unfiled_count),
    };
  });
}

export async function getVATStatsPg(filingPeriod?: string | null) {
  const dashboard = await getVATDashboardPg(filingPeriod);
  return {
    filingPeriod: dashboard.filingPeriod,
    outputVAT: dashboard.output.totalVAT,
    inputVAT: dashboard.input.totalVAT,
    outputCount: dashboard.output.transactionCount,
    inputCount: dashboard.input.transactionCount,
    unfiledCount:
      dashboard.output.unfiledCount + dashboard.input.unfiledCount,
    vatPayable: dashboard.summary.vatPayable,
    vatRefundable: dashboard.summary.vatRefundable,
    netPosition: dashboard.summary.netPosition,
  };
}

export async function getWHTStatsPg(startDate?: unknown, endDate?: unknown) {
  const dashboard = await getWHTDashboardPg(startDate, endDate);
  return {
    period: dashboard.period,
    totalWHT: dashboard.summary.totalWHT,
    remitted: dashboard.summary.remitted,
    unremitted: dashboard.summary.unremitted,
    transactionCount: dashboard.summary.transactionCount,
    unremittedCount: dashboard.summary.unremittedCount,
  };
}
