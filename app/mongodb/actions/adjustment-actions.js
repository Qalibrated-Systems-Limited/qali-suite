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
import { submitApproval } from "./approval-actions";
import { getCompanyThresholds } from "@/app/mongodb/queries/threshold-queries";

// ============================================
// STOCK ADJUSTMENT APPROVAL POLICY
// ============================================
// Industry-standard SoD: physical custody (Storekeeper / Store Manager)
// proposes adjustments; finance / management approves writes.
//
// Auto-approve allowed when ALL of these hold:
//   1. Caller has full authority (Admin or Manager) OR
//      caller is Store Manager / Accountant AND
//      adjustment type is not in the company's configured high-risk list AND
//      total |value| ≤ company's configured stockAdjustmentValue threshold
//
// Otherwise the adjustment is created as a draft and routed through the
// approval engine. Thresholds are now per-company — see Company schema
// `settings.approvalThresholds`.

const FULL_AUTHORITY_ROLES = new Set(["Admin", "Manager", "SuperAdmin"]);
const CREATE_ROLES = new Set([
  "Admin",
  "Manager",
  "Store Manager",
  "Storekeeper",
  "Accountant",
]);

/**
 * Create Stock Adjustment. Auto-approves for full-authority roles;
 * otherwise routes through the approval engine when type is high-risk
 * or value exceeds threshold.
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

    // Check permission — Storekeeper can now propose, but the approval
    // engine ensures they don't auto-apply.
    if (!CREATE_ROLES.has(user.role)) {
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

      const systemQuantity = product.inventory?.quantityOnHand ?? 0;
      const physicalQuantity =
        item.adjustmentType === "increase"
          ? systemQuantity + item.quantity
          : systemQuantity - item.quantity;

      const adjustmentQuantity = physicalQuantity - systemQuantity;
      const unitCost = product.costing?.costPrice ?? 0;
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

    // Compute total absolute value — used for the threshold rule below.
    const totalValue = lines.reduce((s, l) => s + (l.adjustmentValue || 0), 0);

    // Pull the company's configured thresholds (cached, single read).
    const thresholds = await getCompanyThresholds(tenantCompanyId.toString());
    const highRiskSet = new Set(thresholds.stockHighRiskTypes);

    // Decide: auto-approve or route through approval engine?
    const isHighRisk = highRiskSet.has(adjustmentType);
    const isHighValue = totalValue > thresholds.stockAdjustmentValue;
    const hasFullAuthority = FULL_AUTHORITY_ROLES.has(user.role);
    const canAutoApprove =
      hasFullAuthority || (!isHighRisk && !isHighValue);

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

    if (canAutoApprove) {
      // Approve immediately (creates journal entries and stock movements)
      // Pass the transaction session so all writes inside approve()
      // participate in the same atomic unit.
      await adjustment[0].approve(
        {
          name: user.name,
          id: user.id,
        },
        session
      );

      await session.commitTransaction();
      revalidatePath("/dashboard/adjustments");

      return {
        message: `Stock adjustment ${adjustmentNumber} created and approved successfully`,
        success: true,
        adjustmentNumber,
        adjustmentId: adjustment[0]._id.toString(),
      };
    }

    // Route through approval engine. Commit the draft creation first —
    // the approval row is in a separate logical step.
    await session.commitTransaction();
    session.endSession();
    session = null;

    const approvalType = isHighRisk ? "stock_writeoff" : "stock_adjustment";
    const reasonParts = [];
    if (isHighRisk) reasonParts.push(`High-risk type: ${adjustmentType}`);
    if (isHighValue)
      reasonParts.push(
        `Value KES ${totalValue.toLocaleString("en-KE", { maximumFractionDigits: 0 })} exceeds auto-approve threshold`,
      );
    if (reasonParts.length === 0) reasonParts.push("Caller lacks full authority");

    const approvalResult = await submitApproval({
      type: approvalType,
      targetRef: {
        kind: "InventoryAdjustment",
        id: adjustment[0]._id,
        label: `${adjustmentNumber} — ${adjustmentType} (${lines.length} items)`,
      },
      payload: { adjustmentId: adjustment[0]._id.toString() },
      reason: reasonParts.join("; "),
      requesterNote: description || notes || "",
      context: {
        adjustmentType,
        totalValue,
        lineCount: lines.length,
        threshold: thresholds.stockAdjustmentValue,
      },
    });

    revalidatePath("/dashboard/adjustments");
    revalidatePath("/dashboard/approvals");

    if (!approvalResult.success) {
      // The draft was saved but the approval submission failed — surface
      // both pieces so the caller knows what to do.
      return {
        message: `Adjustment ${adjustmentNumber} saved as draft but approval submission failed: ${approvalResult.error}`,
        success: false,
        adjustmentNumber,
        adjustmentId: adjustment[0]._id.toString(),
      };
    }

    return {
      message: `Adjustment ${adjustmentNumber} submitted for approval (${approvalResult.approval?.requestNumber || ""})`,
      success: true,
      requiresApproval: true,
      adjustmentNumber,
      adjustmentId: adjustment[0]._id.toString(),
      approval: approvalResult.approval,
    };
  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch {
        // ignore — session may already be ended
      }
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
