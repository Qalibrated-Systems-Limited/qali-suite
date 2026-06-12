"use server";

import { revalidatePath } from "next/cache";
import { roleAllowed } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { z } from "zod";
import mongoose from "mongoose";

import Expense from "@/app/models/expenses";
import Account from "@/app/models/account";
import Project from "@/app/models/project";
import Asset from "@/app/models/asset";
import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";

function revalidateProject(projectId) {
  if (projectId) {
    revalidatePath("/dashboard/projects");
    revalidatePath(`/dashboard/projects/${projectId}`);
  }
}

// ============================================
// ROLE-BASED ACCESS
// ============================================
const EXPENSE_ROLES = {
  CREATE: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant", "Manager", "Employee"],
  PAY: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant", "Manager"],
  DELETE: ["SuperAdmin", "Admin", "CFO"],
};

function hasRole(user, allowedRoles) {
  return roleAllowed(user?.role, allowedRoles);
}

function formatUser(user) {
  return {
    name: user?.name || user?.email || "System",
    id: user?.id || user?._id?.toString() || "system",
  };
}

// ============================================
// VALIDATION SCHEMA
// ============================================
const expenseSchema = z.object({
  expenseDate: z.string().min(1, "Expense date is required"),
  category: z.string().min(1, "Category is required"),
  accountId: z.string().min(1, "Expense account is required"),
  amount: z.coerce.number().positive("Amount must be positive"),
  taxAmount: z.coerce.number().min(0).optional().default(0),
  taxRate: z.coerce.number().min(0).max(100).optional().default(0),
  withholdingTax: z.coerce.number().min(0).optional().default(0),
  paymentMethod: z.enum(["cash", "mpesa", "bank_transfer", "cheque", "card", "unpaid"]).default("unpaid"),
  paidFrom: z.string().optional(),
  vendorId: z.string().optional(),
  vendorType: z.enum(["supplier", "employee"]).optional().default("supplier"),
  vendorName: z.string().min(1, "Vendor name is required"),
  vendorPhone: z.string().optional(),
  vendorEmail: z.string().email().optional().or(z.literal("")),
  vendorTaxPin: z.string().optional(),
  description: z.string().min(1, "Description is required"),
  reference: z.string().optional(),
  invoiceNumber: z.string().optional(),
  isReimbursable: z.coerce.boolean().default(false),
  employeeId: z.string().optional(),
  employeeName: z.string().optional(),
  notes: z.string().optional(),
  assetId: z.string().optional(),
});

// ============================================
// RESOLVE LINKED ASSET (optional)
// ============================================
// Returns { snapshot } on success or { error } if assetId is set but invalid
// for this tenant. Returning a null snapshot clears any existing link.
async function resolveAssetSnapshot(rawAssetId, companyId, isSuperAdmin) {
  if (!rawAssetId) return { snapshot: null };
  const trimmed = rawAssetId.toString().trim();
  if (!trimmed || trimmed === "none") return { snapshot: null };
  if (!mongoose.Types.ObjectId.isValid(trimmed)) {
    return { error: "Invalid asset reference" };
  }
  const asset = await Asset.findOne(
    withTenantScope({ _id: trimmed }, companyId, isSuperAdmin)
  )
    .select("_id assetNumber name status")
    .lean();
  if (!asset) return { error: "Asset not found" };
  return {
    snapshot: {
      id: asset._id,
      assetNumber: asset.assetNumber,
      name: asset.name,
    },
  };
}

// ============================================
// PARSE RECEIPTS FROM FORM
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
          uploadedBy: formatUser(user),
        }));
      }
    }
  } catch {}
  return [];
}

// ============================================
// CREATE EXPENSE (creates + auto-posts JE)
// ============================================
// Industry-standard one-step flow:
//   Paid   → DR Expense / CR Cash|Bank|Mpesa (posted immediately)
//   Unpaid → DR Expense / CR Accrued Expenses (accrual, pay later)
//
export async function createExpense(prevState, formData) {
  const rawValues = Object.fromEntries(formData.entries());
  let redirectUrl;

  try {
    await requirePlanAccess("all-claims");
    const { companyId, user, isSuperAdmin } = await getTenantContext();

    if (!hasRole(user, EXPENSE_ROLES.CREATE)) {
      return { errors: { _form: ["Insufficient permissions to create expenses"] }, values: rawValues };
    }

    await dbConnect();

    // Validate
    const result = expenseSchema.safeParse(rawValues);
    if (!result.success) {
      return { errors: result.error.flatten().fieldErrors, values: rawValues };
    }

    const validatedData = result.data;
    const receipts = parseReceipts(formData, user);

    // Get expense account details
    const expenseAccount = await Account.findById(validatedData.accountId);
    if (!expenseAccount) {
      return { errors: { _form: ["Expense account not found"] }, values: rawValues };
    }
    if (expenseAccount.accountType !== "expense") {
      return { errors: { _form: ["Selected account is not an expense account"] }, values: rawValues };
    }

    // Validate payment account if paid
    if (validatedData.paymentMethod !== "unpaid") {
      if (!validatedData.paidFrom) {
        return { errors: { _form: ["Payment account is required when expense is paid"] }, values: rawValues };
      }
      const paymentAccount = await Account.findById(validatedData.paidFrom);
      if (!paymentAccount) {
        return { errors: { _form: ["Payment account not found"] }, values: rawValues };
      }
    }

    // Generate expense number
    const expenseNumber = await Expense.generateExpenseNumber(companyId);

    // Calculate totals
    const subtotal = validatedData.amount;
    const total = subtotal + validatedData.taxAmount - validatedData.withholdingTax;

    // Resolve project (optional)
    let projectFields = {};
    const rawProjectId = rawValues.projectId;
    if (rawProjectId) {
      const project = await Project.findById(rawProjectId)
        .select("projectNumber name status")
        .lean();
      if (project && project.status !== "closed") {
        projectFields = {
          projectId: project._id,
          project: { projectNumber: project.projectNumber, name: project.name },
        };
      }
    }

    // Resolve linked asset (optional — fuel/repairs/maintenance tracking)
    const assetResolution = await resolveAssetSnapshot(
      validatedData.assetId,
      companyId,
      isSuperAdmin
    );
    if (assetResolution.error) {
      return {
        errors: { assetId: [assetResolution.error] },
        values: rawValues,
      };
    }

    // Create expense as draft (post() will set it to "posted")
    const expense = await Expense.create({
      companyId,
      expenseNumber,
      expenseDate: new Date(validatedData.expenseDate),
      category: validatedData.category,
      accountId: expenseAccount._id,
      accountCode: expenseAccount.accountCode,
      accountName: expenseAccount.accountName,
      amount: validatedData.amount,
      taxAmount: validatedData.taxAmount,
      taxRate: validatedData.taxRate,
      withholdingTax: validatedData.withholdingTax,
      subtotal,
      total,
      currency: "KES",
      paymentMethod: validatedData.paymentMethod,
      paidFrom: validatedData.paidFrom || null,
      paidAt: validatedData.paymentMethod !== "unpaid" ? new Date() : null,
      vendor: {
        id: validatedData.vendorId || null,
        partyType: validatedData.vendorType || "supplier",
        name: validatedData.vendorName,
        phone: validatedData.vendorPhone,
        email: validatedData.vendorEmail,
        taxPin: validatedData.vendorTaxPin,
      },
      description: validatedData.description,
      reference: validatedData.reference,
      invoiceNumber: validatedData.invoiceNumber,
      isReimbursable: validatedData.isReimbursable,
      employeeId: validatedData.employeeId,
      employeeName: validatedData.employeeName,
      notes: validatedData.notes,
      receipts,
      status: "draft",
      createdBy: formatUser(user),
      ...projectFields,
      ...(assetResolution.snapshot ? { asset: assetResolution.snapshot } : {}),
    });

    // Auto-post: creates JE immediately
    await expense.post(formatUser(user));

    // Update project financials
    if (expense.projectId) {
      const isPaid = expense.paymentStatus === "paid";
      await Project.findByIdAndUpdate(expense.projectId, {
        $inc: isPaid
          ? { "financials.totalCosts": expense.total }
          : { "financials.totalCommitted": expense.total },
      });
    }

    revalidatePath("/dashboard/expenses");
    revalidatePath("/dashboard/journal");
    revalidateProject(expense.projectId);

    redirectUrl = `/dashboard/expenses?success=${encodeURIComponent(`Expense ${expenseNumber} posted`)}`;
  } catch (error) {
    console.error("Create expense error:", error);
    return {
      errors: { _form: [error.message || "Failed to create expense"] },
      values: rawValues,
    };
  }

  redirect(redirectUrl);
}

// ============================================
// UPDATE EXPENSE (draft only)
// ============================================
export async function updateExpense(expenseId, prevState, formData) {
  const rawValues = Object.fromEntries(formData.entries());
  let redirectUrl;

  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    await dbConnect();

    const expense = await Expense.findOne(
      withTenantScope({ _id: expenseId }, companyId, isSuperAdmin)
    );

    if (!expense) {
      return { errors: { _form: ["Expense not found"] }, values: rawValues };
    }

    if (expense.status !== "draft") {
      return { errors: { _form: ["Can only edit draft expenses"] }, values: rawValues };
    }

    // Validate
    const result = expenseSchema.safeParse(rawValues);
    if (!result.success) {
      return { errors: result.error.flatten().fieldErrors, values: rawValues };
    }

    const validatedData = result.data;
    const receipts = parseReceipts(formData, user);

    // Get expense account details
    const expenseAccount = await Account.findById(validatedData.accountId);
    if (!expenseAccount || expenseAccount.accountType !== "expense") {
      return { errors: { _form: ["Invalid expense account"] }, values: rawValues };
    }

    // Calculate totals
    const subtotal = validatedData.amount;
    const total = subtotal + validatedData.taxAmount - validatedData.withholdingTax;

    // Update expense
    expense.receipts = receipts;
    expense.expenseDate = new Date(validatedData.expenseDate);
    expense.category = validatedData.category;
    expense.accountId = expenseAccount._id;
    expense.accountCode = expenseAccount.accountCode;
    expense.accountName = expenseAccount.accountName;
    expense.amount = validatedData.amount;
    expense.taxAmount = validatedData.taxAmount;
    expense.taxRate = validatedData.taxRate;
    expense.withholdingTax = validatedData.withholdingTax;
    expense.subtotal = subtotal;
    expense.total = total;
    expense.paymentMethod = validatedData.paymentMethod;
    expense.paidFrom = validatedData.paidFrom || null;
    expense.vendor = {
      name: validatedData.vendorName,
      phone: validatedData.vendorPhone,
      email: validatedData.vendorEmail,
      taxPin: validatedData.vendorTaxPin,
    };
    expense.description = validatedData.description;
    expense.reference = validatedData.reference;
    expense.invoiceNumber = validatedData.invoiceNumber;
    expense.isReimbursable = validatedData.isReimbursable;
    expense.employeeId = validatedData.employeeId;
    expense.employeeName = validatedData.employeeName;
    expense.notes = validatedData.notes;
    expense.lastModifiedBy = formatUser(user);

    // Update project (optional)
    const updatedProjectId = rawValues.projectId;
    if (updatedProjectId) {
      const project = await Project.findById(updatedProjectId)
        .select("projectNumber name status")
        .lean();
      if (project && project.status !== "closed") {
        expense.projectId = project._id;
        expense.project = { projectNumber: project.projectNumber, name: project.name };
      }
    } else {
      expense.projectId = undefined;
      expense.project = undefined;
    }

    // Update linked asset (optional)
    const assetResolution = await resolveAssetSnapshot(
      validatedData.assetId,
      companyId,
      isSuperAdmin
    );
    if (assetResolution.error) {
      return {
        errors: { assetId: [assetResolution.error] },
        values: rawValues,
      };
    }
    expense.asset = assetResolution.snapshot || {
      id: null,
      assetNumber: null,
      name: null,
    };

    await expense.save();

    // Auto-post after update
    await expense.post(formatUser(user));

    revalidatePath("/dashboard/expenses");
    revalidatePath(`/dashboard/expenses/${expenseId}`);
    revalidatePath("/dashboard/journal");
    revalidateProject(expense.projectId);

    redirectUrl = `/dashboard/expenses/${expenseId}?success=${encodeURIComponent(`Expense ${expense.expenseNumber} posted`)}`;
  } catch (error) {
    console.error("Update expense error:", error);
    return {
      errors: { _form: [error.message || "Failed to update expense"] },
      values: rawValues,
    };
  }

  redirect(redirectUrl);
}

// ============================================
// RECORD PAYMENT (for unpaid/accrued expenses)
// ============================================
// Creates clearing JE: DR Accrued Expenses / CR Cash|Bank
//
export async function recordExpensePayment(expenseId, prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, EXPENSE_ROLES.PAY)) {
      return { success: false, error: "Insufficient permissions to record payment" };
    }

    const paymentMethod = formData.get("paymentMethod")?.toString();
    const paidFrom = formData.get("paidFrom")?.toString();
    const paidAt = formData.get("paidAt")?.toString();

    if (!paymentMethod || !paidFrom) {
      return { success: false, error: "Payment method and account are required" };
    }

    await dbConnect();

    const expense = await Expense.findOne(
      withTenantScope({ _id: expenseId }, companyId, isSuperAdmin)
    );

    if (!expense) {
      return { success: false, error: "Expense not found" };
    }

    if (expense.paymentStatus === "paid") {
      return { success: false, error: "Expense is already paid" };
    }

    await expense.recordPayment(formatUser(user), {
      paymentMethod,
      paidFrom,
      paidAt: paidAt ? new Date(paidAt) : new Date(),
    });

    // Update project financials — payment moves from committed to actual cost
    if (expense.projectId) {
      await Project.findByIdAndUpdate(expense.projectId, {
        $inc: {
          "financials.totalCosts": expense.total,
          "financials.totalCommitted": -expense.total,
        },
      });
    }

    revalidatePath("/dashboard/expenses");
    revalidatePath(`/dashboard/expenses/${expenseId}`);
    revalidatePath("/dashboard/journal");
    revalidateProject(expense.projectId);

    return {
      success: true,
      message: `Payment recorded for ${expense.expenseNumber}`,
    };
  } catch (error) {
    console.error("Record expense payment error:", error);
    return { success: false, error: error.message || "Failed to record payment" };
  }
}

// ============================================
// DELETE EXPENSE
// ============================================
export async function deleteExpense(expenseId) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, EXPENSE_ROLES.DELETE)) {
      return { success: false, error: "Only Admins can delete expenses" };
    }

    await dbConnect();

    const expense = await Expense.findOne(
      withTenantScope({ _id: expenseId }, companyId, isSuperAdmin)
    );

    if (!expense) {
      return { success: false, error: "Expense not found" };
    }

    if (expense.journalEntryId) {
      return { success: false, error: "Cannot delete posted expense — void it instead" };
    }

    if (expense.status !== "draft") {
      return { success: false, error: "Can only delete draft expenses" };
    }

    await Expense.deleteOne({ _id: expenseId });

    revalidatePath("/dashboard/expenses");
    revalidateProject(expense.projectId);

    return {
      success: true,
      message: `Expense ${expense.expenseNumber} deleted`,
    };
  } catch (error) {
    console.error("Delete expense error:", error);
    return { success: false, error: error.message || "Failed to delete expense" };
  }
}

// ============================================
// POST LEGACY EXPENSE
// ============================================
// Migrates old pending/approved/rejected expenses
// to the new one-step flow by posting them now.
//
export async function postLegacyExpense(expenseId) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, EXPENSE_ROLES.PAY)) {
      return { success: false, error: "Insufficient permissions" };
    }

    await dbConnect();

    const expense = await Expense.findOne(
      withTenantScope({ _id: expenseId }, companyId, isSuperAdmin)
    );

    if (!expense) {
      return { success: false, error: "Expense not found" };
    }

    // Only handle legacy statuses that don't have a JE yet
    if (!["pending", "approved", "rejected"].includes(expense.status)) {
      return { success: false, error: `Expense is already ${expense.status}` };
    }

    if (expense.journalEntryId) {
      // Already has a JE (approved+paid in the old flow) — just fix the status
      expense.status = expense.paymentMethod !== "unpaid" ? "paid" : "posted";
      expense.paymentStatus = expense.paymentMethod !== "unpaid" ? "paid" : "unpaid";
      expense.postedAt = expense.approvedAt || new Date();
      expense.postedBy = formatUser(user);
      await expense.save();
    } else {
      // No JE yet — reset to draft so post() can run.
      //
      // Edge case: old expense has paymentMethod (e.g. "cash") but no paidFrom
      // account selected. post() would wrongly treat it as an accrual.
      // Fix: clear the paymentMethod so it posts as unpaid accrual.
      // User can then click "Record Payment" to select the correct account.
      if (expense.paymentMethod !== "unpaid" && !expense.paidFrom) {
        expense.paymentMethod = "unpaid";
      }

      expense.status = "draft";
      await expense.save();
      await expense.post(formatUser(user));
    }

    revalidatePath("/dashboard/expenses");
    revalidatePath(`/dashboard/expenses/${expenseId}`);
    revalidatePath("/dashboard/journal");

    return {
      success: true,
      message: `Expense ${expense.expenseNumber} posted`,
    };
  } catch (error) {
    console.error("Post legacy expense error:", error);
    return { success: false, error: error.message || "Failed to post expense" };
  }
}
