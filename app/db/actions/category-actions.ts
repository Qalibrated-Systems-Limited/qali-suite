"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { CATEGORY_MANAGE_ROLES } from "@/lib/utils/role-gates";
import * as categoriesRepo from "../repositories/categories";

/**
 * Product categories on Postgres (0062).
 *
 * The tree's invariants are the database's — path maintenance, cycle refusal,
 * sibling-name uniqueness, and the delete guard — so this layer parses, gates
 * and translates. What it does NOT do is decide whether a category can be
 * deleted: the Mongo action read a cached `productCount` and decided; here the
 * foreign key decides and the count is only in the message.
 */

export type ActionResult =
  | { success: true; categoryId?: string; message?: string }
  | { success: false; error: string; values?: Record<string, unknown> };

function fail(err: unknown, values?: Record<string, unknown>): ActionResult {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("Cannot delete") ||
    message.includes("not found") ||
    message.includes("beneath itself") ||
    message.includes("does not exist") ||
    message.includes("permission")
  ) {
    return { success: false, error: message, values };
  }
  return {
    success: false,
    error: userMessage(err, "Something went wrong with this category."),
    values,
  };
}

function parseAttributes(formData: FormData) {
  const raw = formData.get("attributes");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .filter((a) => a?.name?.trim())
      .map((a) => ({
        name: String(a.name),
        attributeType: ["text", "number", "boolean", "date", "select"].includes(a.type)
          ? a.type
          : "text",
        isRequired: Boolean(a.required),
        unit: a.unit ? String(a.unit) : null,
      }));
  } catch {
    return undefined;
  }
}

/** `""` and `"none"` are what an untouched parent <select> posts. */
const parentOf = (formData: FormData) => {
  const v = String(formData.get("parent") ?? formData.get("parentId") ?? "").trim();
  return v && v.toLowerCase() !== "none" ? v : null;
};

export async function createCategoryPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const values = Object.fromEntries(formData.entries());
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) {
    return { success: false, error: "A category needs a name.", values };
  }

  let category;
  try {
    category = await withAuthorizedTenant(
      [...CATEGORY_MANAGE_ROLES],
      (tx, { user, companyId }) =>
        categoriesRepo.createCategory(tx, {
          companyId,
          name,
          description: String(formData.get("description") ?? "") || null,
          parentId: parentOf(formData),
          sortOrder: Number(formData.get("sortOrder")) || 0,
          attributes: parseAttributes(formData),
          createdById: user.id,
        }),
    );
  } catch (err) {
    return fail(err, values);
  }

  // Back to the list, outside the try: redirect() works by throwing, and the
  // catch above would turn it into a failure. Paired with revalidatePath, the
  // refreshed list comes back in this same response rather than a second trip.
  // `success` is what the list's FormBanner reads.
  revalidatePath("/dashboard/categories");
  redirect(
    `/dashboard/categories?success=${encodeURIComponent(`${category.name} created`)}`,
  );
}

export async function updateCategoryPg(
  categoryId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const values = Object.fromEntries(formData.entries());
  const name = String(formData.get("name") ?? "").trim();
  if (name && name.length < 2) {
    return { success: false, error: "A category needs a name.", values };
  }

  try {
    await withAuthorizedTenant([...CATEGORY_MANAGE_ROLES], (tx, { user }) =>
      categoriesRepo.updateCategory(tx, categoryId, {
        name: name || undefined,
        description: formData.has("description")
          ? String(formData.get("description") ?? "") || null
          : undefined,
        // Only when the form actually carried a parent field — `undefined` and
        // `null` mean different things, and treating them alike would re-root
        // a category on every unrelated edit.
        parentId: formData.has("parent") || formData.has("parentId")
          ? parentOf(formData)
          : undefined,
        sortOrder: formData.has("sortOrder")
          ? Number(formData.get("sortOrder")) || 0
          : undefined,
        isActive: formData.has("isActive")
          ? formData.get("isActive") === "true" || formData.get("isActive") === "on"
          : undefined,
        attributes: parseAttributes(formData),
        lastModifiedById: user.id,
      }),
    );

    revalidatePath("/dashboard/categories");
    revalidatePath(`/dashboard/categories/${categoryId}`);
    return { success: true, categoryId, message: "Category updated" };
  } catch (err) {
    return fail(err, values);
  }
}

export async function deleteCategoryPg(
  categoryId: string,
): Promise<ActionResult> {
  try {
    const deleted = await withAuthorizedTenant(
      [...CATEGORY_MANAGE_ROLES],
      (tx) => categoriesRepo.deleteCategory(tx, categoryId),
    );
    revalidatePath("/dashboard/categories");
    return { success: true, message: `${deleted.name} deleted` };
  } catch (err) {
    return fail(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function getCategoriesPg(includeInactive = false) {
  return withAuthorizedTenant([], (tx) =>
    categoriesRepo.listCategories(tx, { includeInactive }),
  );
}

export async function getCategoryPg(categoryId: string) {
  return withAuthorizedTenant([], (tx) =>
    categoriesRepo.getCategory(tx, categoryId),
  );
}

export async function searchCategoriesPg(query: string) {
  if (!query?.trim()) return [];
  return withAuthorizedTenant([], (tx) =>
    categoriesRepo.searchCategories(tx, query),
  );
}

export async function getCategoryStatsPg() {
  return withAuthorizedTenant([], (tx) => categoriesRepo.getCategoryStats(tx));
}

export async function getCategoryTreePg(activeOnly = true) {
  return withAuthorizedTenant([], (tx) =>
    categoriesRepo.getCategoryTree(tx, { activeOnly }),
  );
}
