/**
 * Kenya statutory deduction calculator unit tests.
 *
 * Pure functions of (input, config) → output. No DB required.
 *
 * Reflects the law in force for 2026 payrolls — the Tax Laws (Amendment) Act
 * 2024 (effective 27 Dec 2024):
 *   - PAYE bands: 10% / 25% / 30% / 32.5% / 35%; personal relief KES 2,400/mo.
 *   - NSSF, SHIF and AHL are ALL allowable deductions BEFORE PAYE.
 *   - The old 15% SHIF/NHIF "insurance relief" was ABOLISHED.
 *   - NSSF is on pensionable pay (gross, capped at UEL 72,000), not basic.
 *   - SHIF: 2.75% of gross, statutory minimum KES 300/month.
 *   - AHL: 1.5% employee + 1.5% employer on gross.
 */
import { describe, it, expect } from "vitest";
import {
  calculatePAYE,
  calculateNSSF,
  calculateSHIF,
  calculateAHL,
} from "@/lib/payroll/kenya-tax";

const KENYA_CONFIG = {
  payeBrackets: [
    { from: 0, to: 288_000, rate: 0.1 },
    { from: 288_000, to: 388_000, rate: 0.25 },
    { from: 388_000, to: 6_000_000, rate: 0.3 },
    { from: 6_000_000, to: 9_600_000, rate: 0.325 },
    { from: 9_600_000, to: null, rate: 0.35 },
  ],
  personalRelief: 2_400,
  nssfTierILimit: 8_000,
  nssfTierIILimit: 72_000,
  nssfEmployeeRate: 0.06,
  nssfEmployerRate: 0.06,
  shifRate: 0.0275,
  shifMinimum: 300,
  ahlEmployeeRate: 0.015,
  ahlEmployerRate: 0.015,
};

describe("calculateNSSF (on pensionable pay = gross, capped at UEL)", () => {
  it("6% below Tier I limit (5,000 → 300 each)", () => {
    const r = calculateNSSF(5_000, KENYA_CONFIG);
    expect(r.employee).toBe(300);
    expect(r.employer).toBe(300);
  });

  it("Tier I cap at 8,000 (480 each)", () => {
    const r = calculateNSSF(8_000, KENYA_CONFIG);
    expect(r.employee).toBe(480);
  });

  it("Tier II kicks in above 8,000 (50,000 → 3,000)", () => {
    const r = calculateNSSF(50_000, KENYA_CONFIG);
    expect(r.employee).toBe(3_000);
  });

  it("caps at the UEL (72,000 → 4,320 max)", () => {
    expect(calculateNSSF(72_000, KENYA_CONFIG).employee).toBe(4_320);
  });

  it("never exceeds the UEL cap on high pay (200,000 → 4,320)", () => {
    expect(calculateNSSF(200_000, KENYA_CONFIG).employee).toBe(4_320);
  });
});

describe("calculateSHIF (2.75% of gross, min KES 300)", () => {
  it("is 2.75% of gross (50,000 → 1,375)", () => {
    expect(calculateSHIF(50_000, KENYA_CONFIG)).toBe(1_375);
  });

  it("applies the KES 300 statutory minimum for low earners (5,000 → 300)", () => {
    // 5,000 × 2.75% = 137.5 → would be 138, floored up to the 300 minimum.
    expect(calculateSHIF(5_000, KENYA_CONFIG)).toBe(300);
  });

  it("returns 0 for a zero-gross period (no contribution)", () => {
    expect(calculateSHIF(0, KENYA_CONFIG)).toBe(0);
  });
});

describe("calculateAHL", () => {
  it("1.5% employee + 1.5% employer on gross (50,000 → 750/750)", () => {
    const r = calculateAHL(50_000, KENYA_CONFIG);
    expect(r.employee).toBe(750);
    expect(r.employer).toBe(750);
  });
});

describe("calculatePAYE (no insurance relief post-2024)", () => {
  it("low earner under personal relief pays 0", () => {
    expect(calculatePAYE(20_000, KENYA_CONFIG).paye).toBe(0);
  });

  it("mid earner: 50,000 taxable → 7,383, insuranceRelief 0", () => {
    const r = calculatePAYE(50_000, KENYA_CONFIG);
    expect(r.paye).toBe(7_383);
    expect(r.insuranceRelief).toBe(0); // abolished
  });

  it("insurance relief is gone — SHIF no longer reduces PAYE directly", () => {
    // Pre-2024 this would have been lowered by 15% of SHIF; now it does not.
    expect(calculatePAYE(50_000, KENYA_CONFIG).insuranceRelief).toBe(0);
  });

  it("high earner: 600,000 taxable crosses into 32.5% band → 174,883", () => {
    expect(calculatePAYE(600_000, KENYA_CONFIG).paye).toBe(174_883);
  });

  it("never returns negative PAYE", () => {
    expect(calculatePAYE(15_000, KENYA_CONFIG).paye).toBe(0);
  });

  it("handles empty config gracefully", () => {
    expect(calculatePAYE(100_000, { payeBrackets: [], personalRelief: 0 }).paye).toBe(0);
  });
});

describe("End-to-end: NSSF, SHIF and AHL all reduce PAYE taxable income", () => {
  it("60,000 gross employee — statutory deductions are pre-PAYE", () => {
    const gross = 60_000;

    const nssf = calculateNSSF(gross, KENYA_CONFIG); // on gross, not basic
    const shif = calculateSHIF(gross, KENYA_CONFIG);
    const ahl = calculateAHL(gross, KENYA_CONFIG);

    expect(nssf.employee).toBe(3_600); // 480 + (52,000 × 6%)
    expect(shif).toBe(1_650);
    expect(ahl.employee).toBe(900);

    // The fix: taxable = gross − NSSF − SHIF − AHL (all three), not just NSSF.
    const taxable = gross - nssf.employee - shif - ahl.employee; // 53,850
    expect(taxable).toBe(53_850);

    const { paye } = calculatePAYE(taxable, KENYA_CONFIG);
    expect(paye).toBe(8_538);

    const net = gross - (paye + nssf.employee + shif + ahl.employee);
    expect(net).toBe(45_312);
  });
});
