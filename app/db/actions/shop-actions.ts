"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { SHOP_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/shop";

/**
 * Online Shop actions — 0112. Zod validates, `withAuthorizedTenant` scopes and
 * gates, the repository does the SQL. Reads open to any member; writes need
 * SHOP_WRITE_ROLES. The catalogue is the real products table with a listing
 * overlay.
 */

const WRITE = SHOP_WRITE_ROLES as unknown as string[];

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return { id: user?.id ?? null, name: user?.name || "Unknown User" };
}
function serialize<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = { ...row, _id: String(row.id) };
  for (const k of Object.keys(out)) {
    if (out[k] instanceof Date) out[k] = (out[k] as Date).toISOString();
  }
  return out;
}
function bump() {
  revalidatePath("/dashboard/shop");
}

export async function getShopData() {
  return withAuthorizedTenant([], async (tx) => {
    const [orders, catalog, stats] = await Promise.all([
      repo.listOrders(tx),
      repo.listCatalog(tx),
      repo.getShopStats(tx),
    ]);
    return { orders: orders.map(serialize), catalog, stats };
  });
}

// ── listings ───────────────────────────────────────────────────────────────────
const listingSchema = z.object({
  productId: z.string().trim().min(1),
  listed: z.boolean(),
  shopPrice: z.coerce.number().min(0).optional().nullable(),
});

export async function setListing(input: { productId: string; listed: boolean; shopPrice?: number | null }) {
  const parsed = listingSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid listing." };
  try {
    await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.setListing(
        tx,
        { companyId, productId: parsed.data.productId, listed: parsed.data.listed, shopPrice: parsed.data.shopPrice ?? null },
        actorFrom(user),
      ),
    );
    bump();
    return { success: true, message: parsed.data.listed ? "Product listed" : "Product unlisted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── orders ─────────────────────────────────────────────────────────────────────
const orderSchema = z.object({
  customerName: z.string().trim().min(1, "A customer name is required").max(200),
  customerEmail: z.string().trim().max(200).optional(),
  status: z.enum(["awaiting_payment", "paid", "shipped", "delivered", "cancelled"]).optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().trim().optional().nullable(),
        description: z.string().trim().max(200).optional(),
        qty: z.coerce.number().min(0),
        unitPrice: z.coerce.number().min(0),
      }),
    )
    .min(1, "Add at least one line"),
});

export async function createOrder(input: unknown) {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the order" };
  const d = parsed.data;
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createOrder(tx, {
        companyId,
        customerName: d.customerName,
        customerEmail: d.customerEmail,
        status: d.status,
        notes: d.notes,
        lines: d.lines.map((l) => ({
          productId: l.productId || null,
          description: l.description,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `${row.orderNumber} created` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function setOrderStatus(id: string, status: string) {
  if (!["awaiting_payment", "paid", "shipped", "delivered", "cancelled"].includes(status)) {
    return { error: "Unknown status." };
  }
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.setOrderStatus(tx, id, status, actorFrom(user)),
    );
    if (!row) return { error: "Order not found." };
    bump();
    return { success: true, message: `${row.orderNumber} → ${status.replace("_", " ")}` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteOrder(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteOrder(tx, id));
    if (!ok) return { error: "Order not found." };
    bump();
    return { success: true, message: "Order deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
