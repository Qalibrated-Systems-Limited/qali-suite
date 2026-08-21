"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { INVOICE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import * as quotes from "../repositories/quotes";
import * as partiesRepo from "../repositories/parties";
import * as productsRepo from "../repositories/products";
import { quoteDataSchema, toRepositoryInput } from "../validation/quotes";
import { after } from "next/server";
import { getCompanyForDocuments } from "../platform";
import { sendQuoteEmail } from "@/lib/email";

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
    message.includes("no longer exists") ||
    message.includes("no email on the quote") ||
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
      async (tx, { user, companyId }) => {
        /**
         * The customer snapshot is resolved HERE, from the party row.
         *
         * It used to be read off `formData.get("customerName")` with a
         * fallback of the literal string "Customer" — and CreateQuoteForm
         * posts a single `data` blob and no such field, so every quote raised
         * through this action would have been snapshotted as being for
         * "Customer", with no email, phone or address on the document. Nothing
         * caught it because nothing called the action; the defect only became
         * reachable when the screens were pointed at it.
         *
         * Reading the party is also the right answer independently: what the
         * document says about the customer should come from the customer
         * record under RLS, not from whatever the browser sent.
         */
        const customer = await partiesRepo.getParty(tx, parsed.data.customerId);
        if (!customer) throw new Error("That customer no longer exists.");

        return quotes.createQuote(tx, {
          companyId,
          ...toRepositoryInput(parsed.data),
          customerName: customer.name,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          customerAddress:
            [customer.addressLine1, customer.city].filter(Boolean).join(", ") ||
            null,
          customerTaxPin: customer.taxPin,
          createdById: user.id,
          createdByName: user.name,
          createdByRole: user.role,
        });
      },
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
      async (tx, { user }) => {
        // Re-snapshotted for the same reason create resolves it: the payload
        // carries `customerId` and no name, and updateQuote falls back to the
        // name already on the row — so moving a quote to a different customer
        // would change the reference and leave the OLD name printed on the
        // document. The reference and the snapshot move together or not at all.
        const customer = await partiesRepo.getParty(tx, parsed.data.customerId);
        if (!customer) throw new Error("That customer no longer exists.");

        return quotes.updateQuote(tx, quoteId, {
          ...toRepositoryInput(parsed.data),
          customerName: customer.name,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          customerAddress:
            [customer.addressLine1, customer.city].filter(Boolean).join(", ") ||
            null,
          customerTaxPin: customer.taxPin,
          createdById: user.id,
          createdByName: user.name,
        });
      },
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

/**
 * Sends the quote to the customer: flip the status, render the PDF, email it,
 * and record what happened to the message.
 *
 * `sendQuotePg` above records a delivery ATTEMPT and moves the quote on. It
 * does not email, because the repository has no business knowing about Resend
 * — but that left the screens with nothing to call, which is part of why they
 * were still calling the Mongo action. This is the composite the button needs.
 *
 * Three things it does differently from the Mongo original.
 *
 * The recipient comes from the QUOTE, not from a fresh lookup of the party.
 * `customer_email` is snapshotted when the quote is raised (§9.4) — it is the
 * address the document was drawn up for. Re-reading the party would send to
 * whatever the record says today, which is a different question.
 *
 * The email goes out in `after()`, so the button returns immediately, and BOTH
 * outcomes are recorded — a `delivered` row or a `failed` row with the reason.
 * `document_deliveries` keeps one row per attempt (0041), so "what happened on
 * the second try" is answerable; Mongo overwrote `lastDeliveryError` each time
 * and could only ever describe the most recent one.
 *
 * A failure does NOT leave the quote as sent-but-undelivered with no trace:
 * the repository refuses to advance the status on a failed attempt, so a quote
 * nobody received is still a draft.
 */
export async function sendQuoteToCustomerPg(
  quoteId: string,
): Promise<ActionResult> {
  try {
    const prepared = await withAuthorizedTenant(
      [...INVOICE_WRITE_ROLES],
      async (tx, { user }) => {
        const quote = await quotes.getQuoteForDisplay(tx, quoteId);
        if (!quote) throw new Error("Quote not found");

        const recipient = quote.customer.email?.trim();
        if (!recipient) {
          throw new Error(
            "This customer has no email on the quote. Add one to the customer record, raise the quote again, and it will carry the address.",
          );
        }

        // Queued, not sent: the message has not left yet. The `after()` block
        // below records which it became.
        await quotes.sendQuote(tx, quoteId, {
          recipient,
          status: "queued",
          provider: "resend",
          actorId: user.id,
          actorName: user.name,
        });

        return { quote, recipient, user };
      },
    );

    after(async () => {
      const { quote, recipient, user } = prepared;
      try {
        const [{ renderToBuffer }, { QuotePDF }, company] = await Promise.all([
          import("@react-pdf/renderer"),
          import("@/lib/pdf"),
          getCompanyForDocuments(String(quote.companyId ?? "")),
        ]);

        const pdfBuffer = await renderToBuffer(QuotePDF({ quote, company }));

        await sendQuoteEmail({
          to: recipient,
          cc: undefined,
          customMessage: undefined,
          publicUrl: undefined,
          replyTo: company?.email || undefined,
          customerName: quote.customer.name,
          senderCompany: company?.name || "Our Company",
          quoteNumber: quote.quoteNumber,
          quoteDate: quote.quoteDate,
          validUntil: quote.validUntil,
          total: quote.total,
          currency: quote.currency || company?.settings?.currency || "KES",
          pdfBuffer,
        });

        await withAuthorizedTenant([...INVOICE_WRITE_ROLES], (tx) =>
          quotes.sendQuote(tx, quoteId, {
            recipient,
            status: "delivered",
            provider: "resend",
            actorId: user.id,
            actorName: user.name,
          }),
        );
      } catch (err) {
        console.error("[sendQuoteToCustomerPg] delivery failed:", err);
        await withAuthorizedTenant([...INVOICE_WRITE_ROLES], (tx) =>
          quotes.sendQuote(tx, quoteId, {
            recipient,
            status: "failed",
            provider: "resend",
            error: err instanceof Error ? err.message : "Email send failed",
            actorId: user.id,
            actorName: user.name,
          }),
        ).catch((logErr) =>
          console.error("[sendQuoteToCustomerPg] could not record the failure:", logErr),
        );
      }
      revalidatePath(`/dashboard/quotes/${quoteId}`);
    });

    revalidatePath("/dashboard/quotes");
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    return {
      success: true,
      quoteId,
      quoteNumber: prepared.quote.quoteNumber,
      message: `Quote ${prepared.quote.quoteNumber} sent to ${prepared.recipient}`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/** The quote as the detail page, the update form and the PDF want it. */
export async function getQuoteForDisplayPg(quoteId: string) {
  return withAuthorizedTenant([], (tx) =>
    quotes.getQuoteForDisplay(tx, quoteId),
  );
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
/**
 * `convertQuoteToInvoicePg` in the shape a <form> can call.
 *
 * ConvertToInvoiceDialog drives a `useActionState`, which means the action is
 * called as (quoteId, prevState, formData) — while the action above takes a
 * plain object because that is what a route handler or another action would
 * want. This adapts the one to the other rather than making either pretend.
 *
 * `lineId` becomes `quoteLineId`: the dialog's key is named after the Mongo
 * subdocument's `_id`, and the comment beside it in the component says so.
 */
export async function convertQuoteToInvoiceFormPg(
  quoteId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  let raw: {
    selectedItems?: Array<{ lineId?: string; quantity?: number }>;
    invoiceDate?: string;
    dueDate?: string | null;
    notes?: string | null;
  };
  try {
    raw = JSON.parse(String(formData.get("data") ?? "{}"));
  } catch {
    return { success: false, error: "Could not read the conversion data" };
  }

  if (!raw.invoiceDate) {
    return { success: false, error: "An invoice date is required." };
  }

  const selection = (raw.selectedItems ?? [])
    .filter((i) => i.lineId && Number(i.quantity) > 0)
    .map((i) => ({
      quoteLineId: String(i.lineId),
      quantity: Number(i.quantity).toFixed(4),
    }));

  if (!selection.length) {
    return { success: false, error: "Choose at least one line to invoice." };
  }

  return convertQuoteToInvoicePg(quoteId, {
    invoiceDate: raw.invoiceDate,
    dueDate: raw.dueDate ?? null,
    notes: raw.notes ?? null,
    selection,
  });
}

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
