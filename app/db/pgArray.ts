/**
 * A Postgres array literal, as ONE bound parameter.
 *
 * Interpolating a JavaScript array into a `sql` template does not produce an
 * array. The driver expands it into one parameter per element, so
 *
 *     stock_high_risk_types = COALESCE(${["theft","write_off"]}::text[], …)
 *
 * reaches Postgres as `COALESCE(($1, $2)::text[], …)` — a ROW constructor cast
 * to an array, which is a syntax error, and the company-creation form failed on
 * it. The same mistake in a FROM clause produces "malformed array literal".
 *
 * Building the literal keeps it a single parameter, so the values are still
 * bound and never concatenated into SQL. Elements are quoted and backslashes
 * and quotes escaped, because a value containing a comma or a brace would
 * otherwise change the shape of the array.
 *
 * Returns null for null/undefined so it composes with COALESCE(…, column).
 */
export function pgArray(
  values: readonly (string | number)[] | null | undefined,
): string | null {
  if (values === null || values === undefined) return null;
  if (!Array.isArray(values)) return null;
  const escaped = values.map(
    (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
  );
  return `{${escaped.join(",")}}`;
}
