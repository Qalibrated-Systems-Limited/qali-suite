/**
 * The depreciation schedule, reconciled against the MongoDB implementation.
 *
 * `buildSchedule` in the repository is a transcription of `generateSchedule`
 * in app/models/asset.js, which the port deleted — the reference below is
 * that method's body, copied
 * verbatim and made standalone — so this compares the port against the thing
 * it was ported from, across a spread of inputs, rather than against my own
 * reading of it.
 *
 * Rule 2 of the vertical checklist: "Port behaviour as-is; reconciliation
 * against the old behaviour is the test."
 */
import { describe, it, expect } from "vitest";

const { buildSchedule } = await import("@/app/db/repositories/assets");

/**
 * app/models/asset.js:387 as it stood before the port (see git history),
 * verbatim apart from `this` becoming `a` and the
 * result being returned instead of assigned.
 */
function mongoGenerateSchedule(a) {
  const out = [];
  if (a.depreciationMethod === "none" || a.usefulLifeMonths === 0) return out;

  const depreciableAmount = a.acquisitionCost - (a.salvageValue || 0);
  const startDate = new Date(a.depreciationStartDate);
  let month = startDate.getUTCMonth() + 1;
  let year = startDate.getUTCFullYear();
  let accumulated = 0;
  let remainingBookValue = a.acquisitionCost;

  if (a.depreciationMethod === "straight_line") {
    const convention = a.depreciationConvention || "full_month";
    let firstFraction = 1;
    if (convention === "pro_rata") {
      const startDay = startDate.getUTCDate();
      const daysInStartMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (startDay > 1 && daysInStartMonth > 0) {
        firstFraction = (daysInStartMonth - startDay + 1) / daysInStartMonth;
      }
    }
    const needsExtraMonth = firstFraction < 1;
    const totalMonths = a.usefulLifeMonths + (needsExtraMonth ? 1 : 0);
    const monthlyDepRaw = depreciableAmount / a.usefulLifeMonths;
    const fullMonthDep = Math.round(monthlyDepRaw);

    for (let i = 0; i < totalMonths; i++) {
      let thisMonthDep;
      if (i === totalMonths - 1) {
        thisMonthDep = depreciableAmount - accumulated;
      } else if (i === 0 && firstFraction < 1) {
        thisMonthDep = Math.round(monthlyDepRaw * firstFraction);
      } else {
        thisMonthDep = fullMonthDep;
      }
      if (thisMonthDep < 0) thisMonthDep = 0;
      if (accumulated + thisMonthDep > depreciableAmount) {
        thisMonthDep = depreciableAmount - accumulated;
      }
      accumulated += thisMonthDep;
      const bookValue = Math.max(
        a.salvageValue || 0,
        a.acquisitionCost - accumulated,
      );
      out.push({
        period: `${year}-${String(month).padStart(2, "0")}`,
        year,
        month,
        depreciationAmount: thisMonthDep,
        accumulatedDepreciation: accumulated,
        bookValue,
      });
      month++;
      if (month > 12) { month = 1; year++; }
    }
  } else if (a.depreciationMethod === "reducing_balance") {
    const monthlyRate = a.depreciationRate / 12;
    for (let i = 0; i < a.usefulLifeMonths; i++) {
      let depAmount = Math.round(remainingBookValue * monthlyRate);
      if (remainingBookValue - depAmount < (a.salvageValue || 0)) {
        depAmount = Math.max(0, remainingBookValue - (a.salvageValue || 0));
      }
      if (depAmount <= 0) break;
      accumulated += depAmount;
      remainingBookValue -= depAmount;
      out.push({
        period: `${year}-${String(month).padStart(2, "0")}`,
        year,
        month,
        depreciationAmount: depAmount,
        accumulatedDepreciation: accumulated,
        bookValue: remainingBookValue,
      });
      month++;
      if (month > 12) { month = 1; year++; }
    }
  }
  return out;
}

const asNumbers = (rows) =>
  rows.map((r) => ({
    period: r.period,
    year: r.year,
    month: r.month,
    depreciationAmount: Number(r.depreciationAmount),
    accumulatedDepreciation: Number(r.accumulatedDepreciation),
    bookValue: Number(r.bookValue),
  }));

/** A spread of shapes, including the ones that round badly. */
const CASES = [
  { label: "5-year straight line, whole division",
    acquisitionCost: 1_200_000, salvageValue: 0, usefulLifeMonths: 60,
    depreciationMethod: "straight_line", depreciationRate: 0,
    depreciationStartDate: "2026-01-01", depreciationConvention: "full_month" },
  { label: "straight line that does NOT divide evenly",
    acquisitionCost: 1_000_000, salvageValue: 0, usefulLifeMonths: 36,
    depreciationMethod: "straight_line", depreciationRate: 0,
    depreciationStartDate: "2026-03-01", depreciationConvention: "full_month" },
  { label: "straight line with salvage",
    acquisitionCost: 850_000, salvageValue: 100_000, usefulLifeMonths: 48,
    depreciationMethod: "straight_line", depreciationRate: 0,
    depreciationStartDate: "2026-07-01", depreciationConvention: "full_month" },
  { label: "pro rata from mid-month, spilling an extra month",
    acquisitionCost: 1_000_000, salvageValue: 0, usefulLifeMonths: 60,
    depreciationMethod: "straight_line", depreciationRate: 0,
    depreciationStartDate: "2026-03-17", depreciationConvention: "pro_rata" },
  { label: "pro rata starting on the 1st (no extra month)",
    acquisitionCost: 500_000, salvageValue: 0, usefulLifeMonths: 24,
    depreciationMethod: "straight_line", depreciationRate: 0,
    depreciationStartDate: "2026-05-01", depreciationConvention: "pro_rata" },
  { label: "pro rata from a February day",
    acquisitionCost: 730_000, salvageValue: 30_000, usefulLifeMonths: 36,
    depreciationMethod: "straight_line", depreciationRate: 0,
    depreciationStartDate: "2026-02-20", depreciationConvention: "pro_rata" },
  { label: "reducing balance 25%",
    acquisitionCost: 2_000_000, salvageValue: 0, usefulLifeMonths: 60,
    depreciationMethod: "reducing_balance", depreciationRate: 0.25,
    depreciationStartDate: "2026-01-01", depreciationConvention: "full_month" },
  { label: "reducing balance that hits salvage and stops early",
    acquisitionCost: 400_000, salvageValue: 350_000, usefulLifeMonths: 60,
    depreciationMethod: "reducing_balance", depreciationRate: 0.375,
    depreciationStartDate: "2026-09-01", depreciationConvention: "full_month" },
  { label: "land — no depreciation at all",
    acquisitionCost: 9_000_000, salvageValue: 0, usefulLifeMonths: 0,
    depreciationMethod: "none", depreciationRate: 0,
    depreciationStartDate: "2026-01-01", depreciationConvention: "full_month" },
  { label: "a single-month life",
    acquisitionCost: 45_000, salvageValue: 0, usefulLifeMonths: 1,
    depreciationMethod: "straight_line", depreciationRate: 0,
    depreciationStartDate: "2026-12-01", depreciationConvention: "full_month" },
];

describe("depreciation schedule matches the MongoDB implementation", () => {
  // Straight line is a faithful transcription and must match exactly.
  for (const c of CASES.filter((c) => c.depreciationMethod !== "reducing_balance")) {
    it(c.label, () => {
      const expected = mongoGenerateSchedule(c);
      const actual = asNumbers(buildSchedule(c));
      expect(actual).toEqual(expected);
    });
  }

  /**
   * Reducing balance DELIBERATELY diverges — see decision 5 in 0056.
   *
   * Mongo computes the monthly rate as `rate / 12`, which compounds to less
   * than the annual rate it states. The rates are KRA wear-and-tear classes
   * and KRA computes wear-and-tear annually on the reducing balance, so book
   * depreciation ran about 11% under the tax computation it is named after.
   */
  describe("reducing balance, corrected", () => {
    const yearOne = (rate) => {
      const rows = buildSchedule({
        acquisitionCost: 1_000_000, salvageValue: 0, usefulLifeMonths: 12,
        depreciationMethod: "reducing_balance", depreciationRate: rate,
        depreciationStartDate: "2026-01-01", depreciationConvention: "full_month",
      });
      return rows.reduce((s, r) => s + Number(r.depreciationAmount), 0);
    };

    // Each KRA class must actually charge its own rate in year one.
    for (const [label, rate] of [
      ["Class I 37.5% (heavy machinery)", 0.375],
      ["Class II 30% (computers)", 0.3],
      ["Class III 25% (commercial vehicles)", 0.25],
      ["Class IV 12.5% (furniture and the rest)", 0.125],
    ]) {
      it(`${label} charges its stated rate in year one`, () => {
        // Within a shilling per month of rounding across twelve months.
        expect(yearOne(rate)).toBeCloseTo(1_000_000 * rate, -1);
      });
    }

    it("charges MORE than the Mongo version it replaces", () => {
      const mongo = mongoGenerateSchedule({
        acquisitionCost: 1_000_000, salvageValue: 0, usefulLifeMonths: 12,
        depreciationMethod: "reducing_balance", depreciationRate: 0.25,
        depreciationStartDate: "2026-01-01", depreciationConvention: "full_month",
      }).reduce((s, r) => s + r.depreciationAmount, 0);

      // 223,309 under rate/12 against 250,000 under the true monthly rate.
      expect(mongo).toBeLessThan(yearOne(0.25));
      expect(mongo / 1_000_000).toBeCloseTo(0.2233, 3);
    });

    it("still stops at salvage rather than crossing it", () => {
      const rows = buildSchedule({
        acquisitionCost: 400_000, salvageValue: 350_000, usefulLifeMonths: 60,
        depreciationMethod: "reducing_balance", depreciationRate: 0.375,
        depreciationStartDate: "2026-09-01", depreciationConvention: "full_month",
      });
      const total = rows.reduce((s, r) => s + Number(r.depreciationAmount), 0);
      expect(total).toBeLessThanOrEqual(50_000);
      for (const r of rows) expect(Number(r.bookValue)).toBeGreaterThanOrEqual(350_000);
    });
  });

  it("always sums to exactly cost minus salvage", () => {
    // The true-up on the final month is what guarantees this, and it is the
    // reason rounding to whole shillings never reaches the ledger as drift.
    for (const c of CASES) {
      if (c.depreciationMethod === "none") continue;
      const rows = buildSchedule(c);
      if (!rows.length) continue;
      const total = rows.reduce((s, r) => s + Number(r.depreciationAmount), 0);
      const depreciable = c.acquisitionCost - c.salvageValue;
      if (c.depreciationMethod === "straight_line") {
        expect(total).toBe(depreciable);
      } else {
        // Reducing balance approaches salvage asymptotically and stops at the
        // useful life, so it is NOT expected to consume the whole amount. What
        // it leaves standing is `asset_state.unwritten_residue`, which exists
        // so a register can show it rather than carry it in silence.
        expect(total).toBeLessThanOrEqual(depreciable);
      }
    }
  });

  it("never books a month below the salvage value", () => {
    for (const c of CASES) {
      for (const r of buildSchedule(c)) {
        expect(Number(r.bookValue)).toBeGreaterThanOrEqual(c.salvageValue);
      }
    }
  });

  it("runs consecutive months across a year boundary", () => {
    const rows = buildSchedule({
      acquisitionCost: 120_000, salvageValue: 0, usefulLifeMonths: 6,
      depreciationMethod: "straight_line", depreciationRate: 0,
      depreciationStartDate: "2026-11-01", depreciationConvention: "full_month",
    });
    expect(rows.map((r) => r.period)).toEqual([
      "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04",
    ]);
  });
});
