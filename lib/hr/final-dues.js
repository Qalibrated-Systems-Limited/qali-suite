/**
 * Final dues on leaving employment — Kenya, Employment Act 2007.
 *
 * Pure: everything it needs is passed in, so the arithmetic is tested without a
 * database and the repository only gathers facts (days, balances, loans).
 *
 * What is owed, and the section each line answers to:
 *
 *   unpaid_salary    Pay for the days worked since the last payslip. Payroll
 *                    drops a terminated employee from the run for the month
 *                    they leave, so nothing else pays these days. Pro-rated by
 *                    WORKING days, exactly as payroll pro-rates a leaver.
 *   overpaid_salary  The reverse: a payslip already covered days after the
 *                    last working day.
 *   notice_pay       s.36: pay in lieu of the notice the employer did not
 *                    give. Termination and redundancy only.
 *   notice_recovery  s.36: the employee's side — a resignation without full
 *                    notice. Only when HR chooses to recover it.
 *   leave_pay        s.28: annual leave earned and not taken.
 *   leave_recovery   Leave taken beyond what was earned.
 *   severance        s.40(1)(g): redundancy, at least fifteen days' pay for
 *                    each completed year of service.
 *   loan_recovery    Outstanding staff loans, recovered by whole instalment
 *                    while the dues can bear them.
 *
 * DAILY RATE. Notice, leave and severance are all expressed in days' pay, and
 * the Act does not fix a divisor. Monthly gross / 30 (calendar days) is the
 * default; HR can override it per exit, and the statement prints which.
 *
 * TAX, MONTH TO DATE. If a payslip already exists for the month of leaving,
 * the dues are taxed as an addition to it: NSSF on the combined pensionable
 * pay less what that payslip deducted, PAYE on the combined taxable pay less
 * the PAYE already withheld. That keeps the NSSF ceiling and gives personal
 * relief once, not twice. With no payslip that month, it reduces to taxing the
 * dues as the month's pay.
 */
import {
  calculatePAYE,
  calculateNSSF,
  calculateSHIF,
  calculateAHL,
} from "@/lib/payroll/kenya-tax";

export const EXIT_TYPE_LABELS = {
  resignation: "Resignation",
  termination: "Termination with notice",
  summary_dismissal: "Summary dismissal",
  redundancy: "Redundancy",
  retirement: "Retirement",
  contract_end: "End of fixed-term contract",
  death: "Death in service",
  mutual_separation: "Mutual separation",
};

/** Exits where the employer ends the contract and owes notice it did not give. */
const EMPLOYER_OWES_NOTICE = new Set(["termination", "redundancy"]);

/** s.40(1)(g). */
export const SEVERANCE_DAYS_PER_YEAR = 15;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Calendar days from a to b, both YYYY-MM-DD. */
export function daysBetween(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Whole years from hire to the last working day. */
export function completedYears(hireDate, lastWorkingDate) {
  const [hy, hm, hd] = hireDate.split("-").map(Number);
  const [ly, lm, ld] = lastWorkingDate.split("-").map(Number);
  let years = ly - hy;
  if (lm < hm || (lm === hm && ld < hd)) years -= 1;
  return Math.max(0, years);
}

/**
 * Annual leave earned to the last working day and not taken.
 *
 * Works whether the company grants the year's leave up front or accrues it
 * monthly: the earned amount is the smaller of what was credited and the
 * year's entitlement pro-rated to the days employed this year. An up-front 21
 * days is cut to what was earned; a monthly accrual is already at or under it.
 */
export function untakenLeaveDays({
  entitledDays,
  carryOverDays = 0,
  takenDays = 0,
  encashedDays = 0,
  annualEntitlement,
  hireDate,
  lastWorkingDate,
}) {
  const yearStart = `${lastWorkingDate.slice(0, 4)}-01-01`;
  const from = hireDate > yearStart ? hireDate : yearStart;
  const yearly = Math.max(Number(annualEntitlement) || 0, Number(entitledDays) || 0);
  // In months, because a monthly accrual credits whole months: leaving on
  // 30 June has earned exactly half the year, not 181/365 of it.
  const proRated = (yearly * monthsEmployed(from, lastWorkingDate)) / 12;
  const earned = Math.min(Number(entitledDays) || 0, proRated);
  return round2(earned + Number(carryOverDays) - Number(takenDays) - Number(encashedDays));
}

/** Months from `from` to `to` inclusive, part months counted by their days. */
export function monthsEmployed(from, to) {
  if (to < from) return 0;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  let months = 0;
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, (m = 1)) : m++) {
    const dim = daysIn(y, m);
    const first = y === fy && m === fm ? fd : 1;
    const last = y === ty && m === tm ? td : dim;
    months += (last - first + 1) / dim;
  }
  return months;
}

/**
 * @param {object} input
 * @param {string} input.exitType
 * @param {string} input.hireDate            YYYY-MM-DD
 * @param {string} input.lastWorkingDate     YYYY-MM-DD
 * @param {string|null} input.noticeDate     YYYY-MM-DD, or null if none given
 * @param {number} input.noticePeriodDays
 * @param {boolean} input.recoverNoticeShortfall
 * @param {number} input.monthlyGross        basic + allowances
 * @param {number|null} input.dailyRateOverride
 * @param {{ unpaidWorkingDays: number, unpaidMonths: number,
 *          overpaidWorkingDays: number, overpaidMonths: number }} input.salary
 *        Working days not yet paid (or paid past the last day), and the months'
 *        pay they amount to — each month weighed by its own working days.
 * @param {number} input.untakenLeaveDays
 * @param {Array<{ id: string, loanNumber: string, amount: number }>} input.loanInstallments
 *        Pending instalments, oldest first.
 * @param {Array<{ kind: "earning"|"deduction", description: string, amount: number,
 *          taxable?: boolean, pensionable?: boolean, accountId?: string|null }>} input.manualLines
 * @param {object} input.rates               the payroll rates for the month of leaving
 * @param {{ pensionable: number, taxable: number, paye: number, nssfEmployee: number,
 *          nssfEmployer: number, shif: number, ahlEmployee: number, ahlEmployer: number } | null} input.monthToDate
 *        The payslip already issued for the month of leaving, if any.
 */
export function computeFinalDues(input) {
  const warnings = [];
  const lines = [];
  const add = (line) => {
    const amount = round2(line.amount);
    if (amount > 0) lines.push({ quantity: null, rate: null, accountId: null, isManual: false, ...line, amount });
  };

  const monthlyGross = Number(input.monthlyGross) || 0;
  const override = Number(input.dailyRateOverride) || 0;
  const dailyRate = round2(override > 0 ? override : monthlyGross / 30);
  const dailyRateBasis =
    override > 0 ? "Set for this exit" : "Monthly gross ÷ 30 calendar days";

  // ── Salary to the last working day ─────────────────────────────────────────
  // Each month counts by its own working days, as payroll pro-rates: so the
  // repository passes how many months' pay the days amount to, not the days.
  const {
    unpaidWorkingDays = 0,
    unpaidMonths = 0,
    overpaidWorkingDays = 0,
    overpaidMonths = 0,
  } = input.salary ?? {};
  if (unpaidWorkingDays > 0) {
    const amount = monthlyGross * unpaidMonths;
    add({
      kind: "earning",
      code: "unpaid_salary",
      description: `Salary for ${unpaidWorkingDays} working day(s) not yet paid`,
      quantity: unpaidWorkingDays,
      rate: round2(amount / unpaidWorkingDays),
      amount,
      taxable: true,
      pensionable: true,
    });
  }
  if (overpaidWorkingDays > 0) {
    const amount = monthlyGross * overpaidMonths;
    add({
      kind: "deduction",
      code: "overpaid_salary",
      description: `Salary already paid for ${overpaidWorkingDays} working day(s) after the last working day`,
      quantity: overpaidWorkingDays,
      rate: round2(amount / overpaidWorkingDays),
      amount,
      taxable: true,
      pensionable: true,
    });
  }

  // ── Notice ─────────────────────────────────────────────────────────────────
  const noticeServed = input.noticeDate
    ? Math.max(0, daysBetween(input.noticeDate, input.lastWorkingDate))
    : 0;
  const shortfall = Math.max(0, (Number(input.noticePeriodDays) || 0) - noticeServed);
  if (shortfall > 0 && EMPLOYER_OWES_NOTICE.has(input.exitType)) {
    add({
      kind: "earning",
      code: "notice_pay",
      description: `Pay in lieu of notice — ${shortfall} of ${input.noticePeriodDays} day(s) not served`,
      quantity: shortfall,
      rate: dailyRate,
      amount: dailyRate * shortfall,
      taxable: true,
      pensionable: true,
    });
  } else if (shortfall > 0 && input.exitType === "resignation" && input.recoverNoticeShortfall) {
    add({
      kind: "deduction",
      code: "notice_recovery",
      description: `Notice not served — ${shortfall} of ${input.noticePeriodDays} day(s)`,
      quantity: shortfall,
      rate: dailyRate,
      amount: dailyRate * shortfall,
      // Owed by the employee from their net pay, not a reduction of their
      // earnings for tax.
      taxable: false,
      pensionable: false,
    });
  }

  // ── Annual leave ───────────────────────────────────────────────────────────
  const leaveDays = round2(Number(input.untakenLeaveDays) || 0);
  if (leaveDays > 0) {
    add({
      kind: "earning",
      code: "leave_pay",
      description: `Untaken annual leave — ${leaveDays} day(s)`,
      quantity: leaveDays,
      rate: dailyRate,
      amount: dailyRate * leaveDays,
      taxable: true,
      pensionable: true,
    });
  } else if (leaveDays < 0) {
    add({
      kind: "deduction",
      code: "leave_recovery",
      description: `Annual leave taken beyond what was earned — ${-leaveDays} day(s)`,
      quantity: -leaveDays,
      rate: dailyRate,
      amount: dailyRate * -leaveDays,
      taxable: true,
      pensionable: true,
    });
  }

  // ── Severance ──────────────────────────────────────────────────────────────
  if (input.exitType === "redundancy") {
    const years = completedYears(input.hireDate, input.lastWorkingDate);
    if (years > 0) {
      const days = SEVERANCE_DAYS_PER_YEAR * years;
      add({
        kind: "earning",
        code: "severance",
        description: `Severance — ${SEVERANCE_DAYS_PER_YEAR} days' pay × ${years} completed year(s) (s.40)`,
        quantity: days,
        rate: dailyRate,
        amount: dailyRate * days,
        taxable: true,
        // Compensation for the job, not pay for work done.
        pensionable: false,
      });
    } else {
      warnings.push("No severance: less than one completed year of service.");
    }
  }

  // ── Manual lines ───────────────────────────────────────────────────────────
  for (const m of input.manualLines ?? []) {
    add({
      kind: m.kind,
      code: "manual",
      description: m.description,
      amount: m.amount,
      // A manual earning is pay unless said otherwise; a manual deduction is
      // taken from net pay unless said otherwise.
      taxable: m.taxable ?? m.kind === "earning",
      pensionable: m.pensionable ?? m.kind === "earning",
      accountId: m.accountId ?? null,
      isManual: true,
    });
  }

  // ── Bases ──────────────────────────────────────────────────────────────────
  const sum = (pred) => lines.filter(pred).reduce((s, l) => s + l.amount, 0);
  const signed = (l) => (l.kind === "earning" ? l.amount : -l.amount);
  const preTax = (l) => l.kind === "deduction" && l.taxable;

  const earnings = sum((l) => l.kind === "earning");
  // Deductions that reduce pay itself (salary or leave overpaid) rather than
  // being taken from net.
  const preTaxRecoveries = sum(preTax);
  const grossEarnings = round2(earnings - preTaxRecoveries);
  const pensionableBase = Math.max(
    0,
    lines.filter((l) => l.pensionable).reduce((s, l) => s + signed(l), 0),
  );
  const taxableGross = Math.max(
    0,
    lines.filter((l) => l.taxable).reduce((s, l) => s + signed(l), 0),
  );

  // ── Statutory, month to date ───────────────────────────────────────────────
  const prior = input.monthToDate ?? null;
  const rates = input.rates ?? {};
  const delta = (combined, already) => Math.max(0, combined - (already || 0));

  const priorPensionable = prior?.pensionable ?? 0;
  const nssfAll = calculateNSSF(priorPensionable + pensionableBase, rates);
  const nssf = {
    employee: pensionableBase > 0 ? delta(nssfAll.employee, prior?.nssfEmployee) : 0,
    employer: pensionableBase > 0 ? delta(nssfAll.employer, prior?.nssfEmployer) : 0,
  };
  const shif =
    pensionableBase > 0
      ? delta(calculateSHIF(priorPensionable + pensionableBase, rates), prior?.shif)
      : 0;
  const ahlAll = calculateAHL(priorPensionable + pensionableBase, rates);
  const ahl = {
    employee: pensionableBase > 0 ? delta(ahlAll.employee, prior?.ahlEmployee) : 0,
    employer: pensionableBase > 0 ? delta(ahlAll.employer, prior?.ahlEmployer) : 0,
  };

  const taxable = Math.max(0, taxableGross - nssf.employee - shif - ahl.employee);
  const priorTaxable = prior?.taxable ?? 0;
  const paye =
    taxable > 0
      ? delta(calculatePAYE(priorTaxable + taxable, rates).paye, prior?.paye)
      : 0;

  // ── Loans, by whole instalment, while the dues can bear them ───────────────
  const manualAndNotice = sum((l) => l.kind === "deduction" && !l.taxable);
  const statutory = paye + nssf.employee + shif + ahl.employee;
  const netBeforeLoans = round2(grossEarnings - statutory - manualAndNotice);

  const recovered = [];
  let loanTotal = 0;
  let outstanding = 0;
  let stopped = false;
  for (const inst of input.loanInstallments ?? []) {
    const amount = Number(inst.amount) || 0;
    outstanding += amount;
    if (!stopped && loanTotal + amount <= netBeforeLoans + 0.005) {
      loanTotal += amount;
      recovered.push(inst);
    } else {
      // Instalments are taken in schedule order; once one does not fit, the
      // later ones stay with it so the loan's schedule stays contiguous.
      stopped = true;
    }
  }
  loanTotal = round2(loanTotal);
  if (loanTotal > 0) {
    const numbers = [...new Set(recovered.map((r) => r.loanNumber))].join(", ");
    add({
      kind: "deduction",
      code: "loan_recovery",
      description: `Staff loan recovery — ${recovered.length} instalment(s) (${numbers})`,
      amount: loanTotal,
      taxable: false,
      pensionable: false,
    });
  }
  const loansLeft = round2(outstanding - loanTotal);
  if (loansLeft > 0) {
    warnings.push(
      `KES ${loansLeft.toLocaleString("en-KE", { minimumFractionDigits: 2 })} of staff loans is still outstanding after these dues. Agree how it will be repaid.`,
    );
  }

  const otherDeductions = round2(manualAndNotice + loanTotal);
  const net = round2(grossEarnings - statutory - otherDeductions);
  if (net < 0) {
    warnings.push(
      `Deductions exceed earnings by KES ${(-net).toLocaleString("en-KE", { minimumFractionDigits: 2 })}. Reduce the deductions before approving.`,
    );
  }

  return {
    dailyRate,
    dailyRateBasis,
    noticeServedDays: noticeServed,
    noticeShortfallDays: shortfall,
    lines: lines.map((l, i) => ({ ...l, sortOrder: i })),
    loanInstallmentIds: recovered.map((r) => r.id),
    totals: {
      grossEarnings,
      pensionableBase: round2(pensionableBase),
      taxable: round2(taxable),
      paye,
      nssf: nssf.employee,
      employerNssf: nssf.employer,
      shif,
      housingLevy: ahl.employee,
      employerHousingLevy: ahl.employer,
      loanRecovery: loanTotal,
      otherDeductions,
      net,
    },
    warnings,
  };
}
