"use server";

import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { StockRequest } from "../models/requests";
import Product from "../models/product";
import Counter from "../models/counter";
import { ItemCheckout } from "../models/checkouts";
import { StockMovement } from "../models/stockmovement";
import { format } from "date-fns";
import DeliveryNote from "../models/dnote";
import Invoice from "../models/invoice";
import dbConnect from "../config/dbConnect";
import Account from "../models/account";
import JournalEntry from "../models/JournalEntry";
import {
  getTenantContext,
  validateTenantAccess,
} from "@/lib/utils/tenant-utils";
import { stockRequestTypes, stockRequestTypeConfig } from "@/lib/utils";
import Project from "../models/project";
import Company from "../models/Company";
import { requireFreshSession } from "@/lib/utils/session-freshness";

// Senior approval roles — bypass value threshold + department routing.
// Includes finance leadership so they can approve cross-department
// requests without escalation.
const SENIOR_APPROVAL_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
]);

function revalidateProject(projectId) {
  if (projectId) {
    revalidatePath("/dashboard/projects");
    revalidatePath(`/dashboard/projects/${projectId}`);
  }
}

// ============================================
// 1. APPROVE REQUEST (Manager/Admin only)
// ============================================

async function generateRequestNumber(session) {
  const today = format(new Date(), "ddMMyy");
  const counterId = `REQ-${today}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session }
  );

  return `${counterId}-${String(counter.seq).padStart(3, "0")}`;
}
export async function approveRequest(requestId, prevState, formData) {
  await dbConnect();
  let session;
  let success = false;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const rawFormData = Object.fromEntries(formData.entries());
    const comments = rawFormData.comments || "";
    const conditions = rawFormData.conditions || "";

    // Freshness check — reject if approver's session is stale (their
    // role may have been changed mid-flight).
    const fresh = await requireFreshSession();
    if (!fresh.ok) {
      await session.abortTransaction();
      return { message: fresh.message };
    }
    const user = fresh.session.user;

    // Check if user has permission to approve
    if (
      !["SuperAdmin", "Admin", "Manager", "Store Manager"].includes(user.role)
    ) {
      await session.abortTransaction();
      return { message: "You don't have permission to approve requests." };
    }

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      await session.abortTransaction();
      return { message: "Company context required" };
    }

    // Get request
    const request = await StockRequest.findById(requestId).session(session);

    if (!request) {
      await session.abortTransaction();
      return { message: "Request not found" };
    }

    // Validate tenant access
    if (!validateTenantAccess(request, companyId, isSuperAdmin)) {
      await session.abortTransaction();
      return { message: "Access denied to this request" };
    }

    // Check if request can be approved
    if (!request.canApprove(user.id)) {
      await session.abortTransaction();
      return { message: "This request cannot be approved" };
    }

    // ========================================
    // VALUE THRESHOLD + DEPARTMENT ROUTING
    // ========================================
    // Senior roles (Admin / CFO / Finance Manager / SuperAdmin) can
    // approve any request regardless of value or department — they ARE
    // the escalation path. Manager / Store Manager are bounded:
    //   - Value: requests above `stockRequestValue` need senior approval
    //   - Department: must match the requester's department
    // Without these, a Sales Manager could approve a 5M KES Technical
    // request they have no context for.
    const isSenior = SENIOR_APPROVAL_ROLES.has(user.role);
    if (!isSenior) {
      const companyDoc = await Company.findById(request.companyId)
        .select("settings.approvalThresholds")
        .session(session)
        .lean();
      const threshold =
        companyDoc?.settings?.approvalThresholds?.stockRequestValue ?? 100_000;

      const requestValue = request.totalValue || 0;
      if (requestValue > threshold) {
        await session.abortTransaction();
        return {
          message: `Request value (${requestValue.toLocaleString("en-KE")}) exceeds the ${threshold.toLocaleString("en-KE")} threshold for your role. A senior approver (Admin / CFO / Finance Manager) must sign this off.`,
        };
      }

      // Department routing — Manager / Store Manager can only approve
      // their own department's requests. (`user.department` lives in
      // the session per the JWT.)
      const approverDept = user.department;
      const requesterDept = request.requester?.department;
      if (
        approverDept &&
        requesterDept &&
        approverDept !== requesterDept
      ) {
        await session.abortTransaction();
        return {
          message: `This request is from the ${requesterDept} department. You can only approve requests from your own department (${approverDept}). Ask a senior approver to handle cross-department requests.`,
        };
      }
    }

    // ========================================
    // Extract per-item approvals
    // ========================================
    const itemApprovals = {};

    request.items.forEach((item) => {
      const approvedQty = parseInt(rawFormData[`approved_${item._id}`]);
      const itemNotes = rawFormData[`notes_${item._id}`] || "";

      // If manager specified a quantity, use it
      if (!isNaN(approvedQty)) {
        itemApprovals[item._id.toString()] = {
          quantity: Math.max(0, Math.min(approvedQty, item.requestedQuantity)),
          notes: itemNotes,
        };
      } else {
        // Default: approve full requested quantity
        itemApprovals[item._id.toString()] = {
          quantity: item.requestedQuantity,
          notes: itemNotes,
        };
      }
    });

    // ========================================
    // VALIDATE AND COMMIT INVENTORY
    // ========================================
    // Pre-fetch all products in one query
    const approvedProductIds = request.items
      .filter((item) => {
        const approval = itemApprovals[item._id.toString()];
        return approval && approval.quantity > 0 && item.productId;
      })
      .map((item) => item.productId);

    const approveProducts = approvedProductIds.length > 0
      ? await Product.find({ _id: { $in: approvedProductIds } }).session(session)
      : [];
    const approveProductMap = new Map(approveProducts.map((p) => [p._id.toString(), p]));

    // Reserve stock for each approved item to prevent overselling
    for (const item of request.items) {
      const approval = itemApprovals[item._id.toString()];
      if (!approval || approval.quantity <= 0) continue;

      const product = approveProductMap.get(item.productId.toString());
      if (!product) {
        throw new Error(`Product ${item.productName} not found`);
      }

      const available = product.inventory?.quantityAvailable ?? 0;
      if (approval.quantity > available) {
        throw new Error(
          `Insufficient stock for ${product.name}. Available: ${available}, Approved: ${approval.quantity}`
        );
      }

      // COMMIT the inventory (reserve for this request)
      await Product.findByIdAndUpdate(
        item.productId,
        {
          $inc: {
            "inventory.quantityCommitted": approval.quantity,
            "inventory.quantityAvailable": -approval.quantity,
          },
        },
        { session }
      );

      // Update local cache for subsequent items of same product
      product.inventory.quantityAvailable = available - approval.quantity;
      product.inventory.quantityCommitted =
        (product.inventory.quantityCommitted || 0) + approval.quantity;
    }

    // ========================================
    // Approve the request with item approvals
    // ========================================
    await request.approve(
      {
        name: user.name,
        id: user.id,
        comments,
        conditions,
      },
      itemApprovals
    );

    // Update project committed costs if request is linked to a project
    if (request.projectId) {
      let committedAmount = 0;
      for (const item of request.items) {
        const approval = itemApprovals[item._id.toString()];
        if (approval && approval.quantity > 0) {
          committedAmount += approval.quantity * (item.unitPrice || 0);
        }
      }
      if (committedAmount > 0) {
        await Project.findByIdAndUpdate(
          request.projectId,
          { $inc: { "financials.totalCommitted": committedAmount } },
          { session }
        );
      }
    }

    await session.commitTransaction();
    revalidatePath("/dashboard/requests");
    revalidatePath("/dashboard/stocks");
    revalidateProject(request.projectId);
    success = true;
  } catch (error) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("Error approving request:", error);
    return { message: error.message || "Failed to approve request" };
  } finally {
    if (session) {
      session.endSession();
    }
  }

  // Redirect after success (outside try/catch)
  if (success) {
    redirect("/dashboard/requests");
  }
}

// ============================================
// 2. REJECT REQUEST (Manager/Admin only)
// ============================================
export async function rejectRequest(requestId, prevState, formData) {
  await dbConnect();
  let session;
  let success = false;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const rawFormData = Object.fromEntries(formData.entries());
    const reason = rawFormData.reason;

    if (!reason || reason.trim().length < 10) {
      await session.abortTransaction();
      return {
        message:
          "Please provide a detailed reason for rejection (minimum 10 characters)",
      };
    }

    const fresh = await requireFreshSession();
    if (!fresh.ok) {
      await session.abortTransaction();
      return { message: fresh.message };
    }
    const user = fresh.session.user;

    // Check if user has permission to reject (lowercase comparison was a bug —
    // canonical role names are capitalised, so this used to always fail).
    if (
      !["SuperAdmin", "Admin", "Manager", "Store Manager"].includes(user.role)
    ) {
      await session.abortTransaction();
      return { message: "You don't have permission to reject requests." };
    }

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      await session.abortTransaction();
      return { message: "Company context required" };
    }

    // Get request
    const request = await StockRequest.findById(requestId).session(session);

    if (!request) {
      await session.abortTransaction();
      return { message: "Request not found" };
    }

    // Validate tenant access
    if (!validateTenantAccess(request, companyId, isSuperAdmin)) {
      await session.abortTransaction();
      return { message: "Access denied to this request" };
    }

    // Check if request is pending
    if (request.status !== "pending") {
      await session.abortTransaction();
      return { message: "Only pending requests can be rejected" };
    }

    // Reject the request
    await request.reject({
      name: user.name,
      id: user.id,
      reason,
    });

    await session.commitTransaction();
    revalidatePath("/dashboard/requests");
    revalidateProject(request.projectId);
    success = true;
  } catch (error) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("Error rejecting request:", error);
    return { message: error.message || "Failed to reject request" };
  } finally {
    if (session) {
      session.endSession();
    }
  }

  // Redirect after success (outside try/catch)
  if (success) {
    redirect("/dashboard/requests");
  }
}


// ✅ Helper function to generate movement number (pass session if using Counter)
export async function generateMovementNo(session) {
  const today = format(new Date(), "ddMMyy");
  const counterId = `MOV-${today}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session } // ✅ Use session
  );

  return `${counterId}-${String(counter.seq).padStart(4, "0")}`;
}

// ============================================
// 4. CANCEL REQUEST
// ============================================
export async function cancelRequest(requestId, prevState, formData) {
  await dbConnect();
  let session;
  let success = false;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const rawFormData = Object.fromEntries(formData.entries());
    const reason = rawFormData.reason;

    if (!reason || reason.trim().length < 10) {
      await session.abortTransaction();
      return {
        message:
          "Please provide a reason for cancellation (minimum 10 characters)",
      };
    }

    const fresh = await requireFreshSession();
    if (!fresh.ok) {
      await session.abortTransaction();
      return { message: fresh.message };
    }
    const user = fresh.session.user;

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      await session.abortTransaction();
      return { message: "Company context required" };
    }

    // Get request
    const request = await StockRequest.findById(requestId).session(session);

    if (!request) {
      await session.abortTransaction();
      return { message: "Request not found" };
    }

    // Validate tenant access
    if (!validateTenantAccess(request, companyId, isSuperAdmin)) {
      await session.abortTransaction();
      return { message: "Access denied to this request" };
    }

    // Check permissions. Canonical role names are capitalised; the prior
    // lowercase comparison silently denied Manager/Admin so only the
    // requester could ever cancel.
    const canCancel =
      request.requester.id === user.id ||
      ["SuperAdmin", "Admin", "Manager", "Store Manager"].includes(user.role);

    if (!canCancel) {
      await session.abortTransaction();
      return { message: "You don't have permission to cancel this request" };
    }

    // Check if request can be cancelled
    if (
      request.status === "fulfilled" ||
      request.status === "partially_fulfilled"
    ) {
      await session.abortTransaction();
      return { message: "Cannot cancel a fulfilled request" };
    }

    // ========================================
    // RELEASE COMMITTED INVENTORY (if approved)
    // ========================================
    // If the request was approved, stock was committed and needs to be released
    if (request.status === "approved") {
      for (const item of request.items) {
        // Release the approved quantity (not the requested quantity)
        const approvedQty = item.approvedQuantity || 0;
        if (approvedQty > 0) {
          await Product.findByIdAndUpdate(
            item.productId,
            {
              $inc: {
                "inventory.quantityCommitted": -approvedQty,
                "inventory.quantityAvailable": approvedQty,
              },
            },
            { session }
          );
        }
      }
    }

    // Cancel the request
    await request.cancel(reason);

    await session.commitTransaction();
    revalidatePath("/dashboard/requests");
    revalidatePath("/dashboard/stocks");
    revalidateProject(request.projectId);
    success = true;
  } catch (error) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("Error canceling request:", error);
    return { message: error.message || "Failed to cancel request" };
  } finally {
    if (session) {
      session.endSession();
    }
  }

  // Redirect after success (outside try/catch)
  if (success) {
    redirect("/dashboard/requests");
  }
}

async function generateCheckoutNumber(session) {
  const today = format(new Date(), "ddMMyy");
  const counterId = `CHECK-${today}`;

  const result = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after", session: session }
  );

  const sequence = String(result.seq).padStart(3, "0");
  const checkoutNo = `${counterId}-${sequence}`;

  return checkoutNo;
}

export async function createStockRequest(prevState, formData) {
  await dbConnect();
  let session;

  // Extract raw form data early to return on error
  const rawData = {
    requestType: formData.get("requestType"),
    customerId: formData.get("customerId"),
    customerName: formData.get("customerName"),
    customerEmail: formData.get("customerEmail"),
    customerPhone: formData.get("customerPhone"),
    customerAddress: formData.get("customerAddress"),
    customerTaxPin: formData.get("customerTaxPin"),
    priority: formData.get("priority") || "normal",
    notes: formData.get("notes") || "",
    requiredByDate: formData.get("requiredByDate"),
    items: formData.get("items"),
    projectId: formData.get("projectId") || "",
    projectNumber: formData.get("projectNumber") || "",
    projectName: formData.get("projectName") || "",
  };

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const fresh = await requireFreshSession();
    if (!fresh.ok) {
      return {
        success: false,
        error: fresh.message,
        values: rawData,
      };
    }
    const user = fresh.session.user;

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      return {
        success: false,
        error: "Company context required",
        values: rawData,
      };
    }

    // Field-level validation
    const fieldErrors = {};

    // Validate request type
    if (!rawData.requestType || !stockRequestTypes.includes(rawData.requestType)) {
      fieldErrors.requestType = "Please select a valid request type";
    }

    // Get type config to check if customer is required + role gating
    const typeConfig = stockRequestTypeConfig[rawData.requestType];
    const requiresCustomer = typeConfig?.requiresCustomer ?? true;

    // SoD gate: only roles in the type's `allowedRequesterRoles` may
    // create requests of this kind. Closes the audit gap where any
    // authenticated user could mint a "sale" worth millions.
    if (typeConfig?.allowedRequesterRoles) {
      const allowed = typeConfig.allowedRequesterRoles;
      const isSuperAdmin = user.role === "SuperAdmin";
      if (!isSuperAdmin && !allowed.includes(user.role)) {
        await session.abortTransaction();
        return {
          success: false,
          error: `Your role (${user.role}) cannot create "${typeConfig.label || rawData.requestType}" requests. Ask a ${allowed.slice(0, 3).join(" / ")} to raise it.`,
          values: rawData,
        };
      }
    }

    // Validate customer (conditionally based on request type)
    if (requiresCustomer && (!rawData.customerId || !rawData.customerName?.trim())) {
      fieldErrors.customer = "Please select a customer";
    }

    // Validate items
    if (!rawData.items) {
      fieldErrors.items = "No items provided";
    }

    // Parse items
    let items = [];
    if (rawData.items) {
      try {
        items = JSON.parse(rawData.items);
      } catch (error) {
        fieldErrors.items = "Invalid items data";
      }
    }

    if (items.length === 0 && !fieldErrors.items) {
      fieldErrors.items = "Please add at least one item to the request";
    }

    // Validate priority
    const validPriorities = ["low", "normal", "high", "urgent"];
    if (!validPriorities.includes(rawData.priority)) {
      fieldErrors.priority = "Invalid priority selected";
    }

    // If there are field errors, return them
    if (Object.keys(fieldErrors).length > 0) {
      return {
        success: false,
        error: "Please fix the validation errors",
        fieldErrors,
        values: rawData,
      };
    }

    // Validate and prepare items
    const validatedItems = [];

    for (const item of items) {
      // Verify product exists and has sufficient stock
      const product = await Product.findById(item.productId).session(session);

      if (!product) {
        return {
          success: false,
          error: `Product ${item.productName} not found`,
          fieldErrors: { items: `Product ${item.productName} not found` },
          values: rawData,
        };
      }

      // Check available stock
      const availableStock = product.inventory?.quantityAvailable ?? 0;

      if (item.requestedQuantity > availableStock) {
        return {
          success: false,
          error: `Insufficient stock for ${product.name}`,
          fieldErrors: {
            items: `Insufficient stock for ${product.name}. Available: ${availableStock}, Requested: ${item.requestedQuantity}`,
          },
          values: rawData,
        };
      }

      // Get selling price
      const unitPrice = product.pricing?.sellingPrice ?? 0;

      validatedItems.push({
        productId: product._id,
        productName: product.name,
        SKU: product.SKU,
        currentStock: availableStock,
        requestedQuantity: item.requestedQuantity,
        unitPrice,
        unit: product.unit,
        notes: item.notes || "",
        approvedQuantity: 0,
        fulfillments: [],
        totalFulfilled: 0,
        remainingToFulfill: 0,
        fulfillmentStatus: "pending",
      });
    }

    // Generate request number
    const requestNumber = await generateRequestNumber(session);

    // Parse required by date
    let requiredByDate = null;
    if (rawData.requiredByDate) {
      requiredByDate = new Date(rawData.requiredByDate);
    }

    // Build customer object (only for non-internal requests)
    const customerData = requiresCustomer ? {
      id: rawData.customerId,
      name: rawData.customerName.trim(),
      email: rawData.customerEmail || "",
      phone: rawData.customerPhone || "",
      address: rawData.customerAddress || "",
      taxPin: rawData.customerTaxPin || "",
    } : {
      id: "",
      name: "Internal Use",
    };

    // Resolve project if provided
    if (rawData.projectId) {
      const proj = await Project.findById(rawData.projectId)
        .select("projectNumber name status")
        .session(session)
        .lean();
      if (proj && proj.status !== "closed") {
        rawData._resolvedProject = proj;
      }
    }

    // Create request
    await StockRequest.create(
      [
        {
          requestNumber,
          requestType: rawData.requestType,
          customer: customerData,
          requester: {
            name: user.name,
            id: user.id,
            department: user.department || "Other",
            email: user.email || "",
            phone: user.phone || "",
          },
          items: validatedItems,
          status: "pending",
          priority: rawData.priority,
          notes: rawData.notes,
          requiredByDate,
          approvalHistory: [],
          attachments: [],
          companyId, // Tenant isolation
          // Project linking (optional)
          ...(rawData._resolvedProject && {
            projectId: rawData._resolvedProject._id,
            project: { projectNumber: rawData._resolvedProject.projectNumber, name: rawData._resolvedProject.name },
          }),
        },
      ],
      { session }
    );

    await session.commitTransaction();

    revalidatePath("/dashboard/requests");
    revalidateProject(rawData._resolvedProject?._id);
  } catch (error) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error creating stock request:", error);
    return {
      success: false,
      error: error.message || "Failed to create stock request",
      values: rawData,
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }

  // Redirect on success (must be outside try-catch)
  redirect("/dashboard/requests");
}

// ============================================
// RETURN ITEM CHECKOUT
// ============================================
export async function returnItemCheckout(checkoutId, prevState, formData) {
  await dbConnect();
  let session;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const rawFormData = Object.fromEntries(formData.entries());

    const fresh = await requireFreshSession();
    if (!fresh.ok) throw new Error(fresh.message);
    const user = fresh.session.user;

    // Only Store Manager / Admin / SuperAdmin can process returns. Prior
    // lowercase-compare missed SuperAdmin entirely and was fragile.
    if (!["Store Manager", "Admin", "SuperAdmin"].includes(user.role)) {
      throw new Error("Only store managers can process returns.");
    }

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      throw new Error("Company context required");
    }

    // Get checkout
    const checkout = await ItemCheckout.findById(checkoutId).session(session);

    if (!checkout) {
      throw new Error("Checkout not found");
    }

    // Validate tenant access
    if (!validateTenantAccess(checkout, companyId, isSuperAdmin)) {
      await session.abortTransaction();
      throw new Error("Access denied to this checkout");
    }

    if (checkout.status !== "checked_out") {
      throw new Error("Item is not currently checked out");
    }

    const returnCondition = rawFormData.returnCondition || "good";
    const returnNotes = rawFormData.returnNotes || "";

    // Get product
    const product = await Product.findById(checkout.productId).session(
      session
    );

    if (!product) {
      throw new Error("Product not found");
    }

    const previousOnHand = product.inventory?.quantityOnHand ?? 0;

    // Return stock to inventory
    await Product.findByIdAndUpdate(
      checkout.productId,
      {
        $inc: {
          "inventory.quantityOnHand": checkout.quantity,
          "inventory.quantityAvailable": checkout.quantity,
        },
      },
      { session }
    );

    const updatedProduct = await Product.findById(checkout.productId).session(
      session
    );
    const currentOnHand = updatedProduct.inventory?.quantityOnHand ?? 0;
    const sellingPrice = updatedProduct.pricing?.sellingPrice ?? 0;
    const costPrice = updatedProduct.costing?.costPrice ?? 0;

    // Create return stock movement
    const movementNumber = await generateMovementNumber(session);
    const movement = await StockMovement.create(
      [
        {
          movementNumber,
          productId: checkout.productId,
          productSnapshot: {
            name: checkout.productSnapshot.name,
            SKU: checkout.productSnapshot.SKU,
            unit: updatedProduct.unit,
          },
          direction: "in",
          movementType: "return",
          quantity: checkout.quantity,
          previousStock: previousOnHand,
          newStock: currentOnHand,
          costing: {
            unitCost: costPrice,
            totalCost: checkout.quantity * costPrice,
            unitPrice: sellingPrice,
            totalValue: checkout.quantity * sellingPrice,
            averageCostAtMovement: costPrice,
          },
          accounting: {
            affectsAccounting: true,
            accountingPosted: false,
          },
          performedBy: {
            name: user.name,
            id: user.id,
            role: user.role,
          },
          returnedFrom: {
            name: checkout.checkedOutTo.name,
            id: checkout.checkedOutTo.id,
            department: checkout.checkedOutTo.department,
          },
          relatedDocuments: {
            checkoutId: checkout._id,
            checkoutNumber: checkout.checkoutNumber,
          },
          notes: `Returned by ${checkout.checkedOutTo.name} - ${returnCondition} condition`,
          companyId, // Tenant isolation
        },
      ],
      { session }
    );

    // Create reversal journal entry
    // DR: Inventory, CR: Technician Stock
    const totalCost = movement[0].costing.totalCost;
    const journalEntry = await createReturnJournalEntry(
      movement[0],
      totalCost,
      user,
      session,
      companyId
    );

    // Update movement with journal entry ID
    movement[0].accounting.journalEntryId = journalEntry._id;
    movement[0].accounting.accountingPosted = true;
    movement[0].accounting.accountingPostedAt = new Date();
    await movement[0].save({ session });

    // Update checkout
    checkout.status = "returned";
    checkout.actualReturnDate = new Date();
    checkout.returnedBy = {
      name: user.name,
      id: user.id,
    };
    checkout.returnCondition = returnCondition;
    checkout.returnNotes = returnNotes;
    checkout.relatedDocuments.returnMovementId = movement[0]._id;
    await checkout.save({ session });

    await session.commitTransaction();

    revalidatePath("/dashboard/checkouts");
    revalidatePath("/dashboard/stocks");
    revalidatePath("/dashboard/movements");

    return {
      message: "success",
      details: `Item returned successfully`,
    };
  } catch (error) {
    if (session?.inTransaction()) {
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
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Create journal entry for stock fulfillment
 * DR: Technician Stock, CR: Inventory
 */
async function createFulfillmentJournalEntry(
  stockMovement,
  totalCost,
  user,
  session,
  companyId = null
) {
  // Build account query filter (with or without companyId)
  const accountFilter = companyId ? { companyId } : {};

  // Get system accounts (parallel)
  let [techStockAccount, inventoryAccount] = await Promise.all([
    Account.findOne({ ...accountFilter, systemAccount: "technician_stock" }).session(session),
    Account.findOne({ ...accountFilter, systemAccount: "inventory" }).session(session),
  ]);

  // Auto-create technician_stock account if it doesn't exist
  if (!techStockAccount && inventoryAccount) {
    const newAccount = await Account.create(
      [
        {
          companyId: companyId || inventoryAccount.companyId,
          accountCode: "1310",
          accountName: "Technician Stock",
          accountType: "asset",
          subType: "inventory",
          systemAccount: "technician_stock",
          canPost: true,
          isActive: true,
          level: 2,
          description: "Stock issued to technicians for demo, installation, or repair",
        },
      ],
      { session }
    );
    techStockAccount = newAccount[0];
  }

  if (!techStockAccount) {
    throw new Error(
      "Technician Stock account not found and could not be created. Please create system account 'technician_stock'"
    );
  }

  if (!inventoryAccount) {
    throw new Error(
      "Inventory account not found. Please create system account 'inventory'"
    );
  }

  // Generate entry number
  const entryNumber = await generateJournalEntryNumber(session);

  // Create journal entry
  const journalEntry = await JournalEntry.create(
    [
      {
        entryNumber,
        entryDate: new Date(),
        entryType: "transfer", // Transfer between Inventory and Technician Stock accounts
        description: `Stock issued to technician - ${stockMovement.movementNumber}`,
        lines: [
          {
            accountId: techStockAccount._id,
            accountCode: techStockAccount.accountCode,
            accountName: techStockAccount.accountName,
            accountType: techStockAccount.accountType,
            debit: totalCost,
            credit: 0,
            description: `Stock issued - ${stockMovement.productSnapshot.name}`,
          },
          {
            accountId: inventoryAccount._id,
            accountCode: inventoryAccount.accountCode,
            accountName: inventoryAccount.accountName,
            accountType: inventoryAccount.accountType,
            debit: 0,
            credit: totalCost,
            description: `From inventory - ${stockMovement.productSnapshot.name}`,
          },
        ],
        relatedDocuments: {
          movementId: stockMovement._id,
          movementNumber: stockMovement.movementNumber,
        },
        status: "draft",
        createdBy: {
          name: user.name,
          id: user.id,
        },
        companyId, // Tenant isolation
      },
    ],
    { session }
  );

  // Post journal entry (pass session for transaction support)
  await journalEntry[0].post(
    {
      name: user.name,
      id: user.id,
    },
    session
  );

  return journalEntry[0];
}

/**
 * Create journal entry for item return
 * DR: Inventory, CR: Technician Stock (reversal)
 */
async function createReturnJournalEntry(
  stockMovement,
  totalCost,
  user,
  session,
  companyId = null
) {
  // Build account query filter (with or without companyId)
  const accountFilter = companyId ? { companyId } : {};

  // Get system accounts (parallel)
  let [techStockAccount, inventoryAccount] = await Promise.all([
    Account.findOne({ ...accountFilter, systemAccount: "technician_stock" }).session(session),
    Account.findOne({ ...accountFilter, systemAccount: "inventory" }).session(session),
  ]);

  // Auto-create technician_stock account if it doesn't exist
  if (!techStockAccount && inventoryAccount) {
    const newAccount = await Account.create(
      [
        {
          companyId: companyId || inventoryAccount.companyId,
          accountCode: "1310",
          accountName: "Technician Stock",
          accountType: "asset",
          subType: "inventory",
          systemAccount: "technician_stock",
          canPost: true,
          isActive: true,
          level: 2,
          description: "Stock issued to technicians for demo, installation, or repair",
        },
      ],
      { session }
    );
    techStockAccount = newAccount[0];
  }

  if (!techStockAccount || !inventoryAccount) {
    throw new Error("System accounts not found");
  }

  // Generate entry number
  const entryNumber = await generateJournalEntryNumber(session);

  // Create reversal journal entry
  const journalEntry = await JournalEntry.create(
    [
      {
        entryNumber,
        entryDate: new Date(),
        entryType: "transfer", // Reversal - return from Technician Stock to Inventory
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
        },
        status: "draft",
        createdBy: {
          name: user.name,
          id: user.id,
        },
        companyId, // Tenant isolation
      },
    ],
    { session }
  );

  // Post journal entry (pass session for transaction support)
  await journalEntry[0].post(
    {
      name: user.name,
      id: user.id,
    },
    session
  );

  return journalEntry[0];
}

/**
 * Generate journal entry number
 */
async function generateJournalEntryNumber(session) {
  const today = format(new Date(), "yyyyMM");
  const counterId = `JE-${today}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session }
  );

  return `${counterId}-${String(counter.seq).padStart(4, "0")}`;
}

async function generateMovementNumber(session) {
  const today = format(new Date(), "ddMMyy");
  const counterId = `MOV-${today}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session }
  );

  return `${counterId}-${String(counter.seq).padStart(4, "0")}`;
}

async function generateDeliveryNoteNumber(session) {
  const today = format(new Date(), "ddMMyy");
  const counterId = `DN-${today}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session }
  );

  return `${counterId}-${String(counter.seq).padStart(3, "0")}`;
}

/**
 * Derive company code from name (consistent with other generators)
 */
function deriveCompanyCode(name) {
  if (!name) return null;
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return words.slice(0, 4).map((w) => w[0]).join("").toUpperCase();
  }
  return name.slice(0, 3).toUpperCase();
}

async function generateInvoiceNumber(companyId, session) {
  // Get company code for prefix
  const Company = mongoose.model("Company");
  const company = await Company.findById(companyId)
    .select("code name")
    .session(session);

  let companyCode = null;
  if (company) {
    // Use explicit code if set, otherwise derive from company name
    companyCode = company.code || deriveCompanyCode(company.name);
  }

  const today = format(new Date(), "ddMMyy");

  // Counter ID with company code for tenant isolation
  const counterId = companyCode
    ? `inv-${companyCode.toLowerCase()}-${today}`
    : `inv-${today}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session }
  );

  // Format: INV-{CODE}-{DDMMYY}-{NNN} or INV-{DDMMYY}-{NNN}
  const prefix = companyCode ? `INV-${companyCode}` : "INV";
  return `${prefix}-${today}-${String(counter.seq).padStart(3, "0")}`;
}

function getPurposeLabel(purpose) {
  const labels = {
    sale: "Sale to Customer",
    technician_test: "Testing by Technician",
    customer_demo: "Customer Demonstration",
    internal_use: "Internal Use",
    installation: "Installation at Site",
    repair: "Repair/Maintenance",
    other: "Other Purpose",
  };
  return labels[purpose] || purpose;
}

// ============================================
// FULFILL REQUEST (Transaction-Safe with Fulfillments Array)
// ============================================
export async function fulfillRequest(requestId, prevState, formData) {
  await dbConnect();
  let session;
  let success = false;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const rawFormData = Object.fromEntries(formData.entries());

    const fresh = await requireFreshSession();
    if (!fresh.ok) {
      await session.abortTransaction();
      return { message: fresh.message };
    }
    const user = fresh.session.user;

    // Check permissions. Same canonical-role fix as the returns path.
    if (!["Store Manager", "Admin", "SuperAdmin"].includes(user.role)) {
      throw new Error("Only store managers can fulfill requests.");
    }

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      throw new Error("Company context required");
    }

    // Get request
    const request = await StockRequest.findById(requestId).session(session);

    if (!request) {
      throw new Error("Request not found");
    }

    // Validate tenant access
    if (!validateTenantAccess(request, companyId, isSuperAdmin)) {
      await session.abortTransaction();
      throw new Error("Access denied to this request");
    }

    // Check if can fulfill
    if (!request.canFulfill()) {
      throw new Error("This request cannot be fulfilled");
    }

    const fulfillmentNotes = rawFormData.comments || "";
    let itemsFulfilledCount = 0;

    // ========================================
    // PRE-FETCH ALL PRODUCTS IN ONE QUERY
    // ========================================
    const productIds = request.items
      .filter((item) => item.productId)
      .map((item) => item.productId);
    const products = productIds.length > 0
      ? await Product.find({ _id: { $in: productIds } }).session(session)
      : [];
    const productMap = new Map(products.map((p) => [p._id.toString(), p]));

    // ========================================
    // PROCESS EACH ITEM
    // ========================================
    for (const item of request.items) {
      const fulfillQty = parseInt(rawFormData[`item_${item._id}`] || "0");

      if (fulfillQty <= 0) continue; // Skip if no quantity

      itemsFulfilledCount++;

      // ========================================
      // VALIDATION
      // ========================================
      // Calculate current remaining
      const currentFulfilled = item.fulfillments.reduce(
        (sum, f) => sum + (f.quantity || 0),
        0
      );
      const target = item.approvedQuantity || item.requestedQuantity;
      const remaining = target - currentFulfilled;

      if (fulfillQty > remaining) {
        throw new Error(
          `Cannot fulfill ${fulfillQty} of ${item.productName}. ` +
            `Only ${remaining} remaining.`
        );
      }

      // Get product and validate stock
      const product = productMap.get(item.productId.toString());

      if (!product) {
        throw new Error(`Product ${item.productName} not found`);
      }

      // ========================================
      // VALIDATE STOCK (committed flow)
      // ========================================
      const onHandStock = product.inventory?.quantityOnHand ?? 0;
      if (fulfillQty > onHandStock) {
        throw new Error(
          `Insufficient physical stock for ${item.productName}. ` +
            `On-hand: ${onHandStock}, Requested: ${fulfillQty}`
        );
      }

      // Get serial numbers
      const serialNos =
        rawFormData[`serialNo_${item._id}`]
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) || [];

      // ========================================
      // FULFILL COMMITTED INVENTORY
      // ========================================
      const previousOnHand = product.inventory?.quantityOnHand ?? 0;
      await Product.findByIdAndUpdate(
        item.productId,
        {
          $inc: {
            "inventory.quantityOnHand": -fulfillQty,
            "inventory.quantityCommitted": -fulfillQty,
          },
        },
        { session }
      );

      // Calculate new on-hand (no need to re-fetch)
      const currentOnHand = previousOnHand - fulfillQty;
      // Update local cache for subsequent items of same product
      product.inventory.quantityOnHand = currentOnHand;
      product.inventory.quantityCommitted =
        (product.inventory.quantityCommitted || 0) - fulfillQty;

      // ========================================
      // CREATE STOCK MOVEMENT
      // ========================================
      const movementNumber = await generateMovementNumber(session);
      const isSale = request.requestType === "sale";

      // Use product's pricing fields
      const effectiveUnitPrice = product.pricing?.sellingPrice ?? 0;
      const effectiveUnitCost = product.costing?.costPrice ?? 0;

      const movement = await StockMovement.create(
        [
          {
            movementNumber,
            productId: item.productId,
            productSnapshot: {
              name: item.productName,
              SKU: item.SKU,
              unit: item.unit,
            },
            direction: "out",
            movementType: isSale ? "sale" : "issue",
            quantity: fulfillQty,
            previousStock: previousOnHand,
            newStock: currentOnHand,
            costing: {
              unitCost: effectiveUnitCost,
              totalCost: fulfillQty * effectiveUnitCost,
              unitPrice: effectiveUnitPrice,
              totalValue: fulfillQty * effectiveUnitPrice,
              averageCostAtMovement: effectiveUnitCost,
            },

            // ============================================
            // Accounting flags - ALL fulfillments affect accounting
            // ============================================
            accounting: {
              affectsAccounting: true, // ALL fulfillments create journal entries
              accountingPosted: false, // Will be posted after JE creation
            },
            performedBy: {
              name: user.name,
              id: user.id,
              role: user.role,
            },
            issuedTo: {
              name: isSale ? request.customer?.name : request.requester.name,
              id: isSale ? request.customer?.id : request.requester.id,
              department: isSale ? "External" : request.requester.department,
              purpose: request.requestType,
            },
            relatedDocuments: {
              requestId: request._id,
            },
            requiresReturn: !isSale,
            expectedReturnDate: null,
            notes: `${stockRequestTypeConfig[request.requestType]?.label || request.requestType} - Request ${
              request.requestNumber
            }`,
            companyId, // Tenant isolation
          },
        ],
        { session }
      );

      // ========================================
      // CREATE JOURNAL ENTRY
      // DR: Technician Stock, CR: Inventory
      // ========================================
      const totalCost = movement[0].costing.totalCost;
      const journalEntry = await createFulfillmentJournalEntry(
        movement[0],
        totalCost,
        user,
        session,
        companyId
      );

      // Update movement with journal entry ID
      movement[0].accounting.journalEntryId = journalEntry._id;
      movement[0].accounting.accountingPosted = true;
      movement[0].accounting.accountingPostedAt = new Date();
      await movement[0].save({ session });

      let checkoutId = null;
      let deliveryNoteId = null;

      // ========================================
      // HANDLE SALES (Create Delivery Note)
      // ========================================
      if (isSale) {
        const dNoteNumber = await generateDeliveryNoteNumber(session);

        const deliveryNote = await DeliveryNote.create(
          [
            {
              deliveryNumber: dNoteNumber,
              customer: {
                name: request.customer?.name || "Unknown",
                address: request.customer?.address || "",
                phone: request.customer?.phone || "",
              },
              items: [
                {
                  id: product.SKU,
                  name: product.name,
                  quantity: fulfillQty,
                  unitPrice: item.unitPrice || product.pricing?.sellingPrice || 0,
                  unit: product.unit,
                  type: "Stock",
                  serialNo: serialNos,
                },
              ],
              reason: "Selling",
              shouldBeReturned: false,
              notes: `Sale from request ${request.requestNumber}`,
              createdBy: {
                id: user.id,
                name: user.name,
              },
              companyId, // Tenant isolation
            },
          ],
          { session }
        );

        deliveryNoteId = deliveryNote[0]._id;
      }

      // ========================================
      // HANDLE CHECKOUTS (for demo, installation, repair types)
      // ========================================
      const typeConfig = stockRequestTypeConfig[request.requestType];
      const createsCheckout = typeConfig?.createsCheckout || false;

      if (createsCheckout) {
        const checkoutNumber = await generateCheckoutNumber(session);
        const expectedReturn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const checkout = await ItemCheckout.create(
          [
            {
              checkoutNumber,
              productId: item.productId,
              productSnapshot: {
                name: item.productName,
                SKU: item.SKU,
              },
              quantity: fulfillQty,
              serialNo: serialNos.join(", "),
              checkedOutTo: {
                name: request.requester.name,
                id: request.requester.id,
                department: request.requester.department,
                email: request.requester.email || "",
                phone: request.requester.phone || "",
              },
              checkedOutBy: {
                name: user.name,
                id: user.id,
                role: user.role,
              },
              purpose: request.requestType,
              purposeDetails: typeConfig?.description || request.requestType,
              expectedReturnDate: expectedReturn,
              relatedDocuments: {
                requestId: request._id,
                requestNumber: request.requestNumber,
                movementId: movement[0]._id,
              },
              requestType: request.requestType, // Track request type for conversion flow
              // Customer info (for filtering checkouts by customer in invoice forms)
              customer: request.customer ? {
                id: request.customer.id,
                name: request.customer.name,
              } : null,
              checkoutNotes: `Checkout from request ${request.requestNumber} for ${request.customer?.name || "internal use"}`,
              companyId, // Tenant isolation
            },
          ],
          { session }
        );

        checkoutId = checkout[0]._id;
      }

      // ========================================
      // ADD FULFILLMENT TO REQUEST (Using helper method)
      // ========================================
      request.addFulfillment(item._id, {
        quantity: fulfillQty,
        serialNumbers: serialNos,
        fulfilledBy: {
          name: user.name,
          id: user.id,
        },
        fulfilledAt: new Date(),
        movementId: movement[0]._id,
        checkoutId,
        deliveryNoteId,
        notes: fulfillmentNotes,
      });
    }

    if (itemsFulfilledCount === 0) {
      throw new Error("Please specify quantities to fulfill");
    }

    // ========================================
    // CREATE DRAFT INVOICE (for "sale" type requests)
    // ========================================
    if (request.requestType === "sale" && !request.draftInvoice?.invoiceId) {
      const invoiceNumber = await generateInvoiceNumber(companyId, session);

      // Prepare invoice items from fulfilled items (reuse pre-fetched products)
      // Batch-fetch all checkout IDs from fulfillments
      const checkoutIds = request.items
        .filter((item) => item.fulfillments?.length > 0)
        .map((item) => item.fulfillments[item.fulfillments.length - 1]?.checkoutId)
        .filter(Boolean);
      const checkouts = checkoutIds.length > 0
        ? await ItemCheckout.find({ _id: { $in: checkoutIds } }).session(session)
        : [];
      const checkoutMap = new Map(checkouts.map((c) => [c._id.toString(), c]));

      const invoiceItems = [];
      for (const item of request.items) {
        const fulfilledQty = item.fulfillments.reduce((sum, f) => sum + (f.quantity || 0), 0);
        if (fulfilledQty > 0) {
          const product = productMap.get(item.productId.toString());
          const unitCost = product?.costing?.costPrice || 0;
          const amount = fulfilledQty * (item.unitPrice || 0);
          const totalCost = fulfilledQty * unitCost;

          // Get checkout info from fulfillment (for cancel/expire tracking)
          const latestFulfillment = item.fulfillments[item.fulfillments.length - 1];
          let relatedCheckout = null;
          if (latestFulfillment?.checkoutId) {
            const checkout = checkoutMap.get(latestFulfillment.checkoutId.toString());
            if (checkout) {
              relatedCheckout = {
                checkoutId: checkout._id,
                checkoutNumber: checkout.checkoutNumber,
              };
            }
          }

          invoiceItems.push({
            itemType: "product",
            productId: item.productId,
            productSKU: item.SKU,
            productName: item.productName,
            description: item.productName,
            unit: item.unit,
            quantity: fulfilledQty,
            unitPrice: item.unitPrice || 0,
            amount,
            costing: {
              unitCost,
              totalCost,
              grossProfit: amount - totalCost,
              marginPercentage: amount > 0 ? ((amount - totalCost) / amount) * 100 : 0,
            },
            taxRate: 16, // Kenya VAT 16%
            taxAmount: (amount * 16) / 100,
            relatedRequest: {
              requestId: request._id,
              requestNumber: request.requestNumber,
              technicianId: request.requester.id,
              technicianName: request.requester.name,
            },
            relatedCheckout,
          });
        }
      }

      if (invoiceItems.length > 0) {
        const subtotal = invoiceItems.reduce((sum, item) => sum + item.amount, 0);
        const totalTax = invoiceItems.reduce((sum, item) => sum + item.taxAmount, 0);
        const totalCOGS = invoiceItems.reduce((sum, item) => sum + item.costing.totalCost, 0);
        const total = subtotal + totalTax;

        const draftInvoice = await Invoice.create(
          [
            {
              companyId,
              invoiceNumber,
              invoiceDate: new Date(),
              dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
              customer: {
                id: request.customer?.id || "",
                name: request.customer?.name || "Unknown",
                email: request.customer?.email || "",
                phone: request.customer?.phone || "",
                address: request.customer?.address || "",
                taxPin: request.customer?.taxPin || "",
              },
              items: invoiceItems,
              subtotal,
              totalDiscount: 0,
              taxAmount: totalTax,
              total,
              totalCOGS,
              grossProfit: subtotal - totalCOGS,
              grossMarginPercentage: subtotal > 0 ? ((subtotal - totalCOGS) / subtotal) * 100 : 0,
              status: "draft",
              paymentStatus: "unpaid",
              amountPaid: 0,
              amountDue: total,
              source: {
                type: "stock_request",
                requestId: request._id,
                requestNumber: request.requestNumber,
              },
              notes: `Draft invoice from stock request ${request.requestNumber}. Pending service charges.`,
              createdBy: {
                name: user.name,
                id: user.id,
              },
            },
          ],
          { session }
        );

        // Update request with draft invoice reference
        request.draftInvoice = {
          invoiceId: draftInvoice[0]._id,
          invoiceNumber: draftInvoice[0].invoiceNumber,
          createdAt: new Date(),
        };
      }
    }

    // ========================================
    // UPDATE PROJECT FINANCIALS (move committed → cost)
    // ========================================
    if (request.projectId && itemsFulfilledCount > 0) {
      let fulfilledCost = 0;
      for (const item of request.items) {
        const fulfillQty = parseInt(rawFormData[`item_${item._id}`] || "0");
        if (fulfillQty > 0) {
          fulfilledCost += fulfillQty * (item.unitPrice || 0);
        }
      }
      if (fulfilledCost > 0) {
        await Project.findByIdAndUpdate(
          request.projectId,
          {
            $inc: {
              "financials.totalCosts": fulfilledCost,
              "financials.totalCommitted": -fulfilledCost,
            },
          },
          { session }
        );
      }
    }

    // ========================================
    // SAVE REQUEST (recalculation already done by addFulfillment)
    // ========================================
    await request.save({ session });

    await session.commitTransaction();

    // Revalidate paths
    revalidatePath("/dashboard/requests");
    revalidatePath("/dashboard/stocks");
    revalidatePath("/dashboard/checkouts");
    revalidatePath("/dashboard/movement");
    revalidatePath("/dashboard/invoices");
    revalidateProject(request.projectId);

    success = true;
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error fulfilling request:", error);
    return {
      message: error.message || "Failed to fulfill request",
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }

  // Redirect after success (outside try/catch)
  if (success) {
    redirect("/dashboard/requests");
  }
}
