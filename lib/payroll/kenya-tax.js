/**
 * Kenya statutory deduction calculators — PAYE, NSSF, SHIF, AHL.
 *
 * All four are pure functions of inputs + the active PayrollConfig.
 * Rates and brackets live in the PayrollConfig document, not in here,
 * so updates to KRA / NSSF / SHA / AHL rates are a DB-only change.
 *
 * Extracted from app/mongodb/actions/hr-payroll-actions.js so they can
 * be imported by tests. Behavior unchanged — this is a refactor, not a
 * rewrite.
 *
 * Convention: monetary outputs are rounded to the nearest shilling.
 * Math is done at full precision; rounding is the last step. Don't
 * round intermediate values — pennies pile up across many employees.
 */

/**
 * Calculate PAYE using PAYE brackets from PayrollConfig.
 * Returns { paye, insuranceRelief } after personal relief and insurance relief.
 *
 * Insurance relief: 15% of SHIF contribution, capped at KES 5,000/month.
 * This is a Kenyan tax incentive — SHIF premiums qualify as insurance premiums,
 * so 15% of the amount (up to the cap) directly reduces PAYE payable.
 *
 * @param {number} taxableMonthly - monthly taxable income (gross - allowed deductions)
 * @param {object} config - PayrollConfig with payeBrackets[], personalRelief,
 *                          insuranceReliefRate, insuranceReliefCap
 * @param {number} shif - employee's SHIF contribution this period (drives insurance relief)
 * @returns {{ paye: number, insuranceRelief: number }}
 */
export function calculatePAYE(taxableMonthly, config, shif = 0) {
  const annual = taxableMonthly * 12;
  let annualTax = 0;
  let remaining = annual;

  const brackets = [...(config.payeBrackets || [])].sort((a, b) => a.from - b.from);

  for (let i = 0; i < brackets.length; i++) {
    const { from, to, rate } = brackets[i];
    if (remaining <= 0) break;
    const bandTop = to != null ? to : Infinity;
    const bandSize = Math.min(remaining, bandTop - from);
    if (bandSize <= 0) continue;
    annualTax += bandSize * rate;
    remaining -= bandSize;
  }

  const monthlyTax = annualTax / 12;
  const personalRelief = config.personalRelief || 0;

  // Insurance relief: percentage of SHIF contribution, subject to monthly cap
  const insuranceRelief = Math.round(
    Math.min(
      shif * (config.insuranceReliefRate || 0.15),
      config.insuranceReliefCap || 5000,
    ),
  );

  const paye = Math.max(0, Math.round(monthlyTax - personalRelief - insuranceRelief));
  return { paye, insuranceRelief };
}

/**
 * Calculate NSSF employee contribution (Tier I + Tier II).
 * Also returns employer share (same amount, for remittance tracking).
 *
 * Kenya's NSSF (post-2024 NSSF Act) is tiered:
 *   Tier I: 6% on first 8,000 of basic pay → max KES 480
 *   Tier II: 6% on next 64,000 (8,001–72,000) → max KES 3,840
 *   Combined cap: KES 4,320/month
 *
 * @param {number} basicSalary - basic salary only (excludes allowances)
 * @param {object} config - PayrollConfig with nssfTierILimit, nssfTierIILimit,
 *                          nssfEmployeeRate, nssfEmployerRate
 * @returns {{ employee: number, employer: number }}
 */
export function calculateNSSF(basicSalary, config) {
  const LEL = config.nssfTierILimit || 0;
  const UEL = config.nssfTierIILimit || 0;
  const empRate = config.nssfEmployeeRate || 0;

  const tierI = Math.min(basicSalary, LEL) * empRate;
  const tierII = basicSalary > LEL
    ? (Math.min(basicSalary, UEL) - LEL) * empRate
    : 0;
  const employee = Math.round(tierI + tierII);

  const emplRate = config.nssfEmployerRate || 0;
  const tierIEmpl = Math.min(basicSalary, LEL) * emplRate;
  const tierIIEmpl = basicSalary > LEL
    ? (Math.min(basicSalary, UEL) - LEL) * emplRate
    : 0;
  const employer = Math.round(tierIEmpl + tierIIEmpl);

  return { employee, employer };
}

/**
 * Calculate SHIF (Social Health Insurance Fund).
 * Flat rate on gross pay — no cap, no minimum. (2024 SHIF Act: 2.75% of gross,
 * minimum KES 300 per month for employees regardless of gross — but the minimum
 * is handled at config level.)
 *
 * @param {number} grossPay - total gross monthly pay
 * @param {object} config - PayrollConfig with shifRate
 * @returns {number} - rounded SHIF contribution
 */
export function calculateSHIF(grossPay, config) {
  return Math.round(grossPay * (config.shifRate || 0));
}

/**
 * Calculate Affordable Housing Levy (AHL).
 * Returns employee and employer amounts separately.
 *
 * 2024 AHL: 1.5% on gross pay each from employee and employer.
 *
 * @param {number} grossPay - total gross monthly pay
 * @param {object} config - PayrollConfig with ahlEmployeeRate, ahlEmployerRate
 * @returns {{ employee: number, employer: number }}
 */
export function calculateAHL(grossPay, config) {
  const employee = Math.round(grossPay * (config.ahlEmployeeRate || 0));
  const employer = Math.round(grossPay * (config.ahlEmployerRate || 0));
  return { employee, employer };
}
