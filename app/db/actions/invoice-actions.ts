"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedTenant } from "../tenant";
import {
  invoiceDataSchema,
  toDateOnly,
  toRepositoryInput,
} from "../validation/invoices";
import {
  INVOICE_WRITE_ROLES,
  PRICING_OVERRIDE_ROLES,
} from "@/lib/utils/role-gates";
import * as invoices from "../repositories/invoices";
import * as projectsRepo from "../repositories/projects";
import * as accountsRepo from "../repositories/accounts";
import * as payments from "../repositories/payments";
import * as partiesRepo from "../repositories/parties";
import * as productsRepo from "../repositories/products";

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

/**
 * The payload CreateInvoiceForm actually submits: one JSON blob under
 * `invoiceData`, with products and services in SEPARATE lists.
 *
 * The first version of this action parsed indexed `lines[i].x` fields, which is
 * how the JOURNAL form submits — and nothing invoice-shaped ever sent that. The
 * schema is derived from the form now, not assumed.
 *
 * That the form has always kept stockItems and serviceItems apart is also the
 * clearest evidence migration 0025 was right: the UI has modelled the
 * product/service split from the start, and only the table could not express it.
 */
export type ActionResult =
  | { success: true; invoiceId?: string; invoiceNumber?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Postgres phrases accounting violations for a user already. Surface those;
 * hide anything else behind a generic message and a log line.
 */
function toActionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("not balanced") ||
    message.includes("fiscal period") ||
    message.includes("system account") ||
    message.includes("Product not found") ||
    message.includes("product line") ||
    message.includes("service line") ||
    message.includes("quantity_available") ||
    message.includes("not found, or not in draft") ||
    message.includes("permission") ||
    message.includes("Not authenticated") ||
    message.includes("No company selected") ||
    message.includes("No company has been set up") ||
    // A deactivated tenant is something the person needs told, not hidden
    // behind a generic failure.
    message.includes("not active") ||
    message.includes("credit note") ||
    message.includes("over-allocated") ||
    message.includes("already cancelled") ||
    // The discount cap (0055). It names the figure and the way out, so it is
    // no use to anybody hidden behind "Something went wrong".
    message.includes("cap for your role") ||
    message.includes("discount_percentage") ||
    message.includes("discount_within_subtotal")
  ) {
    return message;
  }
  console.error("invoice action failed:", err);
  return "Something went wrong. Please try again.";
}

/**
 * Maps the form's payload to repository input. Shared by create and update so
 * an edited invoice is built by exactly the rules that created it.
 */

/**
 * The discount cap Mongo enforced and the port dropped.
 *
 * `app/mongodb/invoice-actions.js:685-713` refuses any discount above the
 * company's `discountCapPercent` unless the caller holds a pricing-policy
 * role. That check stayed in the Mongo action when the invoice screens moved,
 * so on Postgres ANY discount from ANYONE was accepted — and then silently
 * discarded, which is the only reason nobody noticed.
 *
 * Its own comment records that an earlier version read an unseeded settings
 * sub-doc as "no cap" and so FAILED OPEN. `discount_cap_percent` is NOT NULL
 * with a default since 0035 and the row is created with the company, so there
 * is nothing to fall back to and this fails closed.
 */
async function checkDiscountCap(
  companyId: string,
  user: { role?: string },
  discountPercentage: number,
): Promise<string | null> {
  if (!discountPercentage) return null;
  if (PRICING_OVERRIDE_ROLES.includes(user.role ?? "")) return null;

  const { getCompanyThresholds } = await import("@/app/db/companyConfig");
  const { discountCapPercent } = await getCompanyThresholds(String(companyId));

  if (discountPercentage > discountCapPercent) {
    return `Discount ${discountPercentage}% exceeds the ${discountCapPercent}% cap for your role. Reduce the discount or have finance approve the invoice.`;
  }
  return null;
}

export async function createInvoicePg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("invoiceData") ?? "{}"));
  } catch {
    return { success: false, error: "Could not read the invoice data" };
  }

  const parsed = invoiceDataSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;
  const lines = toRepositoryInput(d).lines;

  try {
    const invoice = await withAuthorizedTenant(
      [...INVOICE_WRITE_ROLES],
      async (tx, { user, companyId }) => {
        const capError = await checkDiscountCap(
          companyId,
          user,
          d.discountPercentage ?? 0,
        );
        if (capError) throw new Error(capError);

        return invoices.createInvoice(tx, {
          companyId,
          customerId: d.customerId,
          invoiceDate: toDateOnly(d.invoiceDate)!,
          dueDate: toDateOnly(d.dueDate) ?? null,
          title: d.title ?? null,
          notes: d.notes ?? null,
          projectId: d.projectId ?? null,
          discountPercentage: (d.discountPercentage ?? 0).toFixed(4),
          lines,
          createdById: user.id,
          createdByName: user.name,
          createdByRole: user.role,
        });
      },
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
 * Replaces a draft invoice's contents.
 *
 * Same payload as create — EditInvoiceForm posts the identical invoiceData
 * blob — and the same rules, because both go through resolveInvoiceLines.
 */
export async function updateInvoicePg(
  invoiceId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("invoiceData") ?? "{}"));
  } catch {
    return { success: false, error: "Could not read the invoice data" };
  }

  const parsed = invoiceDataSchema.safeParse(raw);
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
      async (tx, { user, companyId }) => {
        // The same cap as create — editing a draft down to 90% off is the
        // obvious way around a check that only guards the first save.
        const capError = await checkDiscountCap(
          companyId,
          user,
          parsed.data.discountPercentage ?? 0,
        );
        if (capError) throw new Error(capError);

        return invoices.updateInvoice(
          tx,
          invoiceId,
          toRepositoryInput(parsed.data),
        );
      },
    );
    revalidatePath("/dashboard/invoices");
    revalidatePath(`/dashboard/invoices/${invoiceId}`);
    return {
      success: true,
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      message: `Invoice ${invoice.invoiceNumber} updated`,
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
        // Cost of sales. Without cogs + inventory the stock leaves and its
        // value never comes off the balance sheet (0027).
        const cogs = await accountsRepo.getSystemAccount(tx, "cogs");
        const inventory = await accountsRepo.getSystemAccount(tx, "inventory");
        const technicianStock = await accountsRepo.getSystemAccount(
          tx,
          "technician_stock",
        );

        /**
         * A certificate's retention, if this invoice came from one.
         *
         * Looked up HERE rather than inside `completeInvoice`, so the invoice
         * repository need not know that certificates exist. Null for almost
         * every invoice.
         */
        let retention = null;
        const certificate = await projectsRepo.getCertificateForInvoice(
          tx,
          invoiceId,
        );
        if (certificate && certificate.figures.retentionHeld > 0) {
          const held = await accountsRepo.getSystemAccount(
            tx,
            "retention_receivable",
          );
          if (!held) {
            throw new Error(
              "Retention Receivable (1125) is not configured in the chart of accounts, so this certificate's retention cannot be held back.",
            );
          }
          // What THIS certificate holds back, not the running total — the
          // previous certificate already reclassified its own share.
          retention = {
            amount: certificate.figures.retentionThisCertificate.toFixed(2),
            accountId: held.id,
          };
        }

        return invoices.completeInvoice(tx, invoiceId, {
          retention,
          arAccountId: ar.id,
          revenueAccountId: revenue.id,
          vatOutputAccountId: vatOutput?.id ?? null,
          cogsAccountId: cogs?.id ?? null,
          inventoryAccountId: inventory?.id ?? null,
          technicianStockAccountId: technicianStock?.id ?? null,
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

/** Filtered, paginated list for the invoices page. */
/**
 * Cancels a draft or sent invoice. A completed one needs a credit note — the
 * repository refuses it and the message says so.
 */
export async function cancelInvoicePg(
  invoiceId: string,
  reason = "",
): Promise<ActionResult> {
  try {
    const invoice = await withAuthorizedTenant(
      [...INVOICE_WRITE_ROLES],
      (tx, { user }) =>
        invoices.cancelInvoice(tx, invoiceId, user.id, reason),
    );
    revalidatePath("/dashboard/invoices");
    revalidatePath(`/dashboard/invoices/${invoiceId}`);
    return {
      success: true,
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      message: `Invoice ${invoice.invoiceNumber} cancelled`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

const paymentSchema = z.object({
  amount: z.string().regex(MONEY, "Enter a valid amount"),
  accountId: z.string().uuid("Choose an account to receive the payment into"),
  paymentMethod: z
    .enum(["cash", "mpesa", "bank_transfer", "cheque", "card"])
    .default("cash"),
  paymentDate: z.string().optional(),
  reference: z.string().optional(),
});

/**
 * Records a payment against an invoice: one payment, allocated to it.
 *
 * amount_paid and payment_status follow from the allocation by trigger
 * (migration 0017) — nothing here updates the invoice, and over-payment is
 * refused by the database rather than checked with a tolerance.
 */
export async function recordInvoicePaymentPg(
  invoiceId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = paymentSchema.safeParse({
    amount: formData.get("amount"),
    accountId: formData.get("accountId"),
    paymentMethod: formData.get("paymentMethod") || undefined,
    paymentDate: formData.get("paymentDate") || undefined,
    reference: formData.get("reference") || undefined,
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
    const result = await withAuthorizedTenant(
      [...INVOICE_WRITE_ROLES],
      async (tx, { user, companyId }) => {
        const invoice = await invoices.getInvoice(tx, invoiceId);
        if (!invoice) throw new Error("Invoice not found");

        const payment = await payments.createPayment(tx, {
          companyId,
          paymentType: "received",
          paymentDate: d.paymentDate ?? new Date().toISOString().slice(0, 10),
          paymentMethod: d.paymentMethod,
          amount: d.amount,
          partyId: invoice.customerId,
          accountId: d.accountId,
          reference: d.reference ?? null,
          createdById: user.id,
        });

        await payments.allocateToInvoice(tx, {
          companyId,
          paymentId: payment.id,
          invoiceId,
          amount: d.amount,
        });

        // Post it. Without this the invoice settles while the ledger still
        // shows the receivable outstanding and no cash received — the invoice
        // and the books disagreeing, with only the books being the books.
        const ar = await accountsRepo.getSystemAccount(tx, "accounts_receivable");
        if (!ar) {
          throw new Error("Accounts Receivable system account not configured");
        }
        // Optional: where configured, an uncleared receipt waits here instead
        // of being claimed as bank.
        const clearing = await accountsRepo.getSystemAccount(
          tx,
          "undeposited_funds",
        );

        const posted = await payments.postPaymentReceipt(tx, payment.id, {
          arAccountId: ar.id,
          clearingAccountId: clearing?.id ?? null,
          postedById: user.id,
        });

        return posted;
      },
    );

    revalidatePath("/dashboard/invoices");
    revalidatePath(`/dashboard/invoices/${invoiceId}`);
    revalidatePath("/dashboard/accounts");
    return {
      success: true,
      invoiceId,
      message: result.pendingClearance
        ? `Payment ${result.payment.paymentNumber} recorded, awaiting clearance`
        : `Payment ${result.payment.paymentNumber} recorded`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function searchInvoicesPg(opts: {
  query?: string;
  page?: number;
  status?: string;
  paymentStatus?: string;
  startDate?: string;
  endDate?: string;
}) {
  return withAuthorizedTenant([...INVOICE_WRITE_ROLES], (tx) =>
    invoices.searchInvoices(tx, opts),
  );
}

/** Headline figures for the same filter set. */
export async function getInvoiceStatsPg(opts: {
  status?: string;
  paymentStatus?: string;
  startDate?: string;
  endDate?: string;
} = {}) {
  return withAuthorizedTenant([...INVOICE_WRITE_ROLES], (tx) =>
    invoices.getInvoiceStats(tx, opts),
  );
}

/**
 * The customer and product pickers on the invoice forms.
 *
 * These were served from Mongo while the form submitted to Postgres, so every
 * id the picker offered was an ObjectId and every submission named a customer
 * and products that do not exist in the store being written to. The form has
 * been Postgres-backed since the create slice; its data had not caught up.
 *
 * Shapes match what the form already reads — `_id`, `SKU`,
 * `pricing.sellingPrice`, `inventory.quantityAvailable` — so the markup did
 * not change.
 *
 * CHECKOUTS ARE NOT INCLUDED, and that is deliberate rather than an omission:
 * `item_checkouts` is not backfilled yet (step 9), and invoice_lines.checkout_id
 * is a real FK. Offering a picker whose every option fails the write is worse
 * than not offering one, so the form receives an empty list until fulfilment
 * lands. Selling from a technician's van still works — it is the pre-linked
 * checkout shortcut that is unavailable.
 */
export async function getInvoiceFormData() {
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
          // What can actually be sold: on hand less what other drafts and
          // holds have already claimed. A GENERATED column, so the picker
          // cannot show availability the stock table does not support.
          quantityAvailable: p.quantityAvailable,
          quantityOnHand: p.quantityOnHand,
        },
      })),
    };
  });
}

/*
 * quickCreateParty lived here while parties were still a Mongo module. It is
 * in app/db/actions/party-actions now — one implementation, so the party a
 * form creates inline and the party the parties page creates are the same
 * thing, created the same way.
 */

/** Cash/bank/M-Pesa accounts the payment dialog offers. */
export async function getPaymentAccountsPg() {
  return withAuthorizedTenant([...INVOICE_WRITE_ROLES], (tx) =>
    accountsRepo.listPaymentAccounts(tx),
  );
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

/** One invoice, shaped for the detail page. Returns null if not in this tenant. */
export async function getInvoiceDetailPg(invoiceId: string) {
  return withAuthorizedTenant([...INVOICE_WRITE_ROLES], (tx) =>
    invoices.getInvoiceDetail(tx, invoiceId),
  );
}

/**
 * The overdue invoices the finance tab lists.
 *
 * That card read the MONGO Invoice collection, which nothing has written since
 * invoices moved, so it showed "nothing overdue" to a company with a full
 * ledger of it — the worst possible answer from a collections list.
 */
export async function getOverdueInvoicesPg(limit = 4) {
  return withAuthorizedTenant([...INVOICE_WRITE_ROLES], (tx) =>
    invoices.listOverdueInvoices(tx, limit),
  );
}
