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

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber();

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

      if (product.stock < item.quantity) {
        return {
          message: `Insufficient stock for ${product.name}. Available: ${product.stock}, Required: ${item.quantity}`,
          success: false,
        };
      }

      items.push({
        itemType: "product",
        productId: product._id,
        productSKU: product.SKU,
        productName: product.name,
        description: product.description || product.name,
        unit: product.unit,
        quantity: item.quantity,
        unitPrice: item.sellingPrice,
        amount: item.total,
        taxRate: data.vatPercentage || 16,
        taxAmount: (item.total * (data.vatPercentage || 16)) / 100,
        discountPercentage: 0,
        discountAmount: 0,
      });
    }

    // Process service items
    for (const item of data.serviceItems) {
      items.push({
        itemType: "service",
        description: item.name,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.total,
        taxRate: data.vatPercentage || 16,
        taxAmount: (item.total * (data.vatPercentage || 16)) / 100,
        discountPercentage: 0,
        discountAmount: 0,
      });
    }

    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const totalDiscount = (subtotal * (data.discountPercentage || 0)) / 100;
    const taxAmount = items.reduce((sum, item) => sum + item.taxAmount, 0);
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
                .replace(/(\w+):/g, '"$1":')  // Quote keys
                .replace(/'/g, '"');           // Replace single quotes
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
      dueDate: data.dueDate ? new Date(data.dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Default 30 days
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
      totalDiscount,
      taxAmount,
      total,
      currency: "KES",
      paymentStatus: "unpaid",
      notes: data.notes || "",
      createdBy: {
        name: user.name,
        id: user.id,
      },
      status: "draft",
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
          2
        )}) exceeds balance (${invoice.amountDue?.toFixed(2)})`,
        fieldErrors: { amount: "Amount exceeds outstanding balance" },
      };
    }

    // Get payment account
    const paymentAccount = await Account.findById(accountId).session(
      mongoSession
    );
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
      payDate.getMonth() + 1
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
    });

    await payment.save({ session: mongoSession });

    // Confirm payment (creates JE and updates invoice via updateAllocatedDocuments)
    await payment.confirm(user);

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

  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  const invoice = await Invoice.findById(invoiceId);

  if (!invoice) {
    return {
      message: "Invoice not found",
    };
  }

  try {
    // Use the model's cancel method which handles:
    // - Journal entry reversals
    // - Stock restoration
    // - Movement status updates
    // - Lifetime totals adjustments
    await invoice.cancel(
      { name: user.name, id: user.id },
      reason || `Cancelled by ${user.name}`
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

  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  const invoice = await Invoice.findById(invoiceId);

  if (!invoice) {
    return {
      message: "Invoice not found",
    };
  }

  if (invoice.status !== "draft" && invoice.status !== "sent") {
    return {
      message: `Can only complete draft or sent invoices. Current status: ${invoice.status}`,
    };
  }

  try {
    // Use the model's complete method which handles:
    // - Journal entries (AR, Revenue, VAT Output)
    // - COGS journal entry (if products)
    // - Stock movements (deducts inventory)
    // - Tax transactions (VAT Output)
    await invoice.complete({
      name: user.name,
      id: user.id,
    });
  } catch (error) {
    console.error("Complete invoice error:", error);
    return {
      message: error.message || "Failed to post invoice",
    };
  }

  // Revalidate and redirect on success
  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  revalidatePath("/dashboard/stocks");
  revalidatePath("/dashboard/movements");
  revalidatePath("/dashboard/accounts");
  redirect(`/dashboard/invoices/${invoiceId}`);
}
