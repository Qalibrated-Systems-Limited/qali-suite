"use server";

import { auth } from "@/auth";
import { ItemCheckout } from "../models/checkouts";
import Product from "../models/product";
import { StockMovement } from "../models/stockmovement";
import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import Counter from "../models/counter";
import { format } from "date-fns";
import dbConnect from "../config/dbConnect";

dbConnect();

// ============================================
// RETURN CHECKOUT
// ============================================
export async function returnCheckout(checkoutId, prevState, formData) {
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
    let userRole = user.role || "user";
    if (userRole && userRole !== "Store Manager") {
      userRole = userRole.toLowerCase();
    }

    // Check if user is store manager or admin
    if (userRole !== "Store Manager" && userRole !== "admin") {
      throw new Error("Only store managers can process returns.");
    }

    // Get checkout WITH session
    const checkout = await ItemCheckout.findById(checkoutId).session(session);

    if (!checkout) {
      throw new Error("Checkout not found");
    }

    // Check if already returned
    if (checkout.status === "returned") {
      throw new Error("This item has already been returned");
    }

    // Get return details from form
    const returnCondition = rawFormData.returnCondition;
    const returnNotes = rawFormData.returnNotes || "";
    const damageDetails = rawFormData.damageDetails || "";

    if (!returnCondition) {
      throw new Error("Please specify the return condition");
    }

    // Update product stock (return the item)
    await Product.findByIdAndUpdate(
      checkout.productId,
      { $inc: { stock: checkout.quantity } },
      { session }
    );

    // Get updated product stock
    const updatedProduct = await Product.findById(checkout.productId).session(
      session
    );

    // Generate movement number
    const today = format(new Date(), "ddMMyy");
    const counterId = `MOV-${today}`;
    const counter = await Counter.findOneAndUpdate(
      { name: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, session }
    );

    const movementNumber = `${counterId}-${String(counter.seq).padStart(
      3,
      "0"
    )}`;

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
          previousStock: updatedProduct.stock - checkout.quantity,
          newStock: updatedProduct.stock,
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
        },
      ],
      { session }
    );

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

    // Commit transaction
    await session.commitTransaction();

    // Revalidate paths
    revalidatePath("/dashboard/checkouts");
    revalidatePath("/dashboard/stocks");

    return { message: "success" };
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
}

// ============================================
// ESCALATE CHECKOUT
// ============================================
export async function escalateCheckout(checkoutId, prevState, formData) {
  try {
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

    // Check permissions
    if (userRole !== "Store Manager" && userRole !== "admin") {
      throw new Error("Only store managers can escalate checkouts.");
    }

    const checkout = await ItemCheckout.findById(checkoutId);

    if (!checkout) {
      throw new Error("Checkout not found");
    }

    if (checkout.status !== "checked_out") {
      throw new Error("Only active checkouts can be escalated");
    }

    // Get escalation details
    const escalatedToName = rawFormData.escalatedToName;
    const escalatedToId = rawFormData.escalatedToId;
    const reason = rawFormData.reason || "Overdue item";

    if (!escalatedToName || !escalatedToId) {
      throw new Error("Please specify who to escalate to");
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
  try {
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

    if (userRole !== "Store Manager" && userRole !== "admin") {
      throw new Error("Only store managers can update checkout status.");
    }

    const checkout = await ItemCheckout.findById(checkoutId);

    if (!checkout) {
      throw new Error("Checkout not found");
    }

    const newStatus = rawFormData.status;
    const notes = rawFormData.notes || "";

    if (!newStatus) {
      throw new Error("Please specify a status");
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
      throw new Error("Invalid status");
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
