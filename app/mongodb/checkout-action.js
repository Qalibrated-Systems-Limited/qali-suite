"use server";

import { auth } from "@/auth";
import { ItemCheckout } from "../models/checkouts";
import Product from "../models/product";
import { StockMovement } from "../models/stockmovement";
import JournalEntry from "../models/JournalEntry";
import Account from "../models/account";
import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Counter from "../models/counter";
import { format } from "date-fns";
import dbConnect from "../config/dbConnect";
import {
  getTenantContext,
  validateTenantAccess,
} from "@/lib/utils/tenant-utils";
import Invoice from "../models/invoice";

// ============================================
// RETURN CHECKOUT
// ============================================
export async function returnCheckout(checkoutId, prevState, formData) {
  await dbConnect();
  let session;
  let success = false;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const rawFormData = Object.fromEntries(formData.entries());

    // Get authenticated user
    const userSession = await auth();
    if (!userSession?.user) {
      await session.abortTransaction();
      return { message: "Unauthorized. Please log in." };
    }

    const user = userSession.user;
    let userRole = user.role || "user";
    if (userRole && userRole !== "Store Manager") {
      userRole = userRole.toLowerCase();
    }

    // Check if user is store manager or admin
    if (userRole !== "Store Manager" && userRole !== "admin") {
      await session.abortTransaction();
      return { message: "Only store managers can process returns." };
    }

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      await session.abortTransaction();
      return { message: "Company context required" };
    }

    // Get checkout WITH session
    const checkout = await ItemCheckout.findById(checkoutId).session(session);

    if (!checkout) {
      await session.abortTransaction();
      return { message: "Checkout not found" };
    }

    // Validate tenant access
    if (!validateTenantAccess(checkout, companyId, isSuperAdmin)) {
      await session.abortTransaction();
      return { message: "Access denied to this checkout" };
    }

    // Check if checkout can be returned (only checked_out or overdue items)
    const returnableStatuses = ["checked_out", "overdue"];
    if (!returnableStatuses.includes(checkout.status)) {
      await session.abortTransaction();
      const statusMessages = {
        returned: "This item has already been returned",
        lost: "This item was marked as lost and cannot be returned",
        damaged: "This item was marked as damaged and already processed",
        converted_to_sale:
          "This item was converted to a sale and cannot be returned",
      };
      return {
        message:
          statusMessages[checkout.status] ||
          `Cannot return item with status: ${checkout.status}`,
      };
    }

    // Get return details from form
    const returnCondition = rawFormData.returnCondition;
    const returnNotes = rawFormData.returnNotes || "";
    const damageDetails = rawFormData.damageDetails || "";

    if (!returnCondition) {
      await session.abortTransaction();
      return { message: "Please specify the return condition" };
    }

    // Update product stock (return the item)
    await Product.findByIdAndUpdate(
      checkout.productId,
      { $inc: { "inventory.quantityOnHand": checkout.quantity, "inventory.quantityAvailable": checkout.quantity } },
      { session },
    );

    // Get updated product stock
    const updatedProduct = await Product.findById(checkout.productId).session(
      session,
    );

    // Generate movement number
    const today = format(new Date(), "ddMMyy");
    const counterId = `MOV-${today}`;
    const counter = await Counter.findOneAndUpdate(
      { name: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, session },
    );

    const movementNumber = `${counterId}-${String(counter.seq).padStart(
      3,
      "0",
    )}`;

    // Get cost price for journal entry
    const unitCost = updatedProduct.costing?.costPrice || 0;
    const totalCost = checkout.quantity * unitCost;

    // Get original movement to find original journal entry (for reversal reference)
    let originalJournalEntryId = null;
    if (checkout.relatedDocuments?.movementId) {
      const originalMovement = await StockMovement.findById(
        checkout.relatedDocuments.movementId,
      ).session(session);
      if (originalMovement?.accounting?.journalEntryId) {
        originalJournalEntryId = originalMovement.accounting.journalEntryId;
      }
    }

    // Create stock movement for return
    const movement = await StockMovement.create(
      [
        {
          productId: checkout.productId,
          productSnapshot: {
            name: checkout.productSnapshot.name,
            SKU: checkout.productSnapshot.SKU,
          },
          direction: "in",
          movementNumber: movementNumber,
          movementType: "return",
          quantity: checkout.quantity,
          previousStock: (updatedProduct.inventory?.quantityOnHand || 0) - checkout.quantity,
          newStock: updatedProduct.inventory?.quantityOnHand || 0,
          costing: {
            unitCost,
            totalCost,
            unitPrice:
              updatedProduct.pricing?.sellingPrice || updatedProduct.price || 0,
            totalValue:
              checkout.quantity *
              (updatedProduct.pricing?.sellingPrice ||
                updatedProduct.price ||
                0),
            averageCostAtMovement: unitCost,
          },
          accounting: {
            affectsAccounting: true,
            accountingPosted: false,
          },
          performedBy: {
            name: user.name,
            id: user.id,
            role: "storekeeper",
          },
          returnedBy: {
            name: checkout.checkedOutTo.name,
            id: checkout.checkedOutTo.id,
            department: checkout.checkedOutTo.department,
          },
          relatedDocuments: {
            checkoutId: checkout._id,
            movementId: checkout.relatedDocuments.movementId,
          },
          requiresReturn: false,
          notes: `Returned from checkout ${checkout.checkoutNumber} - Condition: ${returnCondition}`,
          companyId, // Tenant isolation
        },
      ],
      { session },
    );

    // ============================================
    // CREATE REVERSAL JOURNAL ENTRY
    // DR: Inventory (stock coming back in)
    // CR: Technician Stock (reducing technician's held stock)
    // ============================================
    if (totalCost > 0) {
      const journalEntry = await createReturnJournalEntry(
        movement[0],
        totalCost,
        user,
        session,
        companyId,
        originalJournalEntryId,
      );

      // Update movement with journal entry reference
      movement[0].accounting.journalEntryId = journalEntry._id;
      movement[0].accounting.accountingPosted = true;
      movement[0].accounting.accountingPostedAt = new Date();
      await movement[0].save({ session });
    }

    // Update checkout record
    checkout.status =
      returnCondition === "lost"
        ? "lost"
        : returnCondition === "damaged"
          ? "damaged"
          : "returned";
    checkout.returnedDate = new Date();
    checkout.actualReturnDate = new Date();
    checkout.returnedBy = {
      name: user.name,
      id: user.id,
    };
    checkout.returnCondition = returnCondition;
    checkout.returnNotes = returnNotes;
    checkout.damageDetails = damageDetails;
    checkout.relatedDocuments.returnMovementId = movement[0]._id;

    await checkout.save({ session });

    // ============================================
    // CANCEL LINKED DRAFT INVOICES (for sale-type checkouts)
    // ============================================
    // If items are returned, any active draft invoice must be cancelled
    // since there's nothing to sell anymore
    // Note: We update directly since the checkout return already handles
    // inventory restoration - the invoice cancel logic would try to flag
    // the checkout for return (but it's already being returned)
    if (checkout.requestType === "sale") {
      const linkedInvoices = await Invoice.find({
        companyId,
        status: { $in: ["draft", "sent"] },
        "items.relatedCheckout.checkoutId": checkout._id,
      }).session(session);

      for (const invoice of linkedInvoices) {
        // Directly update invoice status (inventory already handled by checkout return)
        invoice.status = "cancelled";
        invoice.cancelledAt = new Date();
        invoice.cancelledBy = {
          name: user.name,
          id: user.id,
        };
        invoice.cancellationReason = `Auto-cancelled: Items returned via checkout ${checkout.checkoutNumber}`;
        invoice.lastModifiedBy = {
          name: user.name,
          id: user.id,
        };

        // Mark items as no longer committed (for sale requests, stock was deducted not committed)
        for (const item of invoice.items) {
          item.stockCommitted = false;
        }

        await invoice.save({ session });
      }
    }

    // Commit transaction
    await session.commitTransaction();

    // Revalidate paths
    revalidatePath("/dashboard/checkout");
    revalidatePath("/dashboard/stocks");
    revalidatePath("/dashboard/invoices");

    success = true;
  } catch (error) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error returning checkout:", error);

    return {
      message: error.message || "Failed to process return",
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }

  // Redirect after successful return (outside try/catch to avoid redirect being caught)
  if (success) {
    redirect("/dashboard/checkout");
  }
}

// ============================================
// ESCALATE CHECKOUT
// ============================================
export async function escalateCheckout(checkoutId, prevState, formData) {
  await dbConnect();
  try {
    const rawFormData = Object.fromEntries(formData.entries());

    // Get authenticated user
    const userSession = await auth();
    if (!userSession?.user) {
      return { message: "Unauthorized. Please log in." };
    }

    const user = userSession.user;
    let userRole = user.role || "user";
    if (userRole && userRole !== "Store Manager") {
      userRole = userRole.toLowerCase();
    }

    // Check permissions
    if (userRole !== "Store Manager" && userRole !== "admin") {
      return { message: "Only store managers can escalate checkouts." };
    }

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      return { message: "Company context required" };
    }

    const checkout = await ItemCheckout.findById(checkoutId);

    if (!checkout) {
      return { message: "Checkout not found" };
    }

    // Validate tenant access
    if (!validateTenantAccess(checkout, companyId, isSuperAdmin)) {
      return { message: "Access denied to this checkout" };
    }

    if (checkout.status !== "checked_out") {
      return { message: "Only active checkouts can be escalated" };
    }

    // Get escalation details
    const escalatedToName = rawFormData.escalatedToName;
    const escalatedToId = rawFormData.escalatedToId;
    const reason = rawFormData.reason || "Overdue item";

    if (!escalatedToName || !escalatedToId) {
      return { message: "Please specify who to escalate to" };
    }

    // Update checkout
    checkout.isEscalated = true;
    checkout.escalatedTo = {
      name: escalatedToName,
      id: escalatedToId,
      escalatedAt: new Date(),
      reason: reason,
    };

    // Add internal note
    const escalationNote = `Escalated by ${user.name} to ${escalatedToName} - Reason: ${reason}`;
    checkout.internalNotes = checkout.internalNotes
      ? `${checkout.internalNotes}\n${escalationNote}`
      : escalationNote;

    await checkout.save();

    revalidatePath("/dashboard/checkouts");

    return { message: "success" };
  } catch (error) {
    console.error("Error escalating checkout:", error);

    return {
      message: error.message || "Failed to escalate checkout",
    };
  }
}

// ============================================
// UPDATE CHECKOUT STATUS (for lost/damaged)
// ============================================
export async function updateCheckoutStatus(checkoutId, prevState, formData) {
  await dbConnect();
  try {
    const rawFormData = Object.fromEntries(formData.entries());

    // Get authenticated user
    const userSession = await auth();
    if (!userSession?.user) {
      return { message: "Unauthorized. Please log in." };
    }

    const user = userSession.user;
    let userRole = user.role || "user";
    if (userRole && userRole !== "Store Manager") {
      userRole = userRole.toLowerCase();
    }

    if (userRole !== "Store Manager" && userRole !== "admin") {
      return { message: "Only store managers can update checkout status." };
    }

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      return { message: "Company context required" };
    }

    const checkout = await ItemCheckout.findById(checkoutId);

    if (!checkout) {
      return { message: "Checkout not found" };
    }

    // Validate tenant access
    if (!validateTenantAccess(checkout, companyId, isSuperAdmin)) {
      return { message: "Access denied to this checkout" };
    }

    const newStatus = rawFormData.status;
    const notes = rawFormData.notes || "";

    if (!newStatus) {
      return { message: "Please specify a status" };
    }

    // Validate status transition
    const validStatuses = [
      "checked_out",
      "returned",
      "overdue",
      "lost",
      "damaged",
    ];
    if (!validStatuses.includes(newStatus)) {
      return { message: "Invalid status" };
    }

    checkout.status = newStatus;

    if (notes) {
      checkout.internalNotes = checkout.internalNotes
        ? `${checkout.internalNotes}\nStatus changed to ${newStatus} by ${user.name}: ${notes}`
        : `Status changed to ${newStatus} by ${user.name}: ${notes}`;
    }

    await checkout.save();

    revalidatePath("/dashboard/checkouts");

    return { message: "success" };
  } catch (error) {
    console.error("Error updating checkout status:", error);

    return {
      message: error.message || "Failed to update checkout status",
    };
  }
}

// ============================================
// HELPER: CREATE RETURN JOURNAL ENTRY
// Reverses the original fulfillment JE
// DR: Inventory (stock coming back)
// CR: Technician Stock (reducing tech's held stock)
// ============================================
async function createReturnJournalEntry(
  stockMovement,
  totalCost,
  user,
  session,
  companyId,
  originalJournalEntryId = null,
) {
  // Get system accounts
  const accountFilter = companyId ? { companyId } : {};

  let techStockAccount = await Account.findOne({
    ...accountFilter,
    systemAccount: "technician_stock",
  }).session(session);

  const inventoryAccount = await Account.findOne({
    ...accountFilter,
    systemAccount: "inventory",
  }).session(session);

  // Auto-create technician_stock account if it doesn't exist
  if (!techStockAccount && inventoryAccount) {
    const newAccount = await Account.create(
      [
        {
          companyId: companyId || inventoryAccount.companyId,
          accountCode: "1310",
          accountName: "Technician Stock",
          accountType: "Asset",
          subType: "inventory",
          systemAccount: "technician_stock",
          canPost: true,
          isActive: true,
          level: 2,
          description:
            "Stock issued to technicians for demo, installation, or repair",
        },
      ],
      { session },
    );
    techStockAccount = newAccount[0];
  }

  if (!techStockAccount || !inventoryAccount) {
    throw new Error(
      "System accounts not configured (inventory or technician_stock)",
    );
  }

  // Generate journal entry number
  const jeToday = format(new Date(), "yyyyMM");
  const jeCounterId = `JE-${jeToday}`;
  const jeCounter = await Counter.findOneAndUpdate(
    { name: jeCounterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session },
  );
  const entryNumber = `${jeCounterId}-${String(jeCounter.seq).padStart(4, "0")}`;

  // Create reversal journal entry: DR Inventory, CR Technician Stock
  const journalEntry = await JournalEntry.create(
    [
      {
        entryNumber,
        entryDate: new Date(),
        entryType: "transfer",
        description: `Stock returned from technician - ${stockMovement.movementNumber}`,
        lines: [
          {
            accountId: inventoryAccount._id,
            accountCode: inventoryAccount.accountCode,
            accountName: inventoryAccount.accountName,
            accountType: inventoryAccount.accountType,
            debit: totalCost,
            credit: 0,
            description: `Stock returned - ${stockMovement.productSnapshot.name}`,
          },
          {
            accountId: techStockAccount._id,
            accountCode: techStockAccount.accountCode,
            accountName: techStockAccount.accountName,
            accountType: techStockAccount.accountType,
            debit: 0,
            credit: totalCost,
            description: `From technician - ${stockMovement.productSnapshot.name}`,
          },
        ],
        relatedDocuments: {
          movementId: stockMovement._id,
          movementNumber: stockMovement.movementNumber,
          // Reference to original JE being reversed (if exists)
          originalJournalEntryId: originalJournalEntryId,
        },
        isReversal: !!originalJournalEntryId,
        status: "draft",
        createdBy: {
          name: user.name,
          id: user.id,
        },
        companyId,
      },
    ],
    { session },
  );

  // Post journal entry (with session for transaction support)
  await journalEntry[0].post(
    {
      name: user.name,
      id: user.id,
    },
    session,
  );

  return journalEntry[0];
}

// ============================================
// EXPENSE INTERNAL CHECKOUT
// ============================================
// Used for internal use items that are consumed/used (not sold)
// Creates: DR Expense Account, CR Technician Stock
// ============================================
export async function expenseInternalCheckout(checkoutId, prevState, formData) {
  await dbConnect();
  let session;
  let success = false;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const rawFormData = Object.fromEntries(formData.entries());

    // Get authenticated user
    const userSession = await auth();
    if (!userSession?.user) {
      await session.abortTransaction();
      return { message: "Unauthorized. Please log in." };
    }

    const user = userSession.user;
    const userRole = user.role?.toLowerCase();

    // Only Admin or Accountant can expense items
    if (userRole !== "admin" && userRole !== "accountant") {
      await session.abortTransaction();
      return { message: "Only Admin or Accountant can expense internal items." };
    }

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      await session.abortTransaction();
      return { message: "Company context required" };
    }

    // Get checkout WITH session
    const checkout = await ItemCheckout.findById(checkoutId).session(session);

    if (!checkout) {
      await session.abortTransaction();
      return { message: "Checkout not found" };
    }

    // Validate tenant access
    if (!validateTenantAccess(checkout, companyId, isSuperAdmin)) {
      await session.abortTransaction();
      return { message: "Access denied to this checkout" };
    }

    // Only internal use checkouts can be expensed
    if (checkout.requestType !== "internal") {
      await session.abortTransaction();
      return {
        message: `Only internal use items can be expensed. This item is for: ${checkout.requestType}`
      };
    }

    // Check if checkout can be expensed
    if (checkout.status !== "checked_out" && checkout.status !== "overdue") {
      await session.abortTransaction();
      const statusMessages = {
        returned: "This item has already been returned",
        lost: "This item was marked as lost",
        damaged: "This item was marked as damaged",
        converted_to_sale: "This item was converted to a sale",
        expensed: "This item has already been expensed",
      };
      return {
        message: statusMessages[checkout.status] || `Cannot expense item with status: ${checkout.status}`,
      };
    }

    // Get expense account from form
    const expenseAccountId = rawFormData.expenseAccountId;
    const reason = rawFormData.reason || "Internal use - consumed";
    const quantityToExpense = parseInt(rawFormData.quantity) || checkout.quantity;

    if (!expenseAccountId) {
      await session.abortTransaction();
      return { message: "Please select an expense account" };
    }

    if (quantityToExpense > checkout.quantity) {
      await session.abortTransaction();
      return { message: `Cannot expense more than checked out quantity (${checkout.quantity})` };
    }

    // Get expense account
    const expenseAccount = await Account.findById(expenseAccountId).session(session);
    if (!expenseAccount) {
      await session.abortTransaction();
      return { message: "Expense account not found" };
    }

    if (expenseAccount.accountType !== "expense") {
      await session.abortTransaction();
      return { message: "Selected account must be an expense account" };
    }

    // Get technician stock account
    const accountFilter = companyId ? { companyId } : {};
    let techStockAccount = await Account.findOne({
      ...accountFilter,
      systemAccount: "technician_stock",
    }).session(session);

    if (!techStockAccount) {
      await session.abortTransaction();
      return { message: "Technician Stock account not configured" };
    }

    // Get product for costing
    const product = await Product.findById(checkout.productId).session(session);
    if (!product) {
      await session.abortTransaction();
      return { message: "Product not found" };
    }

    const unitCost = product.costing?.costPrice || 0;
    const totalCost = unitCost * quantityToExpense;

    // ============================================
    // CREATE STOCK MOVEMENT
    // ============================================
    const movementToday = format(new Date(), "ddMMyy");
    const movementCounterId = `MOV-${movementToday}`;
    const movementCounter = await Counter.findOneAndUpdate(
      { name: movementCounterId },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, session },
    );
    const movementNumber = `${movementCounterId}-${String(movementCounter.seq).padStart(3, "0")}`;

    const movement = await StockMovement.create(
      [
        {
          companyId,
          productId: checkout.productId,
          movementNumber,
          productSnapshot: {
            name: checkout.productSnapshot?.name || product.name,
            SKU: checkout.productSnapshot?.SKU || product.SKU,
            category: product.category,
            unit: product.unit,
          },
          movementType: "expense",
          direction: "out",
          quantity: quantityToExpense,
          previousStock: 0, // From technician stock, not main inventory
          newStock: 0,
          costing: {
            unitCost,
            totalCost,
            unitPrice: 0,
            totalValue: 0,
          },
          performedBy: {
            id: user.id,
            name: user.name,
            role: user.role,
          },
          relatedDocuments: {
            checkoutId: checkout._id,
            checkoutNumber: checkout.checkoutNumber,
          },
          notes: `Internal use expensed to ${expenseAccount.accountName}: ${reason}`,
          reason,
          status: "posted",
          postedAt: new Date(),
          postedBy: {
            name: user.name,
            id: user.id,
          },
          accounting: {
            affectsAccounting: true,
            accountingPosted: false,
          },
        },
      ],
      { session },
    );

    // ============================================
    // CREATE JOURNAL ENTRY
    // DR: Expense Account (cost being recognized)
    // CR: Technician Stock (reducing held stock)
    // ============================================
    const jeToday = format(new Date(), "yyyyMM");
    const jeCounterId = `JE-${jeToday}`;
    const jeCounter = await Counter.findOneAndUpdate(
      { name: jeCounterId },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, session },
    );
    const entryNumber = `${jeCounterId}-${String(jeCounter.seq).padStart(4, "0")}`;

    const journalEntry = await JournalEntry.create(
      [
        {
          companyId,
          entryNumber,
          entryDate: new Date(),
          entryType: "expense",
          description: `Internal use expense - ${checkout.productSnapshot?.name || product.name}`,
          lines: [
            {
              accountId: expenseAccount._id,
              accountCode: expenseAccount.accountCode,
              accountName: expenseAccount.accountName,
              accountType: expenseAccount.accountType,
              debit: totalCost,
              credit: 0,
              description: `${checkout.productSnapshot?.name} - ${reason}`,
            },
            {
              accountId: techStockAccount._id,
              accountCode: techStockAccount.accountCode,
              accountName: techStockAccount.accountName,
              accountType: techStockAccount.accountType,
              debit: 0,
              credit: totalCost,
              description: `From technician stock - ${checkout.checkoutNumber}`,
            },
          ],
          relatedDocuments: {
            movementId: movement[0]._id,
            movementNumber: movement[0].movementNumber,
            checkoutId: checkout._id,
            checkoutNumber: checkout.checkoutNumber,
          },
          status: "draft",
          createdBy: {
            name: user.name,
            id: user.id,
          },
        },
      ],
      { session },
    );

    // Post journal entry
    await journalEntry[0].post(
      { name: user.name, id: user.id },
      session,
    );

    // Update movement with journal entry reference
    movement[0].accounting.journalEntryId = journalEntry[0]._id;
    movement[0].accounting.accountingPosted = true;
    movement[0].accounting.accountingPostedAt = new Date();
    await movement[0].save({ session });

    // ============================================
    // UPDATE CHECKOUT RECORD
    // ============================================
    checkout.status = "expensed";
    checkout.actualReturnDate = new Date(); // Mark as resolved (removes from active list)
    checkout.expenseConversion = {
      expensed: true,
      expensedAt: new Date(),
      expensedBy: {
        name: user.name,
        id: user.id,
      },
      expenseAccount: {
        id: expenseAccount._id,
        code: expenseAccount.accountCode,
        name: expenseAccount.accountName,
      },
      journalEntryId: journalEntry[0]._id,
      reason,
      quantityExpensed: quantityToExpense,
      totalCost,
    };
    // Clear return-related fields (no longer pending)
    checkout.expectedReturnDate = null;
    checkout.returnRequired = {
      required: false,
      reason: null,
      requiredAt: null,
      requiredBy: null,
      returnDeadline: null,
    };

    // Add internal note
    const expenseNote = `Expensed by ${user.name} to ${expenseAccount.accountName} - Qty: ${quantityToExpense}, Cost: ${totalCost.toFixed(2)} - ${reason}`;
    checkout.internalNotes = checkout.internalNotes
      ? `${checkout.internalNotes}\n${expenseNote}`
      : expenseNote;

    await checkout.save({ session });

    // Commit transaction
    await session.commitTransaction();

    // Revalidate paths
    revalidatePath("/dashboard/checkout");
    revalidatePath("/dashboard/checkouts");
    revalidatePath("/dashboard/stocks");
    revalidatePath("/dashboard/accounts");

    success = true;
  } catch (error) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error expensing checkout:", error);

    return {
      message: error.message || "Failed to expense internal item",
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }

  // Redirect after successful expense
  if (success) {
    redirect("/dashboard/checkout");
  }
}
