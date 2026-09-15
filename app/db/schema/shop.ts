/**
 * Online Shop — 0112.
 *
 * The storefront: orders customers place, and which of the company's real
 * products are listed for sale. This is where the Shop INTEGRATES with the rest
 * of the ERP rather than inventing a parallel catalogue:
 *
 *   shop_listings     — an overlay on the real `products` table. A row means
 *                       "this product is on the storefront", with an optional
 *                       shop price override. The Catalog tab is products LEFT
 *                       JOIN this, so stock and base price come straight from
 *                       inventory.
 *   shop_orders       — a storefront order. item_count and total are stamped
 *                       from its lines at creation. customer_party_id is a soft
 *                       link to a CRM party.
 *   shop_order_lines  — the ordered products, each optionally pointing at the
 *                       real product it sold (so fulfilment/stock can follow).
 *
 * Company-scoped, RLS'd, on the same pattern as every other module here.
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { products } from "./products";
import { users } from "./users";

const audit = {
  createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("System"),
  lastModifiedById: text("last_modified_by_id").references(() => users.id, { onDelete: "set null" }),
  lastModifiedByName: text("last_modified_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const shopListings = pgTable(
  "shop_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    listed: boolean("listed").notNull().default(true),
    /** Storefront price override; when null the product's selling price is used. */
    shopPrice: doublePrecision("shop_price"),
    ...audit,
  },
  (t) => [uniqueIndex("shop_listings_company_product_idx").on(t.companyId, t.productId)],
);

export const shopOrders = pgTable(
  "shop_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    /** ORD-00001, from next_entry_number. */
    orderNumber: text("order_number").notNull(),
    customerName: text("customer_name").notNull().default(""),
    /** Soft link into CRM parties (no FK — a walk-up customer may not be one). */
    customerPartyId: text("customer_party_id"),
    customerEmail: text("customer_email").notNull().default(""),
    itemCount: integer("item_count").notNull().default(0),
    total: doublePrecision("total").notNull().default(0),
    status: text("status").notNull().default("awaiting_payment"),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes").notNull().default(""),
    ...audit,
  },
  (t) => [
    uniqueIndex("shop_orders_company_number_idx").on(t.companyId, t.orderNumber),
    index("shop_orders_status_idx").on(t.companyId, t.status),
    index("shop_orders_placed_idx").on(t.companyId, t.placedAt),
    check(
      "shop_orders_status_valid",
      sql`${t.status} IN ('awaiting_payment','paid','shipped','delivered','cancelled')`,
    ),
  ],
);

export const shopOrderLines = pgTable(
  "shop_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").notNull().references(() => shopOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    description: text("description").notNull().default(""),
    qty: doublePrecision("qty").notNull().default(1),
    unitPrice: doublePrecision("unit_price").notNull().default(0),
    lineTotal: doublePrecision("line_total").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shop_order_lines_order_idx").on(t.orderId)],
);
