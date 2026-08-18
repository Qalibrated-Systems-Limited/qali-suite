"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedTenant } from "../tenant";
import {
  INVENTORY_WRITE_ROLES,
  STOCK_REQUEST_APPROVE_ROLES,
} from "@/lib/utils/role-gates";
import * as fulfilment from "../repositories/fulfilment";
import * as partiesRepo from "../repositories/parties";
import * as productsRepo from "../repositories/products";

/**
 * Postgres-backed stock request actions.
 *
 * The five values §9.9 records as maintained by hand — an item's
 * total_fulfilled, remaining, fulfilment status, and the request's status and
 * total value — are generated columns and triggers now, so nothing here
 * computes one and no caller has to remember to.
 *
 * Quantities and money are strings end to end. Never Number() them, and never
 * sum them in JavaScript: `0 + "5.0000"` is `"05.0000"`.
 */

export type ActionResult =
  | { success: true; requestId?: string; requestNumber?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]>; values?: unknown };

function toActionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("permission") ||
    message.includes("Not authenticated") ||
    message.includes("not active") ||
    message.includes("has not been migrated") ||
    message.includes("Stock request not found") ||
    message.includes("Request not found") ||
    message.includes("Cannot cancel") ||
    message.includes("already been issued") ||
    message.includes("Customer is required") ||
    message.includes("Product not found") ||
    message.includes("at least one item") ||
    // Raised by the constraints in 0022 — over-fulfilment, over-approval, an
    // immutable snapshot. All phrased for a person already.
    message.includes("Cannot fulfil more than approved") ||
    message.includes("Cannot issue against") ||
    message.includes("Nothing to issue") ||
    message.includes("is not on this request") ||
    message.includes("quantity_on_hand") ||
    message.includes("would go negative") ||
    message.includes("approved_within_requested") ||
    message.includes("snapshot columns are immutable")
  ) {
    return message;
  }
  console.error("Stock request action failed:", err);
  return "Something went wrong. Please try again.";
}

const qty = (n: number) => n.toFixed(4);

const itemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  requestedQuantity: z.coerce.number().positive("Quantity must be greater than zero"),
  unitPrice: z.coerce.number().min(0).default(0),
  unit: z.string().optional(),
  purpose: z.string().optional(),
  purposeDetails: z.string().optional(),
  notes: z.string().optional(),
});

const createSchema = z
  .object({
    requestType: z.enum([
      "sale",
      "demo",
      "installation",
      "internal",
      "repair",
      "employee_borrow",
    ]),
    customerId: z.string().optional().nullable(),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    requiredByDate: z.string().optional().nullable(),
    notes: z.string().optional(),
    items: z.array(itemSchema).min(1, "Add at least one item"),
  })
  .refine(
    (d) =>
      ["internal", "employee_borrow"].includes(d.requestType) ||
      Boolean(d.customerId),
    {
      message: "Customer is required for this request type",
      path: ["customerId"],
    },
  );

/**
 * The form submits indexed item fields — `items[0].productId`. Same shape the
 * bill form uses, reassembled the same way.
 */
function parseFormData(formData: FormData) {
  const data: Record<string, unknown> = {};
  const items: Array<Record<string, string>> = [];

  for (const [key, value] of formData.entries()) {
    const match = key.match(/^items\[(\d+)\]\.(.+)$/);
    if (match) {
      const i = Number(match[1]);
      items[i] = { ...(items[i] ?? {}), [match[2]]: String(value) };
    } else {
      data[key] = String(value);
    }
  }
  // Removing a row leaves a hole in the indices.
  data.items = items.filter(Boolean);
  return data;
}

const blank = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

export async function createStockRequest(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const raw = parseFormData(formData);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please correct the highlighted fields",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      values: raw,
    };
  }
  const d = parsed.data;

  try {
    const request = await withAuthorizedTenant(
      [...INVENTORY_WRITE_ROLES],
      async (tx, { user, companyId }) =>
        fulfilment.createStockRequest(tx, {
          companyId,
          requestType: d.requestType,
          customerId: blank(d.customerId),
          // The requester is the person raising it. There is no users table in
          // Postgres (§10), so the name is snapshotted beside the id and the
          // id is whatever the session carries.
          requesterId: user.id,
          requesterName: user.name,
          requesterDepartment: "Other",
          priority: d.priority,
          requiredByDate: d.requiredByDate ? d.requiredByDate.slice(0, 10) : null,
          notes: blank(d.notes),
          createdById: user.id,
          items: d.items.map((i) => ({
            productId: i.productId,
            requestedQuantity: qty(i.requestedQuantity),
            unitPrice: qty(i.unitPrice),
            unit: i.unit || "pcs",
            purpose: (blank(i.purpose) ?? undefined) as never,
            purposeDetails: blank(i.purposeDetails),
            notes: blank(i.notes),
          })),
        }),
    );

    revalidatePath("/dashboard/requests");
    return {
      success: true,
      requestId: request.id,
      requestNumber: request.requestNumber,
      message: `Request ${request.requestNumber} created`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err), values: raw };
  }
}

/**
 * Approves a request, item by item.
 *
 * The form submits `approved_<itemId>`; an item left blank is approved in
 * full, which is what the Mongo action does. Approving MORE than was asked is
 * refused by a CHECK — the approval answers the request rather than replacing
 * it — so nothing here has to clamp, and nothing can forget to.
 */
export async function approveStockRequest(
  requestId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const comments = String(formData.get("comments") ?? "").trim() || null;

  try {
    const request = await withAuthorizedTenant(
      [...STOCK_REQUEST_APPROVE_ROLES],
      async (tx, { user }) => {
        const existing = await fulfilment.getStockRequest(tx, requestId);
        if (!existing) throw new Error("Stock request not found");

        const approvals = existing.items.map((item) => {
          const raw = formData.get(`approved_${item.id}`);
          const value = raw === null || String(raw).trim() === "" ? null : Number(raw);
          return {
            itemId: item.id,
            approvedQuantity:
              value === null || Number.isNaN(value)
                ? item.requestedQuantity
                : qty(value),
          };
        });

        return fulfilment.approveStockRequest(tx, requestId, approvals, {
          approvedById: user.id,
          approverName: user.name,
          comments,
        });
      },
    );

    revalidatePath("/dashboard/requests");
    revalidatePath(`/dashboard/requests/${requestId}`);
    return {
      success: true,
      requestId,
      requestNumber: request.requestNumber,
      message: `Request ${request.requestNumber} approved`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function rejectStockRequest(
  requestId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { success: false, error: "Please provide a rejection reason" };
  }

  try {
    const request = await withAuthorizedTenant(
      [...STOCK_REQUEST_APPROVE_ROLES],
      (tx, { user }) =>
        fulfilment.rejectStockRequest(tx, requestId, {
          rejectedById: user.id,
          approverName: user.name,
          reason,
        }),
    );

    revalidatePath("/dashboard/requests");
    revalidatePath(`/dashboard/requests/${requestId}`);
    return {
      success: true,
      requestId,
      requestNumber: request.requestNumber,
      message: `Request ${request.requestNumber} rejected`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

export async function cancelStockRequest(
  requestId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { success: false, error: "Please provide a cancellation reason" };
  }

  try {
    const request = await withAuthorizedTenant(
      [...INVENTORY_WRITE_ROLES],
      (tx, { user }) =>
        fulfilment.cancelStockRequest(tx, requestId, user.id, reason),
    );

    revalidatePath("/dashboard/requests");
    revalidatePath(`/dashboard/requests/${requestId}`);
    return {
      success: true,
      requestId,
      requestNumber: request.requestNumber,
      message: `Request ${request.requestNumber} cancelled`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

/**
 * Issues stock against an approved request.
 *
 * The form submits `item_<itemId>` per line, and `serialNo_<itemId>` beside
 * it; a blank or zero is skipped, so a partial issue is just the lines you
 * filled in. Everything the issue changes — the item's totals and status, the
 * request's status — is derived (§9.9), so this reads the result back rather
 * than computing it.
 */
export async function fulfillRequest(
  requestId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const result = await withAuthorizedTenant(
      [...INVENTORY_WRITE_ROLES],
      async (tx, { user }) => {
        const existing = await fulfilment.getStockRequest(tx, requestId);
        if (!existing) throw new Error("Stock request not found");

        const issues = existing.items
          .map((item) => {
            const raw = formData.get(`item_${item.id}`);
            const value = raw === null ? 0 : Number(String(raw).trim() || 0);
            const serials = String(formData.get(`serialNo_${item.id}`) ?? "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
            return {
              itemId: item.id,
              quantity: qty(Number.isNaN(value) ? 0 : value),
              serialNumbers: serials.length ? serials : undefined,
            };
          })
          .filter((i) => !/^-?0(\.0*)?$/.test(i.quantity));

        return fulfilment.fulfilStockRequest(tx, requestId, issues, {
          fulfilledById: user.id,
          fulfilledByName: user.name,
          expectedReturnDate:
            String(formData.get("expectedReturnDate") ?? "").slice(0, 10) || null,
          notes: blank(formData.get("notes")),
        });
      },
    );

    revalidatePath("/dashboard/requests");
    revalidatePath(`/dashboard/requests/${requestId}`);
    revalidatePath("/dashboard/stocks");
    revalidatePath("/dashboard/checkout");
    return {
      success: true,
      requestId,
      requestNumber: result.request.requestNumber,
      message: `${result.issued} line${result.issued === 1 ? "" : "s"} issued against ${result.request.requestNumber}`,
    };
  } catch (err) {
    return { success: false, error: toActionError(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function getRequestsPaginated(opts: {
  query?: string;
  page?: number;
  perPage?: number;
  status?: string;
  requestType?: string;
  priority?: string;
  requesterId?: string;
} = {}) {
  return withAuthorizedTenant([], (tx) =>
    fulfilment.searchStockRequests(tx, {
      query: opts.query,
      page: opts.page,
      perPage: opts.perPage,
      status: opts.status || undefined,
      requestType: opts.requestType || undefined,
      priority: opts.priority || undefined,
      requesterId: opts.requesterId || undefined,
    }),
  );
}

export async function getRequestStats() {
  return withAuthorizedTenant([], (tx) =>
    fulfilment.getStockRequestStats(tx),
  );
}

export async function getRequestById(requestId: string) {
  return withAuthorizedTenant([], (tx) =>
    fulfilment.getStockRequestDetail(tx, requestId),
  );
}

/**
 * The pickers on the create form.
 *
 * Products carry what can actually be sold — on hand less what other requests
 * and drafts already hold — so the form cannot offer stock that is spoken for.
 */
export async function getRequestFormData() {
  return withAuthorizedTenant([...INVENTORY_WRITE_ROLES], async (tx) => {
    const [customers, products] = await Promise.all([
      partiesRepo.listParties(tx, { role: "customer", limit: 200 }),
      productsRepo.listProducts(tx, { limit: 200 }),
    ]);

    return {
      customers: customers.map((c) => ({
        _id: c.id,
        id: c.id,
        name: c.name,
        email: c.email ?? "",
        phone: c.phone ?? "",
        taxPin: c.taxPin ?? "",
        address: [c.addressLine1, c.city].filter(Boolean).join(", "),
      })),
      products: products.map((p) => ({
        _id: p.id,
        id: p.id,
        name: p.name,
        SKU: p.sku,
        sku: p.sku,
        unit: p.unit ?? "pcs",
        pricing: { sellingPrice: p.sellingPrice },
        inventory: {
          quantityOnHand: p.quantityOnHand,
          quantityAvailable: p.quantityAvailable,
        },
      })),
    };
  });
}

/**
 * Aliases matching the names the existing dialogs import, so switching data
 * source did not mean editing every call site.
 */
export const approveRequest = approveStockRequest;
export const rejectRequest = rejectStockRequest;
export const cancelRequest = cancelStockRequest;
