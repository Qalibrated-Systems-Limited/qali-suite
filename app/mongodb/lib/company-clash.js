import Company from "@/app/models/company";

/**
 * Is this name / code / slug already taken?
 *
 * WHY THIS ASKS MONGO, NOT POSTGRES.
 *
 * Company creation is mid-port and deliberately dual-store: the document is
 * created in Mongo — which is where its `_id` comes from, and every Postgres
 * tenant is keyed back to that id through `_migration_id_map` — and
 * `provisionCompany` then builds the Postgres tenant from it.
 *
 * The duplicate check, however, asked ONLY Postgres, "because that is where
 * the constraint is". It is not the only place, and it is not the one that
 * fires. Mongo's `companies` collection carries unique indexes on `code` and
 * on `slug`, and Mongo is the store the insert actually lands in.
 *
 * The two registries are not the same set. On this repo's databases Mongo held
 * seven companies and Postgres three, and every Postgres `code` was NULL —
 * `provisionCompany` never carried one across, and `companies_code_uq` is
 * partial (`WHERE code IS NOT NULL`). So `WHERE c.code = 'FIL'` matched
 * nothing it could ever have matched, the check passed, and `Company.create`
 * raised a raw E11000 duplicate-key error at the user.
 *
 * SLUG IS CHECKED TOO, and was checked nowhere before. It is derived from the
 * name in a pre-save hook, so two different names can reduce to the same slug
 * — "ABC Ltd." and "ABC Ltd" both become `abc-ltd` — and that clash was
 * reachable with a name and a code that were both genuinely free.
 */

/** The pre-save hook's rule, so the check tests the value that will be stored. */
export function slugFor(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Returns `{ field, message }` for the first clash found, or null.
 * `excludeId` skips the company being edited.
 */
export async function findCompanyClash({ name, code, excludeId = null }) {
  const trimmedName = name ? String(name).trim() : null;
  const upperCode = code ? String(code).trim().toUpperCase() : null;
  const slug = trimmedName ? slugFor(trimmedName) : null;

  const or = [];
  if (upperCode) or.push({ code: upperCode });
  if (slug) or.push({ slug });
  if (trimmedName) or.push({ name: trimmedName });
  if (!or.length) return null;

  const query = excludeId
    ? { $and: [{ $or: or }, { _id: { $ne: excludeId } }] }
    : { $or: or };
  const hit = await Company.findOne(query).select("name code slug").lean();
  if (!hit) return null;

  if (upperCode && hit.code === upperCode) {
    return { field: "code", message: "This company code is already in use" };
  }
  if (trimmedName && hit.name === trimmedName) {
    return { field: "name", message: "A company with this name already exists" };
  }
  // Same slug, different name — say so plainly rather than reporting a name
  // clash the user can see is not one.
  return {
    field: "name",
    message: `That name gives the same short name ("${slug}") as "${hit.name}". Use a name that differs by more than punctuation.`,
  };
}

/**
 * Turns a Mongo duplicate-key error into the field error it describes.
 *
 * A race past the check above still reaches the unique index, and until this
 * existed the user saw the driver's message — collection, index name and the
 * raw key — for what is an ordinary "that code is taken".
 */
export function duplicateKeyError(err) {
  if (!err || err.code !== 11000) return null;
  const key = Object.keys(err.keyPattern ?? err.keyValue ?? {})[0];
  if (key === "code") {
    return { field: "code", message: "This company code is already in use" };
  }
  if (key === "slug" || key === "name") {
    return { field: "name", message: "A company with this name already exists" };
  }
  return { field: "_form", message: "That company already exists" };
}
