"use server";

import { auth } from "@/auth";
import Invoice from "../models/invoice";
import Product from "../models/product";
import { StockMovement } from "../models/stockmovement";
import Account from "../models/account";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { generateInvoiceNumber } from "./invoice-queries";
import { generateMovementNumber } from "./movement-queries";
import mongoose from "mongoose";

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
