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
 * Returns { paye, insuranceRelief } after personal relief.
 *
 * `taxableMonthly` must already be NET of the pre-PAYE statutory deductions —
 * NSSF, SHIF and AHL — which the Tax Laws (Amendment) Act 2024 (effective
 * 27 Dec 2024) made allowable deductions from gross. The old 15% SHIF/NHIF
 * "insurance relief" was abolished by the same Act, so it is no longer applied;
 * `insuranceRelief` is returned as 0 for backward compatibility with stored
 * entries and statutory exports.
 *
 * @param {number} taxableMonthly - monthly taxable income (gross − NSSF − SHIF − AHL)
 * @param {object} config - PayrollConfig with payeBrackets[], personalRelief
 * @returns {{ paye: number, insuranceRelief: number }}
 */
export function calculatePAYE(taxableMonthly, config) {
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

  const paye = Math.max(0, Math.round(monthlyTax - personalRelief));
  return { paye, insuranceRelief: 0 };
}

/**
 * Calculate NSSF employee contribution (Tier I + Tier II).
 * Also returns employer share (same amount, for remittance tracking).
 *
 * Kenya's NSSF (post-2024 NSSF Act) is tiered and based on PENSIONABLE pay
 * (gross earnings, capped at the Upper Earnings Limit) — NOT basic salary:
 *   Tier I: 6% on first 8,000 → max KES 480
 *   Tier II: 6% on next 64,000 (8,001–72,000) → max KES 3,840
 *   Combined cap: KES 4,320/month
 *
 * @param {number} pensionablePay - pensionable earnings (gross), capped at UEL
 * @param {object} config - PayrollConfig with nssfTierILimit, nssfTierIILimit,
 *                          nssfEmployeeRate, nssfEmployerRate
 * @returns {{ employee: number, employer: number }}
 */
export function calculateNSSF(pensionablePay, config) {
  const LEL = config.nssfTierILimit || 0;
  const UEL = config.nssfTierIILimit || 0;
  const empRate = config.nssfEmployeeRate || 0;

  const tierI = Math.min(pensionablePay, LEL) * empRate;
  const tierII = pensionablePay > LEL
    ? (Math.min(pensionablePay, UEL) - LEL) * empRate
    : 0;
  const employee = Math.round(tierI + tierII);

  const emplRate = config.nssfEmployerRate || 0;
  const tierIEmpl = Math.min(pensionablePay, LEL) * emplRate;
  const tierIIEmpl = pensionablePay > LEL
    ? (Math.min(pensionablePay, UEL) - LEL) * emplRate
    : 0;
  const employer = Math.round(tierIEmpl + tierIIEmpl);

  return { employee, employer };
}

/**
 * Calculate SHIF (Social Health Insurance Fund).
 * 2024 SHIF Act: 2.75% of gross, with a statutory minimum of KES 300/month
 * for a contributing (paid) employee. A zero-gross period contributes nothing.
 *
 * @param {number} grossPay - total gross monthly pay
 * @param {object} config - PayrollConfig with shifRate, optional shifMinimum
 * @returns {number} - rounded SHIF contribution
 */
export function calculateSHIF(grossPay, config) {
  if (!grossPay || grossPay <= 0) return 0;
  const computed = Math.round(grossPay * (config.shifRate || 0));
  const minimum = config.shifMinimum ?? 300;
  return Math.max(computed, minimum);
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
