import { sql } from "drizzle-orm";

/**
 * `= ANY(...)` over a JavaScript array.
 *
 * `sql`... ANY(${arr}::text[])`` DOES NOT WORK, in any nesting: drizzle expands
 * a JS array to a parameter TUPLE — `($1, $2)` — and `::text[]` cannot cast
 * one, so Postgres raises 22P02 "malformed array literal". It fails identically
 * inline, nested, and through sql.join, and it fails for a single-element array
 * too. It only ever LOOKS fine because every call site guards on
 * `array.length`, so the broken branch is skipped whenever the filter is empty.
 *
 * Building `ARRAY[$1, $2]` from individual params is the form that works.
 *
 * Found in production: the dashboard's AlertsStrip counts nonconformances
 * awaiting authorisation, and every load raised 22P02 — so the strip had never
 * shown a count. Twelve call sites had the same bug.
 */
export function anyOf(values: readonly (string | number)[], cast: string) {
  return sql`ANY(${arrayOf(values, cast)})`;
}

/**
 * The array literal itself — `ARRAY[$1, $2]::uuid[]` — for the places that
 * need one somewhere other than after `= ANY`.
 *
 * `unnest()` is the case that made this necessary: a batched query that turns
 * a list of ids into rows to LEFT JOIN against cannot use `anyOf`, and
 * inlining the array runs into the same tuple expansion documented above.
 * `cast` includes the brackets, as it does for anyOf: `"uuid[]"`.
 */
export function arrayOf(values: readonly (string | number)[], cast: string) {
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::${sql.raw(cast)}`;
}

/**
 * A `timestamptz` or `date` column off a raw `execute()`, as a real Date.
 *
 * `r.created_at as Date` IS A LIE, and a silent one. Importing
 * `drizzle-orm/postgres-js` replaces postgres.js's date parsers globally so
 * that drizzle can map columns itself from the schema — which it does for
 * `db.select()`, and cannot do for `tx.execute(sql`...`)`, because a raw query
 * has no schema to map against. So every timestamp off an `execute()` arrives
 * as the string Postgres printed: `2026-08-24 10:20:47.538458+00`.
 *
 * A cast does not convert. `as Date` merely stops the compiler objecting, so
 * the string flows into a field the interface swears is a Date, and the failure
 * lands somewhere else entirely — `.toLocaleDateString is not a function` on a
 * page, or a date-fns call quietly returning Invalid Date.
 *
 * Verify it rather than trusting either the type or this comment:
 *
 *     const [r] = await db.execute(sql`SELECT now() AS t`);
 *     r.t instanceof Date   // false
 *
 * Note the same import makes the RAW postgres.js client return strings too, so
 * probing with a standalone `postgres()` in a script that never imports drizzle
 * reports Date and proves nothing about the app.
 *
 * Microseconds truncate to milliseconds, which is all a JS Date holds; the
 * offset is parsed, so `+03` does not shift the instant.
 */
export function toDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A user's search box turned into an ILIKE pattern, with the wildcards escaped.
 *
 * `ILIKE '%' || term || '%'` treats `%` and `_` in the TERM as wildcards, so a
 * person typing `%` matches every row and `a_c` matches "abc". Neither is what
 * a search box means, and the second is the worse one because it looks like it
 * worked.
 *
 * Every search function in this directory built its pattern by hand —
 * `` `%${query}%` `` — so all of them had it. Found while porting the tax
 * screens, where the same construction had the same fault, and swept from
 * there per the rule that fixing one instance is half the job.
 *
 * `\` is the LIKE escape character by default, and these reach Postgres as
 * bound parameters, so the backslash arrives intact without needing
 * `ESCAPE '\'` on every clause.
 *
 *   contains  — matches anywhere. Names, descriptions.
 *   prefix    — matches from the start. Document numbers, emails; index-usable.
 */
function escapeLike(term: string) {
  return term.replace(/([%_\\])/g, "\\$1");
}

/** `%term%` — matches anywhere in the column. */
export function likeContains(term: string) {
  return `%${escapeLike(term)}%`;
}

/** `term%` — matches from the start, and can use a b-tree index. */
export function likePrefix(term: string) {
  return `${escapeLike(term)}%`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Is this string something a `uuid` column could hold?
 *
 * WHY A DETAIL LOOKUP NEEDS THIS. `WHERE i.id = ${invoiceId}` against a uuid
 * column does not return no rows when the id is malformed — Postgres fails to
 * parse the literal and raises 22P02, which surfaces to the reader as a
 * DrizzleQueryError containing the whole statement. Reported from the running
 * app: opening a stale invoice link whose id was a 24-character Mongo ObjectId
 * (`6a3ba4ae0f569c9f3d9a907f`) produced a 500 and a screenful of SQL, on a page
 * that already handles the not-found case two lines later.
 *
 * An id that cannot exist is NOT FOUND, not an error. Old links, bookmarks and
 * anything still holding a pre-migration id all land in the same place, and the
 * page's `notFound()` does the rest.
 *
 * The same reasoning as the `isUuid` branches in app/db/platform.ts, which
 * choose between `c.id = $1::uuid` and the legacy id map — this is the half
 * that has no legacy fallback to fall back to.
 */
export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}
