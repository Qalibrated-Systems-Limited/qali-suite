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
