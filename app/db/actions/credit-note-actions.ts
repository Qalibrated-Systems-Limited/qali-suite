"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { FINANCE_WRITE_ROLES, ADMIN_ROLES } from "@/lib/utils/role-gates";
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

/**
 * Issues a draft credit note: DR Revenue, DR VAT Output, CR Accounts
 * Receivable — plus DR Inventory / CR COGS for lines that restore stock.
 *
 * The repository has done this since the credit-note port; what was missing
 * was any way for a screen to reach it. `CreditNoteActions.jsx` called the
 * MONGO `issueCreditNote`, which posts into a ledger no screen reads (§9L).
 *
 * The system accounts are resolved here rather than in the repository, which
 * must not read configuration — the same split completeInvoicePg uses.
 */
export async function issueCreditNotePg(
  creditNoteId: string,
): Promise<ActionResult> {
  try {
    const result = await withAuthorizedTenant(
      [...FINANCE_WRITE_ROLES],
      async (tx, { user }) => {
        const ar = await accountsRepo.getSystemAccount(tx, "accounts_receivable");
        const revenue = await accountsRepo.getSystemAccount(tx, "sales_revenue");
        if (!ar || !revenue) {
          throw new Error(
            "Accounts Receivable or Sales Revenue system account not configured",
          );
        }
        // Optional: a note with no tax needs no VAT account, and one that
        // restores no stock needs neither inventory nor COGS. The repository
        // raises if a note actually needs one that is missing.
        const vatOutput = await accountsRepo.getSystemAccount(tx, "vat_output");
        const inventory = await accountsRepo.getSystemAccount(tx, "inventory");
        const cogs = await accountsRepo.getSystemAccount(tx, "cogs");

        return creditNotes.issueCreditNote(tx, creditNoteId, {
          arAccountId: ar.id,
          revenueAccountId: revenue.id,
          vatOutputAccountId: vatOutput?.id ?? null,
          inventoryAccountId: inventory?.id ?? null,
          cogsAccountId: cogs?.id ?? null,
          issuedById: user.id,
        });
      },
    );

    revalidatePath("/dashboard/credit-notes");
    revalidatePath(`/dashboard/credit-notes/${creditNoteId}`);
    revalidatePath("/dashboard/journal");
    return {
      success: true,
      creditNoteId,
      message: "Credit note issued",
    };
  } catch (err) {
    return { success: false, error: userMessage(err) };
  }
}

/**
 * Voids a DRAFT credit note.
 *
 * An ISSUED one is not voidable — it has posted, and posting is undone by
 * reversal, not by a status change. The repository puts the status in the
 * WHERE clause, so the guard is the update itself.
 *
 * Signature matches the form's `useActionState` — (id, prevState, formData).
 */
export async function voidDraftCreditNotePg(
  creditNoteId: string,
  reason: string,
): Promise<ActionResult> {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < 3) {
    return { success: false, error: "Say why the credit note is being voided" };
  }

  try {
    await withAuthorizedTenant([...ADMIN_ROLES, "CFO"], (tx, { user }) =>
      creditNotes.voidCreditNote(tx, creditNoteId, user.id, trimmed),
    );

    revalidatePath("/dashboard/credit-notes");
    revalidatePath(`/dashboard/credit-notes/${creditNoteId}`);
    return { success: true, creditNoteId, message: "Credit note voided" };
  } catch (err) {
    return { success: false, error: userMessage(err) };
  }
}

/** The same thing in the shape `useActionState` calls. */
export async function voidCreditNotePg(
  creditNoteId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  return voidDraftCreditNotePg(
    creditNoteId,
    String(formData.get("reason") ?? ""),
  );
}

export async function deleteDraftCreditNotePg(
  creditNoteId: string,
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant([...FINANCE_WRITE_ROLES], (tx) =>
      creditNotes.deleteDraftCreditNote(tx, creditNoteId),
    );
    revalidatePath("/dashboard/credit-notes");
    return { success: true, message: "Draft deleted" };
  } catch (err) {
    return { success: false, error: userMessage(err) };
  }
}

export async function getCreditNoteByIdPg(creditNoteId: string) {
  return withAuthorizedTenant([], (tx) =>
    creditNotes.getCreditNoteForDisplay(tx, creditNoteId),
  );
}

/**
 * Readers for modules that are still Mongo.
 *
 * The project P&L nets credit notes off revenue and the customer statement
 * lists them; both aggregated the MONGO CreditNote collection, which nothing
 * writes now. Left alone they would have reported no credit at all — revenue
 * overstated on every project, and statements showing customers owing money
 * they had been credited. §9K's question, arriving from the inside.
 *
 * They degrade rather than throw, like the project expense reads: a page with
 * plenty else to render should not fail over one figure. They log, because a
 * silent zero here is a wrong number, not a missing one.
 */
async function orFallback<T>(label: string, fn: () => Promise<T>, fallback: T) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[credit-note-actions] ${label} failed:`, err);
    return fallback;
  }
}

export async function sumCreditForInvoicesPg(invoiceIds: string[]) {
  return orFallback(
    "sumCreditForInvoices",
    () =>
      withAuthorizedTenant([], (tx) =>
        creditNotes.sumCreditForInvoices(tx, invoiceIds),
      ),
    "0",
  );
}

export async function listCreditNotesForCustomerPg(
  customerId: string,
  opts: { from?: string; to?: string } = {},
) {
  return orFallback(
    "listCreditNotesForCustomer",
    () =>
      withAuthorizedTenant([], (tx) =>
        creditNotes.listCreditNotesForCustomer(tx, customerId, opts),
      ),
    [] as Awaited<ReturnType<typeof creditNotes.listCreditNotesForCustomer>>,
  );
}

export async function sumCustomerCreditBeforePg(
  customerId: string,
  before: string,
) {
  return orFallback(
    "sumCustomerCreditBefore",
    () =>
      withAuthorizedTenant([], (tx) =>
        creditNotes.sumCustomerCreditBefore(tx, customerId, before),
      ),
    "0",
  );
}

export async function getCreditNoteStatsPg() {
  return withAuthorizedTenant([], (tx) => creditNotes.getCreditNoteStats(tx));
}

/**
 * The list page's rows, in the shape it already reads.
 *
 * `filters.status` arrives as "all" from the page when nothing is selected —
 * an enum value the column does not have, so it is dropped rather than
 * matched. `search` is passed through to the repository instead of being
 * ignored, which is what happened when the screen was pointed here without
 * anyone checking the signature.
 *
 * Returns `{ creditNotes, hasMore, nextCursor }` because that is what the
 * Mongo query returned and what the component destructures. `hasMore` is
 * computed by asking for one more row than the page needs.
 */
export async function getCreditNotesPg(
  filters: {
    status?: string;
    search?: string;
    invoiceId?: string;
  } = {},
  limit = 50,
) {
  const status =
    filters.status && filters.status !== "all" ? filters.status : undefined;

  const rows = await withAuthorizedTenant([...FINANCE_WRITE_ROLES], (tx) =>
    creditNotes.listCreditNotes(tx, {
      status: status as "draft" | "issued" | "applied" | "void" | undefined,
      search: filters.search,
      invoiceId: filters.invoiceId,
      limit: limit + 1,
    }),
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    creditNotes: page.map((r) => ({
      ...r,
      _id: r.id,
      // Nested, because the table reads `cn.customer?.name` and
      // `cn.invoice?.invoiceNumber` — the document shape, not the row shape.
      customer: { name: r.customerName },
      invoice: r.invoiceId
        ? { id: r.invoiceId, invoiceNumber: r.invoiceNumber }
        : null,
    })),
    hasMore,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}
