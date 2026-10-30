/**
 * Final dues on leaving — the arithmetic, without a database.
 *
 * The sections of the Employment Act each line answers to are in
 * lib/hr/final-dues.js. These pin the numbers a person will be handed.
 */
import { describe, it, expect } from "vitest";
import {
  computeFinalDues,
  completedYears,
  untakenLeaveDays,
  daysBetween,
  monthsEmployed,
} from "@/lib/hr/final-dues";
import {
  calculatePAYE,
  calculateNSSF,
  calculateSHIF,
  calculateAHL,
} from "@/lib/payroll/kenya-tax";

const RATES = {
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

/** A 60,000 a month employee, hired 2021-03-01, leaving 2026-08-14. */
function base(over = {}) {
  return {
    exitType: "resignation",
    hireDate: "2021-03-01",
    lastWorkingDate: "2026-08-14",
    noticeDate: "2026-07-17", // 28 days' notice, served in full
    noticePeriodDays: 28,
    recoverNoticeShortfall: false,
    monthlyGross: 60_000,
    dailyRateOverride: null,
    salary: { unpaidWorkingDays: 10, unpaidMonths: 10 / 21, overpaidWorkingDays: 0, overpaidMonths: 0 },
    untakenLeaveDays: 0,
    loanInstallments: [],
    manualLines: [],
    rates: RATES,
    monthToDate: null,
    ...over,
  };
}

const line = (r, code) => r.lines.find((l) => l.code === code);

describe("final dues", () => {
  describe("the helpers", () => {
    it("counts only completed years", () => {
      expect(completedYears("2021-03-01", "2026-02-28")).toBe(4);
      expect(completedYears("2021-03-01", "2026-03-01")).toBe(5);
      expect(completedYears("2026-01-10", "2026-08-14")).toBe(0);
    });

    it("counts calendar days between two dates", () => {
      expect(daysBetween("2026-07-17", "2026-08-14")).toBe(28);
    });

    it("pro-rates leave granted up front, and leaves an accrual alone", () => {
      // 21 days granted on 1 January, leaving at the end of June: about half.
      const upFront = untakenLeaveDays({
        entitledDays: 21, annualEntitlement: 21, takenDays: 0,
        hireDate: "2020-01-01", lastWorkingDate: "2026-06-30",
      });
      expect(upFront).toBe(10.5);

      // Accrued monthly: 10.5 by June is already what was earned.
      const accrued = untakenLeaveDays({
        entitledDays: 10.5, annualEntitlement: 21, takenDays: 2,
        hireDate: "2020-01-01", lastWorkingDate: "2026-06-30",
      });
      expect(accrued).toBe(8.5);
    });

    it("counts a part month by its days", () => {
      expect(monthsEmployed("2026-01-01", "2026-06-30")).toBe(6);
      expect(monthsEmployed("2026-03-16", "2026-04-30")).toBeCloseTo(1 + 16 / 31, 6);
      expect(monthsEmployed("2026-05-01", "2026-04-30")).toBe(0);
    });

    it("adds carry-over and takes off what was encashed", () => {
      const days = untakenLeaveDays({
        entitledDays: 10.5, carryOverDays: 5, takenDays: 3, encashedDays: 2,
        annualEntitlement: 21, hireDate: "2020-01-01", lastWorkingDate: "2026-06-30",
      });
      expect(days).toBe(10.5);
    });
  });

  it("pays unpaid days across two months, each weighed by its own working days", () => {
    // 22 working days of July (all of it) and 10 of August's 21.
    const r = computeFinalDues(
      base({ salary: { unpaidWorkingDays: 32, unpaidMonths: 1 + 10 / 21, overpaidWorkingDays: 0, overpaidMonths: 0 } }),
    );
    expect(line(r, "unpaid_salary").amount).toBeCloseTo(60_000 + (60_000 / 21) * 10, 2);
  });

  it("pays the working days since the last payslip, pro-rated like payroll", () => {
    const r = computeFinalDues(base());
    const salary = line(r, "unpaid_salary");
    expect(salary.amount).toBeCloseTo((60_000 / 21) * 10, 2);
    expect(r.totals.grossEarnings).toBeCloseTo(28_571.43, 2);
  });

  it("recovers salary a payslip already paid past the last working day", () => {
    const r = computeFinalDues(
      base({ salary: { unpaidWorkingDays: 0, unpaidMonths: 0, overpaidWorkingDays: 3, overpaidMonths: 3 / 21 } }),
    );
    expect(line(r, "overpaid_salary").amount).toBeCloseTo((60_000 / 21) * 3, 2);
    expect(r.totals.net).toBeLessThan(0);
    expect(r.warnings.join(" ")).toMatch(/Deductions exceed earnings/);
  });

  it("uses gross / 30 as the daily rate unless HR sets one", () => {
    expect(computeFinalDues(base()).dailyRate).toBe(2_000);
    const set = computeFinalDues(base({ dailyRateOverride: 2_500 }));
    expect(set.dailyRate).toBe(2_500);
    expect(set.dailyRateBasis).toMatch(/Set for this exit/);
  });

  describe("notice", () => {
    it("owes nothing when the notice was served in full", () => {
      const r = computeFinalDues(base({ exitType: "termination" }));
      expect(line(r, "notice_pay")).toBeUndefined();
    });

    it("pays in lieu of what the employer did not give (s.36)", () => {
      const r = computeFinalDues(base({ exitType: "termination", noticeDate: "2026-08-04" }));
      // 10 days served of 28: 18 days in lieu at 2,000.
      expect(r.noticeShortfallDays).toBe(18);
      expect(line(r, "notice_pay").amount).toBe(36_000);
    });

    it("pays a full period when no notice was given at all", () => {
      const r = computeFinalDues(base({ exitType: "redundancy", noticeDate: null }));
      expect(line(r, "notice_pay").amount).toBe(56_000);
    });

    it("does not pay notice on a summary dismissal or a resignation", () => {
      for (const exitType of ["summary_dismissal", "resignation", "contract_end", "death"]) {
        const r = computeFinalDues(base({ exitType, noticeDate: null }));
        expect(line(r, "notice_pay"), exitType).toBeUndefined();
      }
    });

    it("recovers a resignation's unserved notice only when HR chooses to", () => {
      const off = computeFinalDues(base({ noticeDate: "2026-08-04" }));
      expect(line(off, "notice_recovery")).toBeUndefined();

      const on = computeFinalDues(base({ noticeDate: "2026-08-04", recoverNoticeShortfall: true }));
      const rec = line(on, "notice_recovery");
      expect(rec.amount).toBe(36_000);
      // Taken from net, not from the pay that is taxed.
      expect(rec.taxable).toBe(false);
      expect(on.totals.otherDeductions).toBe(36_000);
    });
  });

  describe("leave", () => {
    it("pays untaken annual leave at the daily rate (s.28)", () => {
      const r = computeFinalDues(base({ untakenLeaveDays: 7.5 }));
      expect(line(r, "leave_pay").amount).toBe(15_000);
    });

    it("recovers leave taken beyond what was earned, before tax", () => {
      const r = computeFinalDues(base({ untakenLeaveDays: -2 }));
      const rec = line(r, "leave_recovery");
      expect(rec.amount).toBe(4_000);
      expect(rec.taxable).toBe(true);
      expect(r.totals.grossEarnings).toBeCloseTo(28_571.43 - 4_000, 2);
    });
  });

  describe("severance (s.40)", () => {
    it("pays fifteen days per completed year on a redundancy", () => {
      const r = computeFinalDues(base({ exitType: "redundancy" }));
      // Five completed years, 75 days at 2,000.
      const sev = line(r, "severance");
      expect(sev.quantity).toBe(75);
      expect(sev.amount).toBe(150_000);
      // Taxed, but not pay that NSSF, SHIF or the levy is charged on.
      expect(sev.taxable).toBe(true);
      expect(sev.pensionable).toBe(false);
    });

    it("pays none on any other exit", () => {
      const r = computeFinalDues(base({ exitType: "termination" }));
      expect(line(r, "severance")).toBeUndefined();
    });

    it("says so when there is not yet a completed year", () => {
      const r = computeFinalDues(base({ exitType: "redundancy", hireDate: "2026-01-05" }));
      expect(line(r, "severance")).toBeUndefined();
      expect(r.warnings.join(" ")).toMatch(/less than one completed year/);
    });
  });

  describe("tax", () => {
    it("charges the statutory deductions on pensionable pay and PAYE on the rest", () => {
      const r = computeFinalDues(
        base({ exitType: "redundancy", noticeDate: null, untakenLeaveDays: 5 }),
      );
      const pensionable = (60_000 / 21) * 10 + 56_000 + 10_000;
      const nssf = calculateNSSF(pensionable, RATES);
      const shif = calculateSHIF(pensionable, RATES);
      const ahl = calculateAHL(pensionable, RATES);
      const taxable = pensionable + 150_000 - nssf.employee - shif - ahl.employee;

      expect(r.totals.nssf).toBe(nssf.employee);
      expect(r.totals.employerNssf).toBe(nssf.employer);
      expect(r.totals.shif).toBe(shif);
      expect(r.totals.housingLevy).toBe(ahl.employee);
      expect(r.totals.paye).toBe(calculatePAYE(taxable, RATES).paye);
    });

    it("taxes the dues on top of a payslip already issued that month", () => {
      const prior = {
        pensionable: 60_000,
        taxable: 60_000 - 3_600 - 1_650 - 900,
        nssfEmployee: 3_600,
        nssfEmployer: 3_600,
        shif: 1_650,
        ahlEmployee: 900,
        ahlEmployer: 900,
      };
      prior.paye = calculatePAYE(prior.taxable, RATES).paye;

      const r = computeFinalDues(
        base({
          salary: { unpaidWorkingDays: 0, unpaidMonths: 0, overpaidWorkingDays: 0, overpaidMonths: 0 },
          untakenLeaveDays: 10,
          monthToDate: prior,
        }),
      );

      // NSSF only up to the ceiling the payslip had not reached: 72,000 cap.
      const nssfAll = calculateNSSF(80_000, RATES);
      expect(r.totals.nssf).toBe(nssfAll.employee - 3_600);
      // Personal relief once: the PAYE on the month's total less what was withheld.
      const shifAll = calculateSHIF(80_000, RATES);
      const ahlAll = calculateAHL(80_000, RATES);
      const taxable = 20_000 - (nssfAll.employee - 3_600) - (shifAll - 1_650) - (ahlAll.employee - 900);
      expect(r.totals.paye).toBe(
        calculatePAYE(prior.taxable + taxable, RATES).paye - prior.paye,
      );
    });

    it("keeps gross equal to deductions plus net", () => {
      const r = computeFinalDues(
        base({
          exitType: "redundancy",
          untakenLeaveDays: 4,
          manualLines: [
            { kind: "earning", description: "Gratuity", amount: 25_000 },
            { kind: "deduction", description: "Phone not returned", amount: 8_000, accountId: "acct" },
          ],
          loanInstallments: [{ id: "i1", loanNumber: "LN-00001", amount: 5_000 }],
        }),
      );
      const t = r.totals;
      expect(t.paye + t.nssf + t.shif + t.housingLevy + t.otherDeductions + t.net).toBeCloseTo(
        t.grossEarnings,
        2,
      );
    });
  });

  describe("loans", () => {
    const instalments = [
      { id: "a", loanNumber: "LN-00001", amount: 5_000 },
      { id: "b", loanNumber: "LN-00001", amount: 5_000 },
      { id: "c", loanNumber: "LN-00002", amount: 30_000 },
      { id: "d", loanNumber: "LN-00002", amount: 1_000 },
    ];

    it("recovers whole instalments in schedule order while the dues bear them", () => {
      const r = computeFinalDues(base({ loanInstallments: instalments }));
      // Net before loans is about 22,000: a and b fit, c does not — and d,
      // though it would fit, stays behind c so the schedule stays contiguous.
      expect(r.loanInstallmentIds).toEqual(["a", "b"]);
      expect(line(r, "loan_recovery").amount).toBe(10_000);
      expect(r.warnings.join(" ")).toMatch(/31,000\.00 of staff loans is still outstanding/);
      expect(r.totals.net).toBeGreaterThanOrEqual(0);
    });

    it("recovers everything when the dues can bear it", () => {
      const r = computeFinalDues(
        base({ exitType: "redundancy", loanInstallments: instalments }),
      );
      expect(r.loanInstallmentIds).toEqual(["a", "b", "c", "d"]);
      expect(r.warnings.some((w) => /outstanding/.test(w))).toBe(false);
    });
  });

  it("requires an account on a manual deduction only through the database", () => {
    // The calculator carries the account; the table's check refuses a manual
    // deduction without one. Here it is passed straight through.
    const r = computeFinalDues(
      base({ manualLines: [{ kind: "deduction", description: "Advance", amount: 1_000, accountId: "x" }] }),
    );
    const m = line(r, "manual");
    expect(m.accountId).toBe("x");
    expect(m.isManual).toBe(true);
    expect(m.taxable).toBe(false);
  });
});
