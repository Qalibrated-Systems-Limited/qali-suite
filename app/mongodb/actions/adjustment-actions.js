"use server";

import dbConnect from "@/app/config/dbConnect";
import InventoryAdjustment from "@/app/models/inventoryAdjustment";
import Product from "@/app/models/product";
import { revalidatePath } from "next/cache";
import mongoose from "mongoose";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
} from "@/lib/utils/tenant-utils";

/**
 * Create Stock Adjustment with automatic journal entry creation
 */
export async function createStockAdjustment(prevState, formData) {
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
        success: false,
      };
    }

    // Check permission
    if (!["Admin", "Store Manager", "Accountant"].includes(user.role)) {
      return {
        message: "You don't have permission to create stock adjustments",
        success: false,
      };
    }

    // Get tenant companyId for create
    let tenantCompanyId;
    try {
      tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    } catch (error) {
      return {
        message: error.message,
        success: false,
      };
    }

    // Parse form data
    const adjustmentData = JSON.parse(formData.get("adjustmentData"));

    const { adjustmentDate, adjustmentType, description, notes, items } =
      adjustmentData;

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

    // Validate quantities are positive integers
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        return {
          message: `Invalid quantity for ${item.productName || 'item'}: must be a positive whole number`,
          success: false,
        };
      }
    }

    // Start MongoDB session for transaction
    session = await mongoose.startSession();
    session.startTransaction();

    // Generate adjustment number (tenant-scoped)
    const adjustmentNumber =
      await InventoryAdjustment.generateAdjustmentNumber(tenantCompanyId);

    // Prepare adjustment lines
    const lines = [];

    for (const item of items) {
      // Find product with tenant scoping
      const product = await Product.findOne(
        withTenantScope({ _id: item.productId }, tenantCompanyId, isSuperAdmin)
      ).session(session);

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
          companyId: tenantCompanyId,
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
