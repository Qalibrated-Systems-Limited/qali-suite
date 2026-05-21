

"use server";

import { auth } from "@/auth";
import Invoice from "../models/invoice";
import Product from "../models/product";
import Company from "../models/Company";
import { StockMovement } from "../models/stockmovement";
import Account from "../models/account";
import Party from "../models/parties";
import TaxTransaction from "../models/taxTransactions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { generateInvoiceNumber } from "./queries/invoice-queries";
import { generateMovementNumber } from "./queries/movement-queries";
import mongoose from "mongoose";
import { roundCurrency, applyRate } from "@/lib/money";
import { FINANCE_WRITE_ROLES, hasRole } from "@/lib/utils/role-gates";
import {
  getTenantContext,
  validateTenantAccess,
} from "@/lib/utils/tenant-utils";
import dbConnect from "@/app/config/dbConnect";
import Project from "../models/project";
import { emitWebhookEvent } from "@/lib/integrations/webhooks/emitter";

const ObjectId = mongoose.Types.ObjectId;

// ============================================
// UPDATE INVOICE ACTION
// ============================================
// For DRAFT invoices: Only adjusts quantityCommitted (no stock movements)
// For COMPLETED invoices: Not allowed to edit stock items
// ============================================
export async function updateInvoice(invoiceId, prevState, formData) {
  await dbConnect();
  const session = await auth();

  if (!session?.user) {
    return {
      success: false,
      error: "Unauthorized. Please log in.",
    };
  }

  const { user } = session;

  // Check permissions
  if (!hasRole(user, FINANCE_WRITE_ROLES)) {
    return {
      success: false,
      error: "You don't have permission to update invoices.",
    };
  }

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  if (!companyId && !isSuperAdmin) {
    return {
      success: false,
      error: "Company context required",
    };
  }

  try {
    // Parse invoice data from formData
    const invoiceDataString = formData.get("invoiceData");
    if (!invoiceDataString) {
      return {
        success: false,
        error: "Invoice data is required.",
      };
    }

    const invoiceData = JSON.parse(invoiceDataString);

    // Validate required fields
    if (!invoiceData.customer || !invoiceData.customer.id) {
      return {
        success: false,
        error: "Customer is required.",
      };
    }

    if (
      (!invoiceData.stockItems || invoiceData.stockItems.length === 0) &&
      (!invoiceData.serviceItems || invoiceData.serviceItems.length === 0)
    ) {
      return {
        success: false,
        error: "At least one item or service is required.",
      };
    }

    // Start MongoDB transaction
    const mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    try {
      // Fetch the existing invoice
      const existingInvoice =
        await Invoice.findById(invoiceId).session(mongoSession);

      if (!existingInvoice) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: "Invoice not found.",
        };
      }

      // Validate tenant access
      if (!validateTenantAccess(existingInvoice, companyId, isSuperAdmin)) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: "Access denied to this invoice.",
        };
      }

      // Check if invoice can be edited
      if (existingInvoice.paymentStatus === "paid") {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: "Cannot edit fully paid invoices.",
        };
      }

      if (existingInvoice.status === "cancelled") {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: "Cannot edit cancelled invoices.",
        };
      }

      // Completed invoices cannot have stock items changed
      if (existingInvoice.status === "completed") {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: "Cannot edit completed invoices. Create a credit note instead.",
        };
      }

      // ============================================
      // STEP 1: BUILD MAP OF OLD COMMITTED ITEMS
      // ============================================
      const oldCommittedItemsMap = new Map();
      existingInvoice.items
        .filter((item) => item.itemType === "product" && item.stockCommitted)
        .forEach((item) => {
          oldCommittedItemsMap.set(item.productId.toString(), {
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            SKU: item.productSKU,
            name: item.productName,
          });
        });

      // ============================================
      // STEP 2: BUILD MAP OF NEW ITEMS
      // ============================================
      const newStockItemsMap = new Map();
      const technicianStockItems = [];

      if (invoiceData.stockItems && invoiceData.stockItems.length > 0) {
        invoiceData.stockItems.forEach((item) => {
          const isFromTechnicianStock = item.stockSource === "technician" && item.relatedCheckout?.checkoutId;

          if (isFromTechnicianStock) {
            technicianStockItems.push({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              SKU: item.SKU,
              name: item.name,
              description: item.description || "",
              unit: item.unit,
              total: item.total,
              taxRate: item.taxRate ?? 16,
              relatedCheckout: item.relatedCheckout,
            });
          } else {
            newStockItemsMap.set(item.productId, {
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              SKU: item.SKU,
              name: item.name,
              description: item.description || "",
              unit: item.unit,
              total: item.total,
              taxRate: item.taxRate ?? 16,
            });
          }
        });
      }

      // ============================================
      // STEP 3: ADJUST COMMITMENTS (Draft invoices only)
      // ============================================
      const newLineItems = [];
      const allProductIds = new Set([
        ...oldCommittedItemsMap.keys(),
        ...newStockItemsMap.keys(),
      ]);

      // Pre-fetch all referenced products in one batched + tenant-scoped
      // query. Replaces per-iteration Product.findById N+1, and ensures
      // the loop can't even see a product belonging to another tenant
      // (defense-in-depth against malicious productIds in form payload).
      const tenantClause = isSuperAdmin ? {} : { companyId };
      const validProductIds = [...allProductIds].filter((id) =>
        mongoose.Types.ObjectId.isValid(id),
      );
      const products =
        validProductIds.length > 0
          ? await Product.find({
              ...tenantClause,
              _id: { $in: validProductIds },
            })
              .session(mongoSession)
              .lean()
          : [];
      const productMap = new Map(
        products.map((p) => [p._id.toString(), p]),
      );

      for (const productId of allProductIds) {
        const oldItem = oldCommittedItemsMap.get(productId);
        const newItem = newStockItemsMap.get(productId);

        const oldQuantity = oldItem ? oldItem.quantity : 0;
        const newQuantity = newItem ? newItem.quantity : 0;
        const difference = newQuantity - oldQuantity;

        // If no change in quantity, just add to line items
        if (difference === 0 && newItem) {
          const itemTaxRate = newItem.taxRate ?? 16;
          const itemTaxAmount = applyRate(newItem.total, itemTaxRate);

          newLineItems.push({
            itemType: "product",
            productId: productId,
            productSKU: newItem.SKU,
            productName: newItem.name,
            description: newItem.description || newItem.name,
            unit: newItem.unit,
            quantity: newItem.quantity,
            unitPrice: newItem.unitPrice,
            amount: newItem.total,
            taxRate: itemTaxRate,
            taxAmount: itemTaxAmount,
            stockCommitted: true,
          });
          continue;
        }

        // Resolve product from pre-fetched map (no DB call here).
        const product = productMap.get(productId.toString());

        if (!product && newItem) {
          throw new Error(`Product not found: ${productId}`);
        }

        // Case 1: Item removed from invoice — RELEASE commitment.
        // Releases are always safe (we're returning quantity to the pool),
        // but we still tenant-scope the write defensively.
        if (oldItem && !newItem) {
          await Product.findOneAndUpdate(
            { _id: productId, ...tenantClause },
            {
              $inc: {
                "inventory.quantityCommitted": -oldQuantity,
                "inventory.quantityAvailable": oldQuantity,
              },
            },
            { session: mongoSession }
          );
          continue;
        }

        // Case 2: New item added — COMMIT inventory.
        // Atomic CAS: the conditional `quantityAvailable: { $gte: ... }`
        // means only the write that finds enough stock at the moment of
        // the write succeeds. Closes the prior TOCTOU where the read of
        // `product.inventory.quantityAvailable` could be stale by the
        // time the unconditional $inc landed.
        if (!oldItem && newItem) {
          const committed = await Product.findOneAndUpdate(
            {
              _id: productId,
              ...tenantClause,
              "inventory.quantityAvailable": { $gte: newQuantity },
            },
            {
              $inc: {
                "inventory.quantityCommitted": newQuantity,
                "inventory.quantityAvailable": -newQuantity,
              },
            },
            { session: mongoSession, new: true }
          );

          if (!committed) {
            const fresh = await Product.findOne(
              { _id: productId, ...tenantClause },
            )
              .session(mongoSession)
              .lean();
            const available = fresh?.inventory?.quantityAvailable ?? 0;
            throw new Error(
              `Insufficient stock for ${product.name}. Available: ${available}, Requested: ${newQuantity}`
            );
          }

          const itemTaxRate = newItem.taxRate ?? 16;
          const itemTaxAmount = applyRate(newItem.total, itemTaxRate);

          newLineItems.push({
            itemType: "product",
            productId: product._id,
            productSKU: newItem.SKU,
            productName: newItem.name,
            description: newItem.description || newItem.name,
            unit: newItem.unit,
            quantity: newItem.quantity,
            unitPrice: newItem.unitPrice,
            amount: newItem.total,
            taxRate: itemTaxRate,
            taxAmount: itemTaxAmount,
            stockCommitted: true,
          });
          continue;
        }

        // Case 3: Quantity changed — adjust commitment.
        if (oldItem && newItem && difference !== 0) {
          if (difference > 0) {
            // Commit MORE — same atomic CAS as Case 2 to avoid TOCTOU.
            const committed = await Product.findOneAndUpdate(
              {
                _id: productId,
                ...tenantClause,
                "inventory.quantityAvailable": { $gte: difference },
              },
              {
                $inc: {
                  "inventory.quantityCommitted": difference,
                  "inventory.quantityAvailable": -difference,
                },
              },
              { session: mongoSession, new: true }
            );

            if (!committed) {
              const fresh = await Product.findOne(
                { _id: productId, ...tenantClause },
              )
                .session(mongoSession)
                .lean();
              const available = fresh?.inventory?.quantityAvailable ?? 0;
              throw new Error(
                `Insufficient stock for ${product.name}. Available: ${available}, Additional needed: ${difference}`
              );
            }
          } else {
            // Need to RELEASE some commitment (always safe).
            const releaseQty = Math.abs(difference);
            await Product.findOneAndUpdate(
              { _id: productId, ...tenantClause },
              {
                $inc: {
                  "inventory.quantityCommitted": -releaseQty,
                  "inventory.quantityAvailable": releaseQty,
                },
              },
              { session: mongoSession }
            );
          }

          const itemTaxRate = newItem.taxRate ?? 16;
          const itemTaxAmount = applyRate(newItem.total, itemTaxRate);

          newLineItems.push({
            itemType: "product",
            productId: product._id,
            productSKU: newItem.SKU,
            productName: newItem.name,
            description: newItem.description || newItem.name,
            unit: newItem.unit,
            quantity: newItem.quantity,
            unitPrice: newItem.unitPrice,
            amount: newItem.total,
            taxRate: itemTaxRate,
            taxAmount: itemTaxAmount,
            stockCommitted: true,
          });
        }
      }

      // ============================================
      // STEP 3.5: ADD TECHNICIAN STOCK ITEMS
      // ============================================
      for (const item of technicianStockItems) {
        const techItemTaxRate = item.taxRate ?? 16;
        const techItemTaxAmount = applyRate(item.total, techItemTaxRate);

        newLineItems.push({
          itemType: "product",
          productId: item.productId,
          productSKU: item.SKU,
          productName: item.name,
          description: item.description || item.name,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.total,
          taxRate: techItemTaxRate,
          taxAmount: techItemTaxAmount,
          stockCommitted: false,
          relatedCheckout: {
            checkoutId: item.relatedCheckout.checkoutId,
            checkoutNumber: item.relatedCheckout.checkoutNumber,
          },
          relatedRequest: {
            technicianId: item.relatedCheckout.technicianId,
            technicianName: item.relatedCheckout.technicianName,
          },
        });
      }

      // ============================================
      // STEP 4: PROCESS SERVICE ITEMS
      // ============================================
      if (invoiceData.serviceItems && invoiceData.serviceItems.length > 0) {
        for (const item of invoiceData.serviceItems) {
          const serviceTaxRate = item.taxRate ?? 16;
          const serviceTaxAmount = applyRate(item.total, serviceTaxRate);

          newLineItems.push({
            itemType: "service",
            serviceCategory: item.category || item.serviceCategory || "other",
            description: item.name || item.description,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.total,
            taxRate: serviceTaxRate,
            taxAmount: serviceTaxAmount,
          });
        }
      }

      // ============================================
      // STEP 5: CALCULATE TOTALS
      // ============================================
      // Round at every aggregation step so the document totals match the
      // sum of line totals exactly — required for accounting correctness.
      const subtotal = roundCurrency(
        newLineItems.reduce((sum, item) => sum + (item.amount || 0), 0),
      );
      const discountPercentage = invoiceData.discountPercentage || 0;
      const discountAmount = applyRate(subtotal, discountPercentage);
      const subtotalAfterDiscount = roundCurrency(subtotal - discountAmount);

      const discountFactor = subtotal > 0 ? subtotalAfterDiscount / subtotal : 1;
      const taxAmount = roundCurrency(
        newLineItems.reduce(
          (sum, item) => sum + (item.taxAmount || 0) * discountFactor,
          0,
        ),
      );

      const total = roundCurrency(subtotalAfterDiscount + taxAmount);

      // ============================================
      // STEP 6: UPDATE INVOICE
      // ============================================
      existingInvoice.customer = invoiceData.customer;
      existingInvoice.invoiceDate = new Date(invoiceData.invoiceDate);
      existingInvoice.dueDate = invoiceData.dueDate
        ? new Date(invoiceData.dueDate)
        : null;
      existingInvoice.items = newLineItems;
      existingInvoice.subtotal = subtotal;
      existingInvoice.discountPercentage = discountPercentage;
      existingInvoice.totalDiscount = discountAmount;
      existingInvoice.taxAmount = taxAmount;
      existingInvoice.total = total;
      existingInvoice.title = invoiceData.title || "";
      existingInvoice.referenceNumber = invoiceData.referenceNumber || "";
      existingInvoice.purchaseOrderNumber = invoiceData.purchaseOrderNumber || "";
      existingInvoice.notes = invoiceData.notes || "";
      existingInvoice.termsAndConditions = invoiceData.termsAndConditions || "";

      // Project linking (optional)
      if (invoiceData.projectId) {
        const proj = await Project.findById(invoiceData.projectId)
          .select("projectNumber name status")
          .session(mongoSession)
          .lean();
        if (proj && proj.status !== "closed") {
          existingInvoice.projectId = proj._id;
          existingInvoice.project = { projectNumber: proj.projectNumber, name: proj.name };
        }
      } else {
        existingInvoice.projectId = undefined;
        existingInvoice.project = undefined;
      }

      existingInvoice.amountDue = total - existingInvoice.amountPaid;

      if (existingInvoice.amountPaid > 0) {
        if (existingInvoice.amountDue <= 0.01) {
          existingInvoice.paymentStatus = "paid";
        } else {
          existingInvoice.paymentStatus = "partial";
        }
      }

      // ============================================
      // UPDATE DRAFT EXPIRY BASED ON STOCK ITEMS
      // ============================================
      const hasCommittedStockNow = newLineItems.some(
        (item) => item.stockCommitted === true
      );

      if (hasCommittedStockNow && !existingInvoice.draftExpiresAt) {
        // Invoice now has committed stock but no expiry - set one
        const companyDoc = await Company.findById(companyId).session(mongoSession);
        const expiryDays = companyDoc?.settings?.draftInvoiceExpiryDays ?? 14;
        existingInvoice.draftExpiresAt = new Date(
          Date.now() + expiryDays * 24 * 60 * 60 * 1000
        );
      } else if (!hasCommittedStockNow && existingInvoice.draftExpiresAt) {
        // No more committed stock - clear expiry
        existingInvoice.draftExpiresAt = null;
      }
      // If already has both committed stock and expiry, keep existing expiry

      await existingInvoice.save({ session: mongoSession });

      // Commit transaction
      await mongoSession.commitTransaction();

      // Revalidate paths
      revalidatePath("/dashboard/invoices");
      revalidatePath(`/dashboard/invoices/${invoiceId}`);
      revalidatePath(`/dashboard/invoices/${invoiceId}/edit`);
      revalidatePath("/dashboard/stocks");
      if (existingInvoice.projectId) {
        revalidatePath("/dashboard/projects");
        revalidatePath(`/dashboard/projects/${existingInvoice.projectId}`);
      }

      return {
        success: true,
        message: "Invoice updated successfully",
        invoiceId: existingInvoice._id.toString(),
        invoiceNumber: existingInvoice.invoiceNumber,
      };
    } catch (error) {
      await mongoSession.abortTransaction();
      throw error;
    } finally {
      mongoSession.endSession();
    }
  } catch (error) {
    console.error("Update invoice error:", error);
    return {
      success: false,
      error: error.message || "Failed to update invoice. Please try again.",
    };
  }
}

// ============================================
// CREATE INVOICE (WITH ACCOUNTING INTEGRATION)
// ============================================
export async function createInvoice(prevState, formData) {
  await dbConnect();
  const mongoSession = await mongoose.startSession();

  try {
    const authSession = await auth();
    const user = authSession?.user;

    if (!user) {
      return {
        message: "Unauthorized",
        success: false,
      };
    }

    // Check if user has permission
    if (!hasRole(user, FINANCE_WRITE_ROLES)) {
      return {
        message: "You don't have permission to create invoices.",
        success: false,
      };
    }

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      return {
        message: "Company context required",
        success: false,
      };
    }

    // Parse form data
    const data = JSON.parse(formData.get("invoiceData"));

    // Validate required fields
    if (
      !data.customerId ||
      (!data.stockItems.length && !data.serviceItems.length)
    ) {
      return {
        message: "Customer and at least one item are required",
        success: false,
      };
    }

    // Get customer (Party)
    const customer = await Party.findById(data.customerId);
    if (!customer) {
      return {
        message: "Customer not found",
        success: false,
      };
    }

    // Verify it's a customer
    if (customer.type !== "customer" && customer.type !== "both") {
      return {
        message: "Selected party is not a customer",
        success: false,
      };
    }

    // Start transaction for inventory commitment
    mongoSession.startTransaction();

    // Generate invoice number (with company code prefix)
    const invoiceNumber = await generateInvoiceNumber(companyId);

    // Prepare invoice items in new Invoice model format
    const items = [];

    // Pre-fetch all stock-item products in one batched + tenant-scoped
    // query (replaces per-line Product.findById N+1). The atomic
    // commitment update below still runs per-line so concurrent draft
    // creation can't oversell.
    const tenantClause = isSuperAdmin ? {} : { companyId };
    const stockItemIds = (data.stockItems || [])
      .map((it) => it.productId)
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id));
    const stockProducts =
      stockItemIds.length > 0
        ? await Product.find({
            ...tenantClause,
            _id: { $in: stockItemIds },
          })
            .session(mongoSession)
            .lean()
        : [];
    const stockProductMap = new Map(
      stockProducts.map((p) => [p._id.toString(), p]),
    );

    // ============================================
    // PRICING POLICY ENFORCEMENT
    // ============================================
    // Two policy bounds at invoice creation, both per industry-standard
    // ERP convention (SAP / Odoo / NetSuite):
    //   1. Per-product minimum price (floor) — no line below it.
    //   2. Invoice-level discount cap — no discount above the company's
    //      configured threshold.
    // Both can be overridden by pricing-policy roles (finance leadership)
    // — they explicitly authorise the exception by being the one who saves.
    // Everyone else gets a hard reject with a clear message; later this
    // can route to approval, but a clean rejection is the audit baseline.
    const PRICING_POLICY_ROLES = new Set([
      "SuperAdmin",
      "Admin",
      "CFO",
      "Finance Manager",
    ]);
    const canOverridePricing = PRICING_POLICY_ROLES.has(user.role);

    if (!canOverridePricing) {
      // Load the company's configured caps. Tolerant defaults if the
      // settings sub-doc isn't seeded yet (treat as "no cap").
      const companyDoc = await Company.findById(companyId)
        .select("settings.approvalThresholds")
        .session(mongoSession)
        .lean();
      const thresholds = companyDoc?.settings?.approvalThresholds || {};
      const discountCap = thresholds.discountCapPercent ?? 100;

      const requestedDiscount = data.discountPercentage || 0;
      if (requestedDiscount > discountCap) {
        await mongoSession.abortTransaction();
        return {
          message: `Discount ${requestedDiscount}% exceeds the ${discountCap}% cap for your role. Reduce the discount or have finance approve the invoice.`,
          success: false,
        };
      }

      // Per-line floor enforcement (stock items only — services don't
      // have a product master to floor against).
      for (const item of data.stockItems || []) {
        const product = item.productId
          ? stockProductMap.get(item.productId.toString())
          : null;
        if (!product) continue; // existing missing-product handling kicks in below
        const floor = product.pricing?.minimumPrice ?? 0;
        if (floor > 0 && Number(item.sellingPrice) < floor) {
          await mongoSession.abortTransaction();
          return {
            message: `Price ${item.sellingPrice} for "${product.name}" is below the minimum ${floor}. Increase the price or have finance authorise the override.`,
            success: false,
          };
        }
      }
    }

    // Process stock items (products)
    for (const item of data.stockItems) {
      const product = item.productId
        ? stockProductMap.get(item.productId.toString())
        : null;

      if (!product) {
        await mongoSession.abortTransaction();
        return {
          message: `Product ${item.name} not found`,
          success: false,
        };
      }

      // Check stock availability ONLY for store inventory items
      // Technician stock items were already checked out from inventory
      const isFromTechnicianStock = item.stockSource === "technician" && item.relatedCheckout?.checkoutId;

      if (!isFromTechnicianStock) {
        // ============================================
        // COMMIT INVENTORY (atomic, race-safe + tenant-scoped)
        // ============================================
        // Conditional findOneAndUpdate: only succeeds if quantityAvailable
        // is still >= the requested amount. Two concurrent drafts for the
        // last unit cannot both pass — the second one returns null.
        const committed = await Product.findOneAndUpdate(
          {
            _id: item.productId,
            ...tenantClause,
            "inventory.quantityAvailable": { $gte: item.quantity },
          },
          {
            $inc: {
              "inventory.quantityCommitted": item.quantity,
              "inventory.quantityAvailable": -item.quantity,
            },
          },
          { session: mongoSession, new: true }
        );

        if (!committed) {
          // Re-read fresh value for the error message — `product` was
          // taken from the pre-fetched map and may be stale by now.
          const fresh = await Product.findOne({
            _id: item.productId,
            ...tenantClause,
          })
            .session(mongoSession)
            .lean();
          const available = fresh?.inventory?.quantityAvailable ?? 0;
          await mongoSession.abortTransaction();
          return {
            message: `Insufficient stock for ${product.name}. Available: ${available}, Required: ${item.quantity}`,
            success: false,
          };
        }
      }

      // Use per-item tax rate, fallback to global vatPercentage, then default 16%
      const itemTaxRate = item.taxRate ?? data.vatPercentage ?? 16;

      const invoiceItem = {
        itemType: "product",
        productId: product._id,
        productSKU: product.SKU,
        productName: product.name,
        description: product.description || product.name,
        unit: product.unit,
        quantity: item.quantity,
        unitPrice: item.sellingPrice,
        amount: item.total,
        taxRate: itemTaxRate,
        taxAmount: applyRate(item.total, itemTaxRate),
        discountPercentage: 0,
        discountAmount: 0,
        // Track stock commitment status
        stockCommitted: !isFromTechnicianStock, // true for store items, false for technician stock
      };

      // Add technician stock tracking if from checkout
      if (isFromTechnicianStock) {
        invoiceItem.relatedCheckout = {
          checkoutId: item.relatedCheckout.checkoutId,
          checkoutNumber: item.relatedCheckout.checkoutNumber,
        };
        // Also populate relatedRequest for COGS routing
        if (item.relatedCheckout.technicianId) {
          invoiceItem.relatedRequest = {
            technicianId: item.relatedCheckout.technicianId,
            technicianName: item.relatedCheckout.technicianName,
          };
        }
      }

      items.push(invoiceItem);
    }

    // Process service items
    for (const item of data.serviceItems) {
      // Use per-item tax rate, fallback to global vatPercentage, then default 16%
      const itemTaxRate = item.taxRate ?? data.vatPercentage ?? 16;

      items.push({
        itemType: "service",
        serviceCategory: item.category || "other",
        description: item.name,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.total,
        taxRate: itemTaxRate,
        taxAmount: applyRate(item.total, itemTaxRate),
        discountPercentage: 0,
        discountAmount: 0,
      });
    }

    // Calculate totals — round at every aggregation step so doc totals
    // match the rendered sum of line totals exactly.
    const subtotal = roundCurrency(
      items.reduce((sum, item) => sum + item.amount, 0),
    );
    const totalDiscount = applyRate(subtotal, data.discountPercentage || 0);

    // Item taxAmount is stored as pre-discount (for model validation and audit clarity)
    // Invoice-level taxAmount applies discount proportionally
    const discountFactor = subtotal > 0 ? (subtotal - totalDiscount) / subtotal : 1;
    const taxAmount = roundCurrency(
      items.reduce(
        (sum, item) => sum + item.taxAmount * discountFactor,
        0,
      ),
    );

    const total = roundCurrency(subtotal - totalDiscount + taxAmount);

    // ============================================
    // SET DRAFT EXPIRY FOR INVOICES WITH COMMITTED STOCK
    // ============================================
    // Only invoices holding committed stock should expire
    // Service-only invoices don't need expiry since they don't hold inventory
    const hasCommittedStock = items.some((item) => item.stockCommitted === true);
    let draftExpiresAt = null;

    if (hasCommittedStock) {
      // Fetch company settings for expiry days
      const company = await Company.findById(companyId).session(mongoSession);
      const expiryDays = company?.settings?.draftInvoiceExpiryDays ?? 14;
      draftExpiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    }

    // Format customer address from Party model
    const formatAddress = (address) => {
      if (!address) return "";

      // Handle case where address is a string
      if (typeof address === "string") {
        // Try to parse as JSON first
        try {
          const parsed = JSON.parse(address);
          if (typeof parsed === "object" && parsed !== null) {
            const parts = [
              parsed.line1,
              parsed.line2,
              parsed.city,
              parsed.postalCode,
              parsed.country,
            ].filter(Boolean);
            return parts.join(", ");
          }
        } catch {
          // Not valid JSON - check if it's a JS object literal like "{ country: 'Kenya' }"
          if (address.startsWith("{") && address.endsWith("}")) {
            try {
              // Convert JS object literal to valid JSON
              const jsonStr = address
                .replace(/(\w+):/g, '"$1":') // Quote keys
                .replace(/'/g, '"'); // Replace single quotes
              const parsed = JSON.parse(jsonStr);
              if (typeof parsed === "object" && parsed !== null) {
                const parts = [
                  parsed.line1,
                  parsed.line2,
                  parsed.city,
                  parsed.postalCode,
                  parsed.country,
                ].filter(Boolean);
                return parts.join(", ");
              }
            } catch {
              // Still couldn't parse, return as-is
              return address;
            }
          }
          // Not an object-like string, return as-is (might already be formatted)
          return address;
        }
      }

      // Handle case where address is an object
      if (typeof address === "object" && address !== null) {
        const parts = [
          address.line1,
          address.line2,
          address.city,
          address.postalCode,
          address.country,
        ].filter(Boolean);
        return parts.join(", ");
      }

      return "";
    };

    // Resolve project if provided
    if (data.projectId) {
      const proj = await Project.findById(data.projectId)
        .select("projectNumber name status")
        .session(mongoSession)
        .lean();
      if (proj && proj.status !== "closed") {
        data._resolvedProject = proj;
      } else {
        data.projectId = null;
      }
    }

    // Create invoice using new Invoice model
    const invoice = await Invoice.create(
      [
        {
          invoiceNumber,
          invoiceDate: new Date(data.invoiceDate),
          dueDate: data.dueDate
            ? new Date(data.dueDate)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Default 30 days
          customer: {
            id: customer._id.toString(),
            name: customer.displayName || customer.name,
            email: customer.email || "",
            phone: customer.phone || "",
            address: formatAddress(customer.address),
            taxPin: customer.taxPin || "",
          },
          items,
          subtotal,
          discountPercentage: data.discountPercentage || 0,
          totalDiscount,
          taxAmount,
          total,
          amountPaid: 0,
          amountDue: total, // New invoice - full amount is due
          currency: "KES",
          paymentStatus: "unpaid",
          title: data.title || "",
          referenceNumber: data.referenceNumber || "",
          purchaseOrderNumber: data.purchaseOrderNumber || "",
          notes: data.notes || "",
          termsAndConditions: data.termsAndConditions || "",
          createdBy: {
            name: user.name,
            id: user.id,
          },
          status: "draft",
          companyId: new ObjectId(companyId), // Tenant isolation
          // Set expiry only for invoices with committed stock
          ...(draftExpiresAt && { draftExpiresAt }),
          // Project linking (optional)
          ...(data.projectId && data._resolvedProject && {
            projectId: new ObjectId(data.projectId),
            project: { projectNumber: data._resolvedProject.projectNumber, name: data._resolvedProject.name },
          }),
        },
      ],
      { session: mongoSession }
    );

    // Commit the transaction
    await mongoSession.commitTransaction();

    // Note: Invoice stays as draft - user must explicitly post/complete it
    // Stock is COMMITTED (reserved) but not yet DEDUCTED from quantityOnHand

    revalidatePath("/dashboard/invoices");
    revalidatePath("/dashboard/stocks");
    if (data.projectId) {
      revalidatePath("/dashboard/projects");
      revalidatePath(`/dashboard/projects/${data.projectId}`);
    }

    emitWebhookEvent({
      companyId: companyId.toString(),
      event: "invoice.created",
      payload: {
        invoiceId: invoice[0]._id.toString(),
        invoiceNumber: invoice[0].invoiceNumber,
        status: "draft",
      },
    });

    return {
      message: `Invoice ${invoiceNumber} created as draft. Stock reserved. Post it to finalize.`,
      success: true,
      invoiceId: invoice[0]._id.toString(),
      invoiceNumber: invoice[0].invoiceNumber,
      status: "draft",
    };
  } catch (error) {
    await mongoSession.abortTransaction();
    console.error("Create invoice error:", error);
    return {
      message: error.message || "Database error: failed to create invoice",
      success: false,
    };
  } finally {
    mongoSession.endSession();
  }
}

// ============================================
// UPDATE INVOICE PAYMENT STATUS
// ============================================
// @deprecated Use createInvoicePayment instead - this legacy function
// doesn't create a Payment document, doesn't use transactions, and
// doesn't create journal entries. Use createInvoicePayment for proper
// accounting integration.
// ============================================
export async function updateInvoicePayment(invoiceId, prevState, formData) {
  // Redirect to proper function
  return createInvoicePayment(invoiceId, prevState, formData);
}

// ============================================
// QUICK PAYMENT - Creates Payment + Records on Invoice
// ============================================
// Creates a full Payment document and allocates it to the invoice
// Use this for direct payments from the invoice detail page
// ============================================
export async function createInvoicePayment(invoiceId, prevState, formData) {
  await dbConnect();
  const mongoSession = await mongoose.startSession();

  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Please sign in to continue" };
    }

    const user = session.user;

    // Role check — Manager included in addition to finance roles
    // since branch managers commonly record cash receipts.
    if (!hasRole(user, [...FINANCE_WRITE_ROLES, "Manager"])) {
      return {
        success: false,
        error: "You don't have permission to record payments",
      };
    }

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      return { success: false, error: "Company context required" };
    }

    await dbConnect();

    // Parse form data
    const amount = parseFloat(formData.get("amount"));
    const paymentMethod = formData.get("paymentMethod");
    const accountId = formData.get("accountId");
    const paymentDate = formData.get("paymentDate") || new Date().toISOString();
    const reference = formData.get("reference") || "";
    const notes = formData.get("notes") || "";

    // Validation
    if (!amount || amount <= 0) {
      return {
        success: false,
        error: "Payment amount must be positive",
        fieldErrors: { amount: "Amount must be greater than zero" },
      };
    }

    if (!paymentMethod) {
      return {
        success: false,
        error: "Payment method is required",
        fieldErrors: { paymentMethod: "Please select a payment method" },
      };
    }

    if (!accountId) {
      return {
        success: false,
        error: "Payment account is required",
        fieldErrors: { accountId: "Please select a payment account" },
      };
    }

    mongoSession.startTransaction();

    // Get invoice
    const invoice = await Invoice.findById(invoiceId).session(mongoSession);
    if (!invoice) {
      await mongoSession.abortTransaction();
      return { success: false, error: "Invoice not found" };
    }

    // Validate tenant access
    if (!validateTenantAccess(invoice, companyId, isSuperAdmin)) {
      await mongoSession.abortTransaction();
      return { success: false, error: "Access denied to this invoice" };
    }

    if (invoice.paymentStatus === "paid") {
      await mongoSession.abortTransaction();
      return { success: false, error: "Invoice is already fully paid" };
    }

    // Only completed invoices can receive payments
    if (invoice.status !== "completed") {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: `Can only receive payments on completed invoices. Current status: ${invoice.status}`,
      };
    }

    if (amount > invoice.amountDue + 0.01) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: `Payment amount (${amount.toFixed(
          2,
        )}) exceeds balance (${invoice.amountDue?.toFixed(2)})`,
        fieldErrors: { amount: "Amount exceeds outstanding balance" },
      };
    }

    // Get payment account
    const paymentAccount =
      await Account.findById(accountId).session(mongoSession);
    if (!paymentAccount) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: "Payment account not found",
        fieldErrors: { accountId: "Invalid account selected" },
      };
    }

    if (!["cash", "bank", "mpesa"].includes(paymentAccount.subType)) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: "Payment account must be cash, bank, or M-Pesa type",
        fieldErrors: { accountId: "Select a cash, bank, or M-Pesa account" },
      };
    }

    // Import Payment model
    const Payment = (await import("@/app/models/payment")).default;

    // Generate payment number
    const paymentNumber = await Payment.generatePaymentNumber("RECEIVED");

    // Calculate fiscal period from payment date
    const payDate = new Date(paymentDate);
    const fiscalPeriod = `${payDate.getFullYear()}-${String(
      payDate.getMonth() + 1,
    ).padStart(2, "0")}`;

    // Get customer info
    const customerId = invoice.customer?.id || invoice.customerId;
    const customerName =
      invoice.customer?.name || invoice.customerName || "Customer";

    // Create payment document
    const payment = new Payment({
      paymentNumber,
      paymentType: "received",
      paymentDate: payDate,
      fiscalPeriod,
      amount,
      paymentMethod,
      account: {
        id: paymentAccount._id,
        code: paymentAccount.accountCode,
        name: paymentAccount.accountName,
        subType: paymentAccount.subType,
      },
      party: {
        partyId: customerId,
        type: "customer",
        name: customerName,
      },
      allocations: [
        {
          documentType: "invoice",
          documentId: invoice._id,
          documentNumber: invoice.invoiceNumber,
          documentDate: invoice.invoiceDate || invoice.createdAt,
          originalAmount: invoice.total,
          balanceBefore: invoice.amountDue,
          amountAllocated: amount,
        },
      ],
      description: `Payment for ${invoice.invoiceNumber}`,
      reference,
      notes,
      status: "draft",
      createdBy: {
        id: user.id,
        name: user.name || user.email,
        email: user.email,
      },
      companyId, // Tenant isolation
    });

    await payment.save({ session: mongoSession });

    // Confirm payment (creates JE and updates invoice via updateAllocatedDocuments)
    // Pass session so it uses our transaction instead of creating its own
    await payment.confirm(user, mongoSession);

    await mongoSession.commitTransaction();

    revalidatePath("/dashboard/invoices");
    revalidatePath(`/dashboard/invoices/${invoiceId}`);
    revalidatePath("/dashboard/payments");
    if (invoice.projectId) {
      revalidatePath("/dashboard/projects");
      revalidatePath(`/dashboard/projects/${invoice.projectId}`);
    }

    emitWebhookEvent({
      companyId: companyId.toString(),
      event: invoice.paymentStatus === "paid" ? "invoice.paid" : "payment.received",
      payload: {
        invoiceId: invoiceId.toString(),
        invoiceNumber: invoice.invoiceNumber,
        paymentId: payment._id.toString(),
        paymentNumber: payment.paymentNumber,
        amount,
        paymentStatus: invoice.paymentStatus,
      },
    });

    return {
      success: true,
      message: `Payment of ${amount.toFixed(2)} recorded successfully`,
      data: {
        paymentId: payment._id.toString(),
        paymentNumber: payment.paymentNumber,
      },
    };
  } catch (error) {
    await mongoSession.abortTransaction();
    console.error("Create invoice payment error:", error);
    return {
      success: false,
      error: error.message || "Failed to create payment",
    };
  } finally {
    mongoSession.endSession();
  }
}

// ============================================
// CANCEL INVOICE
// ============================================
export async function cancelInvoice(invoiceId, reason = "") {
  const authSession = await auth();
  const user = authSession?.user;

  if (!hasRole(user, FINANCE_WRITE_ROLES)) {
    return {
      message: "You don't have permission to cancel invoices.",
    };
  }

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  if (!companyId && !isSuperAdmin) {
    return { message: "Company context required" };
  }

  await dbConnect();

  const invoice = await Invoice.findById(invoiceId);

  if (!invoice) {
    return {
      message: "Invoice not found",
    };
  }

  // Accountants can only cancel their own invoices
  if (user.role === "Accountant" && invoice.createdBy?.id !== user.id) {
    return { message: "Accountants can only cancel their own invoices" };
  }

  // Validate tenant access
  if (!validateTenantAccess(invoice, companyId, isSuperAdmin)) {
    return { message: "Access denied to this invoice" };
  }

  // Only draft/sent invoices can be cancelled — use credit notes for completed invoices
  if (invoice.status !== "draft" && invoice.status !== "sent") {
    return { message: "Only draft or sent invoices can be cancelled. Use a credit note for posted invoices." };
  }

  try {
    // Use the model's cancel method which handles:
    // - Journal entry reversals
    // - Stock restoration
    // - Movement status updates
    // - Lifetime totals adjustments
    await invoice.cancel(
      { name: user.name, id: user.id },
      reason || `Cancelled by ${user.name}`,
    );
  } catch (error) {
    console.error("Cancel invoice error:", error);
    return {
      message: error.message || "Failed to cancel invoice",
    };
  }

  // Revalidate and redirect on success
  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  revalidatePath("/dashboard/stocks");
  revalidatePath("/dashboard/movements");
  revalidatePath("/dashboard/accounts");
  if (invoice.projectId) {
    revalidatePath("/dashboard/projects");
    revalidatePath(`/dashboard/projects/${invoice.projectId}`);
  }
  redirect("/dashboard/invoices");
}

// ============================================
// COMPLETE/POST INVOICE
// ============================================
export async function completeInvoice(invoiceId) {
  const authSession = await auth();
  const user = authSession?.user;

  if (!user) {
    return {
      message: "Unauthorized",
    };
  }

  if (!hasRole(user, FINANCE_WRITE_ROLES)) {
    return {
      message: "You don't have permission to perform this action.",
    };
  }

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  if (!companyId && !isSuperAdmin) {
    return { message: "Company context required" };
  }

  await dbConnect();

  const invoice = await Invoice.findById(invoiceId);

  if (!invoice) {
    return {
      message: "Invoice not found",
    };
  }

  // Validate tenant access
  if (!validateTenantAccess(invoice, companyId, isSuperAdmin)) {
    return { message: "Access denied to this invoice" };
  }

  if (invoice.status !== "draft" && invoice.status !== "sent") {
    return {
      message: `Can only complete draft or sent invoices. Current status: ${invoice.status}`,
    };
  }

  // ============================================
  // USE TRANSACTION FOR DATA CONSISTENCY
  // ============================================
  // Strategy:
  // 1. Start transaction for checkout updates
  // 2. Update checkouts first (within transaction, not committed yet)
  // 3. Call invoice.complete() (commits immediately - model limitation)
  // 4. If invoice.complete() succeeds, commit checkout transaction
  // 5. If invoice.complete() fails, abort transaction (checkouts roll back)
  const mongoSession = await mongoose.startSession();
  mongoSession.startTransaction();

  try {
    const { ItemCheckout } = await import("@/app/models/checkouts");

    // ============================================
    // STEP 1: UPDATE CHECKOUTS FIRST (within transaction)
    // ============================================
    const checkoutIds = invoice.items
      .filter((item) => item.relatedCheckout?.checkoutId)
      .map((item) => item.relatedCheckout.checkoutId);

    const checkoutsToUpdate = [];

    if (checkoutIds.length > 0) {
      // Fetch all checkouts in one query
      const checkouts = await ItemCheckout.find({
        _id: { $in: checkoutIds },
        status: "checked_out",
      }).session(mongoSession);

      // Build lookup for quantity per checkout
      const itemByCheckoutId = new Map(
        invoice.items
          .filter((item) => item.relatedCheckout?.checkoutId)
          .map((item) => [item.relatedCheckout.checkoutId.toString(), item])
      );

      for (const checkout of checkouts) {
        const item = itemByCheckoutId.get(checkout._id.toString());
        checkout.status = "converted_to_sale";
        checkout.saleConversion = {
          converted: true,
          convertedAt: new Date(),
          convertedBy: { name: user.name, id: user.id },
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          quantitySold: item?.quantity || 0,
        };
        checkout.isOverdue = false;
        checkoutsToUpdate.push(checkout._id);
      }

      // Save all checkouts in parallel (within transaction)
      await Promise.all(checkouts.map((c) => c.save({ session: mongoSession })));
    }

    // ============================================
    // STEP 2: COMPLETE INVOICE
    // ============================================
    // Note: invoice.complete() doesn't use session (model limitation)
    // but if it fails, we abort the checkout transaction
    await invoice.complete({
      name: user.name,
      id: user.id,
    });

    // ============================================
    // STEP 2b: UPDATE PROJECT FINANCIALS (Revenue + COGS)
    // ============================================
    if (invoice.projectId) {
      // Only count COGS for direct-store items.
      // Tech stock items (from checkouts/requests) already had their
      // cost tracked when the stock request was fulfilled.
      const directStoreCOGS = invoice.items
        .filter(
          (item) =>
            item.itemType === "product" &&
            !item.relatedCheckout?.checkoutId &&
            !item.relatedRequest?.requestId,
        )
        .reduce((sum, item) => sum + (item.costing?.totalCost || 0), 0);

      const incUpdate = { "financials.totalRevenue": invoice.total };
      if (directStoreCOGS > 0) {
        incUpdate["financials.totalCosts"] = directStoreCOGS;
      }
      await Project.findByIdAndUpdate(
        invoice.projectId,
        { $inc: incUpdate },
        { session: mongoSession },
      );
    }

    // ============================================
    // STEP 3: COMMIT CHECKOUT TRANSACTION
    // ============================================
    // Invoice completed successfully, now commit checkout updates
    await mongoSession.commitTransaction();

  } catch (error) {
    // Abort checkout transaction - checkouts roll back to original state
    await mongoSession.abortTransaction();
    console.error("Complete invoice error:", error);
    return {
      message: error.message || "Failed to post invoice",
    };
  } finally {
    mongoSession.endSession();
  }

  // Revalidate and redirect on success
  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  revalidatePath("/dashboard/stocks");
  revalidatePath("/dashboard/movements");
  revalidatePath("/dashboard/accounts");
  revalidatePath("/dashboard/checkouts");
  if (invoice.projectId) {
    revalidatePath("/dashboard/projects");
    revalidatePath(`/dashboard/projects/${invoice.projectId}`);
  }
  redirect(`/dashboard/invoices/${invoiceId}`);
}

// ============================================
// EXPIRE STALE INVOICES (Release committed stock)
// ============================================
// Finds draft invoices with committed stock that have passed their expiry date
// Releases the committed inventory and marks them as expired
// Can be run as a cron job or triggered manually by admin
// ============================================
export async function expireStaleInvoices(companyIdFilter = null) {
  const authSession = await auth();
  const user = authSession?.user;

  // Get tenant context (optional for super admin batch processing)
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Determine which company to process
  const targetCompanyId = companyIdFilter || companyId;

  // Build query
  const query = {
    status: { $in: ["draft", "sent"] },
    draftExpiresAt: { $lt: new Date() },
    "items.stockCommitted": true, // Only invoices with committed stock
  };

  // Apply tenant scope unless super admin processing all
  if (targetCompanyId) {
    query.companyId = new ObjectId(targetCompanyId);
  } else if (!isSuperAdmin) {
    return {
      success: false,
      error: "Company context required",
    };
  }

  await dbConnect();

  try {
    // Find all stale invoices
    const staleInvoices = await Invoice.find(query);

    if (staleInvoices.length === 0) {
      return {
        success: true,
        message: "No stale invoices found",
        expired: 0,
      };
    }

    const userInfo = user
      ? { name: user.name, id: user.id }
      : { name: "System (Auto-Expiry)", id: "system" };

    const results = {
      expired: 0,
      failed: 0,
      errors: [],
    };

    // Process each stale invoice
    for (const invoice of staleInvoices) {
      try {
        await invoice.expire(userInfo);
        results.expired++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          invoiceNumber: invoice.invoiceNumber,
          error: error.message,
        });
      }
    }

    // Revalidate paths if any were processed
    if (results.expired > 0) {
      revalidatePath("/dashboard/invoices");
      revalidatePath("/dashboard/stocks");
    }

    return {
      success: true,
      message: `Expired ${results.expired} invoice(s), ${results.failed} failed`,
      ...results,
    };
  } catch (error) {
    console.error("Expire stale invoices error:", error);
    return {
      success: false,
      error: error.message || "Failed to expire stale invoices",
    };
  }
}

// ============================================
// GET EXPIRING INVOICES (for warnings)
// ============================================
// Returns invoices that will expire within the specified days
// Useful for showing warnings to users
// ============================================
export async function getExpiringInvoices(daysWarning = 3) {
  const { companyId, isSuperAdmin } = await getTenantContext();

  if (!companyId && !isSuperAdmin) {
    return { success: false, error: "Company context required" };
  }

  await dbConnect();

  const now = new Date();
  const warningDate = new Date(Date.now() + daysWarning * 24 * 60 * 60 * 1000);

  const query = {
    status: { $in: ["draft", "sent"] },
    draftExpiresAt: {
      $gt: now, // Not yet expired
      $lte: warningDate, // But will expire within warning period
    },
    "items.stockCommitted": true,
  };

  if (companyId) {
    query.companyId = new ObjectId(companyId);
  }

  try {
    const expiringInvoices = await Invoice.find(query)
      .select("invoiceNumber customer.name total draftExpiresAt createdAt")
      .sort({ draftExpiresAt: 1 })
      .lean();

    return {
      success: true,
      invoices: expiringInvoices.map((inv) => ({
        ...inv,
        _id: inv._id.toString(),
        daysUntilExpiry: Math.ceil(
          (new Date(inv.draftExpiresAt) - now) / (24 * 60 * 60 * 1000)
        ),
      })),
    };
  } catch (error) {
    console.error("Get expiring invoices error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// CONVERT CHECKOUT(S) TO INVOICE
// ============================================
// Used when demo/installation checkouts are converted to sale
// Allows accountant to add service charges (labor, mileage, etc.)
// ============================================
export async function convertCheckoutToInvoice(prevState, formData) {
  await dbConnect();
  const mongoSession = await mongoose.startSession();

  try {
    const authSession = await auth();
    const user = authSession?.user;

    if (!user) {
      return { success: false, error: "Unauthorized. Please log in." };
    }

    if (!hasRole(user, FINANCE_WRITE_ROLES)) {
      return {
        success: false,
        error: "Only Accountants and Admins can convert checkouts to invoices.",
      };
    }

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      return { success: false, error: "Company context required" };
    }

    // Parse form data
    const data = JSON.parse(formData.get("conversionData"));

    // Validate required fields
    if (!data.checkoutIds || data.checkoutIds.length === 0) {
      return { success: false, error: "At least one checkout is required" };
    }

    mongoSession.startTransaction();

    // Import ItemCheckout model
    const { ItemCheckout } = await import("@/app/models/checkouts");
    const { StockRequest } = await import("@/app/models/requests");

    // Fetch checkouts
    const checkouts = await ItemCheckout.find({
      _id: { $in: data.checkoutIds },
      status: "checked_out", // Only active checkouts can be converted
    }).session(mongoSession);

    if (checkouts.length === 0) {
      await mongoSession.abortTransaction();
      return { success: false, error: "No valid active checkouts found" };
    }

    // Validate all checkouts belong to same tenant
    for (const checkout of checkouts) {
      if (!validateTenantAccess(checkout, companyId, isSuperAdmin)) {
        await mongoSession.abortTransaction();
        return { success: false, error: "Access denied to one or more checkouts" };
      }
    }

    // Get parent request to fetch customer info
    const requestId = checkouts[0].relatedDocuments?.requestId;
    if (!requestId) {
      await mongoSession.abortTransaction();
      return { success: false, error: "Checkout has no linked request" };
    }

    const request = await StockRequest.findById(requestId).session(mongoSession);
    if (!request) {
      await mongoSession.abortTransaction();
      return { success: false, error: "Parent request not found" };
    }

    // Customer info from request
    const customer = {
      id: request.customer?.id || "",
      name: request.customer?.name || "Unknown",
      email: request.customer?.email || "",
      phone: request.customer?.phone || "",
      address: request.customer?.address || "",
      taxPin: request.customer?.taxPin || "",
    };

    // Build invoice items from checkouts (products). Batch-fetch all
    // product details in one query — the loop is O(N) field access.
    const checkoutProductIds = (checkouts || [])
      .map((c) => c.productId)
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id));
    const checkoutProducts =
      checkoutProductIds.length > 0
        ? await Product.find({ _id: { $in: checkoutProductIds } })
            .session(mongoSession)
            .lean()
        : [];
    const checkoutProductMap = new Map(
      checkoutProducts.map((p) => [p._id.toString(), p]),
    );

    const invoiceItems = [];

    for (const checkout of checkouts) {
      const product = checkout.productId
        ? checkoutProductMap.get(checkout.productId.toString())
        : null;
      const unitPrice = product?.pricing?.sellingPrice || 0;
      const unitCost = product?.costing?.costPrice || 0;
      const quantity = data.quantitiesToSell?.[checkout._id.toString()] || checkout.quantity;
      const amount = quantity * unitPrice;
      const totalCost = quantity * unitCost;
      const taxRate = 16; // Kenya VAT

      invoiceItems.push({
        itemType: "product",
        productId: checkout.productId,
        productSKU: checkout.productSnapshot?.SKU,
        productName: checkout.productSnapshot?.name,
        description: checkout.productSnapshot?.name,
        unit: product?.unit || "pcs",
        quantity,
        unitPrice,
        amount,
        costing: {
          unitCost,
          totalCost,
          grossProfit: amount - totalCost,
          marginPercentage: amount > 0 ? ((amount - totalCost) / amount) * 100 : 0,
        },
        taxRate,
        taxAmount: applyRate(amount, taxRate),
        relatedRequest: {
          requestId: request._id,
          requestNumber: request.requestNumber,
          technicianId: checkout.checkedOutTo?.id,
          technicianName: checkout.checkedOutTo?.name,
        },
        relatedCheckout: {
          checkoutId: checkout._id,
          checkoutNumber: checkout.checkoutNumber,
        },
      });
    }

    // Add service items (labor, mileage, accommodation, etc.)
    if (data.serviceItems && data.serviceItems.length > 0) {
      for (const service of data.serviceItems) {
        const amount = service.quantity * service.unitPrice;
        const taxRate = service.taxRate ?? 16;

        invoiceItems.push({
          itemType: "service",
          serviceCategory: service.category || "other",
          description: service.description,
          unit: service.unit || "hrs",
          quantity: service.quantity,
          unitPrice: service.unitPrice,
          amount,
          costing: {
            unitCost: 0,
            totalCost: 0,
            grossProfit: amount,
            marginPercentage: 100,
          },
          taxRate,
          taxAmount: applyRate(amount, taxRate),
        });
      }
    }

    // Calculate totals (round defensively at every aggregation)
    const subtotal = roundCurrency(
      invoiceItems.reduce((sum, item) => sum + item.amount, 0),
    );
    const totalTax = roundCurrency(
      invoiceItems.reduce((sum, item) => sum + item.taxAmount, 0),
    );
    const totalCOGS = roundCurrency(
      invoiceItems.reduce(
        (sum, item) => sum + (item.costing?.totalCost || 0),
        0,
      ),
    );
    const total = roundCurrency(subtotal + totalTax);

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber(companyId);

    // Create invoice
    const invoice = await Invoice.create(
      [
        {
          companyId,
          invoiceNumber,
          invoiceDate: new Date(),
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          customer,
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
            type: "checkout_conversion",
            requestId: request._id,
            requestNumber: request.requestNumber,
            checkoutIds: checkouts.map((c) => c._id),
          },
          notes: data.notes || `Converted from checkout(s): ${checkouts.map((c) => c.checkoutNumber).join(", ")}`,
          createdBy: {
            name: user.name,
            id: user.id,
          },
        },
      ],
      { session: mongoSession }
    );

    // Update checkouts to mark as converted
    for (const checkout of checkouts) {
      const quantitySold = data.quantitiesToSell?.[checkout._id.toString()] || checkout.quantity;
      const quantityReturned = checkout.quantity - quantitySold;

      checkout.status = "converted_to_sale";
      checkout.saleConversion = {
        converted: true,
        convertedAt: new Date(),
        convertedBy: {
          name: user.name,
          id: user.id,
        },
        invoiceId: invoice[0]._id,
        invoiceNumber: invoice[0].invoiceNumber,
        quantitySold,
        quantityReturned,
      };

      await checkout.save({ session: mongoSession });
    }

    await mongoSession.commitTransaction();

    revalidatePath("/dashboard/invoices");
    revalidatePath("/dashboard/checkouts");
    revalidatePath("/dashboard/requests");

    return {
      success: true,
      message: `Invoice ${invoice[0].invoiceNumber} created from ${checkouts.length} checkout(s)`,
      invoiceId: invoice[0]._id.toString(),
      invoiceNumber: invoice[0].invoiceNumber,
    };
  } catch (error) {
    await mongoSession.abortTransaction();
    console.error("Convert checkout to invoice error:", error);
    return {
      success: false,
      error: error.message || "Failed to convert checkout to invoice",
    };
  } finally {
    mongoSession.endSession();
  }
}
