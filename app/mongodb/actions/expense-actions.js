"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import mongoose from "mongoose";

import Expense from "@/app/models/expenses";
import Account from "@/app/models/account";
import Project from "@/app/models/project";
import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";

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
  CREATE: ["Employee", "Accountant", "Manager", "Admin"],
  APPROVE: ["Manager", "Admin"],
  PAY: ["Accountant", "Manager", "Admin"],
  DELETE: ["Admin"],
};

function hasRole(user, allowedRoles) {
  return allowedRoles.includes(user?.role);
}

function formatUser(user) {
  return {
    name: user?.name || user?.email || "System",
    id: user?.id || user?._id?.toString() || "system",
  };
}

// ============================================
// VALIDATION SCHEMAS
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
  vendorId: z.string().optional(), // Party ID if selected from list
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
});

// ============================================
// CREATE EXPENSE
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

export async function createExpense(prevState, formData, { skipRedirect = false } = {}) {
  const rawValues = Object.fromEntries(formData.entries());
  let redirectUrl;

  try {
    const { companyId, user } = await getTenantContext();

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

    // Create expense
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
    });

    revalidatePath("/dashboard/expenses");
    revalidateProject(expense.projectId);

    if (skipRedirect) {
      return { success: true, data: { expenseId: expense._id.toString() } };
    }

    redirectUrl = `/dashboard/expenses?success=${encodeURIComponent(`Expense ${expenseNumber} created`)}`;
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
// UPDATE EXPENSE
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

    if (expense.status !== "draft" && expense.status !== "rejected") {
      return { errors: { _form: ["Can only edit draft or rejected expenses"] }, values: rawValues };
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

    // If was rejected, reset to draft
    if (expense.status === "rejected") {
      expense.status = "draft";
      expense.rejectedAt = null;
      expense.rejectedBy = null;
      expense.rejectionReason = null;
    }

    await expense.save();

    revalidatePath("/dashboard/expenses");
    revalidatePath(`/dashboard/expenses/${expenseId}`);
    revalidateProject(expense.projectId);

    redirectUrl = `/dashboard/expenses/${expenseId}?success=${encodeURIComponent(`Expense ${expense.expenseNumber} updated`)}`;
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
// SUBMIT EXPENSE FOR APPROVAL
// ============================================
export async function submitExpense(expenseId) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    await dbConnect();

    const expense = await Expense.findOne(
      withTenantScope({ _id: expenseId }, companyId, isSuperAdmin)
    );

    if (!expense) {
      return { success: false, error: "Expense not found" };
    }

    if (expense.status !== "draft") {
      return { success: false, error: "Can only submit draft expenses" };
    }

    await expense.submit(formatUser(user));

    revalidatePath("/dashboard/expenses");
    revalidatePath(`/dashboard/expenses/${expenseId}`);
    revalidatePath("/dashboard/expenses/pending");
    revalidateProject(expense.projectId);

    return {
      success: true,
      message: `Expense ${expense.expenseNumber} submitted for approval`,
    };
  } catch (error) {
    console.error("Submit expense error:", error);
    return { success: false, error: error.message || "Failed to submit expense" };
  }
}

// ============================================
// APPROVE EXPENSE
// ============================================
export async function approveExpense(expenseId) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, EXPENSE_ROLES.APPROVE)) {
      return { success: false, error: "Only Managers and Admins can approve expenses" };
    }

    await dbConnect();

    const expense = await Expense.findOne(
      withTenantScope({ _id: expenseId }, companyId, isSuperAdmin)
    );

    if (!expense) {
      return { success: false, error: "Expense not found" };
    }

    if (expense.status !== "pending") {
      return { success: false, error: "Can only approve pending expenses" };
    }

    await expense.approve(formatUser(user));

    // Update project financials — approved expense = committed cost
    if (expense.projectId) {
      await Project.findByIdAndUpdate(expense.projectId, {
        $inc: { "financials.totalCommitted": expense.total },
      });
    }

    revalidatePath("/dashboard/expenses");
    revalidatePath(`/dashboard/expenses/${expenseId}`);
    revalidatePath("/dashboard/expenses/pending");
    revalidateProject(expense.projectId);

    return {
      success: true,
      message: `Expense ${expense.expenseNumber} approved`,
    };
  } catch (error) {
    console.error("Approve expense error:", error);
    return { success: false, error: error.message || "Failed to approve expense" };
  }
}

// ============================================
// REJECT EXPENSE
// ============================================
export async function rejectExpense(expenseId, prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, EXPENSE_ROLES.APPROVE)) {
      return { success: false, error: "Only Managers and Admins can reject expenses" };
    }

    const reason = formData.get("reason")?.toString() || "No reason provided";

    await dbConnect();

    const expense = await Expense.findOne(
      withTenantScope({ _id: expenseId }, companyId, isSuperAdmin)
    );

    if (!expense) {
      return { success: false, error: "Expense not found" };
    }

    if (expense.status !== "pending") {
      return { success: false, error: "Can only reject pending expenses" };
    }

    await expense.reject(formatUser(user), reason);

    revalidatePath("/dashboard/expenses");
    revalidatePath(`/dashboard/expenses/${expenseId}`);
    revalidatePath("/dashboard/expenses/pending");
    revalidateProject(expense.projectId);

    return {
      success: true,
      message: `Expense ${expense.expenseNumber} rejected`,
    };
  } catch (error) {
    console.error("Reject expense error:", error);
    return { success: false, error: error.message || "Failed to reject expense" };
  }
}

// ============================================
// MARK EXPENSE AS PAID
// ============================================
export async function markExpenseAsPaid(expenseId, prevState, formData) {
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

    if (expense.status !== "approved") {
      return { success: false, error: "Expense must be approved before payment" };
    }

    // Update payment details
    expense.paymentMethod = paymentMethod;
    expense.paidFrom = paidFrom;
    await expense.save();

    // Mark as paid (creates journal entry)
    await expense.markAsPaid(formatUser(user), {
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
      message: `Expense ${expense.expenseNumber} marked as paid`,
    };
  } catch (error) {
    console.error("Mark expense as paid error:", error);
    return { success: false, error: error.message || "Failed to mark expense as paid" };
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

    if (expense.status === "paid") {
      return { success: false, error: "Cannot delete paid expenses" };
    }

    if (expense.journalEntryId) {
      return { success: false, error: "Cannot delete expense with journal entry" };
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
// QUICK EXPENSE (Create + Submit in one step)
// ============================================
export async function quickExpense(prevState, formData) {
  // Create without redirecting
  const result = await createExpense(prevState, formData, { skipRedirect: true });

  // If createExpense returned errors, pass them through
  if (result?.errors) {
    return result;
  }

  // Auto-submit for approval
  const submitResult = await submitExpense(result.data.expenseId);

  const message = submitResult.success
    ? "Expense created and submitted for approval"
    : `Expense created (auto-submit failed: ${submitResult.error})`;

  redirect(`/dashboard/expenses?success=${encodeURIComponent(message)}`);
}
