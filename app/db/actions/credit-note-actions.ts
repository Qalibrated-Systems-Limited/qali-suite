"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedTenant } from "../tenant";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as creditNotes from "../repositories/creditNotes";
import * as accountsRepo from "../repositories/accounts";

/**
 * Postgres-backed credit note actions.
 *
 * Ported from app/mongodb/actions/credit-note-actions.js rules-first. Its
 * guards, kept:
 *
 *   - FINANCE_WRITE_ROLES
 *   - the invoice must be COMPLETED (a draft recognised no revenue to reverse)
 *   - total credits may not exceed the invoice
 *
 * The last two live below this now — the status check in the repository, the
 * cumulative cap as a deferred constraint trigger (migration 0028), because it
 * spans rows and the Mongo version permits `> invoice.total + 0.01`.
 *
 * IssueCreditNoteDialog posts indexed `items[i].x` fields rather than the JSON
 * blob the invoice form uses, so this parses them that way. The contract is
 * read from the component, not assumed.
 */

const MONEY = /^\d+(\.\d{1,4})?$/;

const itemSchema = z.object({
  itemType: z.enum(["product", "service"]).default("product"),
  productId: z.string().uuid().optional().nullable(),
  originalInvoiceLineId: z.string().uuid().optional().nullable(),
  description: z.string().min(1, "Description is required"),
  unit: z.string().optional(),
  quantity: z.string().regex(MONEY, "Invalid quantity"),
  unitPrice: z.string().regex(MONEY, "Invalid price"),
  taxRate: z.string().regex(MONEY, "Invalid tax rate").optional(),
  originalQuantity: z.string().optional().nullable(),
  originalUnitPrice: z.string().optional().nullable(),
  restoreInventory: z.boolean().default(false),
});

const createSchema = z.object({
  invoiceId: z.string().uuid("Invoice is required"),
  creditNoteDate: z.string().min(1, "Date is required"),
  reason: z.enum([
    "return",
    "damaged",
    "overcharge",
    "cancellation",
    "discount",
    "defective",
    "other",
  ]),
  reasonDescription: z.string().min(1, "Please say why"),
  notes: z.string().optional().nullable(),
  issueImmediately: z.boolean().default(false),
  items: z.array(itemSchema).min(1, "Select at least one item to credit"),
});

export type ActionResult =
  | { success: true; creditNoteId?: string; creditNoteNumber?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function toActionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("over-credited") ||
    message.includes("completed invoice") ||
    message.includes("must credit a positive amount") ||
    message.includes("at least one line") ||
    message.includes("system account") ||
    message.includes("VAT Output") ||
    message.includes("Inventory/COGS") ||
    message.includes("not in draft") ||
    message.includes("permission") ||
    message.includes("Not authenticated") ||
    message.includes("No company selected") ||
    message.includes("No company has been set up") ||
    // A deactivated tenant is something the person needs told, not hidden
    // behind a generic failure.
    message.includes("not active")
  ) {
    return message;
  }
  console.error("credit note action failed:", err);
  return "Something went wrong. Please try again.";
}

const opt = (v: string | File | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? undefined : s;
};

function parseItems(formData: FormData) {
  const items = [];
  let i = 0;
  while (formData.has(`items[${i}].quantity`)) {
    const quantity = String(formData.get(`items[${i}].quantity`) || "0");
    // The dialog renders every invoice line and defaults each to zero; only
    // the ones actually being credited are submitted with a quantity.
    if (Number(quantity) > 0) {
      items.push({
        itemType: opt(formData.get(`items[${i}].itemType`)) ?? "product",
        productId: opt(formData.get(`items[${i}].productId`)) ?? null,
        originalInvoiceLineId:
          opt(formData.get(`items[${i}].originalInvoiceLineId`)) ?? null,
        description:
          opt(formData.get(`items[${i}].description`)) ??
          opt(formData.get(`items[${i}].productName`)) ??
          "Credited item",
        unit: opt(formData.get(`items[${i}].unit`)),
        quantity,
        unitPrice: String(formData.get(`items[${i}].unitPrice`) || "0"),
        taxRate: opt(formData.get(`items[${i}].taxRate`)),
        originalQuantity: opt(formData.get(`items[${i}].originalQuantity`)) ?? null,
        originalUnitPrice:
          opt(formData.get(`items[${i}].originalUnitPrice`)) ?? null,
        restoreInventory:
          String(formData.get(`items[${i}].restoreInventory`)) === "true",
      });
    }
    i++;
  }
  return items;
}

export async function createCreditNotePg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    creditNoteDate: formData.get("creditNoteDate"),
    reason: formData.get("reason"),
    reasonDescription: formData.get("reasonDescription"),
    notes: opt(formData.get("notes")) ?? null,
    issueImmediately: String(formData.get("issueImmediately")) === "true",
    items: parseItems(formData),
  });

  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

  try {
    const note = await withAuthorizedTenant(
      [...FINANCE_WRITE_ROLES],
      async (tx, { user, companyId }) => {
        const created = await creditNotes.createCreditNote(tx, {
          companyId,
          invoiceId: d.invoiceId,
          creditNoteDate: d.creditNoteDate.slice(0, 10),
          reason: d.reason,
          reasonDescription: d.reasonDescription,
          notes: d.notes ?? null,
          createdById: user.id,
          lines: d.items.map((it) => ({
            itemType: it.itemType,
            productId: it.productId,
            originalInvoiceLineId: it.originalInvoiceLineId,
            description: it.description,
            unit: it.unit,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            taxRate: it.taxRate,
            originalQuantity: it.originalQuantity,
            originalUnitPrice: it.originalUnitPrice,
            restoreInventory: it.restoreInventory,
          })),
        });

        if (!d.issueImmediately) return created;

        const ar = await accountsRepo.getSystemAccount(tx, "accounts_receivable");
        const revenue = await accountsRepo.getSystemAccount(tx, "sales_revenue");
        if (!ar || !revenue) {
          throw new Error(
            "Accounts Receivable or Sales Revenue system account not configured",
          );
        }
        const vatOutput = await accountsRepo.getSystemAccount(tx, "vat_output");
        const inventory = await accountsRepo.getSystemAccount(tx, "inventory");
        const cogs = await accountsRepo.getSystemAccount(tx, "cogs");

        const issued = await creditNotes.issueCreditNote(tx, created.id, {
          arAccountId: ar.id,
          revenueAccountId: revenue.id,
          vatOutputAccountId: vatOutput?.id ?? null,
          inventoryAccountId: inventory?.id ?? null,
          cogsAccountId: cogs?.id ?? null,
          issuedById: user.id,
        });
        return issued.creditNote;
      },
    );

    revalidatePath("/dashboard/invoices");
    revalidatePath(`/dashboard/invoices/${d.invoiceId}`);
    revalidatePath("/dashboard/accounts");
    return {
      success: true,
      creditNoteId: note.id,
      creditNoteNumber: note.creditNoteNumber,
      message: d.issueImmediately
        ? `Credit note ${note.creditNoteNumber} issued`
        : `Credit note ${note.creditNoteNumber} created`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function getCreditNotesPg(
  opts: { invoiceId?: string; limit?: number } = {},
) {
  return withAuthorizedTenant([...FINANCE_WRITE_ROLES], (tx) =>
    creditNotes.listCreditNotes(tx, opts),
  );
}
