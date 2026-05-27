"use server";

import { z } from "zod";
import { roleAllowed } from "@/lib/permissions";
import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  getCompanyIdForCreate,
} from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";
import Loan from "@/app/models/loan";
import EmployeeProfile from "@/app/models/employeeProfile";
import JournalEntry from "@/app/models/JournalEntry";
import ErpCounter from "@/app/models/erp-counter";

// ============================================
// ZOD SCHEMAS
// ============================================
const CreateLoanSchema = z.object({
  partyId: z.string().min(1, "Employee is required"),
  loanType: z.enum(["salary_advance", "staff_loan", "sacco_deduction"], {
    errorMap: () => ({ message: "Select a valid loan type" }),
  }),
  principalAmount: z
    .number({ invalid_type_error: "Amount must be a number" })
    .positive("Amount must be greater than zero")
    .max(50_000_000, "Amount exceeds maximum limit"),
  tenure: z
    .number({ invalid_type_error: "Tenure must be a number" })
    .int("Tenure must be a whole number")
    .min(1, "Minimum 1 month")
    .max(120, "Maximum 120 months"),
  interestRate: z
    .number()
    .min(0, "Interest rate cannot be negative")
    .max(1, "Interest rate must be a decimal (e.g., 0.12 for 12%)")
    .default(0),
  interestType: z.enum(["none", "flat", "reducing_balance"]).default("none"),
  startMonth: z
    .number({ invalid_type_error: "Start month is required" })
    .int()
    .min(1, "Month must be 1-12")
    .max(12, "Month must be 1-12"),
  startYear: z
    .number({ invalid_type_error: "Start year is required" })
    .int()
    .min(2015, "Year must be 2015 or later")
    .max(2200, "Year too far in the future"),
  purpose: z.string().max(500, "Purpose too long").optional().default(""),
  notes: z.string().max(500, "Notes too long").optional().default(""),
});

const DisburseLoanSchema = z.object({
  loanId: z.string().min(1, "Loan ID is required"),
  disbursementMethod: z.enum(["bank", "mpesa", "cash", "cheque"], {
    errorMap: () => ({ message: "Select a disbursement method" }),
  }),
  disbursementRef: z.string().max(100).optional().default(""),
  bankAccountId: z.string().min(1, "Bank/Cash account is required"),
  staffLoansAccountId: z
    .string()
    .min(1, "Staff Loans Receivable account is required"),
});

const RejectLoanSchema = z.object({
  loanId: z.string().min(1, "Loan ID is required"),
  rejectionReason: z
    .string()
    .min(3, "Rejection reason is required (min 3 characters)")
    .max(500),
});

// ============================================
// ROLE AUTHORIZATION
// ============================================
const LOAN_ROLES = {
  CREATE: ["SuperAdmin", "Admin", "HR", "Employee"],
  APPROVE: ["SuperAdmin", "Admin", "HR", "CFO", "Finance Manager"],
  // Disbursement releases cash — finance leadership in addition to Admin.
  DISBURSE: ["SuperAdmin", "Admin", "CFO", "Finance Manager"],
  VIEW_ALL: ["SuperAdmin", "Admin", "HR", "Accountant", "CFO", "Finance Manager"],
};

function hasRole(user, roles) {
  return roleAllowed(user?.role, roles);
}

// ============================================
// GL JOURNAL HELPERS (mirrors hr-payroll-actions pattern)
// ============================================

/**
 * Fetch account details for a list of account IDs.
 * Returns a Map of id.toString() -> { accountCode, accountName, accountType }.
 */
async function fetchAccountDetails(accountIds) {
  const Account = mongoose.model("Account");
  const accounts = await Account.find(
    { _id: { $in: accountIds.filter(Boolean) } },
    "accountCode accountName accountType",
  ).lean();
  return new Map(accounts.map((a) => [a._id.toString(), a]));
}

/**
 * Build a journal line; returns null if the account is not mapped or amount is zero.
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

// ============================================
// CREATE LOAN REQUEST
// ============================================
export async function createLoanRequest(_prevState, formData) {
  let mongoSession = null;

  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, LOAN_ROLES.CREATE)) {
      return {
        success: false,
        error: "You do not have permission to create loan requests",
      };
    }

    const tenantCompanyId = getCompanyIdForCreate(
      null,
      companyId,
      isSuperAdmin,
    );

    // Parse and validate with Zod
    const parsed = CreateLoanSchema.safeParse({
      partyId: formData.get("partyId")?.toString(),
      loanType: formData.get("loanType")?.toString(),
      principalAmount: parseFloat(formData.get("principalAmount")) || 0,
      tenure: parseInt(formData.get("tenure"), 10) || 0,
      interestRate: parseFloat(formData.get("interestRate") || "0"),
      interestType: formData.get("interestType")?.toString() || "none",
      startMonth: parseInt(formData.get("startMonth"), 10) || 0,
      startYear: parseInt(formData.get("startYear"), 10) || 0,
      purpose: formData.get("purpose")?.toString() || "",
      notes: formData.get("notes")?.toString() || "",
    });

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      const firstError = Object.values(fieldErrors).flat()[0];
      return {
        success: false,
        error: firstError || "Invalid input",
        fieldErrors,
      };
    }

    const {
      partyId,
      loanType,
      principalAmount,
      tenure,
      interestRate,
      interestType,
      startMonth,
      startYear,
      purpose,
      notes,
    } = parsed.data;

    await dbConnect();

    // Ownership check -- Employee role can only request for themselves
    if (!["Admin", "HR", "Manager", "SuperAdmin"].includes(user.role)) {
      const profile = await EmployeeProfile.findOne({
        companyId: tenantCompanyId,
        partyId,
      })
        .select("userId")
        .lean();
      if (!profile || profile.userId?.toString() !== user.id) {
        return {
          success: false,
          error: "You can only create loan requests for yourself",
        };
      }
    }

    // Look up employee profile to snapshot name, number, department
    const profile = await EmployeeProfile.findOne({
      companyId: tenantCompanyId,
      partyId,
    })
      .select("firstName lastName employeeNumber department partyId")
      .lean();

    if (!profile) {
      return { success: false, error: "Employee profile not found" };
    }

    const employeeName = [profile.firstName, profile.lastName]
      .filter(Boolean)
      .join(" ");

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    // Generate loan number
    const loanNumber = await Loan.generateLoanNumber(
      tenantCompanyId,
      mongoSession,
    );

    // Create Loan document
    const loan = new Loan({
      companyId: tenantCompanyId,
      loanNumber,
      loanType,
      partyId,
      profileId: profile._id,
      employeeName,
      employeeNumber: profile.employeeNumber,
      department: profile.department,
      principalAmount,
      interestRate,
      interestType,
      tenure,
      startMonth,
      startYear,
      purpose,
      notes,
      requestedAt: new Date(),
      requestedBy: { name: user.name, id: user.id },
      createdBy: { name: user.name, id: user.id },
      // SACCO deductions auto-approve
      status: loanType === "sacco_deduction" ? "approved" : "pending_approval",
    });

    if (loanType === "sacco_deduction") {
      loan.approvedAt = new Date();
      loan.approvedBy = { name: "System", id: "system" };
    }

    // Generate installment schedule
    loan.generateSchedule();

    await loan.save({ session: mongoSession });
    await mongoSession.commitTransaction();

    revalidatePath("/dashboard/hr/loans");

    return { success: true, loanId: loan._id.toString() };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    console.error("createLoanRequest error:", error);
    return {
      success: false,
      error: error.message || "Failed to create loan request",
    };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}

// ============================================
// APPROVE LOAN
// ============================================
export async function approveLoan(loanId) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, LOAN_ROLES.APPROVE)) {
      return {
        success: false,
        error: "You do not have permission to approve loans",
      };
    }

    await dbConnect();

    const filter = isSuperAdmin ? { _id: loanId } : { _id: loanId, companyId };

    const loan = await Loan.findOne(filter);
    if (!loan) {
      return { success: false, error: "Loan not found" };
    }

    if (loan.status !== "pending_approval") {
      return {
        success: false,
        error: `Cannot approve a loan with status "${loan.status}"`,
      };
    }

    loan.status = "approved";
    loan.approvedAt = new Date();
    loan.approvedBy = { name: user.name, id: user.id };
    loan.lastModifiedBy = { name: user.name, id: user.id };

    await loan.save();

    revalidatePath("/dashboard/hr/loans");
    return { success: true };
  } catch (error) {
    console.error("approveLoan error:", error);
    return { success: false, error: error.message || "Failed to approve loan" };
  }
}

// ============================================
// REJECT LOAN
// ============================================
export async function rejectLoan(_prevState, formData) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, LOAN_ROLES.APPROVE)) {
      return {
        success: false,
        error: "You do not have permission to reject loans",
      };
    }

    const parsed = RejectLoanSchema.safeParse({
      loanId: formData.get("loanId")?.toString(),
      rejectionReason: formData.get("rejectionReason")?.toString(),
    });

    if (!parsed.success) {
      const firstError = Object.values(
        parsed.error.flatten().fieldErrors,
      ).flat()[0];
      return { success: false, error: firstError || "Invalid input" };
    }

    const { loanId, rejectionReason } = parsed.data;

    await dbConnect();

    const filter = isSuperAdmin ? { _id: loanId } : { _id: loanId, companyId };

    const loan = await Loan.findOne(filter);
    if (!loan) {
      return { success: false, error: "Loan not found" };
    }

    if (loan.status !== "pending_approval") {
      return {
        success: false,
        error: `Cannot reject a loan with status "${loan.status}"`,
      };
    }

    loan.status = "rejected";
    loan.rejectedAt = new Date();
    loan.rejectionReason = rejectionReason;
    loan.lastModifiedBy = { name: user.name, id: user.id };

    await loan.save();

    revalidatePath("/dashboard/hr/loans");
    return { success: true };
  } catch (error) {
    console.error("rejectLoan error:", error);
    return { success: false, error: error.message || "Failed to reject loan" };
  }
}

// ============================================
// DISBURSE LOAN (with journal entry)
// ============================================
export async function disburseLoan(_prevState, formData) {
  let mongoSession = null;

  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, LOAN_ROLES.DISBURSE)) {
      return {
        success: false,
        error: "You do not have permission to disburse loans",
      };
    }

    const parsed = DisburseLoanSchema.safeParse({
      loanId: formData.get("loanId")?.toString(),
      disbursementMethod: formData.get("disbursementMethod")?.toString(),
      disbursementRef: formData.get("disbursementRef")?.toString() || "",
      bankAccountId: formData.get("bankAccountId")?.toString(),
      staffLoansAccountId: formData.get("staffLoansAccountId")?.toString(),
    });

    if (!parsed.success) {
      const firstError = Object.values(
        parsed.error.flatten().fieldErrors,
      ).flat()[0];
      return {
        success: false,
        error: firstError || "Invalid disbursement data",
      };
    }

    const {
      loanId,
      disbursementMethod,
      disbursementRef,
      bankAccountId,
      staffLoansAccountId,
    } = parsed.data;

    await dbConnect();

    const filter = isSuperAdmin ? { _id: loanId } : { _id: loanId, companyId };

    const loan = await Loan.findOne(filter);
    if (!loan) {
      return { success: false, error: "Loan not found" };
    }

    if (loan.status !== "approved") {
      return {
        success: false,
        error: `Cannot disburse a loan with status "${loan.status}". Loan must be approved first.`,
      };
    }

    // Fetch account details for journal lines
    const accountMap = await fetchAccountDetails([
      staffLoansAccountId,
      bankAccountId,
    ]);

    const debitLine = jeLine(
      accountMap,
      staffLoansAccountId,
      loan.principalAmount,
      0,
      `Staff loan receivable — ${loan.employeeName} — ${loan.loanNumber}`,
    );
    const creditLine = jeLine(
      accountMap,
      bankAccountId,
      0,
      loan.principalAmount,
      `Loan disbursement — ${loan.employeeName} — ${loan.loanNumber}`,
    );

    if (!debitLine || !creditLine) {
      return {
        success: false,
        error:
          "Could not resolve GL accounts. Ensure both accounts exist and are active.",
      };
    }

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    // Create journal entry (follows hr-payroll-actions pattern)
    const seq = await ErpCounter.getNextSequence(
      "je-loan",
      loan.companyId,
      mongoSession,
    );
    const entryNumber = `JE-LOAN-${String(seq).padStart(4, "0")}`;

    const je = new JournalEntry({
      companyId: loan.companyId,
      entryNumber,
      entryDate: new Date(),
      entryType: "loan_disbursement",
      description: `Loan disbursement — ${loan.employeeName} — ${loan.loanNumber}`,
      reference: loan.loanNumber,
      party: {
        type: "employee",
        id: loan.partyId.toString(),
        name: loan.employeeName,
      },
      lines: [debitLine, creditLine],
      fiscalYear: new Date().getFullYear(),
      fiscalMonth: new Date().getMonth() + 1,
      createdBy: { name: user.name, id: user.id },
    });

    // Post the journal entry (validates balance, accounts, fiscal period)
    await je.post({ name: user.name, id: user.id }, mongoSession);

    // Update loan record
    loan.status = "active";
    loan.disbursedAt = new Date();
    loan.disbursedBy = { name: user.name, id: user.id };
    loan.disbursementMethod = disbursementMethod;
    loan.disbursementRef = disbursementRef;
    loan.disbursementJournalId = je._id;
    loan.journalEntryIds = [je._id];
    loan.glMapping = {
      staffLoansReceivable: staffLoansAccountId,
      bankAccount: bankAccountId,
    };
    loan.lastModifiedBy = { name: user.name, id: user.id };

    await loan.save({ session: mongoSession });
    await mongoSession.commitTransaction();

    revalidatePath("/dashboard/hr/loans");
    return { success: true };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    console.error("disburseLoan error:", error);
    return {
      success: false,
      error: error.message || "Failed to disburse loan",
    };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}

// ============================================
// CANCEL LOAN
// ============================================
export async function cancelLoan(loanId) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, LOAN_ROLES.APPROVE)) {
      return {
        success: false,
        error: "You do not have permission to cancel loans",
      };
    }

    await dbConnect();

    const filter = isSuperAdmin ? { _id: loanId } : { _id: loanId, companyId };

    const loan = await Loan.findOne(filter);
    if (!loan) {
      return { success: false, error: "Loan not found" };
    }

    // Only allow cancellation if no installments have been deducted
    const hasDeductions = loan.installments.some(
      (i) => i.status === "deducted",
    );
    if (hasDeductions) {
      return {
        success: false,
        error:
          "Cannot cancel a loan that has repayments already deducted. Consider writing it off instead.",
      };
    }

    // Allow cancellation from these statuses
    const cancellableStatuses = [
      "pending_approval",
      "approved",
      "disbursed",
      "active",
    ];
    if (!cancellableStatuses.includes(loan.status)) {
      return {
        success: false,
        error: `Cannot cancel a loan with status "${loan.status}"`,
      };
    }

    loan.status = "cancelled";
    loan.lastModifiedBy = { name: user.name, id: user.id };

    await loan.save();

    revalidatePath("/dashboard/hr/loans");
    return { success: true };
  } catch (error) {
    console.error("cancelLoan error:", error);
    return { success: false, error: error.message || "Failed to cancel loan" };
  }
}

// ============================================
// READ FUNCTIONS (not server actions)
// ============================================

/**
 * Get paginated list of loans for the company.
 * @param {object} filters - { status, loanType, search, page, limit }
 */
export async function getLoans(filters = {}) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, LOAN_ROLES.VIEW_ALL) && user.role !== "Employee") {
      return { success: false, error: "Access denied", loans: [], total: 0 };
    }

    await dbConnect();

    const page = Math.max(1, parseInt(filters.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const query = isSuperAdmin ? {} : { companyId };

    // Employee role: only see their own loans
    if (user.role === "Employee") {
      const profile = await EmployeeProfile.findOne({
        companyId,
        userId: user.id,
      })
        .select("partyId")
        .lean();
      if (!profile) {
        return { success: true, loans: [], total: 0, page, limit };
      }
      query.partyId = profile.partyId;
    }

    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.loanType) {
      query.loanType = filters.loanType;
    }
    if (filters.search) {
      const searchRegex = new RegExp(filters.search, "i");
      query.$or = [
        { loanNumber: searchRegex },
        { employeeName: searchRegex },
        { employeeNumber: searchRegex },
      ];
    }

    const [loans, total] = await Promise.all([
      Loan.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Loan.countDocuments(query),
    ]);

    return { success: true, loans, total, page, limit };
  } catch (error) {
    console.error("getLoans error:", error);
    return { success: false, error: error.message, loans: [], total: 0 };
  }
}

/**
 * Get a single loan by ID with all details.
 */
export async function getLoanById(loanId) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    await dbConnect();

    const filter = isSuperAdmin ? { _id: loanId } : { _id: loanId, companyId };

    const loan = await Loan.findOne(filter).lean();
    if (!loan) {
      return { success: false, error: "Loan not found", loan: null };
    }

    // Employee role: ownership check
    if (user.role === "Employee") {
      const profile = await EmployeeProfile.findOne({
        companyId,
        userId: user.id,
      })
        .select("partyId")
        .lean();
      if (
        !profile ||
        profile.partyId?.toString() !== loan.partyId?.toString()
      ) {
        return { success: false, error: "Access denied", loan: null };
      }
    }

    return { success: true, loan };
  } catch (error) {
    console.error("getLoanById error:", error);
    return { success: false, error: error.message, loan: null };
  }
}

/**
 * Get all loans for a specific employee.
 */
export async function getEmployeeLoans(partyId) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    await dbConnect();

    // Employee role: ownership check
    if (user.role === "Employee") {
      const profile = await EmployeeProfile.findOne({
        companyId,
        userId: user.id,
      })
        .select("partyId")
        .lean();
      if (!profile || profile.partyId?.toString() !== partyId) {
        return { success: false, error: "Access denied", loans: [] };
      }
    } else if (!hasRole(user, LOAN_ROLES.VIEW_ALL)) {
      return { success: false, error: "Access denied", loans: [] };
    }

    const query = isSuperAdmin ? { partyId } : { companyId, partyId };

    const loans = await Loan.find(query).sort({ createdAt: -1 }).lean();

    return { success: true, loans };
  } catch (error) {
    console.error("getEmployeeLoans error:", error);
    return { success: false, error: error.message, loans: [] };
  }
}
