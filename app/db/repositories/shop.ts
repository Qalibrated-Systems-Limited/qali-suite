import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { shopListings, shopOrders, shopOrderLines } from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * Online Shop repository — 0112. `tx` is already RLS-scoped; no companyId
 * filtering, no session/role logic (that is shop-actions.ts).
 *
 * The catalogue is NOT a separate product list — it is the real `products`
 * table LEFT JOINed to `shop_listings`, so stock and base price come straight
 * from inventory and a listing is just the storefront overlay.
 */

type Actor = { id?: string | null; name?: string | null };

async function nextNumber(tx: Tx, companyId: string) {
  const [{ n }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'ORD') AS n`,
  )) as unknown as Array<{ n: string }>;
  return n;
}

// ── Catalogue (products ⋈ listings) ─────────────────────────────────────────────
export async function listCatalog(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT
      p.id                                   AS product_id,
      p.sku                                  AS code,
      p.name                                 AS name,
      p.category                             AS category,
      p.quantity_on_hand::float8             AS stock,
      p.selling_price::float8                AS base_price,
      COALESCE(l.shop_price, p.selling_price::float8)::float8 AS price,
      COALESCE(l.listed, false)              AS listed,
      (l.id IS NOT NULL)                     AS has_listing,
      l.shop_price::float8                   AS shop_price,
      p.is_active                            AS active
    FROM products p
    LEFT JOIN shop_listings l ON l.product_id = p.id
    ORDER BY p.name
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    productId: String(r.product_id),
    code: (r.code as string) ?? "",
    name: (r.name as string) ?? "",
    category: (r.category as string) ?? "",
    stock: Number(r.stock ?? 0),
    basePrice: Number(r.base_price ?? 0),
    price: Number(r.price ?? 0),
    listed: Boolean(r.listed),
    hasListing: Boolean(r.has_listing),
    shopPrice: r.shop_price == null ? null : Number(r.shop_price),
    active: Boolean(r.active),
  }));
}

/** List a product on the storefront (idempotent upsert), or set its shop price. */
export async function setListing(
  tx: Tx,
  input: { companyId: string; productId: string; listed: boolean; shopPrice?: number | null },
  actor: Actor,
) {
  if (!isUuid(input.productId)) return null;
  const [row] = await tx
    .insert(shopListings)
    .values({
      companyId: input.companyId,
      productId: input.productId,
      listed: input.listed,
      shopPrice: input.shopPrice ?? null,
      createdByName: actor?.name || "System",
      lastModifiedByName: actor?.name || "System",
    })
    .onConflictDoUpdate({
      target: [shopListings.companyId, shopListings.productId],
      set: {
        listed: input.listed,
        shopPrice: input.shopPrice ?? null,
        lastModifiedById: actor?.id ?? null,
        lastModifiedByName: actor?.name || "System",
        updatedAt: new Date(),
      },
    })
    .returning();
  return row ?? null;
}

// ── Orders ──────────────────────────────────────────────────────────────────────
export function listOrders(tx: Tx) {
  return tx.select().from(shopOrders).orderBy(desc(shopOrders.placedAt));
}

export async function getOrderLines(tx: Tx, orderId: string) {
  if (!isUuid(orderId)) return [];
  return tx.select().from(shopOrderLines).where(eq(shopOrderLines.orderId, orderId));
}

export async function createOrder(
  tx: Tx,
  input: {
    companyId: string;
    customerName: string;
    customerEmail?: string | null;
    customerPartyId?: string | null;
    status?: string;
    notes?: string | null;
    lines: Array<{ productId?: string | null; description?: string | null; qty: number; unitPrice: number }>;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const lines = (input.lines ?? []).map((l) => ({
    ...l,
    qty: Number(l.qty) || 0,
    unitPrice: Number(l.unitPrice) || 0,
    lineTotal: (Number(l.qty) || 0) * (Number(l.unitPrice) || 0),
  }));
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const total = lines.reduce((s, l) => s + l.lineTotal, 0);
  const orderNumber = await nextNumber(tx, input.companyId);

  const [order] = await tx
    .insert(shopOrders)
    .values({
      companyId: input.companyId,
      orderNumber,
      customerName: input.customerName.trim(),
      customerEmail: input.customerEmail?.trim() ?? "",
      customerPartyId: input.customerPartyId || null,
      itemCount: Math.round(itemCount),
      total,
      status: input.status ?? "awaiting_payment",
      notes: input.notes?.trim() ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedById: input.createdById ?? null,
      lastModifiedByName: input.createdByName,
    })
    .returning();

  if (lines.length) {
    await tx.insert(shopOrderLines).values(
      lines.map((l) => ({
        companyId: input.companyId,
        orderId: order.id,
        productId: l.productId || null,
        description: l.description?.trim() ?? "",
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
    );
  }
  return order;
}

export async function setOrderStatus(tx: Tx, id: string, status: string, actor: Actor) {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .update(shopOrders)
    .set({
      status,
      lastModifiedById: actor?.id ?? null,
      lastModifiedByName: actor?.name || "System",
      updatedAt: new Date(),
    })
    .where(eq(shopOrders.id, id))
    .returning();
  return row ?? null;
}

export async function deleteOrder(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(shopOrders).where(eq(shopOrders.id, id)).returning({ id: shopOrders.id });
  return rows.length > 0;
}

// ── Stats ────────────────────────────────────────────────────────────────────
export async function getShopStats(tx: Tx) {
  const [o] = (await tx.execute(sql`
    SELECT
      count(*)::int AS total_orders,
      count(*) FILTER (WHERE status = 'awaiting_payment')::int AS awaiting_payment,
      COALESCE(SUM(total) FILTER (WHERE status IN ('paid','shipped','delivered')), 0)::float8 AS revenue
    FROM shop_orders
  `)) as unknown as Array<{ total_orders: number; awaiting_payment: number; revenue: number }>;
  const [c] = (await tx.execute(sql`
    SELECT
      (SELECT count(*) FROM products)::int AS catalog_items,
      (SELECT count(*) FROM shop_listings WHERE listed = true)::int AS listed_products
  `)) as unknown as Array<{ catalog_items: number; listed_products: number }>;
  return {
    totalOrders: o?.total_orders ?? 0,
    awaitingPayment: o?.awaiting_payment ?? 0,
    revenue: o?.revenue ?? 0,
    catalogItems: c?.catalog_items ?? 0,
    listedProducts: c?.listed_products ?? 0,
  };
}
