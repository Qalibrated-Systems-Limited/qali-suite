"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { INVOICE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import * as quotes from "../repositories/quotes";
import * as partiesRepo from "../repositories/parties";
import * as productsRepo from "../repositories/products";
import { quoteDataSchema, toRepositoryInput } from "../validation/quotes";

/**
 * Quote actions on Postgres (§9E).
 *
 * Thin, like the invoice actions: parse, gate, call the repository, revalidate.
 * Every rule about what a quote may become lives in the repository's transition
 * table, and every rule about money lives in the schema.
 *
 * ROLES ARE CHECKED HERE, WHICH THEY WERE NOT BEFORE. The Mongo actions read
 * the tenant context and stopped — any signed-in user could raise a quote,
 * accept it on the customer's behalf, or turn it into an invoice. Quotes reuse
 * INVOICE_WRITE_ROLES rather than inventing a set: a quote is a sales document
 * written by the people who write invoices, and Sales Manager is already in it.
 */

export type ActionResult =
  | { success: true; quoteId?: string; quoteNumber?: string; invoiceId?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Postgres phrases these for a user already — the transition machine and the
 * conversion guard both say what is wrong in words. Surface those; hide
 * anything else behind a generic message and a log line.
 */
function toActionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("cannot become") ||
    message.includes("cannot be invoiced") ||
    message.includes("send it first") ||
    message.includes("expired") ||
    message.includes("Only a draft") ||
    message.includes("at least one line") ||
    message.includes("Nothing left to invoice") ||
    message.includes("still to invoice") ||
    message.includes("Cancel it instead") ||
    message.includes("cannot be cancelled") ||
    message.includes("Quote not found") ||
    message.includes("permission")
  ) {
    return message;
  }
  console.error("[quote-action]", err);
  return "Something went wrong. Please try again.";
}

function parsePayload(formData: FormData) {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("data") ?? "{}"));
  } catch {
    return { ok: false as const, error: "Could not read the quote data" };
  }
  const parsed = quoteDataSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  return { ok: true as const, data: parsed.data };
}

export async function createQuotePg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parsePayload(formData);
  if (!parsed.ok) {
    return { success: false, error: parsed.error, fieldErrors: parsed.fieldErrors };
  }

  try {
    const quote = await withAuthorizedTenant(
      [...INVOICE_WRITE_ROLES],
      (tx, { user, companyId }) =>
        quotes.createQuote(tx, {
          companyId,
          ...toRepositoryInput(parsed.data),
          // The customer's name is snapshotted on the quote; the repository
          // needs it because the document is printed from the row, not a join.
          customerName: String(formData.get("customerName") ?? "Customer"),
          customerEmail: (formData.get("customerEmail") as string) || null,
          customerPhone: (formData.get("customerPhone") as string) || null,
          customerAddress: (formData.get("customerAddress") as string) || null,
          createdById: user.id,
          createdByName: user.name,
          createdByRole: user.role,
        }),
    );

    revalidatePath("/dashboard/quotes");
    return {
      success: true,
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      message: `Quote ${quote.quoteNumber} created`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function updateQuotePg(
  quoteId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parsePayload(formData);
  if (!parsed.ok) {
    return { success: false, error: parsed.error, fieldErrors: parsed.fieldErrors };
  }

  try {
    const quote = await withAuthorizedTenant(
      [...INVOICE_WRITE_ROLES],
      (tx, { user }) =>
        quotes.updateQuote(tx, quoteId, {
          ...toRepositoryInput(parsed.data),
          createdById: user.id,
          createdByName: user.name,
        }),
    );

    revalidatePath("/dashboard/quotes");
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    return { success: true, quoteId: quote.id, message: "Quote updated" };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * Marks the quote sent and records the delivery attempt.
 *
 * The email itself is sent by the caller; this records what happened to it, so
 * a failure is a row rather than a lost fact.
 */
export async function sendQuotePg(
  quoteId: string,
  input: {
    recipient: string;
    status?: "queued" | "sent" | "delivered" | "failed" | "bounced";
    provider?: string | null;
    providerMessageId?: string | null;
    error?: string | null;
  },
): Promise<ActionResult> {
  try {
    const quote = await withAuthorizedTenant(
      [...INVOICE_WRITE_ROLES],
      (tx, { user }) =>
        quotes.sendQuote(tx, quoteId, {
          ...input,
          actorId: user.id,
          actorName: user.name,
        }),
    );

    revalidatePath("/dashboard/quotes");
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    return {
      success: true,
      quoteId: quote.id,
      message:
        input.status === "failed" || input.status === "bounced"
          ? "Delivery failed — the attempt was recorded"
          : `Quote ${quote.quoteNumber} sent`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function acceptQuotePg(
  quoteId: string,
  acceptedByName?: string | null,
): Promise<ActionResult> {
  return statusAction(
    quoteId,
    (tx) => quotes.acceptQuote(tx, quoteId, { acceptedByName }),
    "Quote accepted",
  );
}

export async function rejectQuotePg(
  quoteId: string,
  reason?: string | null,
): Promise<ActionResult> {
  return statusAction(quoteId, (tx) => quotes.rejectQuote(tx, quoteId, reason), "Quote rejected");
}

export async function cancelQuotePg(
  quoteId: string,
  reason?: string | null,
): Promise<ActionResult> {
  return statusAction(quoteId, (tx) => quotes.cancelQuote(tx, quoteId, reason), "Quote cancelled");
}

async function statusAction(
  quoteId: string,
  fn: (tx: Parameters<Parameters<typeof withAuthorizedTenant>[1]>[0]) => Promise<unknown>,
  message: string,
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant([...INVOICE_WRITE_ROLES], (tx) => fn(tx));
    revalidatePath("/dashboard/quotes");
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    return { success: true, quoteId, message };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function deleteQuotePg(quoteId: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant([...INVOICE_WRITE_ROLES], (tx) =>
      quotes.deleteQuote(tx, quoteId),
    );
    revalidatePath("/dashboard/quotes");
    return { success: true, message: "Quote deleted" };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function cloneQuotePg(quoteId: string): Promise<ActionResult> {
  try {
    const clone = await withAuthorizedTenant(
      [...INVOICE_WRITE_ROLES],
      (tx, { user }) =>
        quotes.cloneQuote(tx, quoteId, {
          id: user.id,
          name: user.name,
          role: user.role,
        }),
    );
    revalidatePath("/dashboard/quotes");
    return {
      success: true,
      quoteId: clone.id,
      quoteNumber: clone.quoteNumber,
      message: `Quote ${clone.quoteNumber} created from ${quoteId.slice(0, 8)}`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * Turns the quote into an invoice — a POSTGRES invoice (§9E).
 *
 * The Mongo path wrote a Mongo invoice while every invoice screen read
 * Postgres, then redirected to a page that could not load it. This returns the
 * invoice id the invoice pages actually use.
 */
export async function convertQuoteToInvoicePg(
  quoteId: string,
  input: {
    invoiceDate: string;
    dueDate?: string | null;
    notes?: string | null;
    selection?: Array<{ quoteLineId: string; quantity?: string }>;
  },
): Promise<ActionResult> {
  try {
    const { invoice, remaining } = await withAuthorizedTenant(
      [...INVOICE_WRITE_ROLES],
      (tx, { user }) =>
        quotes.convertQuoteToInvoice(tx, quoteId, {
          ...input,
          createdById: user.id,
          createdByName: user.name,
          createdByRole: user.role,
        }),
    );

    revalidatePath("/dashboard/quotes");
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    revalidatePath("/dashboard/invoices");
    return {
      success: true,
      quoteId,
      invoiceId: invoice.id,
      message:
        Number(remaining) > 0
          ? `Invoice ${invoice.invoiceNumber} created — ${remaining} still to invoice`
          : `Invoice ${invoice.invoiceNumber} created`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The pickers on the create and edit forms.
 *
 * SCOPED, WHICH THE MONGO ONES WERE NOT. The form fetched customers through
 * invoice-queries.fetchActiveCustomers, which reads Mongo's Party through
 * withTenantScope — and that returns the query UNSCOPED for a SuperAdmin
 * (lib/utils/tenant-utils.js:116). Signed in as platform staff, the customer
 * combobox listed every tenant's customers, and the products picker the same.
 *
 * Reported from the running app. It is the defect 5cf253641 fixed for invoices
 * — a form whose pickers read a different store from the one it writes to —
 * surviving in quotes, with a cross-tenant list on top of it.
 *
 * Here the read runs inside withAuthorizedTenant, so it returns the ACTING
 * company's customers and nothing else: for a SuperAdmin that is the company
 * chosen in the switcher, and where none is chosen and several are held, the
 * request is refused rather than answered with a mixture.
 *
 * Shapes match getInvoiceFormData deliberately — the quote form and the
 * invoice form pick from the same kind of list and should not disagree about
 * what a customer looks like.
 */
export async function getQuoteFormData() {
  return withAuthorizedTenant([...INVOICE_WRITE_ROLES], async (tx) => {
    const [customers, products] = await Promise.all([
      partiesRepo.listParties(tx, { role: "customer", limit: 200 }),
      productsRepo.listProducts(tx, { limit: 200 }),
    ]);

    return {
      customers: customers.map((c) => ({
        _id: c.id,
        name: c.name,
        email: c.email ?? "",
        phone: c.phone ?? "",
        taxPin: c.taxPin ?? "",
        address: [c.addressLine1, c.city].filter(Boolean).join(", "),
      })),
      products: products.map((p) => ({
        _id: p.id,
        name: p.name,
        SKU: p.sku,
        unit: p.unit ?? "pcs",
        pricing: { sellingPrice: p.sellingPrice },
        inventory: {
          quantityAvailable: p.quantityAvailable,
          quantityOnHand: p.quantityOnHand,
        },
      })),
    };
  });
}


export async function getQuotesPg(opts: {
  limit?: number;
  offset?: number;
  status?: string;
  customerId?: string;
} = {}) {
  return withAuthorizedTenant([], (tx) => quotes.listQuotes(tx, opts));
}

/**
 * The list page's query, with the visibility rule applied.
 *
 * A rep sees their own quotes; the roles that may write invoices see the
 * floor's. The source applied this in the query layer and it would have
 * vanished silently in the port — the list would simply have shown everyone
 * everything, which reads as a working page.
 */
export async function searchQuotesPg(
  opts: {
    query?: string;
    page?: number;
    status?: string;
    startDate?: string;
    endDate?: string;
    customerId?: string;
    expiringSoon?: boolean;
  } = {},
) {
  return withAuthorizedTenant([], (tx, { user }) =>
    quotes.searchQuotes(tx, {
      ...opts,
      visibleToUserId: roleAllowed(user.role, [...INVOICE_WRITE_ROLES])
        ? null
        : user.id,
    }),
  );
}

export async function countQuotesPg(
  opts: {
    query?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    customerId?: string;
    expiringSoon?: boolean;
  } = {},
) {
  return withAuthorizedTenant([], (tx, { user }) =>
    quotes.countQuotes(tx, {
      ...opts,
      visibleToUserId: roleAllowed(user.role, [...INVOICE_WRITE_ROLES])
        ? null
        : user.id,
    }),
  );
}

export async function getQuotesWithAvailableItemsPg(customerId: string) {
  return withAuthorizedTenant([], (tx) =>
    quotes.getQuotesWithAvailableItems(tx, customerId),
  );
}

export async function getQuoteDetailPg(quoteId: string) {
  return withAuthorizedTenant([], (tx) => quotes.getQuoteDetail(tx, quoteId));
}

export async function getQuoteStatsPg(
  filters: { status?: string; startDate?: string; endDate?: string } = {},
) {
  return withAuthorizedTenant([], (tx, { user }) =>
    quotes.getQuoteStats(tx, {
      ...filters,
      visibleToUserId: roleAllowed(user.role, [...INVOICE_WRITE_ROLES])
        ? null
        : user.id,
    }),
  );
}
