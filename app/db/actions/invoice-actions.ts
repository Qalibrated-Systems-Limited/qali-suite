"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedTenant } from "../tenant";
import { INVOICE_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as invoices from "../repositories/invoices";
import * as accountsRepo from "../repositories/accounts";

/**
 * Postgres-backed invoice actions.
 *
 * Thin by design (§4.1): shape validation, tenant + role gating, and a call
 * into the repository. Every accounting rule lives below this — balanced
 * postings (0001), exact settlement (0017), COGS-once (§8.3), and the
 * product/service line rule (0025) are all database constraints, so the Zod
 * schema is here for a friendly message, not for correctness.
 *
 * Money is strings end to end. Never Number() these values.
 */

const MONEY = /^\d+(\.\d{1,4})?$/;
const QTY = /^\d+(\.\d{1,4})?$/;

const lineSchema = z
  .object({
    itemType: z.enum(["product", "service"]).default("product"),
    productId: z.string().uuid().optional(),
    serviceCategory: z
      .enum([
        "labor",
        "mileage",
        "accommodation",
        "installation",
        "consultation",
        "maintenance",
        "repair",
        "other",
      ])
      .optional(),
    description: z.string().optional(),
    unit: z.string().optional(),
    quantity: z.string().regex(QTY, "Invalid quantity"),
    unitPrice: z.string().regex(MONEY, "Invalid unit price"),
    discountAmount: z.string().regex(MONEY, "Invalid discount").optional(),
    taxAmount: z.string().regex(MONEY, "Invalid tax").optional(),
  })
  // Mirrors CHECK invoice_lines_product_matches_item_type. Checked here only so
  // the user gets a field error instead of a constraint violation.
  .refine((l) => (l.itemType === "product") === Boolean(l.productId), {
    message: "A product line needs a product; a service line must not have one",
    path: ["productId"],
  });

const createSchema = z.object({
  customerId: z.string().uuid("Customer is required"),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "At least one line is required"),
});

/**
 * Deliberately the shape app/mongodb/invoice-actions.js returns, so a page can
 * change data source without the component changing.
 */
export type ActionResult =
  | { success: true; invoiceId?: string; invoiceNumber?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function toActionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    // Phrased for a user by the database or the repository.
    message.includes("not balanced") ||
    message.includes("fiscal period") ||
    message.includes("system account") ||
    message.includes("Product not found") ||
    message.includes("product") ||
    message.includes("service line") ||
    message.includes("quantity_available") ||
    message.includes("not found, or not in draft") ||
    message.includes("permission") ||
    message.includes("Not authenticated")
  ) {
    return message;
  }
  console.error("invoice action failed:", err);
  return "Something went wrong. Please try again.";
}

function parseLines(formData: FormData) {
  const lines = [];
  let i = 0;
  while (formData.has(`lines[${i}].quantity`)) {
    const productId = String(formData.get(`lines[${i}].productId`) || "");
    lines.push({
      itemType: String(formData.get(`lines[${i}].itemType`) || (productId ? "product" : "service")),
      productId: productId || undefined,
      serviceCategory:
        String(formData.get(`lines[${i}].serviceCategory`) || "") || undefined,
      description: String(formData.get(`lines[${i}].description`) || "") || undefined,
      unit: String(formData.get(`lines[${i}].unit`) || "") || undefined,
      quantity: String(formData.get(`lines[${i}].quantity`)),
      unitPrice: String(formData.get(`lines[${i}].unitPrice`) || "0"),
      discountAmount: String(formData.get(`lines[${i}].discountAmount`) || "") || undefined,
      taxAmount: String(formData.get(`lines[${i}].taxAmount`) || "") || undefined,
    });
    i++;
  }
  return lines;
}

export async function createInvoicePg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createSchema.safeParse({
    customerId: formData.get("customerId"),
    invoiceDate: formData.get("invoiceDate"),
    dueDate: formData.get("dueDate") || undefined,
    title: formData.get("title") || undefined,
    notes: formData.get("notes") || undefined,
    lines: parseLines(formData),
  });

  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const invoice = await withAuthorizedTenant(
      [...INVOICE_WRITE_ROLES],
      (tx, { user, companyId }) =>
        invoices.createInvoice(tx, {
          companyId,
          ...parsed.data,
          createdById: user.id,
        }),
    );

    revalidatePath("/dashboard/invoices");
    return {
      success: true,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      message: `Invoice ${invoice.invoiceNumber} created`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * Completes a draft invoice: posts revenue, issues stock, posts COGS, and
 * raises the VAT Output record.
 *
 * The system accounts are resolved here rather than passed in — the repository
 * takes ids because it must not read configuration, and this is the layer that
 * knows what a company's chart of accounts is called.
 */
export async function completeInvoicePg(
  invoiceId: string,
): Promise<ActionResult> {
  try {
    const result = await withAuthorizedTenant(
      [...INVOICE_WRITE_ROLES],
      async (tx, { user }) => {
        const ar = await accountsRepo.getSystemAccount(tx, "accounts_receivable");
        const revenue = await accountsRepo.getSystemAccount(tx, "sales_revenue");
        if (!ar || !revenue) {
          throw new Error(
            "Accounts Receivable or Sales Revenue system account not configured",
          );
        }
        const vatOutput = await accountsRepo.getSystemAccount(tx, "vat_output");

        return invoices.completeInvoice(tx, invoiceId, {
          arAccountId: ar.id,
          revenueAccountId: revenue.id,
          vatOutputAccountId: vatOutput?.id ?? null,
          completedById: user.id,
        });
      },
    );

    revalidatePath("/dashboard/invoices");
    revalidatePath(`/dashboard/invoices/${invoiceId}`);
    return {
      success: true,
      invoiceId,
      invoiceNumber: result.invoice.invoiceNumber,
      message: `Invoice ${result.invoice.invoiceNumber} completed`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function getInvoicesPg(
  opts: { limit?: number; offset?: number; status?: "draft" | "completed" | "cancelled" } = {},
) {
  return withAuthorizedTenant([...INVOICE_WRITE_ROLES], (tx) =>
    invoices.listInvoices(tx, opts),
  );
}

export async function getInvoicePg(invoiceId: string) {
  return withAuthorizedTenant([...INVOICE_WRITE_ROLES], (tx) =>
    invoices.getInvoice(tx, invoiceId),
  );
}
