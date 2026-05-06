// ============================================
// DATE UTILITIES
// ============================================
// Calendar arithmetic that doesn't surprise. JS Date.setMonth()
// auto-corrects overflow which is the wrong behavior for billing:
//   - Jan 31 + 1 month should be Feb 28/29, NOT Mar 3.
// Fixed-day approximations (`30 * 24 * 60 * 60 * 1000`) are similarly
// wrong for accounting — Feb has 28/29 days.
//
// This module is dependency-free (no date-fns / Luxon) on purpose so
// it works in the edge runtime (proxy, JWT) where heavy libs can't load.

/**
 * Add N months to a date, clamping the day to the last day of the
 * target month if the source day overflows.
 *
 *   addMonths(new Date("2025-01-31"), 1) → 2025-02-28
 *   addMonths(new Date("2024-01-31"), 1) → 2024-02-29 (leap year)
 *   addMonths(new Date("2025-03-31"), 1) → 2025-04-30
 *
 * The native `d.setMonth(d.getMonth() + 1)` would return 2025-03-03
 * for the first case (auto-overflow), which is wrong for billing.
 *
 * @param {Date | string | number} date - source date
 * @param {number} months - integer; can be negative
 * @returns {Date}
 */
export function addMonths(date, months) {
  const d = new Date(date instanceof Date ? date.getTime() : date);
  if (Number.isNaN(d.getTime())) {
    throw new Error("addMonths: invalid date input");
  }
  const n = Math.trunc(Number(months) || 0);
  if (n === 0) return d;

  const day = d.getDate();
  // Park on day 1 to dodge the overflow correction, advance month, then
  // clamp the day back. setDate(1) on Jan 31 → Jan 1, then setMonth(2) → Mar 1
  // (no overflow), then we put the day back, capped at last-of-month.
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = lastDayOfMonth(d);
  d.setDate(Math.min(day, lastDay));
  return d;
}

/**
 * Last day-of-month for the year/month of the given date.
 * Uses the day-0 trick: Date(year, month+1, 0) = last day of `month`.
 */
export function lastDayOfMonth(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/**
 * Add N days to a date. Wraps Date math safely (handles month/year
 * boundaries automatically — unlike months, days never overflow).
 */
export function addDays(date, days) {
  const d = new Date(date instanceof Date ? date.getTime() : date);
  d.setDate(d.getDate() + Math.trunc(Number(days) || 0));
  return d;
}
