/**
 * Day strings for reports.
 *
 * Every report boundary in the Postgres layer is a `date` — "2026-08-01", not
 * an instant. Two ways of producing one were in use and both were wrong on a
 * server east of Greenwich:
 *
 *   new Date(y, m, 1).toISOString().slice(0, 10)
 *
 * builds LOCAL midnight and then reads it in UTC, so in Nairobi (UTC+3) the
 * first of the month came out as the last day of the previous one — and the
 * last day of the month as the second-to-last, silently dropping a day of
 * postings off the end of every General Ledger and Purchases report.
 *
 *   getProfitLossDataPg(new Date(...), ...)
 *
 * skipped the string entirely and handed a Date to a query parameter typed
 * `::date`. drizzle passes parameters to postgres.js pre-serialized, which
 * calls Buffer.byteLength on them, so a Date arrived as
 * `TypeError: The "string" argument must be of type string ... Received an
 * instance of Date` — wrapped by DrizzleQueryError and shown to the user as a
 * page of SQL.
 *
 * `toDayString` reads the local calendar date, which is the one the person
 * asking for "this month" means.
 */

/** Local calendar date of `d` as YYYY-MM-DD. Never shifts across midnight. */
export function toDayString(d) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today, as a local day string. */
export function today() {
  return toDayString(new Date());
}

/**
 * Accepts what callers actually pass — a Date, a day string, an ISO instant —
 * and returns a day string, or null.
 *
 * Reports are reached from pages, from search params and from server actions
 * a client component calls directly, so the boundary cannot assume its input
 * has already been formatted. A `date` parameter that is handed anything else
 * fails inside the driver, where the message names Buffer rather than the
 * report.
 */
export function coerceDayString(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return toDayString(value);
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return toDayString(s);
}
