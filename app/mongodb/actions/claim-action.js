"use server";

import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import EmployeeClaim from "../../models/employeesClaims";
import Company from "../../models/Company";
import Party from "../../models/parties";
import EmployeeProfile from "../../models/employeeProfile";
import Account from "../../models/account";
import JournalEntry from "../../models/JournalEntry";
import ErpCounter from "../../models/erp-counter";
import Project from "../../models/project";
import { format } from "date-fns";
import dbConnect from "../../config/dbConnect";
import { generateUniqueEntryNumber } from "@/lib/utils/server-utils";
import {
  advanceRequestSchema,
  expenseItemSchema,
  reimbursementSchema,
} from "../validators";
import { z } from "zod";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";
import User from "../../models/user";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
const settleAdvanceSchema = z.object({
  items: z
    .array(expenseItemSchema)
    .min(1, "At least one expense item is required")
    .max(50, "Maximum 50 expense items allowed"),
  notes: z.string().max(500, "Notes too long").optional().or(z.literal("")),
});

// ============================================
// HELPER: Revalidate project pages if claim has a projectId
// ============================================
function revalidateProject(projectId) {
  if (projectId) {
    revalidatePath("/dashboard/projects");
    revalidatePath(`/dashboard/projects/${projectId}`);
  }
}

// ============================================
// HELPER: Parse receipt uploads from form data
// ============================================
function parseReceipts(formData, user) {
  try {
    const receiptsJson = formData.get("receipts");
    if (receiptsJson) {
      const parsed = JSON.parse(receiptsJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((r) => ({
          filename: r.filename,
          url: r.url,
          size: r.size,
          mimeType: r.mimeType,
          uploadedBy: {
            name: user?.name || user?.email || "System",
            id: user?.id || user?._id?.toString() || "system",
          },
        }));
      }
    }
  } catch {}
  return [];
}

// ============================================
// HELPER: Get or auto-create employee party
// ============================================
async function getOrCreateEmployeeParty(user, tenantCompanyId, isSuperAdmin, session) {
  let party = await Party.findOne(
    withTenantScope(
      { userId: user.id, type: "employee" },
      tenantCompanyId,
      isSuperAdmin,
    ),
  ).session(session);

  if (!party) {
    // Auto-create employee party — Party is the financial identity only.
    // Department/designation are HR data and live in EmployeeProfile, not here.
    const created = await Party.create(
      [
        {
          companyId: tenantCompanyId,
          type: "employee",
          userId: user.id,
          name: user.name || user.email,
          email: user.email,
          createdBy: { name: "System", id: "system" },
        },
      ],
      { session },
    );
    party = created[0];
  }

  return party;
}

// Fetch HR snapshot data from EmployeeProfile (source of truth for department/designation).
// Falls back to empty strings if user has no profile yet.
async function getEmployeeHRSnapshot(partyId, session) {
  const profile = await EmployeeProfile.findOne({ partyId })
    .select("employeeNumber employment.department employment.designation")
    .session(session)
    .lean();
  return {
    employeeNumber: profile?.employeeNumber || "",
    department: profile?.employment?.department || "",
    designation: profile?.employment?.designation || "",
  };
}

// ============================================
// HELPER: Format user for audit trail
// ============================================
function formatUserForAudit(user) {
  if (!user) {
    return { name: "System", id: "system" };
  }
  return {
    name: user.name || user.username || "Unknown User",
    id: user.id || user._id?.toString() || "unknown",
  };
}

// ============================================
// HELPER: Derive company code from name
// ============================================
function deriveCompanyCode(name) {
  if (!name) return null;

  const words = name.trim().split(/\s+/);

  if (words.length >= 2) {
    // Multiple words: take first letter of each (up to 4)
    return words
      .slice(0, 4)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  } else {
    // Single word: take first 3-4 characters
    return name.slice(0, 3).toUpperCase();
  }
}

// ============================================
// HELPER: Resolve expense accounts from items by expenseAccountId
// ============================================
async function resolveExpenseAccounts(items, session) {
  const accountMap = {};
  for (const item of items) {
    const accountId = item.expenseAccountId;
    if (accountId && !accountMap[accountId]) {
      const account = await Account.findById(accountId).session(session);
      if (!account) {
        throw new Error(
          `Expense account not found for "${item.category}". Ask your admin to create it.`,
        );
      }
      accountMap[accountId] = account;
    }
  }
  return accountMap;
}

// ============================================
// HELPER: Generate claim number (tenant-scoped)
// ============================================
async function generateClaimNumber(tenantCompanyId, session) {
  const today = format(new Date(), "yyyyMM");

  // Fetch company code for prefix
  let companyCode = null;
  if (tenantCompanyId) {
    const company = await Company.findById(tenantCompanyId)
      .select("code name")
      .lean();

    if (company) {
      // Use explicit code if set, otherwise derive from company name
      companyCode = company.code || deriveCompanyCode(company.name);
    }
  }

  // Build tenant-scoped counter name
  const counterName = companyCode
    ? `claim-${companyCode.toLowerCase()}-${today}`
    : `claim-${today}`;

  // Use ErpCounter.getNextSequence for proper tenant-scoped counter
  const seq = await ErpCounter.getNextSequence(
    counterName,
    tenantCompanyId,
    session,
  );

  // Format: CLAIM-{CODE}-{YYYYMM}-{NNNN} or CLAIM-{YYYYMM}-{NNNN}
  const prefix = companyCode ? `CLAIM-${companyCode}` : "CLAIM";
  return `${prefix}-${today}-${String(seq).padStart(4, "0")}`;
}
const paymentSchema = z.object({
  paymentAccountId: z.string().min(1, "Please select a payment account"),
  paymentMethod: z
    .enum(["cash", "bank", "mpesa"])
    .optional(),
  paymentReference: z
    .string()
    .max(100, "Reference too long")
    .optional()
    .or(z.literal("")),
  paymentNotes: z
    .string()
    .max(500, "Notes too long")
    .optional()
    .or(z.literal("")),
});
// ============================================
// 1. CREATE ADVANCE REQUEST
// ============================================
export async function createAdvanceRequest(prevState, formData) {
  let session;

  try {
    await dbConnect();

    // Auth check with tenant context
    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    // Get tenant companyId for create
    let tenantCompanyId;
    try {
      tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    session = await mongoose.startSession();
    session.startTransaction();

    // ── On-behalf: finance roles may record an advance FOR an employee —
    // captures "manual" advances at the source instead of off the books.
    // The claim belongs to the employee; createdBy stays the recorder.
    let subjectUser = user;
    const onBehalfUserId = (formData.get("onBehalfUserId") || "").toString().trim();
    if (onBehalfUserId && onBehalfUserId !== user.id) {
      if (!FINANCE_WRITE_ROLES.includes(user.role)) {
        await session.abortTransaction();
        return { errors: { _form: ["Only finance roles can record an advance on behalf of an employee."] } };
      }
      if (!mongoose.Types.ObjectId.isValid(onBehalfUserId)) {
        await session.abortTransaction();
        return { errors: { _form: ["Invalid employee selected."] } };
      }
      const target = await User.findOne(
        withTenantScope({ _id: onBehalfUserId, status: "Active" }, tenantCompanyId, isSuperAdmin),
      )
        .select("name email")
        .session(session)
        .lean();
      if (!target) {
        await session.abortTransaction();
        return { errors: { _form: ["Selected employee not found."] } };
      }
      subjectUser = { id: onBehalfUserId, name: target.name, email: target.email };
    }

    // ── One open advance per employee: a new advance is blocked until the
    // previous one is settled or closed — unsettled advances are company
    // assets and must not pile up.
    const openAdvance = await EmployeeClaim.findOne(
      withTenantScope(
        {
          claimType: "advance_request",
          "employee.userId": subjectUser.id,
          status: { $nin: ["rejected", "closed"] },
        },
        tenantCompanyId,
        isSuperAdmin,
      ),
    )
      .select("claimNumber status")
      .session(session)
      .lean();
    if (openAdvance) {
      await session.abortTransaction();
      return {
        errors: {
          _form: [
            `${subjectUser.id === user.id ? "You" : subjectUser.name} already ${subjectUser.id === user.id ? "have" : "has"} an open advance (${openAdvance.claimNumber}, ${openAdvance.status}). Settle it before requesting another.`,
          ],
        },
      };
    }

    // Get or auto-create employee party record (tenant-scoped)
    const party = await getOrCreateEmployeeParty(subjectUser, tenantCompanyId, isSuperAdmin, session);

    // Extract form data early (keep raw values for form persistence on errors)
    const rawValues = {
      advanceType: formData.get("advanceType") || "travel",
      requestedAmount: formData.get("requestedAmount"),
      purpose: formData.get("purpose"),
      destination: formData.get("destination"),
      travelFromDate: formData.get("travelFromDate"),
      travelToDate: formData.get("travelToDate"),
      projectId: formData.get("projectId") || "",
      estimatedExpenses: formData.get("estimatedExpenses"),
      notes: formData.get("notes"),
    };

    const requestedAmount = parseFloat(rawValues.requestedAmount);
    const {
      advanceType,
      purpose,
      destination,
      travelFromDate,
      travelToDate,
      projectId: rawProjectId,
      estimatedExpenses,
      notes,
    } = rawValues;

    const validatedFields = advanceRequestSchema.safeParse({
      advanceType,
      requestedAmount,
      purpose,
      destination,
      travelFromDate,
      travelToDate,
      projectId: rawProjectId,
      estimatedExpenses,
      notes,
    });

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      console.log("Validation errors:", JSON.stringify(fieldErrors, null, 2));
      console.log("Raw values:", JSON.stringify(rawValues, null, 2));
      return {
        errors: fieldErrors,
        values: rawValues,
      };
    }

    const data = validatedFields.data;

    // Generate claim number (tenant-scoped)
    const claimNumber = await generateClaimNumber(tenantCompanyId, session);

    // Fetch HR snapshot from EmployeeProfile — source of truth for department/designation
    const hrSnapshot = await getEmployeeHRSnapshot(party._id, session);

    // Build advanceDetails based on type
    const advanceDetails = {
      advanceType: data.advanceType,
      requestedAmount,
      purpose: data.purpose.trim(),
      estimatedExpenses: data.estimatedExpenses?.trim() || "",
    };

    // Add travel-specific fields only for travel type
    if (data.advanceType === "travel") {
      advanceDetails.destination = data.destination?.trim() || "";
      advanceDetails.travelDates = {
        from: new Date(data.travelFromDate),
        to: new Date(data.travelToDate),
      };
    }

    // Look up project if provided (optional)
    let projectFields = {};
    const projectId = rawValues.projectId;
    if (projectId) {
      const project = await Project.findById(projectId).select("projectNumber name status").lean();
      if (project && project.status !== "closed") {
        projectFields = {
          projectId: project._id,
          project: { projectNumber: project.projectNumber, name: project.name },
        };
      }
    }

    // Create claim
    const claim = await EmployeeClaim.create(
      [
        {
          companyId: tenantCompanyId,
          claimNumber,
          claimDate: new Date(),
          employee: {
            userId: subjectUser.id,
            partyId: party._id,
            name: subjectUser.name,
            employeeNumber: hrSnapshot.employeeNumber,
            department: hrSnapshot.department,
            email: subjectUser.email,
          },
          claimType: "advance_request",
          advanceDetails,
          ...projectFields,
          totalAmount: requestedAmount,
          description: `${data.advanceType.replace("_", " ")} advance for ${data.purpose.trim()}`,
          notes: data.notes?.trim() || "",
          status: "draft",
          createdBy: formatUserForAudit(user),
        },
      ],
      { session },
    );

    // Submit immediately
    await claim[0].submit(formatUserForAudit(user));

    await session.commitTransaction();

    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/my-claims");
    revalidateProject(claim[0].projectId);

    return {
      success: true,
      message: "Advance request submitted successfully",
      claimId: claim[0]._id.toString(),
      claimNumber: claim[0].claimNumber,
    };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error creating advance request:", error);
    return {
      errors: {
        _form: [
          error.message ||
            "Failed to create advance request. Please try again.",
        ],
      },
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// 2. CREATE REIMBURSEMENT CLAIM
// ============================================
export async function createReimbursement(prevState, formData) {
  let session;

  try {
    await dbConnect();

    // Auth check with tenant context
    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    // Get tenant companyId for create
    let tenantCompanyId;
    try {
      tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    session = await mongoose.startSession();
    session.startTransaction();

    // Get or auto-create employee's party record (tenant-scoped)
    const party = await getOrCreateEmployeeParty(user, tenantCompanyId, isSuperAdmin, session);

    // Extract form data early (keep raw values for form persistence on errors)
    const description = formData.get("description");
    const notes = formData.get("notes");
    const itemsJson = formData.get("items");
    const receipts = parseReceipts(formData, user);
    const rawProjectId = formData.get("projectId") || "";
    const rawValues = { description, notes, projectId: rawProjectId };

    // Validation
    let parsedItems;
    try {
      parsedItems = JSON.parse(itemsJson);
    } catch (error) {
      return {
        errors: {
          _form: ["Invalid items data. Please try again."],
        },
        values: rawValues,
      };
    }

    const validatedFields = reimbursementSchema.safeParse({
      description,
      notes,
      items: parsedItems,
    });

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        values: rawValues,
      };
    }

    // Use already-parsed items
    const items = parsedItems;

    // Validate items
    const validatedItems = items.map((item, index) => {
      if (!item.date || !item.category || !item.description || !item.amount) {
        return {
          errors: {
            _form: [
              `Item ${
                index + 1
              }: All fields (date, category, description, amount) are required`,
            ],
          },
        };
      }

      const amount = parseFloat(item.amount);
      if (isNaN(amount) || amount <= 0) {
        return {
          errors: {
            _form: [
              `Item ${index + 1}: Amount must be a number greater than zero`,
            ],
          },
        };
      }

      return {
        date: new Date(item.date),
        category: item.category,
        expenseAccountId: item.expenseAccountId || null,
        description: item.description.trim(),
        amount: amount,
        receipt: item.receipt || {},
        notes: item.notes?.trim() || "",
      };
    });

    // Calculate total
    const totalAmount = validatedItems.reduce(
      (sum, item) => sum + item.amount,
      0,
    );

    // Generate claim number (tenant-scoped)
    const claimNumber = await generateClaimNumber(tenantCompanyId, session);

    // Fetch HR snapshot from EmployeeProfile — source of truth for department/designation
    const hrSnapshot = await getEmployeeHRSnapshot(party._id, session);

    // Look up project if provided (optional)
    let projectFields = {};
    if (rawProjectId) {
      const project = await Project.findById(rawProjectId).select("projectNumber name status").lean();
      if (project && project.status !== "closed") {
        projectFields = {
          projectId: project._id,
          project: { projectNumber: project.projectNumber, name: project.name },
        };
      }
    }

    // Create claim
    const claim = await EmployeeClaim.create(
      [
        {
          companyId: tenantCompanyId,
          claimNumber,
          claimDate: new Date(),
          employee: {
            userId: user.id,
            partyId: party._id,
            name: user.name,
            employeeNumber: hrSnapshot.employeeNumber,
            department: hrSnapshot.department,
            email: user.email,
          },
          claimType: "reimbursement",
          items: validatedItems,
          ...projectFields,
          totalAmount,
          description: description.trim(),
          notes: notes?.trim() || "",
          receipts,
          status: "draft",
          createdBy: formatUserForAudit(user),
        },
      ],
      { session },
    );

    // Submit immediately
    await claim[0].submit(formatUserForAudit(user));

    await session.commitTransaction();

    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/my-claims");
    revalidateProject(claim[0].projectId);

    return {
      success: true,
      message: "Reimbursement claim submitted successfully",
      claimId: claim[0]._id.toString(),
      claimNumber: claim[0].claimNumber,
    };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error creating reimbursement:", error);

    // Try to preserve form values even on unexpected errors
    let values;
    try {
      values = {
        description: formData.get("description"),
        notes: formData.get("notes"),
      };
    } catch {}

    return {
      errors: {
        _form: [
          error.message ||
            "Failed to create reimbursement claim. Please try again.",
        ],
      },
      values,
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// 3. APPROVE CLAIM (Manager)
// ============================================
export async function approveEmployeeClaim(claimId, prevState, formData) {
  let session;

  try {
    await requirePlanAccess("all-claims");
    await dbConnect();

    // Auth check with tenant context
    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      throw new Error(error.message);
    }

    const userRole = user.role?.toLowerCase();

    // Check permissions
    if (
      !["manager", "admin", "cfo", "finance manager", "superadmin"].includes(
        userRole,
      )
    ) {
      throw new Error("You don't have permission to approve claims");
    }

    session = await mongoose.startSession();
    session.startTransaction();

    // Get claim (tenant-scoped)
    const claim = await EmployeeClaim.findOne(
      withTenantScope({ _id: claimId }, companyId, isSuperAdmin),
    ).session(session);

    if (!claim) {
      throw new Error("Claim not found");
    }

    // Check if can approve
    if (claim.status !== "submitted") {
      throw new Error("Can only approve submitted claims");
    }

    // Approve
    await claim.approve(formatUserForAudit(user));

    // Update project financials: increase committed
    if (claim.projectId) {
      await Project.findByIdAndUpdate(
        claim.projectId,
        { $inc: { "financials.totalCommitted": claim.totalAmount } },
        { session },
      );
    }

    await session.commitTransaction();

    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/claims/pending");
    revalidatePath("/dashboard/claims/payments");
    revalidatePath(`/dashboard/claims/${claimId}`);
    revalidateProject(claim.projectId);

    return { message: "success" };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error approving claim:", error);
    return {
      message: error.message || "Failed to approve claim",
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// 4. REJECT CLAIM (Manager)
// ============================================
export async function rejectEmployeeClaim(claimId, prevState, formData) {
  let session;

  try {
    await dbConnect();

    // Auth check with tenant context
    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      throw new Error(error.message);
    }

    const userRole = user.role?.toLowerCase();

    // Check permissions
    if (
      !["manager", "admin", "cfo", "finance manager", "superadmin"].includes(
        userRole,
      )
    ) {
      throw new Error("You don't have permission to reject claims");
    }

    const reason = formData.get("reason");

    if (!reason || reason.trim().length < 10) {
      throw new Error(
        "Please provide a detailed reason for rejection (minimum 10 characters)",
      );
    }

    session = await mongoose.startSession();
    session.startTransaction();

    // Get claim (tenant-scoped)
    const claim = await EmployeeClaim.findOne(
      withTenantScope({ _id: claimId }, companyId, isSuperAdmin),
    ).session(session);

    if (!claim) {
      throw new Error("Claim not found");
    }

    // Reject
    await claim.reject(formatUserForAudit(user), reason.trim());

    await session.commitTransaction();

    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/claims/pending");
    revalidatePath(`/dashboard/claims/${claimId}`);
    revalidateProject(claim.projectId);

    return { message: "success" };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error rejecting claim:", error);
    return {
      message: error.message || "Failed to reject claim",
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// RECALL CLAIM (submitted → draft)
// ============================================
export async function recallEmployeeClaim(claimId) {
  let session;

  try {
    await dbConnect();

    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      throw new Error(error.message);
    }

    session = await mongoose.startSession();
    session.startTransaction();

    const claim = await EmployeeClaim.findOne(
      withTenantScope({ _id: claimId }, companyId, isSuperAdmin),
    ).session(session);

    if (!claim) {
      throw new Error("Claim not found");
    }

    // Only the owner can recall their own claim
    if (claim.employee.userId.toString() !== user.id) {
      throw new Error("You can only recall your own claims");
    }

    await claim.recall(formatUserForAudit(user));

    await session.commitTransaction();

    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/my-claims");
    revalidatePath("/dashboard/claims/pending");
    revalidatePath(`/dashboard/claims/${claimId}`);
    revalidateProject(claim.projectId);

    return { success: true, message: "Claim recalled to draft" };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error recalling claim:", error);
    return { success: false, message: error.message || "Failed to recall claim" };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// RESUBMIT CLAIM (rejected → submitted)
// ============================================
export async function resubmitEmployeeClaim(claimId) {
  let session;

  try {
    await dbConnect();

    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      throw new Error(error.message);
    }

    session = await mongoose.startSession();
    session.startTransaction();

    const claim = await EmployeeClaim.findOne(
      withTenantScope({ _id: claimId }, companyId, isSuperAdmin),
    ).session(session);

    if (!claim) {
      throw new Error("Claim not found");
    }

    // Only the owner can resubmit their own claim
    if (claim.employee.userId.toString() !== user.id) {
      throw new Error("You can only resubmit your own claims");
    }

    await claim.resubmit(formatUserForAudit(user));

    await session.commitTransaction();

    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/my-claims");
    revalidatePath("/dashboard/claims/pending");
    revalidatePath(`/dashboard/claims/${claimId}`);
    revalidateProject(claim.projectId);

    return { success: true, message: "Claim resubmitted for approval" };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error resubmitting claim:", error);
    return { success: false, message: error.message || "Failed to resubmit claim" };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

export async function settleAdvance(advanceClaimId, prevState, formData) {
  let session;

  try {
    await dbConnect();

    // ============================================
    // 1. AUTH CHECK WITH TENANT CONTEXT
    // ============================================
    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    // Get tenant companyId for create
    let tenantCompanyId;
    try {
      tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    // ============================================
    // 2. GET ADVANCE CLAIM (before transaction for validation)
    // ============================================
    const advanceClaim = await EmployeeClaim.findOne(
      withTenantScope({ _id: advanceClaimId }, companyId, isSuperAdmin),
    );

    if (!advanceClaim) {
      return {
        errors: {
          _form: ["Advance claim not found"],
        },
      };
    }

    // ============================================
    // 3. VALIDATE CLAIM TYPE
    // ============================================
    if (advanceClaim.claimType !== "advance_request") {
      return {
        errors: {
          _form: [
            "This is not an advance request. Only advance requests can be settled.",
          ],
        },
      };
    }

    // ============================================
    // 4. VALIDATE CLAIM STATUS
    // ============================================
    if (advanceClaim.status !== "paid") {
      const statusMessages = {
        draft:
          "This advance is still in draft. It must be submitted, approved, and paid before settlement.",
        submitted:
          "This advance is pending approval. It must be approved and paid before settlement.",
        approved:
          "This advance is approved but not yet paid. Wait for payment before settlement.",
        rejected: "This advance was rejected and cannot be settled.",
        closed: "This advance is already closed.",
        pending_return: "This advance is pending return.",
        pending_payment: "This advance is pending payment.",
      };

      return {
        errors: {
          _form: [
            statusMessages[advanceClaim.status] ||
              `Cannot settle advance with status: ${advanceClaim.status}`,
          ],
        },
      };
    }

    // ============================================
    // 5. CHECK FOR DOUBLE SETTLEMENT
    // ============================================
    if (advanceClaim.settlementClaimId) {
      return {
        errors: {
          _form: [
            "This advance has already been settled. You cannot submit another settlement.",
          ],
        },
        existingSettlementId: advanceClaim.settlementClaimId.toString(),
      };
    }

    // Also check if any settlement exists for this advance (tenant-scoped)
    const existingSettlement = await EmployeeClaim.findOne(
      withTenantScope(
        {
          claimType: "advance_return",
          "returnDetails.advanceClaimId": advanceClaimId,
          status: { $nin: ["rejected"] }, // Ignore rejected settlements
        },
        companyId,
        isSuperAdmin,
      ),
    );

    if (existingSettlement) {
      return {
        errors: {
          _form: [
            `A settlement (${existingSettlement.claimNumber}) already exists for this advance.`,
          ],
        },
        existingSettlementId: existingSettlement._id.toString(),
      };
    }

    // ============================================
    // 6. VALIDATE OWNERSHIP
    // ============================================
    if (advanceClaim.employee.userId.toString() !== user.id) {
      return {
        errors: {
          _form: ["You can only settle your own advances"],
        },
      };
    }

    // ============================================
    // 7. PARSE AND VALIDATE INPUT
    // ============================================
    let itemsData;
    try {
      const itemsJson = formData.get("items");
      if (!itemsJson) {
        return {
          errors: {
            items: ["No expense items provided"],
          },
        };
      }
      itemsData = JSON.parse(itemsJson);
    } catch (error) {
      return {
        errors: {
          items: ["Invalid expense data format. Please try again."],
        },
      };
    }

    const validatedFields = settleAdvanceSchema.safeParse({
      items: itemsData,
      notes: formData.get("notes"),
    });

    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;

      // Format item errors more helpfully
      if (fieldErrors.items) {
        // Check if it's array-level or item-level errors
        const itemErrors = validatedFields.error.errors.filter(
          (e) => e.path[0] === "items" && e.path.length > 1,
        );

        if (itemErrors.length > 0) {
          // Format as "Item 1: description is required"
          const formattedErrors = itemErrors.map((e) => {
            const itemIndex = e.path[1];
            const field = e.path[2];
            return `Expense #${itemIndex + 1}: ${field} - ${e.message}`;
          });

          return {
            errors: {
              _form: formattedErrors,
            },
          };
        }
      }

      return {
        errors: fieldErrors,
      };
    }

    const data = validatedFields.data;

    // ============================================
    // 8. VALIDATE EXPENSE DATES
    // ============================================
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const travelStartDate = advanceClaim.advanceDetails?.travelDates?.from;
    const travelEndDate = advanceClaim.advanceDetails?.travelDates?.to;

    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const itemDate = new Date(item.date);

      // Check if date is in the future
      if (itemDate > today) {
        return {
          errors: {
            _form: [`Expense #${i + 1}: Date cannot be in the future`],
          },
        };
      }

      // Optional: Warn if date is outside travel dates (but allow it)
      // This is just a soft validation - expenses might occur before/after travel
    }

    // ============================================
    // 9. CALCULATE TOTALS
    // ============================================
    const totalSpent = data.items.reduce((sum, item) => sum + item.amount, 0);
    const advanceAmount = advanceClaim.totalAmount;
    const balance = advanceAmount - totalSpent;
    // balance > 0 = employee owes company
    // balance < 0 = company owes employee
    // balance = 0 = exactly settled

    // ============================================
    // 10. START TRANSACTION
    // ============================================
    session = await mongoose.startSession();
    session.startTransaction();

    // ============================================
    // 11. GENERATE SETTLEMENT NUMBER (tenant-scoped)
    // ============================================
    const settlementNumber = await generateClaimNumber(
      tenantCompanyId,
      session,
    );

    // ============================================
    // 12. CREATE SETTLEMENT CLAIM
    // ============================================
    // Inherit project from parent advance claim
    const inheritedProject = {};
    if (advanceClaim.projectId) {
      inheritedProject.projectId = advanceClaim.projectId;
      inheritedProject.project = advanceClaim.project;
    }

    const settlementClaim = await EmployeeClaim.create(
      [
        {
          companyId: tenantCompanyId,
          claimNumber: settlementNumber,
          claimDate: new Date(),
          employee: advanceClaim.employee, // Copy employee info
          ...inheritedProject,
          claimType: "advance_return",
          returnDetails: {
            advanceClaimId: advanceClaim._id,
            advancePaymentId: advanceClaim.advancePaymentId,
            advanceAmount,
            totalSpent,
            balance,
          },
          items: data.items.map((item) => ({
            date: item.date,
            category: item.category,
            expenseAccountId: item.expenseAccountId || null,
            description: item.description,
            amount: item.amount,
            notes: item.notes || "",
            receipt: item.receipt || {},
          })),
          totalAmount: totalSpent,
          description: `Settlement for advance ${advanceClaim.claimNumber}`,
          notes: data.notes || "",
          receipts: parseReceipts(formData, user),
          status: "submitted",
          submittedAt: new Date(),
          submittedBy: formatUserForAudit(user),
          createdBy: formatUserForAudit(user),
        },
      ],
      { session },
    );

    // ============================================
    // 13. LINK SETTLEMENT TO ORIGINAL ADVANCE
    // ============================================
    advanceClaim.settlementClaimId = settlementClaim[0]._id;
    advanceClaim.lastModifiedBy = formatUserForAudit(user);
    await advanceClaim.save({ session });

    // ============================================
    // 14. COMMIT TRANSACTION
    // ============================================
    await session.commitTransaction();

    // ============================================
    // 15. REVALIDATE PATHS
    // ============================================
    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/my-claims");
    revalidatePath(`/dashboard/claims/${advanceClaimId}`);
    revalidatePath(`/dashboard/claims/${settlementClaim[0]._id}`);
    revalidateProject(advanceClaim.projectId);

    // ============================================
    // 16. RETURN SUCCESS
    // ============================================
    return {
      success: true,
      message: "Settlement submitted successfully",
      settlementId: settlementClaim[0]._id.toString(),
      claimNumber: settlementClaim[0].claimNumber,
      balance,
      balanceMessage:
        balance > 0
          ? `You will need to return KES ${balance.toLocaleString()} to the company`
          : balance < 0
            ? `The company will reimburse you KES ${Math.abs(
                balance,
              ).toLocaleString()}`
            : "Your expenses exactly match the advance amount",
    };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error settling advance:", error);

    // Handle specific MongoDB errors
    if (error.code === 11000) {
      return {
        errors: {
          _form: [
            "A duplicate settlement was detected. Please refresh and try again.",
          ],
        },
      };
    }

    return {
      errors: {
        _form: [
          error.message || "Failed to submit settlement. Please try again.",
        ],
      },
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// 7. CLOSE SETTLEMENT (Accountant - final step)
// ============================================
export async function closeSettlementt(settlementId, prevState, formData) {
  let session;

  try {
    await dbConnect();

    // Auth check with tenant context
    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return {
        message: error.message,
      };
    }

    // Get tenant companyId for create
    let tenantCompanyId;
    try {
      tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    } catch (error) {
      return {
        message: error.message,
      };
    }

    const userRole = user.role?.toLowerCase();

    // Check permissions
    if (
      !["accountant", "admin", "cfo", "finance manager", "superadmin"].includes(
        userRole,
      )
    ) {
      throw new Error("Only accountants and admins can close settlements");
    }

    session = await mongoose.startSession();
    session.startTransaction();

    // Get settlement claim (tenant-scoped)
    const settlement = await EmployeeClaim.findOne(
      withTenantScope({ _id: settlementId }, companyId, isSuperAdmin),
    ).session(session);

    if (!settlement) {
      throw new Error("Settlement not found");
    }

    // Validate
    if (settlement.claimType !== "advance_return") {
      throw new Error("This is not a settlement");
    }

    if (settlement.status !== "approved") {
      throw new Error("Settlement must be approved first");
    }

    // Resolve expense accounts by expenseAccountId
    const expenseAccountMap = await resolveExpenseAccounts(settlement.items, session);

    // Get system accounts (tenant-scoped)
    const employeeAdvancesAccount = await Account.findOne(
      withTenantScope(
        { systemAccount: "employee_advance" },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);

    const employeePayablesAccount = await Account.findOne(
      withTenantScope(
        { systemAccount: "employee_payables" },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);

    if (!employeeAdvancesAccount || !employeePayablesAccount) {
      throw new Error("System accounts not configured");
    }

    // ============================================
    // CREATE JOURNAL ENTRY FOR SETTLEMENT
    // ============================================
    const entryNumber = await generateUniqueEntryNumber(
      "SETTLE",
      tenantCompanyId,
    );
    const journalLines = [];

    // DEBIT: Expense accounts (grouped by expenseAccountId)
    const expensesByAccount = {};
    settlement.items.forEach((item) => {
      const key = item.expenseAccountId?.toString() || item.category;
      if (!expensesByAccount[key]) {
        expensesByAccount[key] = { amount: 0, category: item.category };
      }
      expensesByAccount[key].amount += item.amount;
    });

    for (const [accountId, { amount, category }] of Object.entries(expensesByAccount)) {
      const account = expenseAccountMap[accountId];
      journalLines.push({
        accountId: account._id,
        accountCode: account.accountCode,
        accountName: account.accountName,
        accountType: account.accountType,
        debit: amount,
        credit: 0,
        description: `${category} expenses`,
      });
    }

    // Handle balance
    const balance = settlement.returnDetails.balance;

    if (balance > 0) {
      // Employee owes company
      // DR: Employee Payables (Liability - they owe us)
      journalLines.push({
        accountId: employeePayablesAccount._id,
        accountCode: employeePayablesAccount.accountCode,
        accountName: employeePayablesAccount.accountName,
        accountType: employeePayablesAccount.accountType,
        debit: balance,
        credit: 0,
        description: `Amount to be returned by ${settlement.employee.name}`,
      });
    } else if (balance < 0) {
      // Company owes employee
      // CR: Employee Payables (Liability - we owe them)
      journalLines.push({
        accountId: employeePayablesAccount._id,
        accountCode: employeePayablesAccount.accountCode,
        accountName: employeePayablesAccount.accountName,
        accountType: employeePayablesAccount.accountType,
        debit: 0,
        credit: Math.abs(balance),
        description: `Additional amount owed to ${settlement.employee.name}`,
      });
    }

    // CR: Employee Advances (clear the advance)
    journalLines.push({
      accountId: employeeAdvancesAccount._id,
      accountCode: employeeAdvancesAccount.accountCode,
      accountName: employeeAdvancesAccount.accountName,
      accountType: employeeAdvancesAccount.accountType,
      debit: 0,
      credit: settlement.returnDetails.advanceAmount,
      description: `Clear advance`,
    });

    // Create journal entry
    const journalEntry = await JournalEntry.create(
      [
        {
          companyId: tenantCompanyId,
          entryNumber,
          entryDate: new Date(),
          entryType: "advance_settlement",
          description: `Settlement - ${settlement.claimNumber}`,
          lines: journalLines,
          party: {
            type: "employee",
            id: settlement.employee.partyId.toString(),
            name: settlement.employee.name,
            email: settlement.employee.email,
          },
          relatedDocuments: {
            claimId: settlement._id,
            claimNumber: settlement.claimNumber,
          },
          status: "draft",
          createdBy: formatUserForAudit(user),
        },
      ],
      { session },
    );

    // Post journal entry (pass session for transaction)
    await journalEntry[0].post(formatUserForAudit(user), session);

    // Update settlement
    settlement.journalEntryIds.push(journalEntry[0]._id);
    settlement.status = "closed";
    await settlement.save({ session });

    // Update party balance (tenant-scoped)
    const party = await Party.findOne(
      withTenantScope(
        { _id: settlement.employee.partyId },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);
    if (party) {
      await party.calculateActualBalance();
    }

    // TODO: If balance > 0, collect cash from employee
    // TODO: If balance < 0, pay employee

    await session.commitTransaction();

    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/claims/payments");
    revalidatePath(`/dashboard/claims/${settlementId}`);
    revalidateProject(settlement.projectId);

    return { message: "success" };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error closing settlement:", error);
    return {
      message: error.message || "Failed to close settlement",
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// 9. UPDATE CLAIM (Draft/Submitted only)
// ============================================
export async function updateClaim(claimId, prevState, formData) {
  let session;

  try {
    await dbConnect();

    // Auth check with tenant context
    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    const userRole = user.role?.toLowerCase();

    session = await mongoose.startSession();
    session.startTransaction();

    // Get claim (tenant-scoped)
    const claim = await EmployeeClaim.findOne(
      withTenantScope({ _id: claimId }, companyId, isSuperAdmin),
    ).session(session);

    if (!claim) {
      return {
        errors: {
          _form: ["Claim not found"],
        },
      };
    }

    // Check permissions
    const isOwner = claim.employee.userId.toString() === user.id;
    const isManager = userRole === "manager" || userRole === "admin";

    if (!isOwner && !isManager) {
      return {
        errors: {
          _form: ["You don't have permission to update this claim"],
        },
      };
    }

    // Only draft and rejected claims can be updated
    if (claim.status !== "draft" && claim.status !== "rejected") {
      return {
        errors: {
          _form: [
            `Cannot update ${claim.status} claims. Only draft or rejected claims can be edited.`,
          ],
        },
      };
    }

    // Handle project update (shared across claim types)
    const updatedProjectId = formData.get("projectId") || "";
    if (updatedProjectId) {
      const project = await Project.findById(updatedProjectId).select("projectNumber name status").lean();
      if (project && project.status !== "closed") {
        claim.projectId = project._id;
        claim.project = { projectNumber: project.projectNumber, name: project.name };
      }
    } else {
      claim.projectId = undefined;
      claim.project = undefined;
    }

    // Update based on claim type
    if (claim.claimType === "advance_request") {
      const requestedAmount = parseFloat(formData.get("requestedAmount"));
      const purpose = formData.get("purpose");
      const destination = formData.get("destination");
      const travelFromDate = formData.get("travelFromDate");
      const travelToDate = formData.get("travelToDate");
      const estimatedExpenses = formData.get("estimatedExpenses");
      const notes = formData.get("notes");
      const rawAdvanceValues = {
        advanceType: formData.get("advanceType"),
        requestedAmount: formData.get("requestedAmount"),
        purpose, destination, travelFromDate, travelToDate,
        projectId: updatedProjectId,
        estimatedExpenses, notes,
      };

      // Validation
      if (!requestedAmount || requestedAmount <= 0) {
        return {
          errors: {
            requestedAmount: ["Please enter a valid amount greater than zero"],
          },
          values: rawAdvanceValues,
        };
      }

      if (!purpose || purpose.trim().length < 10) {
        return {
          errors: {
            purpose: [
              "Please provide a detailed purpose (minimum 10 characters)",
            ],
          },
          values: rawAdvanceValues,
        };
      }

      // Travel-specific validation
      const currentAdvanceType = formData.get("advanceType") || claim.advanceDetails?.advanceType;
      if (currentAdvanceType === "travel") {
        if (!travelFromDate || !travelToDate) {
          return {
            errors: {
              _form: ["Please provide both travel start and end dates"],
            },
            values: rawAdvanceValues,
          };
        }

        const fromDate = new Date(travelFromDate);
        const toDate = new Date(travelToDate);

        if (toDate < fromDate) {
          return {
            errors: {
              _form: ["Travel end date cannot be before start date"],
            },
            values: rawAdvanceValues,
          };
        }
      }

      // Update claim
      claim.advanceDetails.advanceType = currentAdvanceType;
      claim.advanceDetails.requestedAmount = requestedAmount;
      claim.advanceDetails.purpose = purpose.trim();
      claim.advanceDetails.estimatedExpenses = estimatedExpenses?.trim() || "";
      claim.totalAmount = requestedAmount;
      claim.description = `Advance request for ${purpose.trim()}`;
      claim.notes = notes?.trim() || "";

      // Travel-specific fields
      if (currentAdvanceType === "travel") {
        claim.advanceDetails.destination = destination?.trim() || "";
        claim.advanceDetails.travelDates = {
          from: new Date(travelFromDate),
          to: new Date(travelToDate),
        };
      }
    } else if (claim.claimType === "reimbursement") {
      const description = formData.get("description");
      const notes = formData.get("notes");
      const itemsJson = formData.get("items");
      const rawValues = { description, notes };

      // Validation
      if (!description || description.trim().length < 10) {
        return {
          errors: {
            description: [
              "Please provide a detailed description (minimum 10 characters)",
            ],
          },
          values: rawValues,
        };
      }

      if (!itemsJson) {
        return {
          errors: {
            _form: ["No expense items provided"],
          },
          values: rawValues,
        };
      }

      // Parse items
      let items;
      try {
        items = JSON.parse(itemsJson);
      } catch (error) {
        return {
          errors: {
            _form: ["Invalid items data"],
          },
          values: rawValues,
        };
      }

      if (!items || items.length === 0) {
        return {
          errors: {
            _form: ["Please add at least one expense item"],
          },
          values: rawValues,
        };
      }

      // Validate items
      const validatedItems = items.map((item) => {
        if (!item.date || !item.category || !item.description || !item.amount) {
          throw new Error(
            "All expense items must have date, category, description, and amount",
          );
        }

        if (item.amount <= 0) {
          throw new Error("Expense amount must be greater than zero");
        }

        return {
          date: new Date(item.date),
          category: item.category,
          expenseAccountId: item.expenseAccountId || null,
          description: item.description.trim(),
          amount: parseFloat(item.amount),
          receipt: item.receipt || {},
          notes: item.notes?.trim() || "",
        };
      });

      // Calculate total
      const totalAmount = validatedItems.reduce(
        (sum, item) => sum + item.amount,
        0,
      );

      // Update claim
      claim.items = validatedItems;
      claim.totalAmount = totalAmount;
      claim.description = description.trim();
      claim.notes = notes?.trim() || "";
      claim.receipts = parseReceipts(formData, user);
    }

    // Update audit trail
    claim.lastModifiedBy = formatUserForAudit(user);
    claim.updatedAt = new Date();

    await claim.save({ session });

    await session.commitTransaction();

    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/my-claims");
    revalidatePath("/dashboard/claims/pending");
    revalidatePath(`/dashboard/claims/${claimId}`);
    revalidateProject(claim.projectId);

    return {
      success: true,
      message: "Claim updated successfully",
    };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error updating claim:", error);
    return {
      errors: {
        _form: [error.message || "Failed to update claim. Please try again."],
      },
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// ZOD SCHEMAS
// ============================================

const closeSettlementSchema = z.object({
  notes: z.string().max(500).optional().or(z.literal("")),
});

const recordAdvanceReturnSchema = z.object({
  paymentAccountId: z.string().min(1, "Please select a payment account"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  reference: z.string().max(100).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
});

const paySettlementBalanceSchema = z.object({
  paymentAccountId: z.string().min(1, "Please select a payment account"),
  reference: z.string().max(100).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
});

// ============================================
// HELPER: Format user for audit trail
// ============================================

// ============================================
// HELPER: Get payment account by method (tenant-scoped)
// ============================================
async function getPaymentAccount(
  paymentMethod,
  session = null,
  tenantCompanyId = null,
  isSuperAdmin = false,
) {
  const systemAccountMap = {
    cash: "cash",
    bank: ["bank", "bank_main"],
    mpesa: "mpesa",
  };

  const value = systemAccountMap[paymentMethod];
  const baseQuery = Array.isArray(value)
    ? { systemAccount: { $in: value } }
    : { systemAccount: value };
  const scopedQuery = tenantCompanyId
    ? withTenantScope(baseQuery, tenantCompanyId, isSuperAdmin)
    : baseQuery;

  const query = Account.findOne(scopedQuery);
  console.log(scopedQuery);

  if (session) {
    query.session(session);
  }

  const account = await query;
  console.log(account);

  if (!account) {
    return null;
  }

  return account;
}

// ============================================
// 7. CLOSE SETTLEMENT (Accountant - FIXED)
// ============================================
export async function closeSettlement(settlementId, prevState, formData) {
  let session;

  try {
    await dbConnect();

    // ============================================
    // AUTH CHECK WITH TENANT CONTEXT
    // ============================================
    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    // Get tenant companyId for create
    let tenantCompanyId;
    try {
      tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    const userRole = user.role?.toLowerCase();

    if (
      !["accountant", "admin", "cfo", "finance manager", "superadmin"].includes(
        userRole,
      )
    ) {
      return {
        errors: {
          _form: ["Only accountants and admins can close settlements"],
        },
      };
    }

    // ============================================
    // VALIDATE INPUT
    // ============================================
    const validatedFields = closeSettlementSchema.safeParse({
      notes: formData.get("notes"),
    });

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
      };
    }

    // ============================================
    // START TRANSACTION
    // ============================================
    session = await mongoose.startSession();
    session.startTransaction();

    // ============================================
    // GET SETTLEMENT CLAIM (tenant-scoped)
    // ============================================
    const settlement = await EmployeeClaim.findOne(
      withTenantScope({ _id: settlementId }, companyId, isSuperAdmin),
    ).session(session);

    if (!settlement) {
      return {
        errors: {
          _form: ["Settlement not found"],
        },
      };
    }

    if (settlement.claimType !== "advance_return") {
      return {
        errors: {
          _form: ["This is not a settlement claim"],
        },
      };
    }

    if (settlement.status !== "approved") {
      return {
        errors: {
          _form: [
            `Settlement must be approved first. Current status: ${settlement.status}`,
          ],
        },
      };
    }

    // ============================================
    // RESOLVE EXPENSE ACCOUNTS BY ID (tenant-scoped)
    // ============================================
    const expenseAccountMap = await resolveExpenseAccounts(settlement.items, session);

    // ============================================
    // GET SYSTEM ACCOUNTS (tenant-scoped)
    // ============================================
    const employeeAdvanceAccount = await Account.findOne(
      withTenantScope(
        { systemAccount: "employee_advance" },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);

    const employeePayablesAccount = await Account.findOne(
      withTenantScope(
        { systemAccount: "employee_payables" },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);

    if (!employeeAdvanceAccount) {
      return {
        errors: {
          _form: [
            "Employee Advance account not configured. Create system account 'employee_advance'",
          ],
        },
      };
    }

    if (!employeePayablesAccount) {
      return {
        errors: {
          _form: [
            "Employee Payables account not configured. Create system account 'employee_payables'",
          ],
        },
      };
    }

    // ============================================
    // CALCULATE AMOUNTS
    // ============================================
    const advanceAmount = settlement.returnDetails.advanceAmount;
    const totalSpent = settlement.returnDetails.totalSpent;
    const balance = advanceAmount - totalSpent;
    // balance > 0 = employee owes company
    // balance < 0 = company owes employee
    // balance = 0 = exactly matched

    // ============================================
    // BUILD JOURNAL ENTRY LINES
    // ============================================
    const journalLines = [];

    // 1. DEBIT: Expense accounts (grouped by expenseAccountId)
    const expensesByAccount = {};
    settlement.items.forEach((item) => {
      const key = item.expenseAccountId?.toString() || item.category;
      if (!expensesByAccount[key]) {
        expensesByAccount[key] = { amount: 0, category: item.category };
      }
      expensesByAccount[key].amount += item.amount;
    });

    for (const [accountId, { amount, category }] of Object.entries(expensesByAccount)) {
      const account = expenseAccountMap[accountId];
      journalLines.push({
        accountId: account._id,
        accountCode: account.accountCode,
        accountName: account.accountName,
        accountType: account.accountType,
        debit: amount,
        credit: 0,
        description: `${category} expenses - ${settlement.employee.name}`,
      });
    }

    // 2. Handle based on balance
    if (balance >= 0) {
      // Employee spent LESS OR EQUAL to advance
      // Credit Employee Advance by totalSpent only
      journalLines.push({
        accountId: employeeAdvanceAccount._id,
        accountCode: employeeAdvanceAccount.accountCode,
        accountName: employeeAdvanceAccount.accountName,
        accountType: employeeAdvanceAccount.accountType,
        debit: 0,
        credit: totalSpent,
        description: `Clear advance for expenses incurred`,
      });
      // Remaining balance stays in Employee Advance (employee owes us)
    } else {
      // Employee spent MORE than advance (balance < 0)
      // Credit full advance amount + record payable for extra
      const amountOwed = Math.abs(balance);

      // Credit full Employee Advance
      journalLines.push({
        accountId: employeeAdvanceAccount._id,
        accountCode: employeeAdvanceAccount.accountCode,
        accountName: employeeAdvanceAccount.accountName,
        accountType: employeeAdvanceAccount.accountType,
        debit: 0,
        credit: advanceAmount,
        description: `Clear full advance`,
      });

      // Credit Employee Payables for extra owed
      journalLines.push({
        accountId: employeePayablesAccount._id,
        accountCode: employeePayablesAccount.accountCode,
        accountName: employeePayablesAccount.accountName,
        accountType: employeePayablesAccount.accountType,
        debit: 0,
        credit: amountOwed,
        description: `Additional reimbursement owed to ${settlement.employee.name}`,
      });
    }

    // ============================================
    // VALIDATE JOURNAL ENTRY BALANCE
    // ============================================
    const totalDebits = journalLines.reduce(
      (sum, l) => sum + (l.debit || 0),
      0,
    );
    const totalCredits = journalLines.reduce(
      (sum, l) => sum + (l.credit || 0),
      0,
    );

    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      return {
        errors: {
          _form: [
            `Journal entry calculation error. Debits: ${totalDebits.toFixed(
              2,
            )}, Credits: ${totalCredits.toFixed(2)}. Please contact support.`,
          ],
        },
      };
    }

    // ============================================
    // CREATE JOURNAL ENTRY
    // ============================================
    const entryNumber = await generateUniqueEntryNumber(
      "SETTLE",
      tenantCompanyId,
    );

    const journalEntry = await JournalEntry.create(
      [
        {
          companyId: tenantCompanyId,
          entryNumber,
          entryDate: new Date(),
          entryType: "advance_settlement",
          description: `Advance settlement - ${settlement.claimNumber}`,
          lines: journalLines,
          party: {
            type: "employee",
            id: settlement.employee.partyId.toString(),
            name: settlement.employee.name,
            email: settlement.employee.email,
          },
          relatedDocuments: {
            claimId: settlement._id,
            claimNumber: settlement.claimNumber,
          },
          status: "draft",
          createdBy: formatUserForAudit(user),
        },
      ],
      { session },
    );

    // Post journal entry (pass session for transaction)
    await journalEntry[0].post(formatUserForAudit(user), session);

    // ============================================
    // UPDATE SETTLEMENT
    // ============================================
    settlement.journalEntryIds.push(journalEntry[0]._id);
    settlement.lastModifiedBy = formatUserForAudit(user);

    // Set status based on balance
    if (balance === 0) {
      settlement.status = "closed";
    } else if (balance > 0) {
      settlement.status = "pending_return";
    } else {
      settlement.status = "pending_payment";
    }

    await settlement.save({ session });

    // Update party balance (tenant-scoped)
    const party = await Party.findOne(
      withTenantScope(
        { _id: settlement.employee.partyId },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);
    if (party) {
      await party.calculateActualBalance();
    }

    await session.commitTransaction();

    // ============================================
    // REVALIDATE & RETURN
    // ============================================
    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/claims/payments");
    revalidatePath(`/dashboard/claims/${settlementId}`);
    revalidateProject(settlement.projectId);

    return {
      success: true,
      message:
        balance === 0
          ? "Settlement closed successfully"
          : balance > 0
            ? `Settlement processed. Employee owes KES ${balance.toLocaleString()}`
            : `Settlement processed. Company owes employee KES ${Math.abs(
                balance,
              ).toLocaleString()}`,
      balance,
      status: settlement.status,
    };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error closing settlement:", error);
    return {
      errors: {
        _form: [
          error.message || "Failed to close settlement. Please try again.",
        ],
      },
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// 8. RECORD CASH RETURN FROM EMPLOYEE (NEW)
// ============================================
export async function recordAdvanceReturn(settlementId, prevState, formData) {
  let session;

  try {
    await dbConnect();

    // ============================================
    // AUTH CHECK WITH TENANT CONTEXT
    // ============================================
    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    // Get tenant companyId for create
    let tenantCompanyId;
    try {
      tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    const userRole = user.role?.toLowerCase();

    if (
      !["accountant", "admin", "cfo", "finance manager", "superadmin"].includes(
        userRole,
      )
    ) {
      return {
        errors: {
          _form: ["Only accountants and admins can record advance returns"],
        },
      };
    }

    // ============================================
    // GET SETTLEMENT FIRST (need balance for validation, tenant-scoped)
    // ============================================
    const settlementCheck = await EmployeeClaim.findOne(
      withTenantScope({ _id: settlementId }, companyId, isSuperAdmin),
    );

    if (!settlementCheck) {
      return {
        errors: {
          _form: ["Settlement not found"],
        },
      };
    }

    const maxBalance = settlementCheck.returnDetails?.balance || 0;

    // ============================================
    // VALIDATE INPUT
    // ============================================
    const validatedFields = recordAdvanceReturnSchema.safeParse({
      paymentAccountId: formData.get("paymentAccountId"),
      amount: formData.get("amount") || maxBalance,
      reference: formData.get("reference"),
      notes: formData.get("notes"),
    });

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
      };
    }

    const data = validatedFields.data;

    // Additional validation
    if (data.amount > maxBalance) {
      return {
        errors: {
          amount: [
            `Amount cannot exceed balance of KES ${maxBalance.toLocaleString()}`,
          ],
        },
      };
    }

    // ============================================
    // START TRANSACTION
    // ============================================
    session = await mongoose.startSession();
    session.startTransaction();

    // ============================================
    // GET SETTLEMENT (tenant-scoped)
    // ============================================
    const settlement = await EmployeeClaim.findOne(
      withTenantScope({ _id: settlementId }, companyId, isSuperAdmin),
    ).session(session);

    if (settlement.claimType !== "advance_return") {
      return {
        errors: {
          _form: ["This is not a settlement claim"],
        },
      };
    }

    if (settlement.status !== "pending_return") {
      return {
        errors: {
          _form: [
            `Settlement is not pending return. Current status: ${settlement.status}`,
          ],
        },
      };
    }

    const balance = settlement.returnDetails.balance;

    if (balance <= 0) {
      return {
        errors: {
          _form: ["No amount to return - balance is zero or negative"],
        },
      };
    }

    // ============================================
    // GET ACCOUNTS (tenant-scoped)
    // ============================================
    const paymentAccount = await Account.findById(data.paymentAccountId).session(session);

    if (!paymentAccount) {
      return {
        errors: {
          paymentAccountId: ["Selected payment account not found"],
        },
      };
    }

    const employeeAdvanceAccount = await Account.findOne(
      withTenantScope(
        { systemAccount: "employee_advance" },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);

    if (!employeeAdvanceAccount) {
      return {
        errors: {
          _form: ["Employee Advance account not configured"],
        },
      };
    }

    // ============================================
    // CREATE JOURNAL ENTRY
    // DR: Cash/Bank (asset increase)
    // CR: Employee Advance (asset decrease)
    // ============================================
    const entryNumber = await generateUniqueEntryNumber("RET", tenantCompanyId);

    const journalEntry = await JournalEntry.create(
      [
        {
          companyId: tenantCompanyId,
          entryNumber,
          entryDate: new Date(),
          entryType: "advance_return",
          description: `Advance return - ${settlement.claimNumber}`,
          lines: [
            {
              accountId: paymentAccount._id,
              accountCode: paymentAccount.accountCode,
              accountName: paymentAccount.accountName,
              accountType: paymentAccount.accountType,
              debit: data.amount,
              credit: 0,
              description: `Cash returned by ${settlement.employee.name}`,
            },
            {
              accountId: employeeAdvanceAccount._id,
              accountCode: employeeAdvanceAccount.accountCode,
              accountName: employeeAdvanceAccount.accountName,
              accountType: employeeAdvanceAccount.accountType,
              debit: 0,
              credit: data.amount,
              description: `Clear remaining advance balance`,
            },
          ],
          party: {
            type: "employee",
            id: settlement.employee.partyId.toString(),
            name: settlement.employee.name,
            email: settlement.employee.email,
          },
          relatedDocuments: {
            claimId: settlement._id,
            claimNumber: settlement.claimNumber,
          },
          paymentReference: data.reference,
          status: "draft",
          createdBy: formatUserForAudit(user),
        },
      ],
      { session },
    );

    // Post journal entry (pass session for transaction)
    await journalEntry[0].post(formatUserForAudit(user), session);

    // ============================================
    // UPDATE SETTLEMENT
    // ============================================
    settlement.journalEntryIds.push(journalEntry[0]._id);
    settlement.returnDetails.amountReturned =
      (settlement.returnDetails.amountReturned || 0) + data.amount;
    settlement.lastModifiedBy = formatUserForAudit(user);

    // Check if fully returned
    const totalReturned = settlement.returnDetails.amountReturned || 0;
    if (totalReturned >= balance) {
      settlement.status = "closed";
    }

    await settlement.save({ session });

    // Update party balance (tenant-scoped)
    const party = await Party.findOne(
      withTenantScope(
        { _id: settlement.employee.partyId },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);
    if (party) {
      await party.calculateActualBalance();
    }

    await session.commitTransaction();

    // ============================================
    // REVALIDATE & RETURN
    // ============================================
    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/claims/payments");
    revalidatePath(`/dashboard/claims/${settlementId}`);
    revalidateProject(settlement.projectId);

    const remainingBalance = balance - data.amount;

    return {
      success: true,
      message:
        remainingBalance <= 0
          ? "Advance return recorded. Settlement closed."
          : `Advance return recorded. Remaining balance: KES ${remainingBalance.toLocaleString()}`,
      amountReturned: data.amount,
      remainingBalance: Math.max(0, remainingBalance),
    };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error recording advance return:", error);
    return {
      errors: {
        _form: [
          error.message || "Failed to record advance return. Please try again.",
        ],
      },
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// 9. PAY EXTRA AMOUNT TO EMPLOYEE (NEW)
// ============================================
export async function paySettlementBalance(settlementId, prevState, formData) {
  let session;

  try {
    await dbConnect();

    // ============================================
    // AUTH CHECK WITH TENANT CONTEXT
    // ============================================
    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    // Get tenant companyId for create
    let tenantCompanyId;
    try {
      tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    const userRole = user.role?.toLowerCase();

    if (
      !["accountant", "admin", "cfo", "finance manager", "superadmin"].includes(
        userRole,
      )
    ) {
      return {
        errors: {
          _form: ["Only accountants and admins can make payments"],
        },
      };
    }

    // ============================================
    // VALIDATE INPUT
    // ============================================
    const validatedFields = paySettlementBalanceSchema.safeParse({
      paymentAccountId: formData.get("paymentAccountId"),
      reference: formData.get("reference"),
      notes: formData.get("notes"),
    });

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
      };
    }

    const data = validatedFields.data;

    // ============================================
    // START TRANSACTION
    // ============================================
    session = await mongoose.startSession();
    session.startTransaction();

    // ============================================
    // GET SETTLEMENT (tenant-scoped)
    // ============================================
    const settlement = await EmployeeClaim.findOne(
      withTenantScope({ _id: settlementId }, companyId, isSuperAdmin),
    ).session(session);

    if (!settlement) {
      return {
        errors: {
          _form: ["Settlement not found"],
        },
      };
    }

    if (settlement.claimType !== "advance_return") {
      return {
        errors: {
          _form: ["This is not a settlement claim"],
        },
      };
    }

    if (settlement.status !== "pending_payment") {
      return {
        errors: {
          _form: [
            `Settlement is not pending payment. Current status: ${settlement.status}`,
          ],
        },
      };
    }

    const balance = settlement.returnDetails.balance;

    if (balance >= 0) {
      return {
        errors: {
          _form: ["No amount owed to employee - balance is zero or positive"],
        },
      };
    }

    const amountOwed = Math.abs(balance);

    // ============================================
    // GET ACCOUNTS (tenant-scoped)
    // ============================================
    const paymentAccount = await Account.findById(data.paymentAccountId).session(session);

    if (!paymentAccount) {
      return {
        errors: {
          paymentAccountId: ["Selected payment account not found"],
        },
      };
    }

    const employeePayablesAccount = await Account.findOne(
      withTenantScope(
        { systemAccount: "employee_payables" },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);

    if (!employeePayablesAccount) {
      return {
        errors: {
          _form: ["Employee Payables account not configured"],
        },
      };
    }

    // ============================================
    // CREATE JOURNAL ENTRY
    // DR: Employee Payables (liability decrease)
    // CR: Cash/Bank (asset decrease)
    // ============================================
    const entryNumber = await generateUniqueEntryNumber("PAY", tenantCompanyId);

    const journalEntry = await JournalEntry.create(
      [
        {
          companyId: tenantCompanyId,
          entryNumber,
          entryDate: new Date(),
          entryType: "payment_made",
          description: `Settlement payment - ${settlement.claimNumber}`,
          lines: [
            {
              accountId: employeePayablesAccount._id,
              accountCode: employeePayablesAccount.accountCode,
              accountName: employeePayablesAccount.accountName,
              accountType: employeePayablesAccount.accountType,
              debit: amountOwed,
              credit: 0,
              description: `Clear payable to ${settlement.employee.name}`,
            },
            {
              accountId: paymentAccount._id,
              accountCode: paymentAccount.accountCode,
              accountName: paymentAccount.accountName,
              accountType: paymentAccount.accountType,
              debit: 0,
              credit: amountOwed,
              description: `Payment via ${data.paymentMethod}`,
            },
          ],
          party: {
            type: "employee",
            id: settlement.employee.partyId.toString(),
            name: settlement.employee.name,
            email: settlement.employee.email,
          },
          relatedDocuments: {
            claimId: settlement._id,
            claimNumber: settlement.claimNumber,
          },
          paymentReference: data.reference,
          status: "draft",
          createdBy: formatUserForAudit(user),
        },
      ],
      { session },
    );

    // Post journal entry (pass session for transaction)
    await journalEntry[0].post(formatUserForAudit(user), session);

    // ============================================
    // UPDATE SETTLEMENT
    // ============================================
    settlement.journalEntryIds.push(journalEntry[0]._id);
    settlement.settlementPaymentId = journalEntry[0]._id;
    settlement.paidAt = new Date();
    settlement.status = "closed";
    settlement.lastModifiedBy = formatUserForAudit(user);

    await settlement.save({ session });

    // Update party balance (tenant-scoped)
    const party = await Party.findOne(
      withTenantScope(
        { _id: settlement.employee.partyId },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);
    if (party) {
      await party.calculateActualBalance();
    }

    await session.commitTransaction();

    // ============================================
    // REVALIDATE & RETURN
    // ============================================
    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/claims/payments");
    revalidatePath(`/dashboard/claims/${settlementId}`);
    revalidateProject(settlement.projectId);

    return {
      success: true,
      message: `Payment of KES ${amountOwed.toLocaleString()} made to ${
        settlement.employee.name
      }. Settlement closed.`,
      amountPaid: amountOwed,
    };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error paying settlement balance:", error);
    return {
      errors: {
        _form: [
          error.message ||
            "Failed to pay settlement balance. Please try again.",
        ],
      },
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// PAY ADVANCE (Accountant) - FIXED
// ============================================
export async function payAdvance(claimId, prevState, formData) {
  let session;

  try {
    await dbConnect();

    // ============================================
    // 1. AUTH CHECK WITH TENANT CONTEXT
    // ============================================
    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    // Get tenant companyId for create
    let tenantCompanyId;
    try {
      tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    const userRole = user.role?.toLowerCase();

    if (
      !["accountant", "admin", "cfo", "finance manager", "superadmin"].includes(
        userRole,
      )
    ) {
      return {
        errors: {
          _form: ["Only accountants and admins can pay advances"],
        },
      };
    }

    // ============================================
    // 2. VALIDATE INPUT
    // ============================================
    const validatedFields = paymentSchema.safeParse({
      paymentAccountId: formData.get("paymentAccountId"),
      paymentMethod: formData.get("paymentMethod") || undefined,
      paymentReference: formData.get("paymentReference"),
      paymentNotes: formData.get("paymentNotes"),
    });

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
      };
    }

    const data = validatedFields.data;

    // ============================================
    // 3. START TRANSACTION
    // ============================================
    session = await mongoose.startSession();
    session.startTransaction();

    // ============================================
    // 4. GET CLAIM (tenant-scoped)
    // ============================================
    const claim = await EmployeeClaim.findOne(
      withTenantScope({ _id: claimId }, companyId, isSuperAdmin),
    ).session(session);

    if (!claim) {
      return {
        errors: {
          _form: ["Claim not found"],
        },
      };
    }

    // ============================================
    // 5. VALIDATE CLAIM
    // ============================================
    if (claim.status !== "approved") {
      return {
        errors: {
          _form: [
            `Cannot pay claim with status "${claim.status}". Claim must be approved.`,
          ],
        },
      };
    }

    if (claim.claimType !== "advance_request") {
      return {
        errors: {
          _form: [
            "This is not an advance request. Use the appropriate payment action.",
          ],
        },
      };
    }

    // ============================================
    // 6. GET SYSTEM ACCOUNTS (tenant-scoped)
    // ============================================
    const employeeAdvanceAccount = await Account.findOne(
      withTenantScope(
        { systemAccount: "employee_advance" },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);

    if (!employeeAdvanceAccount) {
      return {
        errors: {
          _form: [
            "Employee Advance account not configured. Please create a system account with code 'employee_advance'.",
          ],
        },
      };
    }

    const paymentAccount = await Account.findById(data.paymentAccountId).session(session);

    if (!paymentAccount) {
      return {
        errors: {
          paymentAccountId: ["Selected payment account not found"],
        },
      };
    }

    // ============================================
    // 7. CREATE JOURNAL ENTRY
    // DR: Employee Advance (Asset) - employee owes us
    // CR: Cash/Bank/M-Pesa (Asset) - money going out
    // ============================================
    const entryNumber = await generateUniqueEntryNumber("ADV", tenantCompanyId);
    const amount = claim.totalAmount;

    const journalEntry = await JournalEntry.create(
      [
        {
          companyId: tenantCompanyId,
          entryNumber,
          entryDate: new Date(),
          entryType: "advance",
          description: `Advance payment to ${claim.employee.name} - ${claim.claimNumber}`,
          lines: [
            {
              accountId: employeeAdvanceAccount._id,
              accountCode: employeeAdvanceAccount.accountCode,
              accountName: employeeAdvanceAccount.accountName,
              accountType: employeeAdvanceAccount.accountType,
              debit: amount,
              credit: 0,
              description: `Advance to ${claim.employee.name}`,
            },
            {
              accountId: paymentAccount._id,
              accountCode: paymentAccount.accountCode,
              accountName: paymentAccount.accountName,
              accountType: paymentAccount.accountType,
              debit: 0,
              credit: amount,
              description: `Payment via ${data.paymentMethod}${
                data.paymentReference ? ` - Ref: ${data.paymentReference}` : ""
              }`,
            },
          ],
          party: {
            type: "employee",
            id: claim.employee.partyId.toString(),
            name: claim.employee.name,
            email: claim.employee.email,
          },
          relatedDocuments: {
            claimId: claim._id,
            claimNumber: claim.claimNumber,
          },
          notes: data.paymentNotes || "",
          status: "draft",
          createdBy: formatUserForAudit(user),
        },
      ],
      { session },
    );

    // Post journal entry (pass session for transaction)
    await journalEntry[0].post(formatUserForAudit(user), session);

    // ============================================
    // 8. UPDATE CLAIM
    // ============================================
    claim.advancePaymentId = journalEntry[0]._id;
    claim.journalEntryIds.push(journalEntry[0]._id);
    claim.paidAt = new Date();
    claim.status = "paid";
    claim.lastModifiedBy = formatUserForAudit(user);
    await claim.save({ session });

    // ============================================
    // 9. UPDATE PARTY BALANCE (tenant-scoped)
    // ============================================
    const party = await Party.findOne(
      withTenantScope(
        { _id: claim.employee.partyId },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);
    if (party) {
      await party.calculateActualBalance();
    }

    // ============================================
    // 9b. UPDATE PROJECT FINANCIALS
    // Move from committed → cost
    // ============================================
    if (claim.projectId) {
      await Project.findByIdAndUpdate(
        claim.projectId,
        {
          $inc: {
            "financials.totalCosts": claim.totalAmount,
            "financials.totalCommitted": -claim.totalAmount,
          },
        },
        { session },
      );
    }

    // ============================================
    // 10. COMMIT TRANSACTION
    // ============================================
    await session.commitTransaction();

    // ============================================
    // 11. REVALIDATE & RETURN
    // ============================================
    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/claims/payments");
    revalidatePath(`/dashboard/claims/${claimId}`);
    revalidateProject(claim.projectId);

    return {
      success: true,
      message: `Advance of KES ${amount.toLocaleString()} paid to ${
        claim.employee.name
      }`,
    };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error paying advance:", error);
    return {
      errors: {
        _form: [error.message || "Failed to pay advance. Please try again."],
      },
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// PAY REIMBURSEMENT (Accountant) - FIXED
// ============================================
export async function payReimbursement(claimId, prevState, formData) {
  let session;

  try {
    await dbConnect();

    // ============================================
    // 1. AUTH CHECK WITH TENANT CONTEXT
    // ============================================
    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    // Get tenant companyId for create
    let tenantCompanyId;
    try {
      tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    } catch (error) {
      return {
        errors: {
          _form: [error.message],
        },
      };
    }

    const userRole = user.role?.toLowerCase();

    if (
      !["accountant", "admin", "cfo", "finance manager", "superadmin"].includes(
        userRole,
      )
    ) {
      return {
        errors: {
          _form: ["Only accountants and admins can pay reimbursements"],
        },
      };
    }

    // ============================================
    // 2. VALIDATE INPUT
    // ============================================
    const validatedFields = paymentSchema.safeParse({
      paymentAccountId: formData.get("paymentAccountId"),
      paymentMethod: formData.get("paymentMethod") || undefined,
      paymentReference: formData.get("paymentReference"),
      paymentNotes: formData.get("paymentNotes"),
    });

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
      };
    }

    const data = validatedFields.data;

    // ============================================
    // 3. START TRANSACTION
    // ============================================
    session = await mongoose.startSession();
    session.startTransaction();

    // ============================================
    // 4. GET CLAIM (tenant-scoped)
    // ============================================
    const claim = await EmployeeClaim.findOne(
      withTenantScope({ _id: claimId }, companyId, isSuperAdmin),
    ).session(session);

    if (!claim) {
      return {
        errors: {
          _form: ["Claim not found"],
        },
      };
    }

    // ============================================
    // 5. VALIDATE CLAIM
    // ============================================
    if (claim.status !== "approved") {
      return {
        errors: {
          _form: [
            `Cannot pay claim with status "${claim.status}". Claim must be approved.`,
          ],
        },
      };
    }

    if (claim.claimType !== "reimbursement") {
      return {
        errors: {
          _form: [
            "This is not a reimbursement claim. Use the appropriate payment action.",
          ],
        },
      };
    }

    // ============================================
    // 6. RESOLVE EXPENSE ACCOUNTS BY ID (tenant-scoped)
    // ============================================
    const expenseAccountMap = await resolveExpenseAccounts(claim.items, session);

    // ============================================
    // 7. GET SYSTEM ACCOUNTS (tenant-scoped)
    // ============================================
    const employeePayablesAccount = await Account.findOne(
      withTenantScope(
        { systemAccount: "employee_payables" },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);

    if (!employeePayablesAccount) {
      return {
        errors: {
          _form: [
            "Employee Payables account not configured. Please create a system account with code 'employee_payables'.",
          ],
        },
      };
    }

    const paymentAccount = await Account.findById(data.paymentAccountId).session(session);

    if (!paymentAccount) {
      return {
        errors: {
          paymentAccountId: ["Selected payment account not found"],
        },
      };
    }

    // ============================================
    // 8. CREATE JOURNAL ENTRY #1: RECOGNIZE EXPENSE
    // DR: Expense Accounts (by expenseAccountId)
    // CR: Employee Payables (we owe employee)
    // ============================================
    const expenseEntryNumber = await generateUniqueEntryNumber(
      "EXP",
      tenantCompanyId,
    );
    const expenseLines = [];

    // Group expenses by expenseAccountId
    const expensesByAccount = {};
    claim.items.forEach((item) => {
      const key = item.expenseAccountId?.toString() || item.category;
      if (!expensesByAccount[key]) {
        expensesByAccount[key] = { amount: 0, category: item.category };
      }
      expensesByAccount[key].amount += item.amount;
    });

    // DEBIT: Expense accounts
    for (const [accountId, { amount, category }] of Object.entries(expensesByAccount)) {
      const account = expenseAccountMap[accountId];
      expenseLines.push({
        accountId: account._id,
        accountCode: account.accountCode,
        accountName: account.accountName,
        accountType: account.accountType,
        debit: amount,
        credit: 0,
        description: `${category} expenses - ${claim.employee.name}`,
      });
    }

    // CREDIT: Employee Payables
    expenseLines.push({
      accountId: employeePayablesAccount._id,
      accountCode: employeePayablesAccount.accountCode,
      accountName: employeePayablesAccount.accountName,
      accountType: employeePayablesAccount.accountType,
      debit: 0,
      credit: claim.totalAmount,
      description: `Reimbursement owed to ${claim.employee.name}`,
    });

    const expenseJE = await JournalEntry.create(
      [
        {
          companyId: tenantCompanyId,
          entryNumber: expenseEntryNumber,
          entryDate: new Date(),
          entryType: "expense",
          description: `Expense recognition - ${claim.claimNumber}`,
          lines: expenseLines,
          party: {
            type: "employee",
            id: claim.employee.partyId.toString(),
            name: claim.employee.name,
            email: claim.employee.email,
          },
          relatedDocuments: {
            claimId: claim._id,
            claimNumber: claim.claimNumber,
          },
          status: "draft",
          createdBy: formatUserForAudit(user),
        },
      ],
      { session },
    );

    await expenseJE[0].post(formatUserForAudit(user), session);

    // ============================================
    // 9. CREATE JOURNAL ENTRY #2: PAYMENT
    // DR: Employee Payables (clear liability)
    // CR: Cash/Bank/M-Pesa (money out)
    // ============================================
    const paymentEntryNumber = await generateUniqueEntryNumber(
      "PAY",
      tenantCompanyId,
    );

    const paymentJE = await JournalEntry.create(
      [
        {
          companyId: tenantCompanyId,
          entryNumber: paymentEntryNumber,
          entryDate: new Date(),
          entryType: "payment_made",
          description: `Reimbursement payment to ${claim.employee.name} - ${claim.claimNumber}`,
          lines: [
            {
              accountId: employeePayablesAccount._id,
              accountCode: employeePayablesAccount.accountCode,
              accountName: employeePayablesAccount.accountName,
              accountType: employeePayablesAccount.accountType,
              debit: claim.totalAmount,
              credit: 0,
              description: `Clear liability to ${claim.employee.name}`,
            },
            {
              accountId: paymentAccount._id,
              accountCode: paymentAccount.accountCode,
              accountName: paymentAccount.accountName,
              accountType: paymentAccount.accountType,
              debit: 0,
              credit: claim.totalAmount,
              description: `Payment via ${data.paymentMethod}${
                data.paymentReference ? ` - Ref: ${data.paymentReference}` : ""
              }`,
            },
          ],
          party: {
            type: "employee",
            id: claim.employee.partyId.toString(),
            name: claim.employee.name,
            email: claim.employee.email,
          },
          relatedDocuments: {
            claimId: claim._id,
            claimNumber: claim.claimNumber,
          },
          notes: data.paymentNotes || "",
          status: "draft",
          createdBy: formatUserForAudit(user),
        },
      ],
      { session },
    );

    await paymentJE[0].post(formatUserForAudit(user), session);

    // ============================================
    // 10. UPDATE CLAIM
    // ============================================
    claim.journalEntryIds.push(expenseJE[0]._id, paymentJE[0]._id);
    claim.settlementPaymentId = paymentJE[0]._id;
    claim.paidAt = new Date();
    claim.status = "paid";
    claim.lastModifiedBy = formatUserForAudit(user);
    await claim.save({ session });

    // ============================================
    // 11. UPDATE PARTY BALANCE (tenant-scoped)
    // ============================================
    const party = await Party.findOne(
      withTenantScope(
        { _id: claim.employee.partyId },
        tenantCompanyId,
        isSuperAdmin,
      ),
    ).session(session);
    if (party) {
      await party.calculateActualBalance();
    }

    // ============================================
    // 11b. UPDATE PROJECT FINANCIALS
    // Move from committed → cost
    // ============================================
    if (claim.projectId) {
      await Project.findByIdAndUpdate(
        claim.projectId,
        {
          $inc: {
            "financials.totalCosts": claim.totalAmount,
            "financials.totalCommitted": -claim.totalAmount,
          },
        },
        { session },
      );
    }

    // ============================================
    // 12. COMMIT TRANSACTION
    // ============================================
    await session.commitTransaction();

    // ============================================
    // 13. REVALIDATE & RETURN
    // ============================================
    revalidatePath("/dashboard/claims");
    revalidatePath("/dashboard/claims/payments");
    revalidatePath(`/dashboard/claims/${claimId}`);
    revalidateProject(claim.projectId);

    return {
      success: true,
      message: `Reimbursement of KES ${claim.totalAmount.toLocaleString()} paid to ${
        claim.employee.name
      }`,
    };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error paying reimbursement:", error);
    return {
      errors: {
        _form: [
          error.message || "Failed to pay reimbursement. Please try again.",
        ],
      },
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}
