import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { users } from "./users";
import { categoryAttributeTypeEnum } from "./enums";

/**
 * `ltree` has no Drizzle builder, so it is declared here. Same approach the
 * chart of accounts takes — the type has been available since 0001.
 */
const ltree = customType<{ data: string }>({
  dataType() {
    return "ltree";
  },
});

/**
 * Product categories — a tree, not a label (0062).
 *
 * `products.category` was plain text since the products port, while Mongo
 * carried a taxonomy the categories screens render. See the migration for the
 * four hand-maintained behaviours this replaces.
 *
 * NOT WRITTEN BY THE APPLICATION: `path` and `level`. The path is maintained
 * by a trigger over the whole subtree — the Mongo pre-save hook did the row
 * being saved only, so re-parenting stranded every descendant — and the level
 * is generated from the path, so the two cannot disagree.
 *
 * NOT PRESENT AT ALL: `productCount`. Mongo cached it and then guarded
 * deletion on the cached number. The guard is `products.category_id ... ON
 * DELETE RESTRICT` now; the count is a query, for display.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),

    /** RESTRICT: deleting a parent must not take a subtree of products'
     * classification with it. */
    parentId: uuid("parent_id"),

    /**
     * Trigger-maintained ltree of ids. NEVER ASSIGN THIS.
     *
     * The default is a placeholder the BEFORE trigger overwrites on every
     * insert; it is declared so callers are not required to supply a path they
     * have no business computing.
     */
    path: ltree("path").notNull().default(sql`''::ltree`),
    /** GENERATED from `nlevel(path) - 1`. Root is 0, as in Mongo. */
    level: integer("level").generatedAlwaysAs(sql`nlevel(path) - 1`),

    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),

    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastModifiedById: text("last_modified_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * NULLS NOT DISTINCT, which the Mongo index could not express: its
     * (companyId, name, parent) index let two ROOT categories share a name,
     * because NULL parents never collide in a btree.
     */
    // NULLS NOT DISTINCT is in 0062 rather than here — Drizzle's index builder
    // has no method for it, and the Mongo index could not express it either:
    // (companyId, name, parent) let two ROOT categories share a name, because
    // NULL parents never collide in a btree.
    uniqueIndex("categories_sibling_name_uq").on(
      t.companyId,
      t.parentId,
      sql`lower(${t.name})`,
    ),
    // Scoped to the parent, like the name — a company-wide slug refuses
    // "Accessories" under a second parent, which the sibling-name rule allows.
    // See 0062. NULLS NOT DISTINCT is in the migration.
    uniqueIndex("categories_slug_uq").on(t.companyId, t.parentId, t.slug),
    index("categories_parent_idx").on(t.companyId, t.parentId, t.sortOrder),
    index("categories_active_idx").on(t.companyId, t.isActive),

    check("categories_name_not_blank", sql`btrim(${t.name}) <> ''`),
    check(
      "categories_not_own_parent",
      sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`,
    ),
    // The gist index on `path` and the cycle/re-sync triggers live in 0062 —
    // Drizzle has no builder for either, so declaring them here would be a
    // comment pretending to be code.
  ],
);

/**
 * A category's attribute DEFINITIONS — the fields products in it should carry.
 *
 * An embedded array in Mongo. It is a list of typed field definitions, which
 * is a table by any reading.
 */
export const categoryAttributes = pgTable(
  "category_attributes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    attributeType: categoryAttributeTypeEnum("attribute_type")
      .notNull()
      .default("text"),
    isRequired: boolean("is_required").notNull().default(false),
    /** For a number attribute: "kg", "mm". */
    unit: text("unit"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("category_attributes_name_uq").on(
      t.categoryId,
      sql`lower(${t.name})`,
    ),
    check("category_attributes_name_not_blank", sql`btrim(${t.name}) <> ''`),
  ],
);
