/**
 * Report boundaries are calendar dates, and both ways the app produced one
 * were wrong on a server east of Greenwich. This pins both.
 *
 * The suite forces Africa/Nairobi (UTC+3, the primary market) so the bug is
 * actually reachable — under TZ=UTC every one of these assertions passes with
 * the broken code, which is why it survived.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { toDayString, today, coerceDayString } from "@/lib/utils/report-dates";

describe("report day strings", () => {
  let original;
  beforeAll(() => {
    original = process.env.TZ;
    process.env.TZ = "Africa/Nairobi";
  });
  afterAll(() => {
    process.env.TZ = original;
  });

  it("keeps the calendar date the user picked", () => {
    // Local midnight on the first of August. `.toISOString()` reads this back
    // as 2026-07-31 in Nairobi, which is how "this month" started in July.
    const firstOfAugust = new Date(2026, 7, 1);
    expect(firstOfAugust.toISOString().slice(0, 10)).toBe("2026-07-31");
    expect(toDayString(firstOfAugust)).toBe("2026-08-01");
  });

  it("keeps the last day of the month, which is the one that got dropped", () => {
    // new Date(y, m + 1, 0) is the last day of month m. Formatted in UTC it
    // came out a day early, so the closing day's postings fell outside every
    // range the General Ledger asked for.
    const lastOfAugust = new Date(2026, 8, 0);
    expect(toDayString(lastOfAugust)).toBe("2026-08-31");
  });

  it("round-trips any local date to its own calendar day", () => {
    for (const [y, m, d] of [
      [2026, 0, 1],
      [2026, 11, 31],
      [2024, 1, 29], // leap day
      [2026, 5, 15],
    ]) {
      expect(toDayString(new Date(y, m, d))).toBe(
        `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      );
    }
  });

  it("reads today off the local clock, not UTC", () => {
    const now = new Date();
    expect(today()).toBe(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate(),
      ).padStart(2, "0")}`,
    );
  });

  describe("coercing what callers actually pass", () => {
    it("passes a day string through untouched", () => {
      expect(coerceDayString("2026-08-01")).toBe("2026-08-01");
    });

    it("accepts a Date — the shape that crashed the query", () => {
      // getProfitLossDataPg was handed these by its page. A Date reaching a
      // `::date` parameter fails in the driver with "the string argument must
      // be of type string ... Received an instance of Date".
      expect(coerceDayString(new Date(2026, 7, 1))).toBe("2026-08-01");
    });

    it("accepts an ISO instant", () => {
      expect(coerceDayString("2026-07-31T21:00:00.000Z")).toBe("2026-08-01");
    });

    it("returns null for nothing, rather than a date", () => {
      expect(coerceDayString(null)).toBeNull();
      expect(coerceDayString("")).toBeNull();
      expect(coerceDayString(undefined)).toBeNull();
      expect(coerceDayString("not a date")).toBeNull();
    });
  });
});
