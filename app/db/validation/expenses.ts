import { z } from "zod";

/**
 * What an expense payload must look like, and how it becomes repository input.
 *
 * Its own module because the action file is `"use server"` and Next only lets
 * async functions out of one — the same reason validation/claims.ts and
 * validation/quotes.ts exist.
 *
 * THE SHAPE IS THE FORM'S. `ExpenseForm` posts these exact names —
 * `vendorName`, `paidFrom`, `assetId`, receipts as a JSON string — so the
 * screen moves over without being rewritten first. Money arrives as a number
 * and leaves as a string: numeric(19,4) is exact and JavaScript's float is
 * not, so the boundary is here and it is one-way.
 */

const money = (n: number) => n.toFixed(4);

/** An empty string is what an untouched hidden input or <select> posts. */
const blankToNull = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    const s = v === null || v === undefined ? "" : String(v).trim();
    // "none" is what the asset and project comboboxes post for "not linked".
    return s === "" || s === "none" ? null : s;
  });

const optionalText = z.preprocess(
  (v) => (v === null || v === "" ? undefined : v),
  z.string().optional(),
);

export const EXPENSE_CATEGORIES = [
  "utilities",
  "rent",
  "salaries",
  "transport",
  "office_supplies",
  "insurance",
  "maintenance",
  "marketing",
  "legal_professional",
  "bank_charges",
  "depreciation",
  "meals_entertainment",
  "telecommunications",
  "training",
  "materials",
  "subscriptions",
  "security",
  "cleaning",
  "licenses_permits",
  "printing_stationery",
  "courier_postage",
  "other",
] as const;

/**
 * `unpaid` is accepted from the form and means "no payment", not a method.
 *
 * The Mongo enum lists it beside cash and mpesa, which is what lets an expense
 * carry `paymentMethod: "cash"` with no account behind it — the state
 * postLegacyExpense has a branch for. Here it is translated to nulls at the
 * boundary and never reaches the column.
 */
export const EXPENSE_PAYMENT_METHODS = [
  "cash",
  "mpesa",
  "bank_transfer",
  "cheque",
  "card",
] as const;

const uuidish = (label: string) =>
  z.string().refine((v) => /^[0-9a-f-]{36}$/i.test(v), `Not a valid ${label}`);

export const expenseReceiptSchema = z.object({
  filename: z.string().min(1),
  url: z.string().min(1),
  publicId: optionalText,
  resourceType: optionalText,
  size: z.coerce.number().int().nonnegative().optional(),
  mimeType: optionalText,
});

export const expenseSchema = z
  .object({
    expenseDate: z.string().min(1, "Expense date is required"),
    category: z.enum(EXPENSE_CATEGORIES, {
      message: "Choose a category",
    }),
    accountId: uuidish("expense account"),
    amount: z.coerce.number().positive("Amount must be greater than zero"),
    taxAmount: z.coerce.number().min(0).default(0),
    taxRate: z.coerce.number().min(0).max(100).default(0),
    withholdingTax: z.coerce.number().min(0).default(0),

    paymentMethod: z
      .enum([...EXPENSE_PAYMENT_METHODS, "unpaid"])
      .default("unpaid"),
    paidFrom: blankToNull,

    vendorId: blankToNull,
    vendorType: z.enum(["supplier", "employee"]).default("supplier"),
    vendorName: z.string().min(1, "Payee name is required"),
    vendorPhone: optionalText,
    vendorEmail: z.union([z.string().email(), z.literal("")]).optional(),
    vendorTaxPin: optionalText,

    description: z.string().min(1, "Description is required"),
    reference: optionalText,
    invoiceNumber: optionalText,
    notes: optionalText,

    projectId: blankToNull,
    costCodeId: blankToNull,
    assetId: blankToNull,

    isReimbursable: z.coerce.boolean().default(false),
    employeeId: blankToNull,
    employeeName: optionalText,

    receipts: z.array(expenseReceiptSchema).default([]),
  })
  /**
   * "Payment account is required when expense is paid" — the Mongo action's
   * check, moved into the schema so it lands on the FIELD rather than in
   * `_form`, and so the API path cannot skip it.
   */
  .refine((d) => d.paymentMethod === "unpaid" || !!d.paidFrom, {
    message: "Choose the account the money came out of",
    path: ["paidFrom"],
  })
  /** The database's `expenses_total_non_negative`, said in words first. */
  .refine((d) => d.amount + d.taxAmount - d.withholdingTax >= 0, {
    message: "Withholding tax cannot exceed the amount plus tax",
    path: ["withholdingTax"],
  });

export type ExpenseInput = z.infer<typeof expenseSchema>;

/**
 * Payload → repository input.
 *
 * Money crosses to strings here and nowhere else. `unpaid` becomes three
 * nulls, which is what makes `expenses_payment_is_whole` satisfiable.
 */
export function toRepositoryInput(d: ExpenseInput) {
  const isPaid = d.paymentMethod !== "unpaid" && !!d.paidFrom;

  return {
    expenseDate: d.expenseDate.slice(0, 10),
    category: d.category,
    accountId: d.accountId,
    amount: money(d.amount),
    taxAmount: money(d.taxAmount),
    taxRate: d.taxRate.toFixed(2),
    withholdingTax: money(d.withholdingTax),

    paymentMethod: isPaid
      ? (d.paymentMethod as (typeof EXPENSE_PAYMENT_METHODS)[number])
      : null,
    paidFromAccountId: isPaid ? d.paidFrom : null,
    paidAt: isPaid ? new Date() : null,

    payeePartyId: d.vendorId,
    payeeType: d.vendorType,
    payeeName: d.vendorName,
    payeePhone: d.vendorPhone ?? null,
    payeeEmail: d.vendorEmail || null,
    payeeTaxPin: d.vendorTaxPin ?? null,

    description: d.description,
    reference: d.reference ?? null,
    supplierInvoiceNumber: d.invoiceNumber ?? null,
    notes: d.notes ?? null,

    projectId: d.projectId,
    costCodeId: d.costCodeId,
    assetId: d.assetId,

    isReimbursable: d.isReimbursable,
    employeePartyId: d.employeeId,
    employeeName: d.employeeName ?? null,

    receipts: d.receipts,
  };
}

/** The payment dialog's payload — a smaller form, its own schema. */
export const expensePaymentSchema = z.object({
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS, {
    message: "Choose how it was paid",
  }),
  paidFrom: uuidish("payment account"),
  paidAt: optionalText,
});

export const expenseVoidSchema = z.object({
  reason: z.string().min(3, "Say why this is being voided"),
});
