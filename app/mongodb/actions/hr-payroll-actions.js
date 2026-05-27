"use server";

import mongoose from "mongoose";
import { roleAllowed } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope, getCompanyIdForCreate } from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";
import PayrollRun from "@/app/models/payrollRun";
import PayrollEntry from "@/app/models/payrollEntry";
import PayrollConfig from "@/app/models/payrollConfig";
import EmployeeProfile from "@/app/models/employeeProfile";
import LeaveRequest from "@/app/models/leaveRequest";
import PublicHoliday from "@/app/models/publicHoliday";
import JournalEntry from "@/app/models/JournalEntry";
import ErpCounter from "@/app/models/erp-counter";
import Loan from "@/app/models/loan";
import {
  calculatePAYE,
  calculateNSSF,
  calculateSHIF,
  calculateAHL,
} from "@/lib/payroll/kenya-tax";

// ============================================
// ROLE AUTHORIZATION (extended)
// ============================================

// ============================================
// ROLE AUTHORIZATION
// ============================================
// SuperAdmin / CFO / Finance Manager added across the board — they are
// the senior finance authority. HR drafts; Finance approves and posts.
const PAYROLL_ROLES = {
  CREATE: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "HR"],
  REVIEW: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "HR", "Manager"],
  APPROVE: ["SuperAdmin", "Admin", "CFO", "Finance Manager"],
  POST: ["SuperAdmin", "Admin", "CFO", "Finance Manager"],
  VOID: ["SuperAdmin", "Admin", "CFO"],
};

function hasRole(user, allowedRoles) {
  return roleAllowed(user?.role, allowedRoles);
}

// ============================================
// STATUTORY DEDUCTION CALCULATORS
// ============================================
// Imported from @/lib/payroll/kenya-tax so the math is directly
// unit-testable (a "use server" file can't export sync helpers). Rates
// and brackets still come from PayrollConfig at runtime — no behavior
// change. See lib/payroll/kenya-tax.js for the implementations.

// ============================================
// WORKING DAYS HELPER
// ============================================
/**
 * Count working days between two dates (inclusive), excluding weekends and public holidays.
 * Uses PublicHoliday.getDateSet() for the holiday lookup.
 */
async function countWorkingDays(companyId, fromDate, toDate, holidaySet = null) {
  if (!holidaySet) {
    holidaySet = await PublicHoliday.getDateSet(companyId, fromDate, toDate);
  }
  let count = 0;
  const cur = new Date(fromDate);
  cur.setUTCHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setUTCHours(23, 59, 59, 999);
  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6 && !holidaySet.has(cur.toISOString().slice(0, 10))) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

// ============================================
// SYNC RUN TOTALS (shared helper)
// ============================================
async function syncRunTotals(payrollRunId) {
  const totals = await PayrollEntry.aggregateTotals(payrollRunId);
  if (!totals) return;
  await PayrollRun.findByIdAndUpdate(payrollRunId, {
    "totals.employeeCount": totals.employeeCount,
    "totals.totalBasicSalary": Math.round(totals.totalBasicSalary),
    "totals.totalAllowances": Math.round(totals.totalAllowances),
    "totals.totalGrossPay": Math.round(totals.totalGrossPay),
    "totals.totalPAYE": Math.round(totals.totalPAYE),
    "totals.totalNSSF": Math.round(totals.totalNSSF),
    "totals.totalSHIF": Math.round(totals.totalSHIF || 0),
    "totals.totalHousingLevy": Math.round(totals.totalHousingLevy || 0),
    "totals.totalOtherDeductions": Math.round(totals.totalOtherDeductions),
    "totals.totalDeductions": Math.round(totals.totalDeductions),
    "totals.totalNetPay": Math.round(totals.totalNetPay),
    "totals.totalEmployerNSSF": Math.round(totals.totalEmployerNSSF || 0),
    "totals.totalEmployerAHL": Math.round(totals.totalEmployerAHL || 0),
  });
}

// ============================================
// CREATE PAYROLL RUN
// ============================================
export async function createPayrollRun(_prevState, formData) {
  let mongoSession = null;
  let createdId = null;

  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, PAYROLL_ROLES.CREATE)) {
      return { success: false, error: "You do not have permission to create payroll runs" };
    }

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    const month = parseInt(formData.get("month") || "0");
    const year = parseInt(formData.get("year") || "0");
    const notes = formData.get("notes")?.toString() || null;

    if (!month || month < 1 || month > 12) {
      return { success: false, error: "Invalid month", fieldErrors: { month: "Month must be 1–12" } };
    }
    if (!year || year < 2020) {
      return { success: false, error: "Invalid year", fieldErrors: { year: "Invalid year" } };
    }

    await dbConnect();

    // Prevent duplicate run for the same period
    const exists = await PayrollRun.existsForPeriod(tenantCompanyId, month, year);
    if (exists) {
      return { success: false, error: `A payroll run already exists for ${month}/${year}` };
    }

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    const payrollNumber = await PayrollRun.generatePayrollNumber(
      tenantCompanyId, month, year, mongoSession
    );

    const monthNames = [
      "", "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0); // Last day of month

    const [newRun] = await PayrollRun.create(
      [
        {
          companyId: tenantCompanyId,
          payrollNumber,
          period: { month, year, from, to, label: `${monthNames[month]} ${year}` },
          status: "draft",
          createdBy: { name: user.name, id: user.id },
          notes,
        },
      ],
      { session: mongoSession }
    );

    createdId = newRun._id.toString();

    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null;

    revalidatePath("/dashboard/hr/payroll");
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    return { success: false, error: error.message || "Failed to create payroll run" };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }

  redirect(`/dashboard/hr/payroll/${createdId}`);
}

// ============================================
// GENERATE PAYROLL ENTRIES
// ============================================
// Pulls all active employees and auto-calculates gross, deductions, net.
// Idempotent: safe to re-run (updates existing entries, inserts new ones).
// ============================================
export async function generatePayrollEntries(payrollRunId) {
  let mongoSession = null;

  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, PAYROLL_ROLES.CREATE)) {
      return { success: false, error: "You do not have permission to generate payroll entries" };
    }

    await dbConnect();

    const run = await PayrollRun.findOne(
      withTenantScope({ _id: payrollRunId }, companyId, isSuperAdmin)
    );
    if (!run) return { success: false, error: "Payroll run not found" };
    if (!["draft", "processing"].includes(run.status)) {
      return { success: false, error: "Entries can only be generated for draft or processing runs" };
    }

    // Load active payroll config — required for statutory rate calculations
    const payConfig = await PayrollConfig.getActive(run.companyId);
    if (!payConfig) {
      return {
        success: false,
        error: "No payroll configuration found. Set up payroll settings (PAYE brackets, SHIF rate, NSSF tiers, AHL rate) before generating entries.",
      };
    }

    // Fetch all active employees (lean — read only)
    const employees = await EmployeeProfile.find({
      companyId: run.companyId,
      "employment.status": { $in: ["active", "probation"] },
    })
      .select(
        "partyId employeeNumber personalInfo.firstName personalInfo.lastName " +
        "employment.department employment.designation employment.employmentType " +
        "employment.hireDate employment.terminationDate " +
        "compensation.basicSalary compensation.allowances compensation.currency " +
        "compensation.paymentMethod compensation.bankName compensation.bankBranch " +
        "compensation.bankAccount compensation.mpesaNumber"
      )
      .lean();

    if (employees.length === 0) {
      return { success: false, error: "No active employees found" };
    }

    // Period boundaries
    const periodFrom = new Date(run.period.year, run.period.month - 1, 1);
    const periodTo = new Date(run.period.year, run.period.month, 0, 23, 59, 59);

    // Pre-fetch holiday set once for the entire period (avoids re-fetching per employee/leave)
    const holidaySet = await PublicHoliday.getDateSet(run.companyId, periodFrom, periodTo);

    // Total working days in the period (shared for all pro-rata calculations)
    const totalWorkingDays = await countWorkingDays(run.companyId, periodFrom, periodTo, holidaySet);

    // Fetch all approved unpaid leaves overlapping this period (batch — one query for all employees)
    const partyIds = employees.map((e) => e.partyId);
    const unpaidLeaves = await LeaveRequest.find({
      companyId: run.companyId,
      "employee.partyId": { $in: partyIds },
      leaveType: "unpaid",
      status: "approved",
      "dates.from": { $lte: periodTo },
      "dates.to": { $gte: periodFrom },
    })
      .select("employee.partyId dates.from dates.to dates.totalDays")
      .lean();

    // Map partyId → unpaid leave days within the period
    const unpaidLeaveDaysMap = {};
    for (const leave of unpaidLeaves) {
      const pid = leave.employee?.partyId?.toString();
      if (!pid) continue;
      // Clip leave dates to the period
      const leaveFrom = new Date(Math.max(new Date(leave.dates.from), periodFrom));
      const leaveTo = new Date(Math.min(new Date(leave.dates.to), periodTo));
      const lwopDays = await countWorkingDays(run.companyId, leaveFrom, leaveTo, holidaySet);
      unpaidLeaveDaysMap[pid] = (unpaidLeaveDaysMap[pid] || 0) + lwopDays;
    }

    // Fetch all active loans with pending installments for this period
    const activeLoans = await Loan.getPendingInstallments(
      run.companyId, run.period.month, run.period.year
    );

    // Build map: partyId -> { loanRepayment, saccoDeduction }
    const loanDeductionMap = new Map();
    for (const loan of activeLoans) {
      const lpid = loan.partyId.toString();
      if (!loanDeductionMap.has(lpid)) {
        loanDeductionMap.set(lpid, { loanRepayment: 0, saccoDeduction: 0 });
      }
      const loanEntry = loanDeductionMap.get(lpid);
      const installment = loan.installments.find(
        (i) => i.month === run.period.month && i.year === run.period.year && i.status === "pending"
      );
      if (!installment) continue;
      if (loan.loanType === "sacco_deduction") {
        loanEntry.saccoDeduction += installment.total;
      } else {
        loanEntry.loanRepayment += installment.total;
      }
    }

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    // Update run status
    run.status = "processing";
    run.preparedBy = { name: user.name, id: user.id };
    run.preparedAt = new Date();
    await run.save({ session: mongoSession });

    // TODO: Convert to bulkWrite() for better performance with large employee counts
    // Upsert one PayrollEntry per employee
    for (const emp of employees) {
      const comp = emp.compensation || {};

      // ── Pro-rata check ──────────────────────────────────────────
      // If employee joined or left mid-month, scale salary proportionally.
      let daysWorked = totalWorkingDays;
      let isProRata = false;

      const hireDate = emp.employment?.hireDate ? new Date(emp.employment.hireDate) : null;
      const termDate = emp.employment?.terminationDate ? new Date(emp.employment.terminationDate) : null;

      const effectiveFrom = (hireDate && hireDate > periodFrom) ? hireDate : periodFrom;
      const effectiveTo = (termDate && termDate < periodTo) ? termDate : periodTo;

      if (effectiveFrom > periodFrom || effectiveTo < periodTo) {
        daysWorked = await countWorkingDays(run.companyId, effectiveFrom, effectiveTo, holidaySet);
        isProRata = true;
      }

      const proRataFraction = totalWorkingDays > 0 ? daysWorked / totalWorkingDays : 1;

      let basic = Math.round((comp.basicSalary || 0) * proRataFraction);
      let housing = Math.round((comp.allowances?.housing || 0) * proRataFraction);
      let transport = Math.round((comp.allowances?.transport || 0) * proRataFraction);
      let medical = Math.round((comp.allowances?.medical || 0) * proRataFraction);
      let otherAllowance = Math.round((comp.allowances?.other || 0) * proRataFraction);

      // ── LWOP deduction ──────────────────────────────────────────
      // Approved unpaid leave → deduct proportionate salary
      const pid = emp.partyId?.toString();
      const lwopDays = unpaidLeaveDaysMap[pid] || 0;
      let lwopDeduction = 0;
      if (lwopDays > 0 && totalWorkingDays > 0) {
        const lwopRatio = (totalWorkingDays - lwopDays) / totalWorkingDays;
        lwopDeduction = Math.round((basic + housing + transport + medical + otherAllowance) * (1 - lwopRatio));
        // Deduct proportionally from ALL earnings
        basic = Math.round(basic * lwopRatio);
        housing = Math.round(housing * lwopRatio);
        transport = Math.round(transport * lwopRatio);
        medical = Math.round(medical * lwopRatio);
        otherAllowance = Math.round(otherAllowance * lwopRatio);
      }

      const grossPay = basic + housing + transport + medical + otherAllowance;

      // NSSF based on basic salary; reduces taxable income for PAYE
      const nssfResult = calculateNSSF(basic, payConfig);
      const nssf = nssfResult.employee;
      const nssfEmployer = nssfResult.employer;

      // SHIF (flat % of gross — calculated before PAYE because it feeds insurance relief)
      const shif = calculateSHIF(grossPay, payConfig);

      // PAYE on taxable income (gross minus NSSF employee deduction)
      // Insurance relief (15% of SHIF, capped) is applied inside calculatePAYE
      const taxableMonthly = Math.max(0, grossPay - nssf);
      const { paye, insuranceRelief } = calculatePAYE(taxableMonthly, payConfig, shif);

      // Affordable Housing Levy
      const ahlResult = calculateAHL(grossPay, payConfig);
      const housingLevy = ahlResult.employee;
      const housingLevyEmployer = ahlResult.employer;

      // Loan / SACCO deductions from active loans
      const loanDed = loanDeductionMap.get(pid) || { loanRepayment: 0, saccoDeduction: 0 };

      const totalDeductions = paye + nssf + shif + housingLevy + loanDed.loanRepayment + loanDed.saccoDeduction;
      const netPay = grossPay - totalDeductions;

      const fullName = `${emp.personalInfo?.firstName || ""} ${emp.personalInfo?.lastName || ""}`.trim();

      await PayrollEntry.findOneAndUpdate(
        { payrollRunId: run._id, partyId: emp.partyId },
        {
          $setOnInsert: {
            companyId: run.companyId,
            payrollRunId: run._id,
            partyId: emp.partyId,
            profileId: emp._id,
            createdBy: { name: user.name, id: user.id },
          },
          $set: {
            period: run.period,
            employeeNumber: emp.employeeNumber,
            employeeName: fullName,
            department: emp.employment?.department,
            designation: emp.employment?.designation,
            employmentType: emp.employment?.employmentType,
            "earnings.basicSalary": basic,
            "earnings.housingAllowance": housing,
            "earnings.transportAllowance": transport,
            "earnings.medicalAllowance": medical,
            "earnings.otherAllowance": otherAllowance,
            "earnings.grossPay": grossPay,
            "deductions.paye": paye,
            "deductions.nssf": nssf,
            "deductions.shif": shif,
            "deductions.housingLevy": housingLevy,
            "deductions.insuranceRelief": insuranceRelief,
            "deductions.loanRepayment": loanDed.loanRepayment,
            "deductions.saccoDeduction": loanDed.saccoDeduction,
            "deductions.totalDeductions": totalDeductions,
            "employerContributions.nssf": nssfEmployer,
            "employerContributions.housingLevy": housingLevyEmployer,
            netPay,
            currency: comp.currency || "KES",
            paymentMethod: comp.paymentMethod || "bank",
            bankName: comp.bankName || null,
            bankBranch: comp.bankBranch || null,
            bankAccount: comp.bankAccount || null,
            mpesaNumber: comp.mpesaNumber || null,
            "workingDays.total": totalWorkingDays,
            "workingDays.worked": daysWorked - lwopDays,
            ...(isProRata && { notes: `Pro-rata: ${daysWorked}/${totalWorkingDays} days${lwopDays ? `. LWOP: ${lwopDays} days` : ""}` }),
            lastModifiedBy: { name: user.name, id: user.id },
          },
        },
        { upsert: true, session: mongoSession, new: true }
      );
    }

    // Sync aggregated totals back to the run
    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null;

    // Re-aggregate totals (outside transaction — read-only aggregate)
    await syncRunTotals(payrollRunId);

    revalidatePath(`/dashboard/hr/payroll/${payrollRunId}`);
    return { success: true, employeeCount: employees.length };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    return { success: false, error: error.message || "Failed to generate payroll entries" };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}

// ============================================
// GL JOURNAL POSTING HELPERS
// ============================================

/**
 * Fetch account details (code, name, type) for a list of account IDs.
 * Returns a Map of id.toString() → { accountCode, accountName, accountType }.
 */
async function fetchAccountDetails(accountIds) {
  const Account = mongoose.model("Account");
  const accounts = await Account.find(
    { _id: { $in: accountIds.filter(Boolean) } },
    "accountCode accountName accountType"
  ).lean();
  return new Map(accounts.map((a) => [a._id.toString(), a]));
}

/**
 * Build a journal line if the account is mapped; returns null if skipped.
 */
function jeLine(accountMap, accountId, debit, credit, description) {
  if (!accountId) return null;
  const acct = accountMap.get(accountId.toString());
  if (!acct) return null;
  if ((debit || 0) === 0 && (credit || 0) === 0) return null;
  return {
    accountId,
    accountCode: acct.accountCode,
    accountName: acct.accountName,
    accountType: acct.accountType,
    debit: debit || 0,
    credit: credit || 0,
    description,
  };
}

/**
 * Post the payroll ACCRUAL journal on approval.
 *
 * Dr salaryExpense       = totalGrossPay
 * Dr employerNssfExpense = totalEmployerNSSF
 * Dr employerAhlExpense  = totalEmployerAHL
 * Cr payePayable         = totalPAYE
 * Cr nssfPayable         = totalNSSF + totalEmployerNSSF
 * Cr shifPayable         = totalSHIF
 * Cr ahlPayable          = totalHousingLevy + totalEmployerAHL
 * Cr salaryPayable       = totalNetPay
 *
 * Skips posting gracefully if no glMapping is configured.
 * Returns the new JournalEntry _id or null if skipped.
 */
async function postPayrollAccrualJournal(run, glMapping, user) {
  if (!glMapping) return null;

  const t = run.totals || {};
  const totalGrossPay     = t.totalGrossPay || 0;
  const totalPAYE         = t.totalPAYE || 0;
  const totalNSSF         = t.totalNSSF || 0;
  const totalSHIF         = t.totalSHIF || 0;
  const totalHousingLevy  = t.totalHousingLevy || 0;
  const totalNetPay       = t.totalNetPay || 0;
  const totalEmployerNSSF = t.totalEmployerNSSF || 0;
  const totalEmployerAHL  = t.totalEmployerAHL || 0;
  const totalOtherDeductions = t.totalOtherDeductions || 0;

  // Collect all account IDs we need
  const accountIds = [
    glMapping.salaryExpense,
    glMapping.employerNssfExpense,
    glMapping.employerAhlExpense,
    glMapping.payePayable,
    glMapping.nssfPayable,
    glMapping.shifPayable,
    glMapping.ahlPayable,
    glMapping.salaryPayable,
    glMapping.staffLoansReceivable,
  ];

  // If no accounts mapped at all, skip
  if (accountIds.every((id) => !id)) return null;

  const accountMap = await fetchAccountDetails(accountIds);
  const periodLabel = run.period?.label || `${run.period?.month}/${run.period?.year}`;

  const lines = [
    jeLine(accountMap, glMapping.salaryExpense,       totalGrossPay,                          0, `Gross pay — ${periodLabel}`),
    jeLine(accountMap, glMapping.employerNssfExpense,  totalEmployerNSSF,                     0, `Employer NSSF — ${periodLabel}`),
    jeLine(accountMap, glMapping.employerAhlExpense,   totalEmployerAHL,                      0, `Employer AHL — ${periodLabel}`),
    jeLine(accountMap, glMapping.payePayable,          0,  totalPAYE,                           `PAYE payable — ${periodLabel}`),
    jeLine(accountMap, glMapping.nssfPayable,          0,  totalNSSF + totalEmployerNSSF,       `NSSF payable (employee + employer) — ${periodLabel}`),
    jeLine(accountMap, glMapping.shifPayable,          0,  totalSHIF,                           `SHIF payable — ${periodLabel}`),
    jeLine(accountMap, glMapping.ahlPayable,           0,  totalHousingLevy + totalEmployerAHL, `AHL payable (employee + employer) — ${periodLabel}`),
    jeLine(accountMap, glMapping.salaryPayable,        0,  totalNetPay,                         `Net salaries payable — ${periodLabel}`),
    // Loan/SACCO repayments — reduces Staff Loans Receivable asset
    jeLine(accountMap, glMapping.staffLoansReceivable, 0, totalOtherDeductions,                 `Staff loan/SACCO repayments — ${periodLabel}`),
  ].filter(Boolean);

  if (lines.length < 2) return null;

  // BUG-6: Verify journal is balanced before posting (catches partial GL mapping)
  const totalDebits = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.abs(totalDebits - totalCredits) > 1) {
    throw new Error(`Payroll journal is unbalanced: debits=${totalDebits}, credits=${totalCredits}. Check GL mapping — all accounts must be configured.`);
  }

  // TODO: Validate fiscal period is open before posting. Currently allows posting to closed periods.

  const seq = await ErpCounter.getNextSequence("je-pay", run.companyId);
  const entryNumber = `JE-PAY-${String(seq).padStart(4, "0")}`;

  const je = new JournalEntry({
    companyId: run.companyId,
    entryNumber,
    entryDate: new Date(),
    entryType: "payroll",
    description: `Payroll accrual — ${periodLabel} (${run.payrollNumber})`,
    reference: run.payrollNumber,
    lines,
    fiscalYear: run.period?.year,
    fiscalMonth: run.period?.month,
    createdBy: { name: user.name, id: user.id },
  });

  await je.post({ name: user.name, id: user.id });
  return je._id;
}

/**
 * Post the payroll PAYMENT CLEARING journal on marking as paid.
 *
 * Dr salaryPayable = totalNetPay
 * Cr bankAccount   = totalNetPay
 *
 * Skips gracefully if salaryPayable or bankAccount not configured.
 * Returns new JournalEntry _id or null if skipped.
 */
async function postPayrollPaymentJournal(run, glMapping, user) {
  if (!glMapping?.salaryPayable || !glMapping?.bankAccount) return null;

  const totalNetPay = run.totals?.totalNetPay || 0;
  if (totalNetPay === 0) return null;

  const accountMap = await fetchAccountDetails([glMapping.salaryPayable, glMapping.bankAccount]);
  const periodLabel = run.period?.label || `${run.period?.month}/${run.period?.year}`;

  const lines = [
    jeLine(accountMap, glMapping.salaryPayable, totalNetPay, 0,           `Salary payable cleared — ${periodLabel}`),
    jeLine(accountMap, glMapping.bankAccount,   0,           totalNetPay, `Bank payment — ${periodLabel}`),
  ].filter(Boolean);

  if (lines.length < 2) return null;

  const seq = await ErpCounter.getNextSequence("je-pay", run.companyId);
  const entryNumber = `JE-PAY-${String(seq).padStart(4, "0")}`;

  const je = new JournalEntry({
    companyId: run.companyId,
    entryNumber,
    entryDate: new Date(),
    entryType: "payroll",
    description: `Payroll payment — ${periodLabel} (${run.payrollNumber})`,
    reference: run.payrollNumber,
    lines,
    fiscalYear: run.period?.year,
    fiscalMonth: run.period?.month,
    createdBy: { name: user.name, id: user.id },
  });

  await je.post({ name: user.name, id: user.id });
  return je._id;
}

// ============================================
// UPDATE LOAN BALANCES AFTER PAYROLL APPROVAL
// ============================================
async function updateLoanBalancesAfterApproval(run) {
  const loans = await Loan.find({
    companyId: run.companyId,
    status: { $in: ["disbursed", "active"] },
    installments: {
      $elemMatch: {
        month: run.period.month,
        year: run.period.year,
        status: "pending",
      },
    },
  });

  for (const loan of loans) {
    loan.recordRepayment(run.period.month, run.period.year, run._id);
    await loan.save();
  }
}

// ============================================
// APPROVE PAYROLL RUN
// ============================================
export async function approvePayrollRun(payrollRunId) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, PAYROLL_ROLES.APPROVE)) {
      return { success: false, error: "You do not have permission to approve payroll" };
    }

    await dbConnect();

    const run = await PayrollRun.findOne(
      withTenantScope({ _id: payrollRunId }, companyId, isSuperAdmin)
    );
    if (!run) return { success: false, error: "Payroll run not found" };
    if (!["processing", "review"].includes(run.status)) {
      return { success: false, error: "Only processing or review payrolls can be approved" };
    }

    // Verify there are entries
    const entryCount = await PayrollEntry.countDocuments({ payrollRunId: run._id });
    if (entryCount === 0) {
      return { success: false, error: "Cannot approve an empty payroll run. Generate entries first." };
    }

    run.status = "approved";
    run.approvedBy = { name: user.name, id: user.id };
    run.approvedAt = new Date();
    run.lastModifiedBy = { name: user.name, id: user.id };
    await run.save();

    // Update loan balances — mark installments as deducted
    try {
      await updateLoanBalancesAfterApproval(run);
    } catch (loanErr) {
      console.error("[approvePayrollRun] Loan balance update failed:", loanErr.message);
    }

    // GL: post payroll accrual journal (optional — skipped if no glMapping)
    let glWarning = null;
    try {
      const payConfig = await PayrollConfig.getActive(run.companyId);
      const jeId = await postPayrollAccrualJournal(run, payConfig?.glMapping, user);
      if (jeId) {
        await PayrollRun.findByIdAndUpdate(run._id, { $push: { journalEntryIds: jeId } });
      }
    } catch (glErr) {
      console.error("[approvePayrollRun] GL posting failed:", glErr.message);
      glWarning = "Payroll approved but GL journal entry failed. Check GL mapping.";
    }

    revalidatePath(`/dashboard/hr/payroll/${payrollRunId}`);
    revalidatePath("/dashboard/hr/payroll");
    return { success: true, ...(glWarning && { warning: glWarning }) };
  } catch (error) {
    return { success: false, error: error.message || "Failed to approve payroll" };
  }
}

// ============================================
// VOID PAYROLL RUN (Admin only)
// ============================================
export async function voidPayrollRun(_prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, PAYROLL_ROLES.VOID)) {
      return { success: false, error: "You do not have permission to void payroll runs" };
    }

    const payrollRunId = formData.get("payrollRunId")?.toString();
    const reason = formData.get("reason")?.toString().trim();

    if (!payrollRunId) return { success: false, error: "Payroll run ID is required" };
    if (!reason) return { success: false, error: "Void reason is required", fieldErrors: { reason: "Required" } };

    await dbConnect();

    const run = await PayrollRun.findOne(
      withTenantScope({ _id: payrollRunId }, companyId, isSuperAdmin)
    );
    if (!run) return { success: false, error: "Payroll run not found" };
    if (run.status === "paid") {
      return { success: false, error: "Cannot void a payroll run that has already been paid" };
    }

    run.status = "voided";
    run.voidedBy = { name: user.name, id: user.id };
    run.voidedAt = new Date();
    run.voidReason = reason;
    run.lastModifiedBy = { name: user.name, id: user.id };
    await run.save();

    // Reverse journal entries if any exist
    if (run.journalEntryIds?.length > 0) {
      for (const jeId of run.journalEntryIds) {
        const originalJe = await JournalEntry.findById(jeId);
        if (originalJe && originalJe.status === "posted") {
          // Create reversal entry with debits/credits swapped
          const reversalLines = originalJe.lines.map(line => ({
            accountId: line.accountId,
            accountCode: line.accountCode,
            accountName: line.accountName,
            accountType: line.accountType,
            debit: line.credit,    // swap
            credit: line.debit,    // swap
            description: `Reversal — ${line.description || ""}`,
          }));

          const seq = await ErpCounter.getNextSequence("je-pay", run.companyId);
          const reversalEntryNumber = `JE-PAY-${String(seq).padStart(4, "0")}`;

          const reversalJe = new JournalEntry({
            companyId: originalJe.companyId,
            entryNumber: reversalEntryNumber,
            entryDate: new Date(),
            entryType: "payroll",
            description: `Reversal of ${originalJe.description}`,
            reference: originalJe.reference,
            lines: reversalLines,
            fiscalYear: originalJe.fiscalYear,
            fiscalMonth: originalJe.fiscalMonth,
            originalEntryId: originalJe._id,
            createdBy: { name: user.name, id: user.id },
          });

          await reversalJe.post({ name: user.name, id: user.id });

          // Mark original as reversed
          originalJe.status = "reversed";
          originalJe.reversedAt = new Date();
          originalJe.reversedBy = { name: user.name, id: user.id };
          originalJe.reversalEntryId = reversalJe._id;
          await originalJe.save();
        }
      }
    }

    revalidatePath(`/dashboard/hr/payroll/${payrollRunId}`);
    revalidatePath("/dashboard/hr/payroll");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to void payroll run" };
  }
}

// ============================================
// MARK PAYROLL AS PAID (Admin only)
// ============================================
// Transitions approved → paid and marks all entries as paid.
// ============================================
export async function markPayrollPaid(payrollRunId) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, PAYROLL_ROLES.APPROVE)) {
      return { success: false, error: "Only Admins can mark payroll as paid" };
    }

    await dbConnect();

    const run = await PayrollRun.findOne(
      withTenantScope({ _id: payrollRunId }, companyId, isSuperAdmin)
    );
    if (!run) return { success: false, error: "Payroll run not found" };
    if (run.status !== "approved") {
      return { success: false, error: "Only approved payroll runs can be marked as paid" };
    }

    run.status = "paid";
    run.paidBy = { name: user.name, id: user.id };
    run.paidAt = new Date();
    run.lastModifiedBy = { name: user.name, id: user.id };
    await run.save();

    // GL: post payment clearing journal (optional — skipped if not configured)
    let glWarning = null;
    try {
      const payConfig = await PayrollConfig.getActive(run.companyId);
      const jeId = await postPayrollPaymentJournal(run, payConfig?.glMapping, user);
      if (jeId) {
        await PayrollRun.findByIdAndUpdate(run._id, { $push: { journalEntryIds: jeId } });
      }
    } catch (glErr) {
      console.error("[markPayrollPaid] GL posting failed:", glErr.message);
      glWarning = "Payroll marked as paid but GL journal entry failed. Check GL mapping.";
    }

    // Mark all entries as paid
    await PayrollEntry.updateMany(
      { payrollRunId: run._id, paymentStatus: { $ne: "paid" } },
      {
        $set: {
          paymentStatus: "paid",
          paidAt: new Date(),
          lastModifiedBy: { name: user.name, id: user.id },
        },
      }
    );

    revalidatePath(`/dashboard/hr/payroll/${payrollRunId}`);
    revalidatePath("/dashboard/hr/payroll");
    return { success: true, ...(glWarning && { warning: glWarning }) };
  } catch (error) {
    return { success: false, error: error.message || "Failed to mark payroll as paid" };
  }
}

// ============================================
// UPDATE PAYROLL ENTRY (Admin / HR override)
// ============================================
// Allows manual adjustment of an individual employee's payroll entry.
// The PayrollEntry pre-save hook calls recalculate() automatically.
// After saving the entry, totals on the run are re-synced.
// ============================================
export async function updatePayrollEntry(_prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, PAYROLL_ROLES.CREATE)) {
      return { success: false, error: "You do not have permission to edit payroll entries" };
    }

    const entryId = formData.get("entryId")?.toString();
    const payrollRunId = formData.get("payrollRunId")?.toString();
    if (!entryId || !payrollRunId) return { success: false, error: "Entry ID is required" };

    await dbConnect();

    // Confirm the run is still editable
    const run = await PayrollRun.findOne(
      withTenantScope({ _id: payrollRunId }, companyId, isSuperAdmin)
    );
    if (!run) return { success: false, error: "Payroll run not found" };
    if (["paid", "voided", "approved"].includes(run.status)) {
      return { success: false, error: "Cannot edit entries in an approved, paid, or voided payroll run" };
    }

    const entry = await PayrollEntry.findOne({ _id: entryId, payrollRunId, companyId: run.companyId });
    if (!entry) return { success: false, error: "Payroll entry not found" };

    // Update earnings
    entry.earnings.basicSalary = parseFloat(formData.get("basicSalary") || "0");
    entry.earnings.housingAllowance = parseFloat(formData.get("housingAllowance") || "0");
    entry.earnings.transportAllowance = parseFloat(formData.get("transportAllowance") || "0");
    entry.earnings.medicalAllowance = parseFloat(formData.get("medicalAllowance") || "0");
    entry.earnings.overtime = parseFloat(formData.get("overtime") || "0");
    entry.earnings.bonus = parseFloat(formData.get("bonus") || "0");
    entry.earnings.commission = parseFloat(formData.get("commission") || "0");

    // Update deductions
    entry.deductions.paye = parseFloat(formData.get("paye") || "0");
    entry.deductions.nssf = parseFloat(formData.get("nssf") || "0");
    entry.deductions.shif = parseFloat(formData.get("shif") || "0");
    entry.deductions.housingLevy = parseFloat(formData.get("housingLevy") || "0");
    entry.deductions.insuranceRelief = parseFloat(formData.get("insuranceRelief") || "0");
    entry.deductions.loanRepayment = parseFloat(formData.get("loanRepayment") || "0");
    entry.deductions.saccoDeduction = parseFloat(formData.get("saccoDeduction") || "0");

    entry.notes = formData.get("notes")?.toString() || entry.notes;
    entry.lastModifiedBy = { name: user.name, id: user.id };

    // pre-save hook recalculates grossPay, totalDeductions, netPay automatically
    await entry.save();

    // Re-sync run totals
    await syncRunTotals(payrollRunId);

    revalidatePath(`/dashboard/hr/payroll/${payrollRunId}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to update payroll entry" };
  }
}
