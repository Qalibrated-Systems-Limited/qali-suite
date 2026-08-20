import { sql } from "drizzle-orm";
import type { Tx } from "../client";
import { pgArray } from "../pgArray";

/**
 * The rules the books obey (0035).
 *
 * Read INSIDE the transaction that acts on them. That is the whole reason the
 * settings moved: a VAT rate or an approval threshold fetched from another
 * store is a rule read outside the transaction that has to honour it, and it
 * can change between the read and the write it was supposed to govern.
 *
 * Numbers come back as strings, like every other numeric in this layer —
 * parsing money into a float is what the migration exists to remove. Callers
 * that need to compare against an amount should do it in SQL.
 */
export interface CompanySettings {
  currencySymbol: string;
  locale: string;
  timezone: string;
  defaultVatRate: string;
  enableWithholdingTax: boolean;
  defaultWhtRate: string;
  requireGrn: boolean;
  fiscalYearStartMonth: number;
  invoicePrefix: string;
  billPrefix: string;
  quotePrefix: string;
  poPrefix: string;
  defaultCostingMethod: string;
  lowStockThreshold: string;
  defaultPaymentTerms: string;
  defaultPaymentTermsDays: number;
  draftInvoiceExpiryDays: number;
  capitalizationThreshold: string;
  approvalThresholds: {
    stockAdjustmentValue: string;
    stockRequestValue: string;
    stockHighRiskTypes: string[];
    minimumMarginPercent: string;
    creditNoteValue: string;
    billPaymentValue: string;
    expensePaymentValue: string;
    discountCapPercent: string;
  };
  features: {
    inventory: boolean;
    sales: boolean;
    purchases: boolean;
    accounting: boolean;
    expenses: boolean;
    reports: boolean;
    multiCurrency: boolean;
    advancedReporting: boolean;
    apiAccess: boolean;
  };
}

function shape(r: Record<string, unknown>): CompanySettings {
  return {
    currencySymbol: String(r.currency_symbol),
    locale: String(r.locale),
    timezone: String(r.timezone),
    defaultVatRate: String(r.default_vat_rate),
    enableWithholdingTax: Boolean(r.enable_withholding_tax),
    defaultWhtRate: String(r.default_wht_rate),
    requireGrn: Boolean(r.require_grn),
    fiscalYearStartMonth: Number(r.fiscal_year_start_month),
    invoicePrefix: String(r.invoice_prefix),
    billPrefix: String(r.bill_prefix),
    quotePrefix: String(r.quote_prefix),
    poPrefix: String(r.po_prefix),
    defaultCostingMethod: String(r.default_costing_method),
    lowStockThreshold: String(r.low_stock_threshold),
    defaultPaymentTerms: String(r.default_payment_terms),
    defaultPaymentTermsDays: Number(r.default_payment_terms_days),
    draftInvoiceExpiryDays: Number(r.draft_invoice_expiry_days),
    capitalizationThreshold: String(r.capitalization_threshold),
    approvalThresholds: {
      stockAdjustmentValue: String(r.stock_adjustment_value),
      stockRequestValue: String(r.stock_request_value),
      stockHighRiskTypes: (r.stock_high_risk_types as string[]) ?? [],
      minimumMarginPercent: String(r.minimum_margin_percent),
      creditNoteValue: String(r.credit_note_value),
      billPaymentValue: String(r.bill_payment_value),
      expensePaymentValue: String(r.expense_payment_value),
      discountCapPercent: String(r.discount_cap_percent),
    },
    features: {
      inventory: Boolean(r.feature_inventory),
      sales: Boolean(r.feature_sales),
      purchases: Boolean(r.feature_purchases),
      accounting: Boolean(r.feature_accounting),
      expenses: Boolean(r.feature_expenses),
      reports: Boolean(r.feature_reports),
      multiCurrency: Boolean(r.feature_multi_currency),
      advancedReporting: Boolean(r.feature_advanced_reporting),
      apiAccess: Boolean(r.feature_api_access),
    },
  };
}

/**
 * This tenant's settings.
 *
 * Throws rather than returning defaults when the row is missing. A missing
 * settings row means the tenant was created outside provisioning, and quietly
 * substituting a 16% VAT rate for a company that may not charge VAT is how a
 * silent default becomes a tax filing.
 */
export async function getCompanySettings(
  tx: Tx,
  companyId: string,
): Promise<CompanySettings> {
  const rows = (await tx.execute(sql`
    SELECT * FROM company_settings WHERE company_id = ${companyId}
  `)) as unknown as Array<Record<string, unknown>>;

  if (!rows.length) {
    throw new Error(
      "This company has no settings. It was created outside provisioning — contact support.",
    );
  }
  return shape(rows[0]);
}

/**
 * Writes the settings a form collected.
 *
 * Every key is optional and an absent one is left alone, so a form that edits
 * the tax block cannot blank the approval thresholds it never showed.
 */
export async function updateCompanySettings(
  tx: Tx,
  companyId: string,
  patch: Partial<{
    currencySymbol: string;
    locale: string;
    timezone: string;
    defaultVatRate: string | number;
    enableWithholdingTax: boolean;
    defaultWhtRate: string | number;
    requireGrn: boolean;
    fiscalYearStartMonth: number;
    invoicePrefix: string;
    billPrefix: string;
    quotePrefix: string;
    poPrefix: string;
    defaultCostingMethod: string;
    lowStockThreshold: string | number;
    defaultPaymentTerms: string;
    defaultPaymentTermsDays: number;
    draftInvoiceExpiryDays: number;
    capitalizationThreshold: string | number;
    stockAdjustmentValue: string | number;
    stockRequestValue: string | number;
    stockHighRiskTypes: string[];
    minimumMarginPercent: string | number;
    creditNoteValue: string | number;
    billPaymentValue: string | number;
    expensePaymentValue: string | number;
    discountCapPercent: string | number;
  }>,
) {
  const v = <T,>(x: T | undefined) => (x === undefined ? null : x);

  await tx.execute(sql`
    UPDATE company_settings
       SET currency_symbol      = COALESCE(${v(patch.currencySymbol)}, currency_symbol),
           locale               = COALESCE(${v(patch.locale)}, locale),
           timezone             = COALESCE(${v(patch.timezone)}, timezone),
           default_vat_rate     = COALESCE(${v(patch.defaultVatRate)}::numeric, default_vat_rate),
           enable_withholding_tax = COALESCE(${v(patch.enableWithholdingTax)}::boolean, enable_withholding_tax),
           default_wht_rate     = COALESCE(${v(patch.defaultWhtRate)}::numeric, default_wht_rate),
           require_grn          = COALESCE(${v(patch.requireGrn)}::boolean, require_grn),
           fiscal_year_start_month = COALESCE(${v(patch.fiscalYearStartMonth)}::int, fiscal_year_start_month),
           invoice_prefix       = COALESCE(${v(patch.invoicePrefix)}, invoice_prefix),
           bill_prefix          = COALESCE(${v(patch.billPrefix)}, bill_prefix),
           quote_prefix         = COALESCE(${v(patch.quotePrefix)}, quote_prefix),
           po_prefix            = COALESCE(${v(patch.poPrefix)}, po_prefix),
           default_costing_method = COALESCE(${v(patch.defaultCostingMethod)}, default_costing_method),
           low_stock_threshold  = COALESCE(${v(patch.lowStockThreshold)}::numeric, low_stock_threshold),
           default_payment_terms = COALESCE(${v(patch.defaultPaymentTerms)}, default_payment_terms),
           default_payment_terms_days = COALESCE(${v(patch.defaultPaymentTermsDays)}::int, default_payment_terms_days),
           draft_invoice_expiry_days = COALESCE(${v(patch.draftInvoiceExpiryDays)}::int, draft_invoice_expiry_days),
           capitalization_threshold = COALESCE(${v(patch.capitalizationThreshold)}::numeric, capitalization_threshold),
           stock_adjustment_value = COALESCE(${v(patch.stockAdjustmentValue)}::numeric, stock_adjustment_value),
           stock_request_value  = COALESCE(${v(patch.stockRequestValue)}::numeric, stock_request_value),
           stock_high_risk_types = COALESCE(${pgArray(patch.stockHighRiskTypes)}::text[], stock_high_risk_types),
           minimum_margin_percent = COALESCE(${v(patch.minimumMarginPercent)}::numeric, minimum_margin_percent),
           credit_note_value    = COALESCE(${v(patch.creditNoteValue)}::numeric, credit_note_value),
           bill_payment_value   = COALESCE(${v(patch.billPaymentValue)}::numeric, bill_payment_value),
           expense_payment_value = COALESCE(${v(patch.expensePaymentValue)}::numeric, expense_payment_value),
           discount_cap_percent = COALESCE(${v(patch.discountCapPercent)}::numeric, discount_cap_percent),
           updated_at           = now()
     WHERE company_id = ${companyId}
  `);
}
