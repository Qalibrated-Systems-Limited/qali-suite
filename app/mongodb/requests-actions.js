"use server";

import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { StockRequest } from "../models/requests";
import Product from "../models/product";
import Counter from "../models/counter";
import { ItemCheckout } from "../models/checkouts";
import { StockMovement } from "../models/stockmovement";
import { format } from "date-fns";
import DeliveryNote from "../models/dnote";
import dbConnect from "../config/dbConnect";

// ============================================
// 1. APPROVE REQUEST (Manager/Admin only)
// ============================================
dbConnect();

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
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const rawFormData = Object.fromEntries(formData.entries());
    const comments = rawFormData.comments || "";
    const conditions = rawFormData.conditions || "";

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

    // Check if user has permission to approve
    if (userRole !== "manager" && userRole !== "admin") {
      return { message: "Only managers and admins can approve requests." };
    }

    // Get request
    const request = await StockRequest.findById(requestId).session(session);

    if (!request) {
      return { message: "Request not found" };
    }

    // Check if request can be approved
    if (!request.canApprove(user.id)) {
      return { message: "This request cannot be approved" };
    }

    // ========================================
    // ✅ NEW: Extract per-item approvals
    // ========================================
    const itemApprovals = {};
    
    request.items.forEach((item) => {
      const approvedQty = parseInt(rawFormData[`approved_${item._id}`]);
      const itemNotes = rawFormData[`notes_${item._id}`] || "";
      
      // If manager specified a quantity, use it
      if (!isNaN(approvedQty)) {
        itemApprovals[item._id.toString()] = {
          quantity: Math.max(0, Math.min(approvedQty, item.requestedQuantity)),
          notes: itemNotes
        };
      } else {
        // Default: approve full requested quantity
        itemApprovals[item._id.toString()] = {
          quantity: item.requestedQuantity,
          notes: itemNotes
        };
      }
    });

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
      itemApprovals  // ✅ Pass item-specific approvals
    );

    await session.commitTransaction();

    // TODO: Send notification to requester and storekeeper
  } catch (error) {
    await session.abortTransaction();
    console.error("Error approving request:", error);
    return { message: error.message || "Failed to approve request" };
  } finally {
    session.endSession();
  }

  revalidatePath("/dashboard/requests");
  return { message: "success" };
}

// ============================================
// 2. REJECT REQUEST (Manager/Admin only)
// ============================================
export async function rejectRequest(requestId, prevState, formData) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const rawFormData = Object.fromEntries(formData.entries());
    const reason = rawFormData.reason;

    if (!reason || reason.trim().length < 10) {
      return {
        message:
          "Please provide a detailed reason for rejection (minimum 10 characters)",
      };
    }

    // Get authenticated user
    const userSession = await auth();
    if (!userSession?.user) {
      return { message: "Unauthorized. Please log in." };
    }

    const user = userSession.user;

    // Check if user has permission to reject
    if (user.role !== "manager" && user.role !== "admin") {
      return { message: "Only managers and admins can reject requests." };
    }

    // Get request
    const request = await StockRequest.findById(requestId).session(session);

    if (!request) {
      return { message: "Request not found" };
    }

    // Check if request is pending
    if (request.status !== "pending") {
      return { message: "Only pending requests can be rejected" };
    }

    // Reject the request
    await request.reject({
      name: user.name,
      id: user.id,
      reason,
    });

    await session.commitTransaction();

    // TODO: Send notification to requester
  } catch (error) {
    await session.abortTransaction();
    console.error("Error rejecting request:", error);
    return { message: "Failed to reject request" };
  } finally {
    session.endSession();
  }

  revalidatePath("/dashboard/requests");
  return { message: "success" };
}

// ============================================
// 3. FULFILL REQUEST (Store Manager only)
// ============================================

export async function fulfillRequestOldVersion(requestId, prevState, formData) {
  let session;

  try {
    // Start session
    session = await mongoose.startSession();
    session.startTransaction();

    const rawFormData = Object.fromEntries(formData.entries());

    // Get authenticated user
    const userSession = await auth();
    if (!userSession?.user) {
      throw new Error("Unauthorized. Please log in.");
    }

    const user = userSession.user;
    let userRole = user.role || "user";
    if (userRole && userRole !== "Store Manager") {
      userRole = userRole.toLowerCase();
    }

    // Check if user is store manager
    if (userRole !== "Store Manager" && userRole !== "admin") {
      throw new Error("Only store managers can fulfill requests.");
    }

    // Get request WITH session
    const request = await StockRequest.findById(requestId).session(session);

    if (!request) {
      throw new Error("Request not found");
    }

    // Check if request can be fulfilled
    if (request.status !== "approved") {
      throw new Error("Only approved requests can be fulfilled");
    }

    // Categorize items by purpose
    const salesItems = [];
    const loanItems = [];
    const fulfilledItems = [];

    // Process items and update stock
    for (const item of request.items) {
      const fulfilledQty = parseInt(rawFormData[`item_${item._id}`] || "0");

      if (fulfilledQty > 0) {
        // Validate stock availability
        const product = await Product.findById(item.productId).session(session);

        if (!product) {
          throw new Error(`Product ${item.productName} not found`);
        }

        if (fulfilledQty > product.stock) {
          throw new Error(
            `Insufficient stock for ${item.productName}. Available: ${product.stock}, Requested: ${fulfilledQty}`
          );
        }

        if (fulfilledQty > item.requestedQuantity) {
          throw new Error(
            `Cannot fulfill more than requested for ${item.productName}`
          );
        }

        const itemData = {
          item,
          product,
          fulfilledQty,
          serialNo: rawFormData[`serialNo_${item._id}`] || "",
        };

        // Categorize based on purpose
        if (item.purpose === "sale") {
          salesItems.push(itemData);
        } else {
          loanItems.push(itemData);
        }

        fulfilledItems.push({
          itemId: item._id,
          quantity: fulfilledQty,
          serialNo: itemData.serialNo,
        });

        // Update product stock WITHIN transaction
        await Product.findByIdAndUpdate(
          item.productId,
          { $inc: { stock: -fulfilledQty } },
          { session }
        );
      }
    }

    if (fulfilledItems.length === 0) {
      throw new Error("Please specify quantities to fulfill");
    }

    // ============================================
    // HANDLE SALES ITEMS
    // ============================================
    if (salesItems.length > 0) {
      // Generate Delivery Note Number
      const today = format(new Date(), "ddMMyy");
      const counterId = `DN-${today}`;
      const counter = await Counter.findOneAndUpdate(
        { name: counterId },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, session }
      );

      if (!counter) {
        throw new Error("Failed to generate delivery note number");
      }

      const dNoteNumber = `${counterId}-${String(counter.seq).padStart(
        3,
        "0"
      )}`;

      // Prepare items for delivery note
      const dnoteItems = salesItems.map(({ item, fulfilledQty, product }) => ({
        id: product.SKU,
        name: product.name,
        quantity: fulfilledQty,
        unitPrice: item.unitPrice || product.price,
      }));

      // Create Delivery Note
      await DeliveryNote.create(
        [
          {
            deliveryNumber: dNoteNumber,
            customer: {
              name: request.customer || "Unknown",
              address: "",
              phone: "",
            },
            items: dnoteItems,
            reason: "Selling",
            shouldBeReturned: false,
            notes: `Fulfilled from request ${request.requestNumber}`,
            createdBy: {
              id: user.id,
              name: user.name,
            },
          },
        ],
        { session }
      );

      // Create Stock Movements for sales
      for (const { item, fulfilledQty } of salesItems) {
        const movementNumber = await generateMovementNo(session);

        // Get current product stock (after deduction)
        const updatedProduct = await Product.findById(item.productId).session(
          session
        );

        await StockMovement.create(
          [
            {
              productId: item.productId,
              productSnapshot: {
                name: item.productName,
                SKU: item.SKU,
                unit: item.unit,
              },
              direction: "out",
              movementNumber: movementNumber,
              movementType: "sale",
              quantity: fulfilledQty,
              previousStock: updatedProduct.stock + fulfilledQty,
              newStock: updatedProduct.stock,
              unitPrice: item.unitPrice,
              performedBy: {
                name: user.name,
                id: user.id,
                role: "storekeeper",
              },
              issuedTo: {
                name: request.customer || "Customer",
                id: "",
                department: "External",
                purpose: "sale",
              },
              relatedDocuments: {
                requestId: request._id,
              },
              requiresReturn: false,
              notes: `Sale via request ${request.requestNumber} - DN: ${dNoteNumber}`,
            },
          ],
          { session }
        );
      }
    }

    // ============================================
    // HANDLE LOAN ITEMS
    // ============================================
    if (loanItems.length > 0) {
      for (const { item, fulfilledQty, serialNo } of loanItems) {
        const movementNumber = await generateMovementNo(session);

        // Get current product stock (after deduction)
        const updatedProduct = await Product.findById(item.productId).session(
          session
        );

        const movement = await StockMovement.create(
          [
            {
              productId: item.productId,
              productSnapshot: {
                name: item.productName,
                SKU: item.SKU,
                unit: item.unit,
              },
              direction: "out",
              movementNumber: movementNumber,
              movementType: "issue",
              quantity: fulfilledQty,
              previousStock: updatedProduct.stock + fulfilledQty,
              newStock: updatedProduct.stock,
              unitPrice: item.unitPrice,
              performedBy: {
                name: user.name,
                id: user.id,
                role: "storekeeper",
              },
              issuedTo: {
                name: request.requester.name,
                id: request.requester.id,
                department: request.requester.department,
                purpose: item.purpose,
              },
              relatedDocuments: {
                requestId: request._id,
              },
              requiresReturn: true,
              expectedReturnDate:
                item.expectedReturnDate ||
                new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              notes: `Loaned from request ${
                request.requestNumber
              } - ${getPurposeLabel(item.purpose)}`,
            },
          ],
          { session }
        );

        // Create Item Loan record
        const expectedReturn =
          item.expectedReturnDate ||
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        // Generate checkout number
        const checkoutNumber = await generateCheckoutNumber(session);

        await ItemCheckout.create(
          [
            {
              checkoutNumber: checkoutNumber,
              productId: item.productId,
              productSnapshot: {
                name: item.productName,
                SKU: item.SKU,
              },
              quantity: fulfilledQty,
              serialNo: serialNo || "",
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
                role: "storekeeper",
              },
              purpose: item.purpose,
              purposeDetails:
                item.purposeDetails || getPurposeLabel(item.purpose),
              expectedReturnDate: expectedReturn,
              relatedDocuments: {
                requestId: request._id,
                movementId: movement[0]._id,
              },
              checkoutNotes: `Loaned from request ${
                request.requestNumber
              } for ${getPurposeLabel(item.purpose)}`,
            },
          ],
          { session }
        );
      }
    }

    // ============================================
    // UPDATE REQUEST
    // ============================================
    const comments = rawFormData.comments || "";
    const fulfillmentNote = `Fulfilled: ${salesItems.length} sold, ${loanItems.length} loaned`;

    // Update fulfilled quantities
    fulfilledItems.forEach((fulfilled) => {
      const item = request.items.id(fulfilled.itemId);
      if (item) {
        item.fulfilledQuantity = fulfilled.quantity;
        item.serialNo = fulfilled.serialNo;
      }
    });

    // Calculate status
    const allFulfilled = request.items.every(
      (item) => item.fulfilledQuantity >= item.requestedQuantity
    );
    const someFulfilled = request.items.some(
      (item) => item.fulfilledQuantity > 0
    );

    if (allFulfilled) {
      request.status = "fulfilled";
    } else if (someFulfilled) {
      request.status = "partially_fulfilled";
    }

    // Set storekeeper details
    request.storekeeper = {
      name: user.name,
      id: user.id,
      fulfilledAt: new Date(),
      comments: comments ? `${comments}\n${fulfillmentNote}` : fulfillmentNote,
    };

    // Save request with session
    await request.save({ session });

    // Commit transaction
    await session.commitTransaction();

    // Revalidate after successful commit
    revalidatePath("/dashboard/requests");
    revalidatePath("/dashboard/stocks");
    revalidatePath("/dashboard/checkouts");
    revalidatePath("/dashboard/dnotes");

    return { message: "success" };
  } catch (error) {
    // Abort transaction if still active
    if (session && session.inTransaction()) {
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
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const rawFormData = Object.fromEntries(formData.entries());
    const reason = rawFormData.reason;

    if (!reason || reason.trim().length < 10) {
      return {
        message:
          "Please provide a reason for cancellation (minimum 10 characters)",
      };
    }

    // Get authenticated user
    const userSession = await auth();
    if (!userSession?.user) {
      return { message: "Unauthorized. Please log in." };
    }

    const user = userSession.user;

    // Get request
    const request = await StockRequest.findById(requestId).session(session);

    if (!request) {
      return { message: "Request not found" };
    }

    // Check permissions
    const canCancel =
      request.requester.id === user.id || // Requester can cancel their own
      user.role === "manager" ||
      user.role === "admin";

    if (!canCancel) {
      return { message: "You don't have permission to cancel this request" };
    }

    // Check if request can be cancelled
    if (
      request.status === "fulfilled" ||
      request.status === "partially_fulfilled"
    ) {
      return { message: "Cannot cancel a fulfilled request" };
    }

    // Cancel the request
    await request.cancel(reason);

    await session.commitTransaction();

    // TODO: Send notification
  } catch (error) {
    await session.abortTransaction();
    console.error("Error canceling request:", error);
    return { message: "Failed to cancel request" };
  } finally {
    session.endSession();
  }

  revalidatePath("/dashboard/requests");
  return { message: "success" };
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
  let session;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    // Get authenticated user
    const userSession = await auth();
    if (!userSession?.user) {
      throw new Error("Unauthorized. Please log in.");
    }

    const user = userSession.user;

    // Extract form data
    const customer = formData.get("customer");
    const priority = formData.get("priority") || "normal";
    const notes = formData.get("notes") || "";
    const requiredByDateStr = formData.get("requiredByDate");
    const itemsJson = formData.get("items");

    // Validate required fields
    if (!customer || !customer.trim()) {
      throw new Error("Customer name is required");
    }

    if (!itemsJson) {
      throw new Error("No items provided");
    }

    // Parse items
    let items;
    try {
      items = JSON.parse(itemsJson);
    } catch (error) {
      throw new Error("Invalid items data");
    }

    if (!items || items.length === 0) {
      throw new Error("Please add at least one item to the request");
    }

    // Validate and prepare items
    const validatedItems = [];

    for (const item of items) {
      // Verify product exists and has sufficient stock
      const product = await Product.findById(item.productId).session(session);

      if (!product) {
        throw new Error(`Product ${item.productName} not found`);
      }

      if (item.requestedQuantity > product.stock) {
        throw new Error(
          `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.requestedQuantity}`
        );
      }

      validatedItems.push({
        productId: product._id,
        productName: product.name,
        SKU: product.SKU,
        currentStock: product.stock,
        requestedQuantity: item.requestedQuantity,
        unitPrice: product.price || 0,
        unit: product.unit,
        purpose: item.purpose,
        purposeDetails: item.purposeDetails || "",
        requiresReturn: item.requiresReturn || false,
        expectedReturnDate: item.expectedReturnDate || null,
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
    if (requiredByDateStr) {
      requiredByDate = new Date(requiredByDateStr);
    }

    // Create request
    const newRequest = await StockRequest.create(
      [
        {
          requestNumber,
          customer: customer.trim(),
          requester: {
            name: user.name,
            id: user.id,
            department: user.department || "Other",
            email: user.email || "",
            phone: user.phone || "",
          },
          items: validatedItems,
          status: "pending",
          priority,
          notes,
          requiredByDate,
          approvalHistory: [],
          attachments: [],
        },
      ],
      { session }
    );

    await session.commitTransaction();

    revalidatePath("/dashboard/requests");

    // Return success with request ID
    return {
      message: "success",
      requestId: newRequest[0]._id.toString(),
      requestNumber: newRequest[0].requestNumber,
    };
  } catch (error) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error creating stock request:", error);
    return {
      message: error.message || "Failed to create stock request",
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
  let session;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const rawFormData = Object.fromEntries(formData.entries());

    // Get authenticated user
    const userSession = await auth();
    if (!userSession?.user) {
      throw new Error("Unauthorized. Please log in.");
    }

    const user = userSession.user;
    const userRole =
      user.role === "Store Manager"
        ? "Store Manager"
        : user.role?.toLowerCase();

    // Check permissions
    if (userRole !== "Store Manager" && userRole !== "admin") {
      throw new Error("Only store managers can fulfill requests.");
    }

    // Get request
    const request = await StockRequest.findById(requestId).session(session);

    if (!request) {
      throw new Error("Request not found");
    }

    // Check if can fulfill
    if (!request.canFulfill()) {
      throw new Error("This request cannot be fulfilled");
    }

    const fulfillmentNotes = rawFormData.comments || "";
    let itemsFulfilledCount = 0;

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

      // Check stock availability
      const product = await Product.findById(item.productId).session(session);

      if (!product) {
        throw new Error(`Product ${item.productName} not found`);
      }

      if (fulfillQty > product.stock) {
        throw new Error(
          `Insufficient stock for ${item.productName}. ` +
            `Available: ${product.stock}, Requested: ${fulfillQty}`
        );
      }

      // Get serial numbers
      const serialNos =
        rawFormData[`serialNo_${item._id}`]
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) || [];

      // ========================================
      // DEDUCT STOCK
      // ========================================
      await Product.findByIdAndUpdate(
        item.productId,
        { $inc: { stock: -fulfillQty } },
        { session }
      );

      const updatedProduct = await Product.findById(item.productId).session(
        session
      );

      // ========================================
      // CREATE STOCK MOVEMENT
      // ========================================
      const movementNumber = await generateMovementNumber(session);
      const isSale = item.purpose === "sale";

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
            previousStock: updatedProduct.stock + fulfillQty,
            newStock: updatedProduct.stock,
            unitPrice: item.unitPrice,
            totalValue: fulfillQty * (item.unitPrice || 0),
            performedBy: {
              name: user.name,
              id: user.id,
              role: userRole,
            },
            issuedTo: {
              name: isSale ? request.customer : request.requester.name,
              id: isSale ? "" : request.requester.id,
              department: isSale ? "External" : request.requester.department,
              purpose: item.purpose,
            },
            relatedDocuments: {
              requestId: request._id,
            },
            requiresReturn: !isSale && item.requiresReturn,
            expectedReturnDate: item.expectedReturnDate,
            notes: `${getPurposeLabel(item.purpose)} - Request ${
              request.requestNumber
            }`,
          },
        ],
        { session }
      );

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
                name: request.customer || "Unknown",
                address: "",
                phone: "",
              },
              items: [
                {
                  id: product.SKU,
                  name: product.name,
                  quantity: fulfillQty,
                  unitPrice: item.unitPrice || product.price,
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
            },
          ],
          { session }
        );

        deliveryNoteId = deliveryNote[0]._id;
      }

      // ========================================
      // HANDLE LOANS (Create Checkout)
      // ========================================
      if (!isSale && item.requiresReturn) {
        const checkoutNumber = await generateCheckoutNumber(session);
        const expectedReturn =
          item.expectedReturnDate ||
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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
                role: userRole,
              },
              purpose: item.purpose,
              purposeDetails:
                item.purposeDetails || getPurposeLabel(item.purpose),
              expectedReturnDate: expectedReturn,
              relatedDocuments: {
                requestId: request._id,
                movementId: movement[0]._id,
              },
              checkoutNotes: `Checkout from request ${request.requestNumber}`,
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
    // SAVE REQUEST (recalculation already done by addFulfillment)
    // ========================================
    await request.save({ session });

    await session.commitTransaction();

    // Revalidate paths
    revalidatePath("/dashboard/requests");
    revalidatePath("/dashboard/stocks");
    revalidatePath("/dashboard/checkouts");
    revalidatePath("/dashboard/dnotes");
    revalidatePath("/dashboard/movement");

    return {
      message: "success",
      details: `Fulfilled ${itemsFulfilledCount} item(s)`,
    };
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
}
