"use server";

import { formatAddress } from "@/lib/format-address";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import mongoose from "mongoose";

import CreditNote from "@/app/models/creditNote";
import Invoice from "@/app/models/invoice";
import ApprovalRequest from "@/app/models/approvalRequest";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { generateUniqueEntryNumber } from "@/lib/utils/server-utils";
import { FINANCE_WRITE_ROLES, hasRole } from "@/lib/utils/role-gates";
import { getCompanyThresholds } from "@/app/mongodb/queries/threshold-queries";
import { submitApproval } from "@/app/mongodb/actions/approval-actions";

// ============================================
// VALIDATION SCHEMA
// ============================================
const creditNoteItemSchema = z.object({
  originalItemIndex: z.coerce.number().optional(),
  itemType: z.enum(["product", "service"]),
  productId: z.string().optional(),
  productSKU: z.string().optional(),
  productName: z.string().optional(),
  description: z.string().min(1, "Description is required"),
  unit: z.string().default("pcs"),
  quantity: z.coerce.number().min(0.001, "Quantity must be greater than 0"),
  originalQuantity: z.coerce.number().optional(),
  originalUnitPrice: z.coerce.number().optional(),
  unitPrice: z.coerce.number().min(0, "Unit price cannot be negative"),
  taxRate: z.coerce.number().min(0).max(100).default(16),
  restoreInventory: z.coerce.boolean().default(false),
});

const createCreditNoteSchema = z.object({
  invoiceId: z.string().min(1, "Invoice ID is required"),
  creditNoteDate: z.coerce.date(),
  reason: z.enum([
    "return",
    "damaged",
    "overcharge",
    "cancellation",
    "discount",
    "defective",
    "other",
  ]),
  reasonDescription: z.string().min(1, "Reason description is required"),
  items: z.array(creditNoteItemSchema).min(1, "At least one item is required"),
  notes: z.string().optional(),
  issueImmediately: z.coerce.boolean().default(false),
});

// ============================================
// CREATE CREDIT NOTE
// ============================================
export async function createCreditNote(prevState, formData) {
  await dbConnect();
  const { user, companyId } = await getTenantContext();

  if (!user || !hasRole(user, FINANCE_WRITE_ROLES)) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Parse items from FormData
    const itemsData = [];
    let i = 0;
    while (formData.has(`items[${i}].description`)) {
      itemsData.push({
        originalItemIndex: formData.get(`items[${i}].originalItemIndex`) || i,
        itemType: formData.get(`items[${i}].itemType`) || "product",
        productId: formData.get(`items[${i}].productId`) || undefined,
        productSKU: formData.get(`items[${i}].productSKU`) || undefined,
        productName: formData.get(`items[${i}].productName`) || undefined,
        description: formData.get(`items[${i}].description`),
        unit: formData.get(`items[${i}].unit`) || "pcs",
        quantity: formData.get(`items[${i}].quantity`),
        originalQuantity: formData.get(`items[${i}].originalQuantity`) || undefined,
        originalUnitPrice: formData.get(`items[${i}].originalUnitPrice`) || undefined,
        unitPrice: formData.get(`items[${i}].unitPrice`),
        taxRate: formData.get(`items[${i}].taxRate`) || 16,
        restoreInventory: formData.get(`items[${i}].restoreInventory`) === "true",
      });
      i++;
    }

    const rawData = {
      invoiceId: formData.get("invoiceId"),
      creditNoteDate: formData.get("creditNoteDate"),
      reason: formData.get("reason"),
      reasonDescription: formData.get("reasonDescription"),
      items: itemsData,
      notes: formData.get("notes") || "",
      issueImmediately: formData.get("issueImmediately") === "true",
    };

    // Validate
    const validated = createCreditNoteSchema.parse(rawData);

    // Get the invoice
    const invoice = await Invoice.findOne({
      _id: validated.invoiceId,
      companyId,
    }).lean();

    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    if (invoice.status !== "completed") {
      return { success: false, error: "Can only create credit notes for completed invoices" };
    }

    // Calculate item amounts
    let subtotal = 0;
    let totalTax = 0;

    const processedItems = validated.items.map((item) => {
      const amount = item.quantity * item.unitPrice;
      const taxAmount = (amount * item.taxRate) / 100;
      subtotal += amount;
      totalTax += taxAmount;

      return {
        ...item,
        productId: item.productId ? new mongoose.Types.ObjectId(item.productId) : undefined,
        amount,
        taxAmount,
      };
    });

    const total = subtotal + totalTax;

    // Check if total credits would exceed invoice total
    const existingCredits = (invoice.creditNotes || [])
      .reduce((sum, cn) => sum + (cn.amount || 0), 0);
    const totalAfterCredit = existingCredits + total;

    if (totalAfterCredit > invoice.total + 0.01) {
      return {
        success: false,
        error: `Credit amount (${total.toFixed(2)}) would exceed remaining creditable amount. Invoice total: ${invoice.total.toFixed(2)}, Already credited: ${existingCredits.toFixed(2)}`,
      };
    }

    // Generate credit note number
    const creditNoteNumber = await generateUniqueEntryNumber("CN", companyId);

    // Create credit note
    const creditNote = new CreditNote({
      companyId,
      creditNoteNumber,
      creditNoteDate: validated.creditNoteDate,
      invoice: {
        id: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        originalTotal: invoice.total,
      },
      customer: {
        id: invoice.customer.id,
        name: invoice.customer.name,
        email: invoice.customer.email,
        phone: invoice.customer.phone,
        address: formatAddress(invoice.customer.address),
        taxPin: invoice.customer.taxPin,
      },
      reason: validated.reason,
      reasonDescription: validated.reasonDescription,
      items: processedItems,
      subtotal,
      taxAmount: totalTax,
      total,
      currency: invoice.currency || "KES",
      status: "draft",
      amountRemaining: total,
      notes: validated.notes,
      createdBy: { name: user.name, id: user.id },
    });

    await creditNote.save();

    // Issue immediately if requested
    if (validated.issueImmediately) {
      await creditNote.issue({ name: user.name, id: user.id });
    }

    revalidatePath("/dashboard/credit-notes");
    revalidatePath(`/dashboard/invoices/${validated.invoiceId}`);

    return {
      success: true,
      creditNoteId: creditNote._id.toString(),
      creditNoteNumber: creditNote.creditNoteNumber,
      status: creditNote.status,
    };
  } catch (error) {
    console.error("Create credit note error:", error);

    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: error.flatten().fieldErrors,
      };
    }

    return {
      success: false,
      error: error.message || "Failed to create credit note",
    };
  }
}

// ============================================
// ISSUE CREDIT NOTE
// ============================================
export async function issueCreditNote(creditNoteId) {
  await dbConnect();
  const { user, companyId } = await getTenantContext();

  if (!user || !hasRole(user, FINANCE_WRITE_ROLES)) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const creditNote = await CreditNote.findOne({ _id: creditNoteId, companyId });

    if (!creditNote) {
      return { success: false, error: "Credit note not found" };
    }

    // ============================================
    // APPROVAL GATE — credit notes above threshold
    // ============================================
    // Issuance posts to GL and reduces AR; we want a sign-off when the
    // amount is material. Finance leadership bypasses since they're the
    // ones who'd approve it anyway.
    const APPROVER_ROLES_BYPASS = new Set([
      "SuperAdmin",
      "Admin",
      "CFO",
      "Finance Manager",
    ]);
    const userRole = user?.role;
    const amount = Number(creditNote.total) || 0;
    const userBypasses = APPROVER_ROLES_BYPASS.has(userRole);

    if (!userBypasses && amount > 0) {
      const thresholds = await getCompanyThresholds(
        (companyId || creditNote.companyId)?.toString?.() || null,
      );
      const threshold = Number(thresholds.creditNoteValue) || 0;

      if (threshold > 0 && amount > threshold) {
        // Already pending? Don't create a duplicate.
        const existing = await ApprovalRequest.findOne({
          companyId: creditNote.companyId,
          type: "credit_note",
          status: "submitted",
          "targetRef.kind": "CreditNote",
          "targetRef.id": creditNote._id,
        }).select("_id requestNumber").lean();

        if (existing) {
          return {
            success: false,
            error: `Approval ${existing.requestNumber} is already pending for this credit note.`,
            pendingApprovalId: existing._id.toString(),
          };
        }

        const result = await submitApproval({
          type: "credit_note",
          targetRef: {
            kind: "CreditNote",
            id: creditNote._id,
            label: `${creditNote.creditNoteNumber || creditNote._id} — ${creditNote.customer?.name || "Customer"} — KES ${amount.toLocaleString()}`,
          },
          payload: { creditNoteId: creditNote._id.toString() },
          reason: `Credit note of KES ${amount.toLocaleString()} exceeds threshold of KES ${threshold.toLocaleString()}`,
          context: { amount, threshold, reason: creditNote.reason },
        });

        if (!result.success) {
          return { success: false, error: result.error };
        }

        revalidatePath(`/dashboard/credit-notes/${creditNoteId}`);
        return {
          success: false,
          error: `Credit note exceeds the KES ${threshold.toLocaleString()} approval threshold. Approval ${result.approval.requestNumber} has been submitted.`,
          pendingApprovalId: result.approval._id,
          pendingApprovalNumber: result.approval.requestNumber,
        };
      }
    }

    await creditNote.issue({ name: user.name, id: user.id });

    revalidatePath("/dashboard/credit-notes");
    revalidatePath(`/dashboard/credit-notes/${creditNoteId}`);
    revalidatePath(`/dashboard/invoices/${creditNote.invoice.id}`);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// VOID CREDIT NOTE
// ============================================
export async function voidCreditNote(creditNoteId, prevState, formData) {
  await dbConnect();
  const { user, companyId } = await getTenantContext();

  // Voiding is destructive — restrict to top-level finance authority.
  if (!hasRole(user, ["SuperAdmin", "Admin", "CFO"])) {
    return { success: false, error: "You don't have permission to void credit notes" };
  }

  try {
    const reason = formData?.get?.("reason") || "No reason provided";

    const creditNote = await CreditNote.findOne({ _id: creditNoteId, companyId });

    if (!creditNote) {
      return { success: false, error: "Credit note not found" };
    }

    await creditNote.void({ name: user.name, id: user.id }, reason);

    revalidatePath("/dashboard/credit-notes");
    revalidatePath(`/dashboard/credit-notes/${creditNoteId}`);
    revalidatePath(`/dashboard/invoices/${creditNote.invoice.id}`);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// DELETE DRAFT CREDIT NOTE
// ============================================
export async function deleteDraftCreditNote(creditNoteId) {
  await dbConnect();
  const { user, companyId } = await getTenantContext();

  if (!user || !hasRole(user, FINANCE_WRITE_ROLES)) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const creditNote = await CreditNote.findOne({ _id: creditNoteId, companyId });

    if (!creditNote) {
      return { success: false, error: "Credit note not found" };
    }

    if (creditNote.status !== "draft") {
      return { success: false, error: "Only draft credit notes can be deleted" };
    }

    await creditNote.deleteOne();

    revalidatePath("/dashboard/credit-notes");

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// APPLY CREDIT TO ANOTHER INVOICE
// ============================================
export async function applyCreditToInvoice(creditNoteId, targetInvoiceId, amount) {
  await dbConnect();
  const { user, companyId } = await getTenantContext();

  if (!user || !hasRole(user, FINANCE_WRITE_ROLES)) {
    return { success: false, error: "Unauthorized" };
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const creditNote = await CreditNote.findOne({ _id: creditNoteId, companyId }).session(session);
    if (!creditNote) {
      throw new Error("Credit note not found");
    }

    if (creditNote.status !== "issued") {
      throw new Error("Credit note must be issued before applying to invoices");
    }

    if (creditNote.amountRemaining < amount) {
      throw new Error(`Insufficient credit balance. Available: ${creditNote.amountRemaining.toFixed(2)}`);
    }

    // Get target invoice
    const targetInvoice = await Invoice.findOne({ _id: targetInvoiceId, companyId }).session(session);
    if (!targetInvoice) {
      throw new Error("Target invoice not found");
    }

    if (targetInvoice.status !== "completed") {
      throw new Error("Can only apply credit to completed invoices");
    }

    if (targetInvoice.amountDue <= 0) {
      throw new Error("Target invoice is already fully paid");
    }

    // Validate customer matches
    if (creditNote.customer.id !== targetInvoice.customer?.id) {
      throw new Error("Credit note customer must match invoice customer");
    }

    // Calculate actual amount to apply (can't exceed invoice balance)
    const applyAmount = Math.min(amount, targetInvoice.amountDue, creditNote.amountRemaining);

    // Get accounts
    const Account = mongoose.model("Account");
    const JournalEntry = mongoose.model("JournalEntry");

    const arAccount = await Account.findOne({
      companyId,
      systemAccount: "accounts_receivable",
    });

    if (!arAccount) {
      throw new Error("Accounts Receivable not configured");
    }

    // Create journal entry to apply credit
    // Dr: Accounts Receivable (reduce credit note liability)
    // Cr: Accounts Receivable (reduce invoice receivable)
    // Net effect: Transfer credit from one A/R entry to another
    const { generateUniqueEntryNumber } = await import("@/lib/utils/server-utils");
    const entryNumber = await generateUniqueEntryNumber("CNA", companyId);

    const journalEntry = await JournalEntry.create([{
      companyId,
      entryNumber,
      entryDate: new Date(),
      entryType: "credit_application",
      description: `Apply Credit Note ${creditNote.creditNoteNumber} to Invoice ${targetInvoice.invoiceNumber}`,
      lines: [
        {
          accountId: arAccount._id,
          accountCode: arAccount.accountCode,
          accountName: arAccount.accountName,
          accountType: arAccount.accountType,
          debit: applyAmount,
          credit: 0,
          description: `Clear credit from CN ${creditNote.creditNoteNumber}`,
          party: {
            type: "customer",
            id: creditNote.customer.id,
            name: creditNote.customer.name,
          },
        },
        {
          accountId: arAccount._id,
          accountCode: arAccount.accountCode,
          accountName: arAccount.accountName,
          accountType: arAccount.accountType,
          debit: 0,
          credit: applyAmount,
          description: `Apply credit to Invoice ${targetInvoice.invoiceNumber}`,
          party: {
            type: "customer",
            id: targetInvoice.customer.id,
            name: targetInvoice.customer.name,
          },
        },
      ],
      party: {
        type: "customer",
        id: creditNote.customer.id,
        name: creditNote.customer.name,
      },
      relatedDocuments: {
        creditNoteId: creditNote._id,
        creditNoteNumber: creditNote.creditNoteNumber,
        invoiceId: targetInvoice._id,
        invoiceNumber: targetInvoice.invoiceNumber,
      },
      status: "draft",
      createdBy: { name: user.name, id: user.id },
    }], { session });

    // Post the journal entry
    await journalEntry[0].post({ name: user.name, id: user.id });

    // Update credit note
    creditNote.amountApplied += applyAmount;
    creditNote.amountRemaining -= applyAmount;
    if (creditNote.amountRemaining <= 0.01) {
      creditNote.status = "applied";
    }
    await creditNote.save({ session });

    // Update target invoice
    targetInvoice.amountPaid = (targetInvoice.amountPaid || 0) + applyAmount;
    targetInvoice.amountDue -= applyAmount;
    if (targetInvoice.amountDue <= 0.01) {
      targetInvoice.paymentStatus = "paid";
    } else {
      targetInvoice.paymentStatus = "partial";
    }

    // Track credit application on invoice
    targetInvoice.creditApplications = targetInvoice.creditApplications || [];
    targetInvoice.creditApplications.push({
      creditNoteId: creditNote._id,
      creditNoteNumber: creditNote.creditNoteNumber,
      amount: applyAmount,
      date: new Date(),
      appliedBy: { name: user.name, id: user.id },
    });

    await targetInvoice.save({ session });

    await session.commitTransaction();

    revalidatePath("/dashboard/credit-notes");
    revalidatePath(`/dashboard/credit-notes/${creditNoteId}`);
    revalidatePath(`/dashboard/invoices/${targetInvoiceId}`);

    return {
      success: true,
      amountApplied: applyAmount,
      creditNoteRemaining: creditNote.amountRemaining,
      invoiceBalanceDue: targetInvoice.amountDue,
    };
  } catch (error) {
    await session.abortTransaction();
    console.error("Apply credit to invoice error:", error);
    return { success: false, error: error.message };
  } finally {
    session.endSession();
  }
}

// ============================================
// ISSUE REFUND FROM CREDIT NOTE
// ============================================
export async function issueRefund(creditNoteId, prevState, formData) {
  await dbConnect();
  const { user, companyId } = await getTenantContext();

  if (!user || !hasRole(user, FINANCE_WRITE_ROLES)) {
    return { success: false, error: "Unauthorized" };
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const refundAmount = parseFloat(formData.get("amount"));
    const paymentMethod = formData.get("paymentMethod");
    const bankAccountId = formData.get("bankAccountId");
    const reference = formData.get("reference") || "";
    const notes = formData.get("notes") || "";

    if (!refundAmount || refundAmount <= 0) {
      throw new Error("Valid refund amount is required");
    }

    if (!paymentMethod || !bankAccountId) {
      throw new Error("Payment method and bank account are required");
    }

    const creditNote = await CreditNote.findOne({ _id: creditNoteId, companyId }).session(session);
    if (!creditNote) {
      throw new Error("Credit note not found");
    }

    if (creditNote.status !== "issued") {
      throw new Error("Credit note must be issued before issuing refund");
    }

    if (creditNote.amountRemaining < refundAmount) {
      throw new Error(`Insufficient credit balance. Available: ${creditNote.amountRemaining.toFixed(2)}`);
    }

    // Get accounts
    const Account = mongoose.model("Account");
    const JournalEntry = mongoose.model("JournalEntry");
    const Payment = mongoose.model("Payment");

    const arAccount = await Account.findOne({
      companyId,
      systemAccount: "accounts_receivable",
    });

    const bankAccount = await Account.findById(bankAccountId);
    if (!bankAccount) {
      throw new Error("Bank account not found");
    }

    if (!["bank", "cash", "mpesa"].includes(bankAccount.subType)) {
      throw new Error("Invalid payment account type. Must be bank, cash, or mpesa.");
    }

    // Create refund payment record
    const paymentNumber = await Payment.generatePaymentNumber(companyId, "made");

    const payment = await Payment.create([{
      companyId,
      paymentNumber,
      paymentType: "made", // Refund is money going out
      paymentDate: new Date(),
      amount: refundAmount,
      currency: creditNote.currency,
      paymentMethod,
      paymentAccountId: bankAccount._id,
      paymentAccountCode: bankAccount.accountCode,
      paymentAccountName: bankAccount.accountName,
      party: {
        type: "customer",
        id: creditNote.customer.id,
        name: creditNote.customer.name,
      },
      reference,
      notes: notes || `Refund for Credit Note ${creditNote.creditNoteNumber}`,
      relatedDocuments: {
        creditNoteId: creditNote._id,
        creditNoteNumber: creditNote.creditNoteNumber,
        invoiceId: creditNote.invoice.id,
        invoiceNumber: creditNote.invoice.invoiceNumber,
      },
      status: "completed",
      completedAt: new Date(),
      createdBy: { name: user.name, id: user.id },
    }], { session });

    // Create journal entry for refund
    // Dr: Accounts Receivable (clear the credit)
    // Cr: Bank/Cash (money going out)
    const { generateUniqueEntryNumber } = await import("@/lib/utils/server-utils");
    const entryNumber = await generateUniqueEntryNumber("REF", companyId);

    const journalEntry = await JournalEntry.create([{
      companyId,
      entryNumber,
      entryDate: new Date(),
      entryType: "refund",
      description: `Refund for Credit Note ${creditNote.creditNoteNumber}`,
      lines: [
        {
          accountId: arAccount._id,
          accountCode: arAccount.accountCode,
          accountName: arAccount.accountName,
          accountType: arAccount.accountType,
          debit: refundAmount,
          credit: 0,
          description: `Clear credit balance`,
          party: {
            type: "customer",
            id: creditNote.customer.id,
            name: creditNote.customer.name,
          },
        },
        {
          accountId: bankAccount._id,
          accountCode: bankAccount.accountCode,
          accountName: bankAccount.accountName,
          accountType: bankAccount.accountType,
          debit: 0,
          credit: refundAmount,
          description: `Refund to ${creditNote.customer.name}`,
        },
      ],
      party: {
        type: "customer",
        id: creditNote.customer.id,
        name: creditNote.customer.name,
      },
      relatedDocuments: {
        creditNoteId: creditNote._id,
        creditNoteNumber: creditNote.creditNoteNumber,
        paymentId: payment[0]._id,
        paymentNumber: payment[0].paymentNumber,
      },
      status: "draft",
      createdBy: { name: user.name, id: user.id },
    }], { session });

    await journalEntry[0].post({ name: user.name, id: user.id });

    // Link journal entry to payment
    payment[0].journalEntryId = journalEntry[0]._id;
    await payment[0].save({ session });

    // Update credit note
    creditNote.amountApplied += refundAmount;
    creditNote.amountRemaining -= refundAmount;
    if (creditNote.amountRemaining <= 0.01) {
      creditNote.status = "applied";
    }
    await creditNote.save({ session });

    await session.commitTransaction();

    revalidatePath("/dashboard/credit-notes");
    revalidatePath(`/dashboard/credit-notes/${creditNoteId}`);
    revalidatePath("/dashboard/payments");

    return {
      success: true,
      paymentId: payment[0]._id.toString(),
      paymentNumber: payment[0].paymentNumber,
      refundAmount,
      creditNoteRemaining: creditNote.amountRemaining,
    };
  } catch (error) {
    await session.abortTransaction();
    console.error("Issue refund error:", error);
    return { success: false, error: error.message };
  } finally {
    session.endSession();
  }
}

// ============================================
// GET CUSTOMER INVOICES FOR CREDIT APPLICATION
// ============================================
export async function getCustomerInvoicesForCredit(customerId) {
  await dbConnect();
  const { companyId } = await getTenantContext();

  try {
    const invoices = await Invoice.find({
      companyId,
      "customer.id": customerId,
      status: "completed",
      amountDue: { $gt: 0 },
    })
      .select("invoiceNumber invoiceDate total amountDue amountPaid customer")
      .sort({ dueDate: 1 })
      .lean();

    return {
      success: true,
      invoices: invoices.map((inv) => ({
        ...inv,
        _id: inv._id.toString(),
      })),
    };
  } catch (error) {
    return { success: false, error: error.message, invoices: [] };
  }
}
