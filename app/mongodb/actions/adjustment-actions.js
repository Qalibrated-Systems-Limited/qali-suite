"use server";

import dbConnect from "@/app/config/dbConnect";
import InventoryAdjustment from "@/app/models/inventoryAdjustment";
import Product from "@/app/models/product";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import mongoose from "mongoose";

/**
 * Create Stock Adjustment with automatic journal entry creation
 */
export async function createStockAdjustment(prevState, formData) {
  let session;

  try {
    await dbConnect();

    const sessionData = await auth();
    if (!sessionData?.user) {
      return {
        message: "Unauthorized",
        success: false,
      };
    }

    const user = sessionData.user;

    // Check permission
    if (!["Admin", "Store Manager", "Accountant"].includes(user.role)) {
      return {
        message: "You don't have permission to create stock adjustments",
        success: false,
      };
    }

    // Parse form data
    const adjustmentData = JSON.parse(formData.get("adjustmentData"));

    const { adjustmentDate, adjustmentType, description, notes, items } =
      adjustmentData;


      console.log(items)

    // Validation
    if (!adjustmentDate || !adjustmentType) {
      return {
        message: "Adjustment date and type are required",
        success: false,
      };
    }

    if (!items || items.length === 0) {
      return {
        message: "At least one adjustment item is required",
        success: false,
      };
    }

    // Start MongoDB session for transaction
    session = await mongoose.startSession();
    session.startTransaction();

    // Generate adjustment number
    const adjustmentNumber =
      await InventoryAdjustment.generateAdjustmentNumber();

    // Prepare adjustment lines
    const lines = [];

    for (const item of items) {
      const product = await Product.findById(item.productId).session(session);

      if (!product) {
        throw new Error(`Product not found: ${item.productId}`);
      }

      const systemQuantity = product.stock || 0;
      const physicalQuantity =
        item.adjustmentType === "increase"
          ? systemQuantity + item.quantity
          : systemQuantity - item.quantity;

      const adjustmentQuantity = physicalQuantity - systemQuantity;
      // Use costPrice from costing object, or fallback to old price field
      const unitCost = product.costing?.costPrice || product.price || 0;
      const adjustmentValue = Math.abs(adjustmentQuantity) * unitCost;

      lines.push({
        productId: product._id,
        productSKU: product.SKU,
        productName: product.name,
        productUnit: product.unit,
        systemQuantity,
        physicalQuantity,
        adjustmentQuantity,
        unitCost,
        adjustmentValue,
        reason: item.reason,
      });
    }

    // Create adjustment (draft status)
    const adjustment = await InventoryAdjustment.create(
      [
        {
          adjustmentNumber,
          adjustmentDate: new Date(adjustmentDate),
          adjustmentType,
          description,
          notes,
          lines,
          status: "draft",
          createdBy: {
            name: user.name,
            id: user.id,
          },
        },
      ],
      { session }
    );

    // Approve immediately (creates journal entries and stock movements)
    await adjustment[0].approve({
      name: user.name,
      id: user.id,
    });

    await session.commitTransaction();

    revalidatePath("/dashboard/adjustments");

    return {
      message: `Stock adjustment ${adjustmentNumber} created and approved successfully`,
      success: true,
      adjustmentNumber,
      adjustmentId: adjustment[0]._id.toString(),
    };
  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }

    console.error("[CREATE_ADJUSTMENT_ERROR]", error);

    return {
      message: error.message || "Failed to create stock adjustment",
      success: false,
    };
  } finally {
    if (session) {
      session.endSession();
    }
  }
}
