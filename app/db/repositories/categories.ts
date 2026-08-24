import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { categories, categoryAttributes, products } from "../schema";

/**
 * Product categories — a real tree (0062).
 *
 * `path` is an `ltree` of ids, maintained by trigger over the whole subtree,
 * and `level` is generated from it. Neither is written here: the Mongo pre-save
 * hook maintained both by hand and only for the row being saved, so moving a
 * category left its descendants pointing through a parent that had moved.
 *
 * `productCount` is a COUNT, not a column. Mongo cached it and then guarded
 * deletion on the cached value — drift low and a category with products is
 * deleted, drift high and a legitimate delete is refused for ever. Deletion is
 * guarded by the foreign key now; the count is only ever displayed.
 */

const slugify = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "category";

export interface CategoryAttributeInput {
  name: string;
  attributeType?: "text" | "number" | "boolean" | "date" | "select";
  isRequired?: boolean;
  unit?: string | null;
}

export interface CreateCategoryInput {
  companyId: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  sortOrder?: number;
  attributes?: CategoryAttributeInput[];
  createdById?: string | null;
}

/**
 * Creates a category.
 *
 * The slug is derived and NOT made unique by retrying: the unique index does
 * that. Mongo queried for the slug, appended `-1`, and queried again — two
 * categories created at once both saw it free. A collision surfaces here as a
 * constraint error the action layer translates, which is a truthful failure
 * rather than a silently different slug.
 */
export async function createCategory(tx: Tx, input: CreateCategoryInput) {
  const [row] = await tx
    .insert(categories)
    .values({
      companyId: input.companyId,
      name: input.name.trim(),
      slug: slugify(input.name),
      description: input.description ?? null,
      parentId: input.parentId ?? null,
      sortOrder: input.sortOrder ?? 0,
      createdById: input.createdById ?? null,
    })
    .returning();

  if (input.attributes?.length) {
    await tx.insert(categoryAttributes).values(
      input.attributes.map((a, i) => ({
        companyId: input.companyId,
        categoryId: row.id,
        name: a.name.trim(),
        attributeType: a.attributeType ?? "text",
        isRequired: a.isRequired ?? false,
        unit: a.unit ?? null,
        sortOrder: i,
      })),
    );
  }

  return row;
}

export async function updateCategory(
  tx: Tx,
  categoryId: string,
  input: {
    name?: string;
    description?: string | null;
    parentId?: string | null;
    sortOrder?: number;
    isActive?: boolean;
    attributes?: CategoryAttributeInput[];
    lastModifiedById?: string | null;
  },
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    set.name = input.name.trim();
    set.slug = slugify(input.name);
  }
  if (input.description !== undefined) set.description = input.description;
  // `parentId` is only assigned when the caller MEANT to move it —
  // `undefined` and `null` are different answers here, and conflating them
  // would re-root a category on every unrelated edit.
  if (input.parentId !== undefined) set.parentId = input.parentId;
  if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) set.isActive = input.isActive;
  if (input.lastModifiedById) set.lastModifiedById = input.lastModifiedById;

  const [updated] = await tx
    .update(categories)
    .set(set)
    .where(eq(categories.id, categoryId))
    .returning();
  if (!updated) throw new Error("Category not found");

  if (input.attributes) {
    await tx
      .delete(categoryAttributes)
      .where(eq(categoryAttributes.categoryId, categoryId));
    if (input.attributes.length) {
      await tx.insert(categoryAttributes).values(
        input.attributes.map((a, i) => ({
          companyId: updated.companyId,
          categoryId,
          name: a.name.trim(),
          attributeType: a.attributeType ?? "text",
          isRequired: a.isRequired ?? false,
          unit: a.unit ?? null,
          sortOrder: i,
        })),
      );
    }
  }

  return updated;
}

/**
 * Deletes a category.
 *
 * The guards are the database's: `products.category_id` and
 * `categories.parent_id` are both ON DELETE RESTRICT, so a category with
 * products or children cannot go. The counts here are only for the message —
 * Mongo made the decision on a cached `productCount`.
 */
export async function deleteCategory(tx: Tx, categoryId: string) {
  const [{ product_count, child_count }] = (await tx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM products   WHERE category_id = ${categoryId}::uuid) AS product_count,
      (SELECT count(*)::int FROM categories WHERE parent_id  = ${categoryId}::uuid) AS child_count
  `)) as unknown as Array<{ product_count: number; child_count: number }>;

  if (product_count > 0) {
    throw new Error(
      `Cannot delete a category with ${product_count} product${product_count === 1 ? "" : "s"}. Reassign them first.`,
    );
  }
  if (child_count > 0) {
    throw new Error(
      `Cannot delete a category with ${child_count} sub-categor${child_count === 1 ? "y" : "ies"}. Remove or move them first.`,
    );
  }

  const [deleted] = await tx
    .delete(categories)
    .where(eq(categories.id, categoryId))
    .returning();
  if (!deleted) throw new Error("Category not found");
  return deleted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/** The count is a query. See the note at the top of this file. */
const WITH_COUNTS = sql`
  (SELECT count(*)::int FROM products p WHERE p.category_id = c.id) AS product_count,
  (SELECT count(*)::int FROM categories k WHERE k.parent_id = c.id) AS child_count
`;

function row(r: Record<string, unknown>) {
  return {
    _id: String(r.id),
    id: String(r.id),
    name: r.name as string,
    slug: r.slug as string,
    description: (r.description as string) ?? null,
    parent: (r.parent_id as string) ?? null,
    // The screens read `cat.path` as a display string, so it is the NAMES
    // joined — "Electronics > Scales" — not the ltree of ids. The ids are an
    // implementation detail of the tree; the path a person reads is the names.
    path: (r.path_names as string) ?? "",
    level: Number(r.level ?? 0),
    sortOrder: Number(r.sort_order ?? 0),
    isActive: Boolean(r.is_active),
    productCount: Number(r.product_count ?? 0),
    childCount: Number(r.child_count ?? 0),
  };
}

/**
 * The readable path — ancestor names joined.
 *
 * A recursive walk up the ltree, in SQL, so the label a screen shows is built
 * from the tree rather than cached beside it. Mongo stores `path` as a string
 * on the row, which goes stale the moment any ancestor is renamed.
 */
const PATH_NAMES = sql`
  (SELECT string_agg(a.name, ' > ' ORDER BY nlevel(a.path))
     FROM categories a
    WHERE c.path <@ a.path) AS path_names
`;

export async function listCategories(
  tx: Tx,
  opts: { includeInactive?: boolean } = {},
) {
  const rows = (await tx.execute(sql`
    SELECT c.*, ${PATH_NAMES}, ${WITH_COUNTS}
      FROM categories c
     ${opts.includeInactive ? sql`` : sql`WHERE c.is_active`}
     ORDER BY c.path, c.sort_order, c.name
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(row);
}

export async function getCategory(tx: Tx, categoryId: string) {
  const rows = (await tx.execute(sql`
    SELECT c.*, ${PATH_NAMES}, ${WITH_COUNTS}
      FROM categories c
     WHERE c.id = ${categoryId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  if (!rows[0]) return null;

  const attributes = await tx
    .select()
    .from(categoryAttributes)
    .where(eq(categoryAttributes.categoryId, categoryId))
    .orderBy(asc(categoryAttributes.sortOrder));

  return { ...row(rows[0]), attributes };
}

export async function searchCategories(tx: Tx, query: string, limit = 20) {
  const term = `%${query.trim()}%`;
  const rows = (await tx.execute(sql`
    SELECT c.*, ${PATH_NAMES}, ${WITH_COUNTS}
      FROM categories c
     WHERE c.name ILIKE ${term} OR c.description ILIKE ${term}
     ORDER BY c.path
     LIMIT ${Math.min(limit, 100)}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(row);
}

/**
 * The nested tree the CategoryTree component renders.
 *
 * Built from ONE query ordered by path, which is what makes an ltree worth
 * having: rows arrive with every parent before its children, so the nesting is
 * a single pass and no recursion is needed. Mongo issues a query per level.
 */
export async function getCategoryTree(
  tx: Tx,
  opts: { activeOnly?: boolean } = {},
) {
  const flat = await listCategories(tx, {
    includeInactive: opts.activeOnly === false,
  });

  const byId = new Map(flat.map((c) => [c.id, { ...c, children: [] as unknown[] }]));
  const roots: unknown[] = [];
  for (const node of byId.values()) {
    const parent = node.parent ? byId.get(node.parent) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Every descendant of a category, itself included — one indexed query. */
export async function listSubtree(tx: Tx, categoryId: string) {
  const rows = (await tx.execute(sql`
    SELECT c.*, ${PATH_NAMES}, ${WITH_COUNTS}
      FROM categories c
     WHERE c.path <@ (SELECT path FROM categories WHERE id = ${categoryId}::uuid)
     ORDER BY c.path
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(row);
}
