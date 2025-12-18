"use server";

import { auth } from "@/auth";
import Invoice from "../models/invoice";
import Product from "../models/product";
import { StockMovement } from "../models/stockmovement";
import Account from "../models/account";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { generateInvoiceNumber } from "./queries/invoice-queries";
import { generateMovementNumber } from "./queries/movement-queries";
import mongoose from "mongoose";

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
      const existingInvoice = await Invoice.findById(invoiceId).session(
        mongoSession
      );

      if (!existingInvoice) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: "Invoice not found.",
        };
      }

      // Check if invoice can be edited
      if (existingInvoice.status === "paid") {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: "Cannot edit paid invoices.",
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
      if (invoiceData.stockItems && invoiceData.stockItems.length > 0) {
        invoiceData.stockItems.forEach((item) => {
          newStockItemsMap.set(item.productId, {
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            SKU: item.SKU,
            name: item.name,
            description: item.description || "",
            unit: item.unit,
            total: item.total,
          });
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
          newLineItems.push({
            type: "stock",
            productId: productId,
            SKU: newItem.SKU,
            name: newItem.name,
            description: newItem.description,
            unit: newItem.unit,
            quantity: newItem.quantity,
            unitPrice: newItem.unitPrice,
            total: newItem.total,
            stockDeducted: true,
          });
          continue;
        }

        // Fetch product
        const product = await Product.findById(productId).session(mongoSession);

        if (!product) {
          throw new Error(`Product not found: ${productId}`);
        }

        const previousStock = product.stock;

        // Case 1: Item removed from invoice (old exists, new doesn't)
        if (oldItem && !newItem) {
          // Restore full quantity
          product.stock += oldQuantity;
          await product.save({ session: mongoSession });

          const stockMovementNo = await generateMovementNumber(mongoSession);
          await StockMovement.create(
            [
              {
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
                previousStock: previousStock,
                newStock: product.stock,
                unitPrice: oldItem.unitPrice,
                totalValue: oldItem.unitPrice * oldQuantity,
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
            { session: mongoSession }
          );
          // Don't add to newLineItems (item removed)
          continue;
        }

        // Case 2: New item added (new exists, old doesn't)
        if (!oldItem && newItem) {
          // Check stock availability
          if (product.stock < newQuantity) {
            throw new Error(
              `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${newQuantity}`
            );
          }

          // Deduct full quantity
          product.stock -= newQuantity;
          await product.save({ session: mongoSession });

          const stockMovementNo = await generateMovementNumber(mongoSession);
          const movement = await StockMovement.create(
            [
              {
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
                previousStock: previousStock,
                newStock: product.stock,
                unitPrice: newItem.unitPrice,
                totalValue: newItem.total,
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
            { session: mongoSession }
          );

          newMovementIds.push(movement[0]._id);

          newLineItems.push({
            type: "stock",
            productId: product._id,
            SKU: newItem.SKU,
            name: newItem.name,
            description: newItem.description,
            unit: newItem.unit,
            quantity: newItem.quantity,
            unitPrice: newItem.unitPrice,
            total: newItem.total,
            stockDeducted: true,
          });
          continue;
        }

        // Case 3: Quantity changed (both exist, difference != 0)
        if (oldItem && newItem && difference !== 0) {
          if (difference > 0) {
            // Increased quantity - need to deduct MORE stock
            // Check if enough stock available
            if (product.stock < difference) {
              throw new Error(
                `Insufficient stock for ${product.name}. Available: ${product.stock}, Additional needed: ${difference}`
              );
            }

            product.stock -= difference;
            await product.save({ session: mongoSession });

            const stockMovementNo = await generateMovementNumber(mongoSession);
            const movement = await StockMovement.create(
              [
                {
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
                  previousStock: previousStock,
                  newStock: product.stock,
                  unitPrice: newItem.unitPrice,
                  totalValue: newItem.unitPrice * difference,
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
              { session: mongoSession }
            );

            newMovementIds.push(movement[0]._id);
          } else {
            // Decreased quantity - need to RESTORE stock (difference is negative)
            const restoreQuantity = Math.abs(difference);
            product.stock += restoreQuantity;
            await product.save({ session: mongoSession });

            const stockMovementNo = await generateMovementNumber(mongoSession);
            await StockMovement.create(
              [
                {
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
                  previousStock: previousStock,
                  newStock: product.stock,
                  unitPrice: oldItem.unitPrice,
                  totalValue: oldItem.unitPrice * restoreQuantity,
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
              { session: mongoSession }
            );
          }

          // Add to line items with new quantity
          newLineItems.push({
            type: "stock",
            productId: product._id,
            SKU: newItem.SKU,
            name: newItem.name,
            description: newItem.description,
            unit: newItem.unit,
            quantity: newItem.quantity,
            unitPrice: newItem.unitPrice,
            total: newItem.total,
            stockDeducted: true,
          });
        }
      }

      // ============================================
      // STEP 4: PROCESS SERVICE ITEMS
      // ============================================
      if (invoiceData.serviceItems && invoiceData.serviceItems.length > 0) {
        for (const item of invoiceData.serviceItems) {
          newLineItems.push({
            type: "service",
            name: item.name,
            description: item.description || "",
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            stockDeducted: false,
          });
        }
      }

      // ============================================
      // STEP 5: CALCULATE TOTALS
      // ============================================
      const subtotal = newLineItems.reduce((sum, item) => sum + item.total, 0);
      const discountAmount =
        (subtotal * (invoiceData.discountPercentage || 0)) / 100;
      const subtotalAfterDiscount = subtotal - discountAmount;
      const taxAmount =
        (subtotalAfterDiscount * (invoiceData.vatPercentage || 0)) / 100;
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
      existingInvoice.discountPercentage = invoiceData.discountPercentage || 0;
      existingInvoice.discountAmount = discountAmount;
      existingInvoice.taxRate = invoiceData.vatPercentage || 0;
      existingInvoice.taxAmount = taxAmount;
      existingInvoice.total = total;
      existingInvoice.notes = invoiceData.notes || "";
      existingInvoice.relatedDocuments.movementIds = newMovementIds;

      // Update payment status if amount changed
      if (existingInvoice.amountPaid > 0) {
        if (existingInvoice.amountPaid >= total) {
          existingInvoice.paymentStatus = "paid";
          existingInvoice.status = "paid";
        } else if (existingInvoice.amountPaid > 0) {
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
// CREATE INVOICE
// ============================================
export async function createInvoice(prevState, formData) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const authSession = await auth();
    const user = authSession?.user;

    if (!user) {
      await session.abortTransaction();
      return {
        message: "Unauthorized",
        success: false,
      };
    }

    // Check if user has permission
    if (user.role !== "Admin" && user.role !== "Accountant") {
      await session.abortTransaction();
      return {
        message: "Access denied. Only Admin or Accountant can create invoices.",
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
      await session.abortTransaction();
      return {
        message: "Customer and at least one item are required",
        success: false,
      };
    }

    // Get customer
    const customer = await Account.findById(data.customerId).session(session);
    if (!customer) {
      await session.abortTransaction();
      return {
        message: "Customer not found",
        success: false,
      };
    }

    // Prepare line items
    const lineItems = [];
    const movementIds = [];

    // Process stock items
    for (const item of data.stockItems) {
      // Check stock availability
      const product = await Product.findById(item.productId).session(session);

      if (!product) {
        await session.abortTransaction();
        return {
          message: `Product ${item.name} not found`,
          success: false,
        };
      }

      if (product.stock < item.quantity) {
        await session.abortTransaction();
        return {
          message: `Insufficient stock for ${product.name}. Available: ${product.stock}, Required: ${item.quantity}`,
          success: false,
        };
      }

      // Deduct stock
      await Product.findByIdAndUpdate(
        item.productId,
        {
          $inc: { stock: -item.quantity },
        },
        { session }
      );

      // Create stock movement
      const movementNumber = await generateMovementNumber(session);
      const movement = await StockMovement.create(
        [
          {
            movementNumber,
            productId: item.productId,
            productSnapshot: {
              name: product.name,
              SKU: product.SKU,
              category: product.category,
              unit: product.unit,
            },
            movementType: "sale",
            direction: "out",
            quantity: item.quantity,
            previousStock: product.stock,
            newStock: product.stock - item.quantity,
            unitPrice: item.sellingPrice,
            totalValue: item.total,
            performedBy: {
              name: user.name,
              id: user.id,
              role: user.role,
            },
            notes: `Sale via invoice - Customer: ${customer.name}`,
            reason: "Direct sale",
          },
        ],
        { session }
      );

      movementIds.push(movement[0]._id);

      // Add to line items
      lineItems.push({
        type: "stock",
        productId: item.productId,
        SKU: product.SKU,
        name: item.name,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.sellingPrice,
        total: item.total,
        stockDeducted: true,
      });
    }

    // Process service items
    for (const item of data.serviceItems) {
      lineItems.push({
        type: "service",
        name: item.name,
        description: item.description || "",
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
        stockDeducted: false,
      });
    }

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber(session);

    // Calculate totals
    const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
    const discountAmount = (subtotal * data.discountPercentage) / 100;
    const subtotalAfterDiscount = subtotal - discountAmount;
    const taxAmount = (subtotalAfterDiscount * data.vatPercentage) / 100;
    const total = subtotalAfterDiscount + taxAmount;

    // Create invoice
    const invoice = await Invoice.create(
      [
        {
          invoiceNumber,
          customer: {
            id: customer._id.toString(),
            name: customer.name,
            email: customer.email || "",
            phone: customer.phoneNumber || "",
            address: customer.address,
          },
          invoiceDate: new Date(data.invoiceDate),
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          items: lineItems,
          currency: "KES",
          subtotal,
          discountPercentage: data.discountPercentage,
          discountAmount,
          taxRate: data.vatPercentage,
          taxAmount,
          total,
          paymentStatus: "unpaid",
          notes: data.notes || "",
          createdBy: {
            name: user.name,
            id: user.id,
            role: user.role,
          },
          relatedDocuments: {
            movementIds,
          },
          status: "draft",
        },
      ],
      { session }
    );

    await session.commitTransaction();

    revalidatePath("/dashboard/invoices");

    return {
      message: "Invoice created successfully",
      success: true,
      invoiceId: invoice[0]._id.toString(),
      invoiceNumber: invoice[0].invoiceNumber,
    };
  } catch (error) {
    await session.abortTransaction();
    console.error("Create invoice error:", error);
    return {
      message: "Database error: failed to create invoice",
      success: false,
    };
  } finally {
    session.endSession();
  }
}

// ============================================
// UPDATE INVOICE PAYMENT STATUS
// ============================================
export async function updateInvoicePayment(invoiceId, prevState, formData) {
  try {
    const authSession = await auth();
    const user = authSession?.user;

    if (!user) {
      return {
        message: "Unauthorized",
        success: false,
      };
    }

    if (user.role !== "Admin" && user.role !== "Accountant") {
      return {
        message: "Access denied",
        success: false,
      };
    }

    const amount = Number(formData.get("amount"));
    const paymentMethod = formData.get("paymentMethod");
    const reference = formData.get("reference");

    const invoice = await Invoice.findById(invoiceId);

    if (!invoice) {
      return {
        message: "Invoice not found",
        success: false,
      };
    }

    await invoice.recordPayment(amount, paymentMethod, reference);

    revalidatePath("/dashboard/invoices");
    revalidatePath(`/dashboard/invoices/${invoiceId}`);

    return {
      message: "Payment recorded successfully",
      success: true,
    };
  } catch (error) {
    console.error("Update payment error:", error);
    return {
      message: "Database error: failed to record payment",
      success: false,
    };
  }
}

// ============================================
// CANCEL INVOICE
// ============================================
export async function cancelInvoice(invoiceId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const authSession = await auth();
    const user = authSession?.user;

    if (!user || user.role !== "Admin") {
      await session.abortTransaction();
      return {
        message: "Unauthorized - Admin only",
        success: false,
      };
    }

    const invoice = await Invoice.findById(invoiceId).session(session);

    if (!invoice) {
      await session.abortTransaction();
      return {
        message: "Invoice not found",
        success: false,
      };
    }

    if (invoice.status === "paid") {
      await session.abortTransaction();
      return {
        message: "Cannot cancel paid invoice",
        success: false,
      };
    }

    // Restore stock for cancelled invoice
    for (const item of invoice.items) {
      if (item.type === "stock" && item.stockDeducted) {
        await Product.findByIdAndUpdate(
          item.productId,
          {
            $inc: { stock: item.quantity },
          },
          { session }
        );

        // Create reversal movement
        const product = await Product.findById(item.productId).session(session);
        const movementNumber = await generateMovementNumber(session);

        await StockMovement.create(
          [
            {
              movementNumber,
              productId: item.productId,
              productSnapshot: {
                name: product.name,
                SKU: product.SKU,
                category: product.category,
                unit: product.unit,
              },
              movementType: "adjustment",
              direction: "in",
              quantity: item.quantity,
              previousStock: product.stock - item.quantity,
              newStock: product.stock,
              unitPrice: item.unitPrice,
              totalValue: item.total,
              performedBy: {
                name: user.name,
                id: user.id,
                role: user.role,
              },
              notes: `Invoice cancelled - ${invoice.invoiceNumber}`,
              reason: "Invoice cancellation - stock restored",
            },
          ],
          { session }
        );
      }
    }

    // Mark invoice as cancelled
    invoice.status = "cancelled";
    await invoice.save({ session });

    await session.commitTransaction();

    revalidatePath("/dashboard/invoices");
    revalidatePath(`/dashboard/invoices/${invoiceId}`);

    return {
      message: "Invoice cancelled and stock restored",
      success: true,
    };
  } catch (error) {
    await session.abortTransaction();
    console.error("Cancel invoice error:", error);
    return {
      message: "Database error: failed to cancel invoice",
      success: false,
    };
  } finally {
    session.endSession();
  }
}
