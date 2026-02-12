"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import mongoose from "mongoose";

import Expense from "@/app/models/expenses";
import Account from "@/app/models/account";
import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";

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
export async function createExpense(prevState, formData) {
  try {
    const { companyId, user } = await getTenantContext();

    if (!hasRole(user, EXPENSE_ROLES.CREATE)) {
      return { success: false, error: "Insufficient permissions to create expenses" };
    }

    await dbConnect();

    // Parse and validate form data
    const rawData = Object.fromEntries(formData.entries());
    const validatedData = expenseSchema.parse(rawData);

    // Get expense account details
    const expenseAccount = await Account.findById(validatedData.accountId);
    if (!expenseAccount) {
      return { success: false, error: "Expense account not found" };
    }

    if (expenseAccount.accountType !== "expense") {
      return { success: false, error: "Selected account is not an expense account" };
    }

    // Generate expense number
    const expenseNumber = await Expense.generateExpenseNumber(companyId);

    // Calculate totals
    const subtotal = validatedData.amount;
    const total = subtotal + validatedData.taxAmount - validatedData.withholdingTax;

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
        id: validatedData.vendorId || null, // Party ID if selected from list
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
      status: "draft",
      createdBy: formatUser(user),
    });

    revalidatePath("/dashboard/expenses");

    return {
      success: true,
      message: `Expense ${expenseNumber} created`,
      data: { expenseId: expense._id.toString() },
    };
  } catch (error) {
    console.error("Create expense error:", error);
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: error.message || "Failed to create expense" };
  }
}

// ============================================
// UPDATE EXPENSE
// ============================================
export async function updateExpense(expenseId, prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    await dbConnect();

    // Get expense
    const expense = await Expense.findOne(
      withTenantScope({ _id: expenseId }, companyId, isSuperAdmin)
    );

    if (!expense) {
      return { success: false, error: "Expense not found" };
    }

    if (expense.status !== "draft" && expense.status !== "rejected") {
      return { success: false, error: "Can only edit draft or rejected expenses" };
    }

    // Parse and validate form data
    const rawData = Object.fromEntries(formData.entries());
    const validatedData = expenseSchema.parse(rawData);

    // Get expense account details
    const expenseAccount = await Account.findById(validatedData.accountId);
    if (!expenseAccount || expenseAccount.accountType !== "expense") {
      return { success: false, error: "Invalid expense account" };
    }

    // Calculate totals
    const subtotal = validatedData.amount;
    const total = subtotal + validatedData.taxAmount - validatedData.withholdingTax;

    // Update expense
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

    return {
      success: true,
      message: `Expense ${expense.expenseNumber} updated`,
    };
  } catch (error) {
    console.error("Update expense error:", error);
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: error.message || "Failed to update expense" };
  }
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

    revalidatePath("/dashboard/expenses");
    revalidatePath(`/dashboard/expenses/${expenseId}`);
    revalidatePath("/dashboard/expenses/pending");

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

    revalidatePath("/dashboard/expenses");
    revalidatePath(`/dashboard/expenses/${expenseId}`);
    revalidatePath("/dashboard/journal");

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
  const result = await createExpense(prevState, formData);

  if (!result.success) {
    return result;
  }

  // Auto-submit for approval
  const submitResult = await submitExpense(result.data.expenseId);

  if (!submitResult.success) {
    return {
      success: true,
      message: `${result.message} (Note: Auto-submit failed - ${submitResult.error})`,
      data: result.data,
    };
  }

  return {
    success: true,
    message: `Expense created and submitted for approval`,
    data: result.data,
  };
}
