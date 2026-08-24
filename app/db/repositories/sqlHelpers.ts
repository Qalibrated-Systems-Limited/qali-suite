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
  return sql`ANY(ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::${sql.raw(cast)})`;
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
