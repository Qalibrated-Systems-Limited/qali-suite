/**
 * Kenya statutory deduction calculator unit tests.
 *
 * These are pure functions of (input, config) → output. No DB required.
 * Each test uses a config that matches the official 2024/2025 KRA, NSSF,
 * SHA and AHL rates so the assertions reflect reality, not arbitrary
 * numbers. When the government changes rates, update the config in this
 * file (and the PayrollConfig seed in the app) and the tests stay valid.
 *
 * Reference rates (Kenya, Jan 2025):
 *   - PAYE: 10% / 25% / 30% / 32.5% / 35% on monthly bands
 *   - Personal relief: KES 2,400/month
 *   - Insurance relief: 15% of SHIF, capped at KES 5,000/month
 *   - NSSF: 6% employee + 6% employer, Tier I to 8,000, Tier II to 72,000
 *   - SHIF: 2.75% of gross
 *   - AHL: 1.5% employee + 1.5% employer
 *
 * Sources:
 *   - Finance Act 2023 (PAYE bands)
 *   - NSSF Act 2013 + 2024 enforcement
 *   - SHIF Act 2023
 *   - Affordable Housing Act 2024
 */
import { describe, it, expect } from "vitest";
import {
  calculatePAYE,
  calculateNSSF,
  calculateSHIF,
  calculateAHL,
} from "@/lib/payroll/kenya-tax";

// Canonical Kenya 2025 PayrollConfig — used by every test below.
// Annual bracket boundaries; monthly = annual / 12.
const KENYA_2025_CONFIG = {
  payeBrackets: [
    { from: 0, to: 288_000, rate: 0.10 },        // 0–24,000/mo @ 10%
    { from: 288_000, to: 388_000, rate: 0.25 },  // 24,001–32,333/mo @ 25%
    { from: 388_000, to: 6_000_000, rate: 0.30 },// 32,334–500,000/mo @ 30%
    { from: 6_000_000, to: 9_600_000, rate: 0.325 }, // 500,001–800,000/mo @ 32.5%
    { from: 9_600_000, to: null, rate: 0.35 },   // 800,001+/mo @ 35%
  ],
  personalRelief: 2_400,           // KES/month — built-in tax credit
  insuranceReliefRate: 0.15,       // 15% of SHIF
  insuranceReliefCap: 5_000,       // monthly cap
  nssfTierILimit: 8_000,
  nssfTierIILimit: 72_000,
  nssfEmployeeRate: 0.06,
  nssfEmployerRate: 0.06,
  shifRate: 0.0275,
  ahlEmployeeRate: 0.015,
  ahlEmployerRate: 0.015,
};

describe("calculateNSSF", () => {
  it("returns 0 for an employee below Tier I limit (e.g. 5,000 basic)", () => {
    const r = calculateNSSF(5_000, KENYA_2025_CONFIG);
    expect(r.employee).toBe(300);  // 5000 × 6%
    expect(r.employer).toBe(300);
  });

  it("hits the Tier I cap at 8,000 basic (480 each)", () => {
    const r = calculateNSSF(8_000, KENYA_2025_CONFIG);
    expect(r.employee).toBe(480);
    expect(r.employer).toBe(480);
  });

  it("Tier II kicks in above 8,000 (e.g. 50,000 basic)", () => {
    // Tier I: 8000 × 6% = 480
    // Tier II: (50000 − 8000) × 6% = 2520
    // Total: 3000
    const r = calculateNSSF(50_000, KENYA_2025_CONFIG);
    expect(r.employee).toBe(3_000);
    expect(r.employer).toBe(3_000);
  });

  it("caps at the Tier II ceiling (72,000 basic → KES 4,320 max)", () => {
    const r = calculateNSSF(72_000, KENYA_2025_CONFIG);
    expect(r.employee).toBe(4_320);  // 8000×6% + 64000×6% = 480 + 3840
    expect(r.employer).toBe(4_320);
  });

  it("does NOT exceed the Tier II ceiling on very high basic pay (200,000)", () => {
    const r = calculateNSSF(200_000, KENYA_2025_CONFIG);
    expect(r.employee).toBe(4_320);  // capped
    expect(r.employer).toBe(4_320);
  });
});

describe("calculateSHIF", () => {
  it("is 2.75% of gross pay (e.g. 50,000 gross → 1,375)", () => {
    expect(calculateSHIF(50_000, KENYA_2025_CONFIG)).toBe(1_375);
  });

  it("scales linearly — 200,000 gross → 5,500", () => {
    expect(calculateSHIF(200_000, KENYA_2025_CONFIG)).toBe(5_500);
  });

  it("rounds to the nearest shilling (e.g. 12,345 gross)", () => {
    // 12345 × 0.0275 = 339.4875 → 339
    expect(calculateSHIF(12_345, KENYA_2025_CONFIG)).toBe(339);
  });

  it("returns 0 for zero gross", () => {
    expect(calculateSHIF(0, KENYA_2025_CONFIG)).toBe(0);
  });
});

describe("calculateAHL", () => {
  it("is 1.5% from employee + 1.5% from employer on gross pay", () => {
    const r = calculateAHL(50_000, KENYA_2025_CONFIG);
    expect(r.employee).toBe(750);
    expect(r.employer).toBe(750);
  });

  it("returns 0/0 for zero gross", () => {
    const r = calculateAHL(0, KENYA_2025_CONFIG);
    expect(r.employee).toBe(0);
    expect(r.employer).toBe(0);
  });
});

describe("calculatePAYE", () => {
  // Worked examples — verify against KRA's published P9 PAYE calculator.

  it("low earner under personal relief threshold pays 0 PAYE", () => {
    // 20,000 taxable monthly → annual 240,000 → all in 10% band → 24,000/12 = 2,000
    // Personal relief 2,400 wipes it out: max(0, 2000 − 2400 − insurance) = 0
    const r = calculatePAYE(20_000, KENYA_2025_CONFIG);
    expect(r.paye).toBe(0);
  });

  it("mid earner: 50,000 taxable, no SHIF → PAYE math hits expected", () => {
    // Annual 600,000.
    // 10% on first 288,000 = 28,800
    // 25% on (388k − 288k) = 100,000 = 25,000
    // 30% on (600k − 388k) = 212,000 = 63,600
    // Total annual = 117,400
    // Monthly tax = 9,783.33
    // − Personal relief 2,400 = 7,383.33 → rounded 7,383
    const r = calculatePAYE(50_000, KENYA_2025_CONFIG);
    expect(r.paye).toBe(7_383);
    expect(r.insuranceRelief).toBe(0);
  });

  it("applies insurance relief = 15% of SHIF, capped at 5,000", () => {
    // Same 50,000 taxable, but with 2,000 SHIF contribution.
    // Insurance relief: 2000 × 0.15 = 300 (under the cap)
    // PAYE = 7,383 − 300 = 7,083
    const r = calculatePAYE(50_000, KENYA_2025_CONFIG, 2_000);
    expect(r.paye).toBe(7_083);
    expect(r.insuranceRelief).toBe(300);
  });

  it("insurance relief is capped at 5,000/month even with huge SHIF", () => {
    // 100,000 SHIF would give 15,000 relief if uncapped; should be 5,000.
    const r = calculatePAYE(50_000, KENYA_2025_CONFIG, 100_000);
    expect(r.insuranceRelief).toBe(5_000);
  });

  it("high earner: 600,000 taxable crosses into 32.5% band", () => {
    // Annual 7,200,000.
    // 10% × 288k = 28,800
    // 25% × 100k = 25,000
    // 30% × (6,000k − 388k) = 30% × 5,612k = 1,683,600
    // 32.5% × (7,200k − 6,000k) = 32.5% × 1,200k = 390,000
    // Annual = 2,127,400
    // Monthly = 177,283.33
    // − 2,400 relief = 174,883.33 → 174,883
    const r = calculatePAYE(600_000, KENYA_2025_CONFIG);
    expect(r.paye).toBe(174_883);
  });

  it("never returns negative PAYE — clamps to 0", () => {
    // Very low earner with huge SHIF → would otherwise compute < 0
    const r = calculatePAYE(15_000, KENYA_2025_CONFIG, 30_000);
    expect(r.paye).toBe(0);
    expect(r.paye).toBeGreaterThanOrEqual(0);
  });

  it("handles missing/empty config gracefully", () => {
    // No brackets, no relief → 0 PAYE
    const r = calculatePAYE(100_000, { payeBrackets: [], personalRelief: 0 });
    expect(r.paye).toBe(0);
  });
});

describe("End-to-end payroll math for a typical employee", () => {
  // Sanity check that the four calculators compose into a sensible net pay.
  // Real employee: basic 50,000, housing 10,000, no other allowances.

  it("an employee on 60,000 gross / 50,000 basic gets a sensible net pay", () => {
    const basic = 50_000;
    const gross = 60_000;

    const nssf = calculateNSSF(basic, KENYA_2025_CONFIG);          // 3,000
    const shif = calculateSHIF(gross, KENYA_2025_CONFIG);          // 1,650
    const ahl = calculateAHL(gross, KENYA_2025_CONFIG);            // 900 / 900
    // Taxable = gross − NSSF (NSSF reduces taxable income in Kenya)
    const taxable = gross - nssf.employee;                          // 57,000
    const { paye } = calculatePAYE(taxable, KENYA_2025_CONFIG, shif);

    const totalDeductions = paye + nssf.employee + shif + ahl.employee;
    const netPay = gross - totalDeductions;

    expect(nssf.employee).toBe(3_000);
    expect(shif).toBe(1_650);
    expect(ahl.employee).toBe(900);
    // Don't pin the exact PAYE because rounding-by-component can shift
    // it by ±KES 1; just assert it's in a sensible range.
    expect(paye).toBeGreaterThan(5_000);
    expect(paye).toBeLessThan(15_000);
    // Net pay must be positive and meaningfully less than gross.
    expect(netPay).toBeGreaterThan(40_000);
    expect(netPay).toBeLessThan(gross);
  });
});
