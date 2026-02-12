"use server";

import { auth } from "@/auth";
import Invoice from "../models/invoice";
import Product from "../models/product";
import { StockMovement } from "../models/stockmovement";
import Account from "../models/account";
import Party from "../models/parties";
import TaxTransaction from "../models/taxTransactions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { generateInvoiceNumber } from "./queries/invoice-queries";
import { generateMovementNumber } from "./queries/movement-queries";
import mongoose from "mongoose";
import {
  getTenantContext,
  validateTenantAccess,
} from "@/lib/utils/tenant-utils";

const ObjectId = mongoose.Types.ObjectId;

// ============================================
// UPDATE INVOICE ACTION
// ============================================
export async function updateInvoice(invoiceId, prevState, formData) {
  const session = await auth();

  if (!session?.user) {
    return {
      success: false,
      error: "Unauthorized. Please log in.",
    };
  }

  const { user } = session;

  // Check permissions
  if (user.role !== "Admin" && user.role !== "Accountant") {
    return {
      success: false,
      error: "Only Admins and Accountants can update invoices.",
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

      // ============================================
      // STEP 1: BUILD A MAP OF OLD ITEMS
      // ============================================
      const oldStockItemsMap = new Map();
      existingInvoice.items
        .filter((item) => item.type === "stock" && item.stockDeducted)
        .forEach((item) => {
          oldStockItemsMap.set(item.productId.toString(), {
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            SKU: item.SKU,
            name: item.name,
          });
        });

      // ============================================
      // STEP 2: BUILD A MAP OF NEW ITEMS
      // ============================================
      const newStockItemsMap = new Map();
      const technicianStockItems = []; // Items from technician checkouts (separate handling)

      if (invoiceData.stockItems && invoiceData.stockItems.length > 0) {
        invoiceData.stockItems.forEach((item) => {
          // Check if this is from technician stock
          const isFromTechnicianStock = item.stockSource === "technician" && item.relatedCheckout?.checkoutId;

          if (isFromTechnicianStock) {
            // Technician stock items don't affect main inventory
            technicianStockItems.push({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              SKU: item.SKU,
              name: item.name,
              description: item.description || "",
              unit: item.unit,
              total: item.total,
              relatedCheckout: item.relatedCheckout,
            });
          } else {
            // Store inventory items - track for stock adjustments
            newStockItemsMap.set(item.productId, {
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              SKU: item.SKU,
              name: item.name,
              description: item.description || "",
              unit: item.unit,
              total: item.total,
            });
          }
        });
      }

      // ============================================
      // STEP 3: PROCESS STOCK ADJUSTMENTS
      // ============================================
      const newLineItems = [];
      const newMovementIds = [];

      // Track all products that need adjustment
      const allProductIds = new Set([
        ...oldStockItemsMap.keys(),
        ...newStockItemsMap.keys(),
      ]);

      for (const productId of allProductIds) {
        const oldItem = oldStockItemsMap.get(productId);
        const newItem = newStockItemsMap.get(productId);

        const oldQuantity = oldItem ? oldItem.quantity : 0;
        const newQuantity = newItem ? newItem.quantity : 0;
        const difference = newQuantity - oldQuantity;

        // If no change in quantity, skip
        if (difference === 0 && newItem) {
          // Just add to line items, no stock movement needed
          // Get taxRate from submitted data
          const itemTaxRate = invoiceData.stockItems?.find(
            (si) => si.productId === productId
          )?.taxRate ?? 16;
          const itemTaxAmount = (newItem.total * itemTaxRate) / 100;

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
            stockDeducted: true,
          });
          continue;
        }

        // Fetch product
        const product = await Product.findById(productId).session(mongoSession);

        if (!product) {
          throw new Error(`Product not found: ${productId}`);
        }

        const previousStock = product.inventory?.quantityOnHand ?? product.stock ?? 0;

        // Helper to update inventory consistently (both legacy and new fields)
        const updateProductInventory = async (qty, direction) => {
          const currentOnHand = product.inventory?.quantityOnHand ?? product.stock ?? 0;
          const newOnHand = direction === "in"
            ? currentOnHand + qty
            : currentOnHand - qty;

          // Update both fields for consistency
          product.stock = newOnHand;
          if (!product.inventory) product.inventory = {};
          product.inventory.quantityOnHand = newOnHand;
          product.inventory.quantityAvailable = newOnHand - (product.inventory.quantityCommitted || 0);

          await product.save({ session: mongoSession });
        };

        // Case 1: Item removed from invoice (old exists, new doesn't)
        if (oldItem && !newItem) {
          // Restore full quantity
          await updateProductInventory(oldQuantity, "in");

          const stockMovementNo = await generateMovementNumber(mongoSession);
          await StockMovement.create(
            [
              {
                companyId: existingInvoice.companyId,
                productId: product._id,
                movementNumber: stockMovementNo,
                productSnapshot: {
                  name: product.name,
                  SKU: product.SKU,
                  category: product.category,
                  unit: product.unit,
                },
                movementType: "adjustment",
                direction: "in",
                quantity: oldQuantity,
                previousStock,
                newStock: product.inventory?.quantityOnHand ?? product.stock,
                costing: {
                  unitCost: product.costing?.costPrice || 0,
                  totalCost: oldQuantity * (product.costing?.costPrice || 0),
                  unitPrice: oldItem.unitPrice,
                  totalValue: oldItem.unitPrice * oldQuantity,
                },
                reason: `Item removed - Invoice ${existingInvoice.invoiceNumber} edited`,
                performedBy: {
                  id: user.id,
                  name: user.name,
                  role: user.role,
                },
                relatedDocuments: {
                  invoiceId: existingInvoice._id,
                },
                notes: `Stock restored - item removed from invoice`,
              },
            ],
            { session: mongoSession },
          );
          // Don't add to newLineItems (item removed)
          continue;
        }

        // Case 2: New item added (new exists, old doesn't)
        if (!oldItem && newItem) {
          // Check stock availability
          const available = product.inventory?.quantityAvailable ?? product.stock ?? 0;
          if (available < newQuantity) {
            throw new Error(
              `Insufficient stock for ${product.name}. Available: ${available}, Requested: ${newQuantity}`,
            );
          }

          // Deduct full quantity
          await updateProductInventory(newQuantity, "out");

          const stockMovementNo = await generateMovementNumber(mongoSession);
          const movement = await StockMovement.create(
            [
              {
                companyId: existingInvoice.companyId,
                productId: product._id,
                movementNumber: stockMovementNo,
                productSnapshot: {
                  name: product.name,
                  SKU: product.SKU,
                  category: product.category,
                  unit: product.unit,
                },
                movementType: "sale",
                direction: "out",
                quantity: newQuantity,
                previousStock,
                newStock: product.inventory?.quantityOnHand ?? product.stock,
                costing: {
                  unitCost: product.costing?.costPrice || 0,
                  totalCost: newQuantity * (product.costing?.costPrice || 0),
                  unitPrice: newItem.unitPrice,
                  totalValue: newItem.total,
                },
                reason: `New item - Invoice ${existingInvoice.invoiceNumber} updated`,
                performedBy: {
                  id: user.id,
                  name: user.name,
                  role: user.role,
                },
                relatedDocuments: {
                  invoiceId: existingInvoice._id,
                },
                notes: `Stock deducted - new item added to invoice`,
              },
            ],
            { session: mongoSession },
          );

          newMovementIds.push(movement[0]._id);

          // Get taxRate from submitted data
          const itemTaxRate = invoiceData.stockItems?.find(
            (si) => si.productId === productId
          )?.taxRate ?? 16;
          const itemTaxAmount = (newItem.total * itemTaxRate) / 100;

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
            stockDeducted: true,
          });
          continue;
        }

        // Case 3: Quantity changed (both exist, difference != 0)
        if (oldItem && newItem && difference !== 0) {
          if (difference > 0) {
            // Increased quantity - need to deduct MORE stock
            // Check if enough stock available
            const available = product.inventory?.quantityAvailable ?? product.stock ?? 0;
            if (available < difference) {
              throw new Error(
                `Insufficient stock for ${product.name}. Available: ${available}, Additional needed: ${difference}`,
              );
            }

            await updateProductInventory(difference, "out");

            const stockMovementNo = await generateMovementNumber(mongoSession);
            const movement = await StockMovement.create(
              [
                {
                  companyId: existingInvoice.companyId,
                  productId: product._id,
                  movementNumber: stockMovementNo,
                  productSnapshot: {
                    name: product.name,
                    SKU: product.SKU,
                    category: product.category,
                    unit: product.unit,
                  },
                  movementType: "sale",
                  direction: "out",
                  quantity: difference,
                  previousStock,
                  newStock: product.inventory?.quantityOnHand ?? product.stock,
                  costing: {
                    unitCost: product.costing?.costPrice || 0,
                    totalCost: difference * (product.costing?.costPrice || 0),
                    unitPrice: newItem.unitPrice,
                    totalValue: newItem.unitPrice * difference,
                  },
                  reason: `Quantity increased - Invoice ${existingInvoice.invoiceNumber} updated`,
                  performedBy: {
                    id: user.id,
                    name: user.name,
                    role: user.role,
                  },
                  relatedDocuments: {
                    invoiceId: existingInvoice._id,
                  },
                  notes: `Quantity increased from ${oldQuantity} to ${newQuantity} (difference: ${difference})`,
                },
              ],
              { session: mongoSession },
            );

            newMovementIds.push(movement[0]._id);
          } else {
            // Decreased quantity - need to RESTORE stock (difference is negative)
            const restoreQuantity = Math.abs(difference);
            await updateProductInventory(restoreQuantity, "in");

            const stockMovementNo = await generateMovementNumber(mongoSession);
            await StockMovement.create(
              [
                {
                  companyId: existingInvoice.companyId,
                  productId: product._id,
                  movementNumber: stockMovementNo,
                  productSnapshot: {
                    name: product.name,
                    SKU: product.SKU,
                    category: product.category,
                    unit: product.unit,
                  },
                  movementType: "adjustment",
                  direction: "in",
                  quantity: restoreQuantity,
                  previousStock,
                  newStock: product.inventory?.quantityOnHand ?? product.stock,
                  costing: {
                    unitCost: product.costing?.costPrice || 0,
                    totalCost: restoreQuantity * (product.costing?.costPrice || 0),
                    unitPrice: oldItem.unitPrice,
                    totalValue: oldItem.unitPrice * restoreQuantity,
                  },
                  reason: `Quantity decreased - Invoice ${existingInvoice.invoiceNumber} updated`,
                  performedBy: {
                    id: user.id,
                    name: user.name,
                    role: user.role,
                  },
                  relatedDocuments: {
                    invoiceId: existingInvoice._id,
                  },
                  notes: `Quantity decreased from ${oldQuantity} to ${newQuantity} (difference: ${restoreQuantity} restored)`,
                },
              ],
              { session: mongoSession },
            );
          }

          // Add to line items with new quantity
          // Get taxRate from submitted data
          const itemTaxRateChanged = invoiceData.stockItems?.find(
            (si) => si.productId === productId
          )?.taxRate ?? 16;
          const itemTaxAmountChanged = (newItem.total * itemTaxRateChanged) / 100;

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
            taxRate: itemTaxRateChanged,
            taxAmount: itemTaxAmountChanged,
            stockDeducted: true,
          });
        }
      }

      // ============================================
      // STEP 3.5: ADD TECHNICIAN STOCK ITEMS
      // ============================================
      // Technician stock items don't affect main inventory - they were already
      // checked out from inventory during the fulfillment process
      for (const item of technicianStockItems) {
        // Get taxRate from submitted stockItems
        const techItemTaxRate = invoiceData.stockItems?.find(
          (si) => si.productId === item.productId && si.stockSource === "technician"
        )?.taxRate ?? 16;
        const techItemTaxAmount = (item.total * techItemTaxRate) / 100;

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
          stockDeducted: false, // No deduction needed - already checked out
          relatedCheckout: {
            checkoutId: item.relatedCheckout.checkoutId,
            checkoutNumber: item.relatedCheckout.checkoutNumber,
          },
          // relatedRequest for COGS routing to Technician Stock account
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
          // Use per-item taxRate from submitted data
          const serviceTaxRate = item.taxRate ?? 16;
          const serviceTaxAmount = (item.total * serviceTaxRate) / 100;

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
            stockDeducted: false,
          });
        }
      }

      // ============================================
      // STEP 5: CALCULATE TOTALS (using per-item tax rates)
      // ============================================
      const subtotal = newLineItems.reduce((sum, item) => sum + (item.amount || 0), 0);
      const discountPercentage = invoiceData.discountPercentage || 0;
      const discountAmount = (subtotal * discountPercentage) / 100;
      const subtotalAfterDiscount = subtotal - discountAmount;

      // Calculate tax from per-item taxAmounts (adjusted for discount)
      // Discount factor to proportionally reduce tax when discount is applied
      const discountFactor = subtotal > 0 ? subtotalAfterDiscount / subtotal : 1;
      const taxAmount = newLineItems.reduce((sum, item) => {
        // Apply discount factor to each item's tax contribution
        return sum + ((item.taxAmount || 0) * discountFactor);
      }, 0);

      const total = subtotalAfterDiscount + taxAmount;

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
      existingInvoice.discountPercentage = discountPercentage; // For validation
      existingInvoice.totalDiscount = discountAmount; // Calculated discount amount
      existingInvoice.taxAmount = taxAmount;
      existingInvoice.total = total;
      existingInvoice.notes = invoiceData.notes || "";
      // Initialize relatedDocuments if it doesn't exist
      if (!existingInvoice.relatedDocuments) {
        existingInvoice.relatedDocuments = {};
      }
      existingInvoice.relatedDocuments.movementIds = newMovementIds;

      // Update payment status if amount changed
      // Recalculate amountDue based on new total
      existingInvoice.amountDue = total - existingInvoice.amountPaid;

      if (existingInvoice.amountPaid > 0) {
        if (existingInvoice.amountDue <= 0.01) {
          existingInvoice.paymentStatus = "paid";
          // Note: status stays "completed" - we use paymentStatus to track payment state
        } else {
          existingInvoice.paymentStatus = "partial";
        }
      }

      await existingInvoice.save({ session: mongoSession });

      // Commit transaction
      await mongoSession.commitTransaction();

      // Revalidate paths
      revalidatePath("/dashboard/invoices");
      revalidatePath(`/dashboard/invoices/${invoiceId}`);
      revalidatePath(`/dashboard/invoices/${invoiceId}/edit`);
      revalidatePath("/dashboard/stocks");
      revalidatePath("/dashboard/movements");

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
    if (user.role !== "Admin" && user.role !== "Accountant") {
      return {
        message: "Access denied. Only Admin or Accountant can create invoices.",
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

    // Generate invoice number (with company code prefix)
    const invoiceNumber = await generateInvoiceNumber(companyId);

    // Prepare invoice items in new Invoice model format
    const items = [];

    // Process stock items (products)
    for (const item of data.stockItems) {
      const product = await Product.findById(item.productId);

      if (!product) {
        return {
          message: `Product ${item.name} not found`,
          success: false,
        };
      }

      // Check stock availability ONLY for store inventory items
      // Technician stock items were already checked out from inventory
      const isFromTechnicianStock = item.stockSource === "technician" && item.relatedCheckout?.checkoutId;

      if (!isFromTechnicianStock) {
        const available = product.inventory?.quantityAvailable ?? product.stock ?? 0;
        if (available < item.quantity) {
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
        taxAmount: (item.total * itemTaxRate) / 100,
        discountPercentage: 0,
        discountAmount: 0,
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
        taxAmount: (item.total * itemTaxRate) / 100,
        discountPercentage: 0,
        discountAmount: 0,
      });
    }

    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const totalDiscount = (subtotal * (data.discountPercentage || 0)) / 100;

    // Item taxAmount is stored as pre-discount (for model validation and audit clarity)
    // Invoice-level taxAmount applies discount proportionally
    const discountFactor = subtotal > 0 ? (subtotal - totalDiscount) / subtotal : 1;
    const taxAmount = items.reduce((sum, item) => {
      // Apply discount factor to each item's tax contribution
      return sum + item.taxAmount * discountFactor;
    }, 0);

    const total = subtotal - totalDiscount + taxAmount;

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

    // Create invoice using new Invoice model
    const invoice = await Invoice.create({
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
      notes: data.notes || "",
      createdBy: {
        name: user.name,
        id: user.id,
      },
      status: "draft",
      companyId: new ObjectId(companyId), // Tenant isolation
    });

    // Note: Invoice stays as draft - user must explicitly post/complete it
    // This follows standard ERP practice where drafts can be reviewed before posting

    revalidatePath("/dashboard/invoices");

    return {
      message: `Invoice ${invoiceNumber} created as draft. Post it to finalize.`,
      success: true,
      invoiceId: invoice._id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      status: "draft",
    };
  } catch (error) {
    console.error("Create invoice error:", error);
    return {
      message: error.message || "Database error: failed to create invoice",
      success: false,
    };
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
  const mongoSession = await mongoose.startSession();

  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Please sign in to continue" };
    }

    const user = session.user;

    // Role check
    if (!["Admin", "Accountant", "Manager"].includes(user.role)) {
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

    const dbConnect = (await import("@/app/config/dbConnect")).default;
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

  if (!user || user.role !== "Admin") {
    return {
      message: "Unauthorized - Admin only",
    };
  }

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  if (!companyId && !isSuperAdmin) {
    return { message: "Company context required" };
  }

  const dbConnect = (await import("@/app/config/dbConnect")).default;
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

  if (user.role !== "Admin" && user.role !== "Accountant") {
    return {
      message: "Access denied - Admin or Accountant only",
    };
  }

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  if (!companyId && !isSuperAdmin) {
    return { message: "Company context required" };
  }

  const dbConnect = (await import("@/app/config/dbConnect")).default;
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
    // This ensures checkouts are validated and updated atomically
    // If this fails, we haven't touched the invoice yet
    const checkoutsToUpdate = [];

    for (const item of invoice.items) {
      if (item.relatedCheckout?.checkoutId) {
        const checkout = await ItemCheckout.findById(item.relatedCheckout.checkoutId).session(mongoSession);

        if (checkout && checkout.status === "checked_out") {
          checkout.status = "converted_to_sale";
          checkout.saleConversion = {
            converted: true,
            convertedAt: new Date(),
            convertedBy: {
              name: user.name,
              id: user.id,
            },
            invoiceId: invoice._id,
            invoiceNumber: invoice.invoiceNumber,
            quantitySold: item.quantity,
          };
          // Clear overdue flag since item is now sold (expectedReturnDate kept for history)
          checkout.isOverdue = false;

          await checkout.save({ session: mongoSession });
          checkoutsToUpdate.push(checkout._id);
        }
      }
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
  redirect(`/dashboard/invoices/${invoiceId}`);
}

// ============================================
// CONVERT CHECKOUT(S) TO INVOICE
// ============================================
// Used when demo/installation checkouts are converted to sale
// Allows accountant to add service charges (labor, mileage, etc.)
// ============================================
export async function convertCheckoutToInvoice(prevState, formData) {
  const mongoSession = await mongoose.startSession();

  try {
    const authSession = await auth();
    const user = authSession?.user;

    if (!user) {
      return { success: false, error: "Unauthorized. Please log in." };
    }

    // Only Accountant or Admin can convert checkouts to invoices
    if (user.role !== "Admin" && user.role !== "Accountant") {
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

    // Build invoice items from checkouts (products)
    const invoiceItems = [];

    for (const checkout of checkouts) {
      const product = await Product.findById(checkout.productId).session(mongoSession);
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
        taxAmount: (amount * taxRate) / 100,
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
          taxAmount: (amount * taxRate) / 100,
        });
      }
    }

    // Calculate totals
    const subtotal = invoiceItems.reduce((sum, item) => sum + item.amount, 0);
    const totalTax = invoiceItems.reduce((sum, item) => sum + item.taxAmount, 0);
    const totalCOGS = invoiceItems.reduce((sum, item) => sum + (item.costing?.totalCost || 0), 0);
    const total = subtotal + totalTax;

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
