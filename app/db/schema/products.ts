import {
  pgTable,
  uuid,
  text,
  boolean,
  numeric,
  timestamp,
  date,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { costingMethodEnum } from "./enums";

/**
 * Product catalogue.
 *
 * `quantity_available` is a GENERATED column, not a stored one. The Mongo
 * schema documents it as `= quantityOnHand - quantityCommitted - quantityOnHold`
 * and then stores the result, so it can disagree with its own inputs — see
 * docs/POSTGRES-MIGRATION-PLAN.md §8.4. Postgres computes it on read from the
 * three columns it is defined by, so the two cannot diverge.
 *
 * Quantities are numeric(19,4) rather than integers: this catalogue holds bulk
 * commodities weighed to fractions of a kilo, not only countable units.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    unit: text("unit").notNull().default("pcs"),
    productType: text("product_type").notNull().default("Inventory Item"),

    // ── Inventory ────────────────────────────────────────────────────────────
    quantityOnHand: numeric("quantity_on_hand", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    quantityCommitted: numeric("quantity_committed", {
      precision: 19,
      scale: 4,
    })
      .notNull()
      .default("0"),
    quantityOnHold: numeric("quantity_on_hold", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    reorderLevel: numeric("reorder_level", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    /**
     * GENERATED ALWAYS — never written. Created in migration 0008; declared
     * here so reads include it. See §8.4: the Mongo schema documents the same
     * formula and then stores the result, which can disagree with its inputs.
     */
    quantityAvailable: numeric("quantity_available", {
      precision: 19,
      scale: 4,
    }).generatedAlwaysAs(
      sql`quantity_on_hand - quantity_committed - quantity_on_hold`,
    ),

    // ── Costing ──────────────────────────────────────────────────────────────
    costPrice: numeric("cost_price", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    lastPurchaseCost: numeric("last_purchase_cost", {
      precision: 19,
      scale: 4,
    })
      .notNull()
      .default("0"),
    lastPurchaseDate: date("last_purchase_date"),
    costingMethod: costingMethodEnum("costing_method")
      .notNull()
      .default("average"),

    // ── Pricing ──────────────────────────────────────────────────────────────
    sellingPrice: numeric("selling_price", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    wholesalePrice: numeric("wholesale_price", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    /** Below this price a sale requires approval. */
    minimumPrice: numeric("minimum_price", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),

    isActive: boolean("is_active").notNull().default(true),

    createdById: uuid("created_by_id"),
    lastModifiedById: uuid("last_modified_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("products_company_sku_uq").on(t.companyId, t.sku),
    index("products_company_name_idx").on(t.companyId, t.name),
    index("products_company_category_idx").on(t.companyId, t.category),
    // Drives the low-stock filter on the products list.
    index("products_company_reorder_idx")
      .on(t.companyId, t.quantityOnHand)
      .where(sql`${t.isActive} = true`),
    check(
      "products_quantities_non_negative",
      sql`${t.quantityOnHand} >= 0 AND ${t.quantityCommitted} >= 0 AND ${t.quantityOnHold} >= 0`,
    ),
    check(
      "products_prices_non_negative",
      sql`${t.costPrice} >= 0 AND ${t.sellingPrice} >= 0 AND ${t.minimumPrice} >= 0`,
    ),
    // Cannot commit or hold more than is physically on hand.
    check(
      "products_commitments_within_on_hand",
      sql`${t.quantityCommitted} + ${t.quantityOnHold} <= ${t.quantityOnHand}`,
    ),
  ],
);
