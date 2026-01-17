import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// UTILITY: Format user for audit trail
// ============================================
function formatUserForAudit(user) {
  if (!user) {
    return { name: "System", id: "system" };
  }
  return {
    name: user.name || user.username || "Unknown User",
    id: user.id || user._id?.toString() || "unknown",
  };
}

// ============================================
// PURCHASE ORDER SCHEMA
// ============================================
const purchaseOrderSchema = new Schema(
  {
    // PO Identification
    poNumber: {
      type: String,
      required: [true, "PO number is required"],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    poDate: {
      type: Date,
      required: [true, "PO date is required"],
      index: true,
    },

    expectedDeliveryDate: {
      type: Date,
      validate: {
        validator: function (value) {
          if (!value) return true;
          return value >= this.poDate;
        },
        message: "Expected delivery date cannot be before PO date",
      },
    },

    // Supplier Information (cached from Party)
    supplier: {
      id: {
        type: String,
        required: [true, "Supplier ID is required"],
        index: true,
      },
      partyId: {
        type: Schema.Types.ObjectId,
        ref: "Party",
      },
      name: {
        type: String,
        required: [true, "Supplier name is required"],
        trim: true,
      },
      email: {
        type: String,
        trim: true,
        lowercase: true,
      },
      phone: {
        type: String,
        trim: true,
      },
      address: String,
      taxPin: {
        type: String,
        trim: true,
        uppercase: true,
      },
    },

    // Delivery Address (may differ from billing)
    deliveryAddress: {
      line1: String,
      line2: String,
      city: String,
      postalCode: String,
      country: { type: String, default: "Kenya" },
      contactPerson: String,
      contactPhone: String,
    },

    // PO Items
    items: {
      type: [
        {
          // Product Reference (optional - can be non-inventory items)
          productId: {
            type: Schema.Types.ObjectId,
            ref: "Product",
          },
          productSKU: {
            type: String,
            uppercase: true,
            trim: true,
          },
          productName: String,

          // Item Details
          description: {
            type: String,
            required: [true, "Item description is required"],
            trim: true,
          },
          unit: {
            type: String,
            default: "pcs",
            trim: true,
          },

          // Quantities
          quantity: {
            type: Number,
            required: [true, "Quantity is required"],
            min: [0.001, "Quantity must be greater than zero"],
          },
          receivedQuantity: {
            type: Number,
            default: 0,
            min: [0, "Received quantity cannot be negative"],
          },
          pendingQuantity: {
            type: Number,
            default: function () {
              return this.quantity;
            },
          },

          // Pricing
          unitPrice: {
            type: Number,
            required: [true, "Unit price is required"],
            min: [0, "Unit price cannot be negative"],
          },
          amount: {
            type: Number,
            required: [true, "Amount is required"],
            min: [0, "Amount cannot be negative"],
          },

          // Tax (VAT)
          taxRate: {
            type: Number,
            default: 16, // Kenya standard VAT
            min: [0, "Tax rate cannot be negative"],
            max: [100, "Tax rate cannot exceed 100%"],
          },
          taxAmount: {
            type: Number,
            default: 0,
            min: [0, "Tax amount cannot be negative"],
          },

          // Line Total (amount + tax)
          lineTotal: {
            type: Number,
            default: 0,
          },

          // Receiving History for this item
          receivingHistory: [
            {
              receivingId: Schema.Types.ObjectId,
              billId: Schema.Types.ObjectId,
              quantity: Number,
              receivedAt: Date,
              receivedBy: {
                name: String,
                id: String,
              },
            },
          ],

          // Status
          status: {
            type: String,
            enum: ["pending", "partial", "received", "cancelled"],
            default: "pending",
          },
        },
      ],
      validate: {
        validator: function (items) {
          return items && items.length > 0;
        },
        message: "Purchase order must have at least one item",
      },
    },

    // Amounts Summary
    subtotal: {
      type: Number,
      required: [true, "Subtotal is required"],
      min: [0, "Subtotal cannot be negative"],
    },

    taxAmount: {
      type: Number,
      default: 0,
      min: [0, "Tax amount cannot be negative"],
    },

    total: {
      type: Number,
      required: [true, "Total is required"],
      min: [0.01, "Total must be greater than zero"],
    },

    currency: {
      type: String,
      default: "KES",
      uppercase: true,
      trim: true,
    },

    // Status Workflow
    status: {
      type: String,
      enum: {
        values: [
          "draft",
          "pending_approval",
          "approved",
          "sent",
          "confirmed",
          "partial",
          "received",
          "cancelled",
          "closed",
        ],
        message: "{VALUE} is not a valid status",
      },
      default: "draft",
      index: true,
    },

    // Approval Workflow
    approvalRequired: {
      type: Boolean,
      default: true,
    },

    approvalThreshold: {
      type: Number,
      default: 0, // Amount above which approval is required
    },

    approvedAt: Date,
    approvedBy: {
      name: String,
      id: String,
    },

    // Sent to Supplier
    sentAt: Date,
    sentBy: {
      name: String,
      id: String,
    },
    sentVia: {
      type: String,
      enum: ["email", "print", "portal", "manual"],
    },

    // Supplier Confirmation
    confirmedAt: Date,
    confirmedBy: {
      name: String,
      id: String,
    },
    supplierReference: String, // Supplier's order reference

    // Receiving Summary
    receivingSummary: {
      totalReceived: { type: Number, default: 0 },
      totalPending: { type: Number, default: 0 },
      lastReceivedAt: Date,
      isFullyReceived: { type: Boolean, default: false },
    },

    // Linked Documents
    receivings: [
      {
        receivingId: {
          type: Schema.Types.ObjectId,
          // Can link to a GRN (Goods Received Note) if you have one
        },
        billId: {
          type: Schema.Types.ObjectId,
          ref: "Bill",
        },
        billNumber: String,
        receivedAt: {
          type: Date,
          required: true,
        },
        receivedBy: {
          name: { type: String, required: true },
          id: { type: String, required: true },
        },
        items: [
          {
            itemIndex: Number, // Index in PO items array
            productId: Schema.Types.ObjectId,
            productSKU: String,
            quantityReceived: {
              type: Number,
              required: true,
              min: 0,
            },
          },
        ],
        notes: String,
      },
    ],

    // Bill Conversions
    bills: [
      {
        billId: {
          type: Schema.Types.ObjectId,
          ref: "Bill",
          required: true,
        },
        billNumber: String,
        billAmount: Number,
        convertedAt: Date,
        convertedBy: {
          name: String,
          id: String,
        },
      },
    ],

    // Notes & Terms
    notes: String,
    internalNotes: String, // Not visible to supplier

    termsAndConditions: String,

    // Payment Terms (copied from supplier or overridden)
    paymentTerms: {
      termsDays: {
        type: Number,
        default: 30, // Net 30
      },
      description: String, // e.g., "Net 30", "50% upfront, 50% on delivery"
    },

    // Attachments
    attachments: [
      {
        filename: String,
        url: String,
        size: Number,
        mimeType: String,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
        uploadedBy: {
          name: String,
          id: String,
        },
      },
    ],

    // Audit Trail
    createdBy: {
      name: {
        type: String,
        required: [true, "Creator name is required"],
      },
      id: {
        type: String,
        required: [true, "Creator ID is required"],
      },
    },

    lastModifiedBy: {
      name: String,
      id: String,
    },

    cancelledAt: Date,
    cancelledBy: {
      name: String,
      id: String,
    },
    cancellationReason: String,

    closedAt: Date,
    closedBy: {
      name: String,
      id: String,
    },
    closeReason: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================
// COMPOUND INDEXES
// ============================================
purchaseOrderSchema.index({ poDate: -1, status: 1 });
purchaseOrderSchema.index({ "supplier.id": 1, status: 1 });
purchaseOrderSchema.index({ status: 1, poDate: -1 });
purchaseOrderSchema.index({ expectedDeliveryDate: 1, status: 1 });

// ============================================
// VIRTUALS
// ============================================
purchaseOrderSchema.virtual("isOverdue").get(function () {
  if (["received", "cancelled", "closed"].includes(this.status)) return false;
  if (!this.expectedDeliveryDate) return false;
  return new Date() > this.expectedDeliveryDate;
});

purchaseOrderSchema.virtual("daysOverdue").get(function () {
  if (!this.isOverdue) return 0;
  const diff = new Date() - this.expectedDeliveryDate;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
});

purchaseOrderSchema.virtual("isFullyReceived").get(function () {
  return this.items.every((item) => item.status === "received");
});

purchaseOrderSchema.virtual("hasPartialReceiving").get(function () {
  return this.items.some(
    (item) => item.receivedQuantity > 0 && item.receivedQuantity < item.quantity
  );
});

purchaseOrderSchema.virtual("totalItemsCount").get(function () {
  return this.items.length;
});

purchaseOrderSchema.virtual("receivedItemsCount").get(function () {
  return this.items.filter((item) => item.status === "received").length;
});

purchaseOrderSchema.virtual("pendingItemsCount").get(function () {
  return this.items.filter((item) =>
    ["pending", "partial"].includes(item.status)
  ).length;
});

purchaseOrderSchema.virtual("canEdit").get(function () {
  return ["draft", "pending_approval"].includes(this.status);
});

purchaseOrderSchema.virtual("canApprove").get(function () {
  return this.status === "pending_approval";
});

purchaseOrderSchema.virtual("canSend").get(function () {
  return this.status === "approved";
});

purchaseOrderSchema.virtual("canReceive").get(function () {
  return ["sent", "confirmed", "partial"].includes(this.status);
});

purchaseOrderSchema.virtual("canConvertToBill").get(function () {
  return (
    ["sent", "confirmed", "partial", "received"].includes(this.status) &&
    this.receivings.length > 0
  );
});

purchaseOrderSchema.virtual("canCancel").get(function () {
  // Cannot cancel if any items have been received
  if (this.items.some((item) => item.receivedQuantity > 0)) return false;
  return !["cancelled", "closed", "received"].includes(this.status);
});

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
purchaseOrderSchema.pre("save", function (next) {
  // Recalculate item totals
  this.items.forEach((item) => {
    item.amount = item.quantity * item.unitPrice;
    item.taxAmount = (item.amount * item.taxRate) / 100;
    item.lineTotal = item.amount + item.taxAmount;
    item.pendingQuantity = item.quantity - item.receivedQuantity;

    // Update item status based on received quantity
    if (item.receivedQuantity >= item.quantity) {
      item.status = "received";
    } else if (item.receivedQuantity > 0) {
      item.status = "partial";
    }
  });

  // Recalculate totals
  this.subtotal = this.items.reduce((sum, item) => sum + item.amount, 0);
  this.taxAmount = this.items.reduce((sum, item) => sum + item.taxAmount, 0);
  this.total = this.subtotal + this.taxAmount;

  // Update receiving summary
  const totalQtyOrdered = this.items.reduce(
    (sum, item) => sum + item.quantity,
    0
  );
  const totalQtyReceived = this.items.reduce(
    (sum, item) => sum + item.receivedQuantity,
    0
  );

  this.receivingSummary.totalReceived = totalQtyReceived;
  this.receivingSummary.totalPending = totalQtyOrdered - totalQtyReceived;
  this.receivingSummary.isFullyReceived = totalQtyReceived >= totalQtyOrdered;

  // Update overall status based on receiving
  if (this.receivingSummary.isFullyReceived && this.status !== "closed") {
    this.status = "received";
  } else if (totalQtyReceived > 0 && !this.receivingSummary.isFullyReceived) {
    if (!["cancelled", "closed"].includes(this.status)) {
      this.status = "partial";
    }
  }

  next();
});

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Validate PO before submission
 */
purchaseOrderSchema.methods.validate = function () {
  // Check items
  if (!this.items || this.items.length === 0) {
    throw new Error("Purchase order must have at least one item");
  }

  // Validate each item
  for (const item of this.items) {
    if (item.quantity <= 0) {
      throw new Error(`Invalid quantity for item: ${item.description}`);
    }
    if (item.unitPrice < 0) {
      throw new Error(`Invalid unit price for item: ${item.description}`);
    }
  }

  // Validate supplier
  if (!this.supplier?.id || !this.supplier?.name) {
    throw new Error("Supplier information is required");
  }

  return true;
};

/**
 * Submit for approval
 */
purchaseOrderSchema.methods.submitForApproval = async function (user) {
  if (this.status !== "draft") {
    throw new Error(`Cannot submit PO in status: ${this.status}`);
  }

  this.validate();

  const userInfo = formatUserForAudit(user);

  // Check if approval is required based on threshold
  if (!this.approvalRequired || this.total <= this.approvalThreshold) {
    // Auto-approve
    this.status = "approved";
    this.approvedAt = new Date();
    this.approvedBy = userInfo;
  } else {
    this.status = "pending_approval";
  }

  this.lastModifiedBy = userInfo;
  await this.save();

  return this;
};

/**
 * Approve PO
 */
purchaseOrderSchema.methods.approve = async function (user) {
  if (this.status !== "pending_approval") {
    throw new Error(`Cannot approve PO in status: ${this.status}`);
  }

  const userInfo = formatUserForAudit(user);

  this.status = "approved";
  this.approvedAt = new Date();
  this.approvedBy = userInfo;
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

/**
 * Reject PO (return to draft)
 */
purchaseOrderSchema.methods.reject = async function (user, reason) {
  if (this.status !== "pending_approval") {
    throw new Error(`Cannot reject PO in status: ${this.status}`);
  }

  const userInfo = formatUserForAudit(user);

  this.status = "draft";
  this.notes = this.notes
    ? `${this.notes}\n\nRejected: ${reason}`
    : `Rejected: ${reason}`;
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

/**
 * Send to supplier
 */
purchaseOrderSchema.methods.send = async function (user, method = "email") {
  if (this.status !== "approved") {
    throw new Error(`Cannot send PO in status: ${this.status}`);
  }

  const userInfo = formatUserForAudit(user);

  this.status = "sent";
  this.sentAt = new Date();
  this.sentBy = userInfo;
  this.sentVia = method;
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

/**
 * Mark as confirmed by supplier
 */
purchaseOrderSchema.methods.confirm = async function (
  user,
  supplierReference = null
) {
  if (!["sent", "approved"].includes(this.status)) {
    throw new Error(`Cannot confirm PO in status: ${this.status}`);
  }

  const userInfo = formatUserForAudit(user);

  this.status = "confirmed";
  this.confirmedAt = new Date();
  this.confirmedBy = userInfo;
  if (supplierReference) {
    this.supplierReference = supplierReference;
  }
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

/**
 * Receive items (partial or full)
 */
purchaseOrderSchema.methods.receiveItems = async function (
  itemsToReceive,
  user,
  notes = null
) {
  if (!this.canReceive) {
    throw new Error(`Cannot receive items for PO in status: ${this.status}`);
  }

  const userInfo = formatUserForAudit(user);
  const receivingId = new mongoose.Types.ObjectId();
  const receivedAt = new Date();

  const receivingRecord = {
    receivingId,
    receivedAt,
    receivedBy: userInfo,
    items: [],
    notes,
  };

  // Process each item to receive
  for (const receiveItem of itemsToReceive) {
    const itemIndex = this.items.findIndex(
      (item) =>
        item._id.toString() === receiveItem.itemId ||
        item.productId?.toString() === receiveItem.productId
    );

    if (itemIndex === -1) {
      throw new Error(`Item not found in PO: ${receiveItem.itemId}`);
    }

    const poItem = this.items[itemIndex];
    const quantityToReceive = receiveItem.quantity;

    // Validate quantity
    if (quantityToReceive <= 0) {
      throw new Error(
        `Invalid quantity for item: ${poItem.description}`
      );
    }

    const maxReceivable = poItem.quantity - poItem.receivedQuantity;
    if (quantityToReceive > maxReceivable) {
      throw new Error(
        `Cannot receive ${quantityToReceive} of ${poItem.description}. ` +
          `Maximum receivable: ${maxReceivable}`
      );
    }

    // Update item
    poItem.receivedQuantity += quantityToReceive;
    poItem.pendingQuantity = poItem.quantity - poItem.receivedQuantity;

    // Add to item's receiving history
    poItem.receivingHistory.push({
      receivingId,
      quantity: quantityToReceive,
      receivedAt,
      receivedBy: userInfo,
    });

    // Update item status
    if (poItem.receivedQuantity >= poItem.quantity) {
      poItem.status = "received";
    } else {
      poItem.status = "partial";
    }

    // Add to receiving record
    receivingRecord.items.push({
      itemIndex,
      productId: poItem.productId,
      productSKU: poItem.productSKU,
      quantityReceived: quantityToReceive,
    });
  }

  // Add receiving record to PO
  this.receivings.push(receivingRecord);
  this.receivingSummary.lastReceivedAt = receivedAt;
  this.lastModifiedBy = userInfo;

  await this.save();

  return {
    receivingId,
    receivingRecord,
    poStatus: this.status,
    isFullyReceived: this.isFullyReceived,
  };
};

/**
 * Convert to Bill
 */
purchaseOrderSchema.methods.convertToBill = async function (
  user,
  billData = {}
) {
  if (!this.canConvertToBill) {
    throw new Error(
      `Cannot convert PO to bill in current status: ${this.status}`
    );
  }

  const Bill = mongoose.model("Bill");
  const userInfo = formatUserForAudit(user);

  // Generate bill number
  const billNumber =
    billData.billNumber || (await this.generateBillNumber());

  // Build bill lines from received items
  const billLines = [];

  for (const item of this.items) {
    // Only include items that have been received
    if (item.receivedQuantity <= 0) continue;

    // Calculate how much of this item hasn't been billed yet
    const previouslyBilled = this.bills.reduce((sum, bill) => {
      // You'd need to track per-item billing, simplified here
      return sum;
    }, 0);

    const qtyToBill = item.receivedQuantity - previouslyBilled;
    if (qtyToBill <= 0) continue;

    billLines.push({
      description: item.description,
      quantity: qtyToBill,
      unitPrice: item.unitPrice,
      amount: qtyToBill * item.unitPrice,
      taxRate: item.taxRate,
      taxAmount: (qtyToBill * item.unitPrice * item.taxRate) / 100,
      productId: item.productId,
      productSKU: item.productSKU,
      productName: item.productName,
    });
  }

  if (billLines.length === 0) {
    throw new Error("No items to bill. Receive items first.");
  }

  // Calculate bill totals
  const subtotal = billLines.reduce((sum, line) => sum + line.amount, 0);
  const taxAmount = billLines.reduce((sum, line) => sum + line.taxAmount, 0);
  const total = subtotal + taxAmount;

  // Create bill
  const bill = new Bill({
    billNumber,
    billDate: billData.billDate || new Date(),
    dueDate:
      billData.dueDate ||
      new Date(Date.now() + this.paymentTerms.termsDays * 24 * 60 * 60 * 1000),
    supplierInvoiceNumber: billData.supplierInvoiceNumber,
    supplier: {
      id: this.supplier.id,
      name: this.supplier.name,
      email: this.supplier.email,
      phone: this.supplier.phone,
      address: this.supplier.address,
      taxPin: this.supplier.taxPin,
    },
    lines: billLines,
    subtotal,
    taxAmount,
    total,
    netPayable: total, // Adjust if WHT applicable
    currency: this.currency,
    description: `Bill from PO ${this.poNumber}`,
    notes: billData.notes,
    createdBy: userInfo,
  });

  await bill.save();

  // Link bill to PO
  this.bills.push({
    billId: bill._id,
    billNumber: bill.billNumber,
    billAmount: bill.total,
    convertedAt: new Date(),
    convertedBy: userInfo,
  });

  this.lastModifiedBy = userInfo;
  await this.save();

  return bill;
};

/**
 * Generate unique bill number
 */
purchaseOrderSchema.methods.generateBillNumber = async function () {
  const Bill = mongoose.model("Bill");
  const date = new Date();
  const prefix = `BILL-${date.getFullYear()}${String(
    date.getMonth() + 1
  ).padStart(2, "0")}`;

  const lastBill = await Bill.findOne({
    billNumber: { $regex: `^${prefix}` },
  })
    .sort({ billNumber: -1 })
    .lean();

  let nextNum = 1;
  if (lastBill?.billNumber) {
    const match = lastBill.billNumber.match(/(\d+)$/);
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}-${String(nextNum).padStart(4, "0")}`;
};

/**
 * Cancel PO
 */
purchaseOrderSchema.methods.cancel = async function (user, reason) {
  if (!this.canCancel) {
    throw new Error(`Cannot cancel PO in status: ${this.status}`);
  }

  const userInfo = formatUserForAudit(user);

  this.status = "cancelled";
  this.cancelledAt = new Date();
  this.cancelledBy = userInfo;
  this.cancellationReason = reason;
  this.lastModifiedBy = userInfo;

  // Cancel all pending items
  this.items.forEach((item) => {
    if (item.status === "pending") {
      item.status = "cancelled";
    }
  });

  await this.save();

  return this;
};

/**
 * Close PO (manually close even if not fully received)
 */
purchaseOrderSchema.methods.close = async function (user, reason) {
  if (["cancelled", "closed", "draft"].includes(this.status)) {
    throw new Error(`Cannot close PO in status: ${this.status}`);
  }

  const userInfo = formatUserForAudit(user);

  this.status = "closed";
  this.closedAt = new Date();
  this.closedBy = userInfo;
  this.closeReason = reason;
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

/**
 * Clone PO (create new draft from existing)
 */
purchaseOrderSchema.methods.clone = async function (user) {
  const userInfo = formatUserForAudit(user);

  const newPO = new this.constructor({
    poNumber: await this.constructor.generatePONumber(),
    poDate: new Date(),
    expectedDeliveryDate: null,
    supplier: { ...this.supplier },
    deliveryAddress: { ...this.deliveryAddress },
    items: this.items.map((item) => ({
      productId: item.productId,
      productSKU: item.productSKU,
      productName: item.productName,
      description: item.description,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
      taxRate: item.taxRate,
      taxAmount: item.taxAmount,
      lineTotal: item.lineTotal,
      receivedQuantity: 0,
      pendingQuantity: item.quantity,
      status: "pending",
    })),
    subtotal: this.subtotal,
    taxAmount: this.taxAmount,
    total: this.total,
    currency: this.currency,
    status: "draft",
    notes: this.notes,
    termsAndConditions: this.termsAndConditions,
    paymentTerms: { ...this.paymentTerms },
    createdBy: userInfo,
  });

  await newPO.save();

  return newPO;
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Generate unique PO number
 */
purchaseOrderSchema.statics.generatePONumber = async function () {
  const date = new Date();
  const prefix = `PO-${date.getFullYear()}${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}`;

  const lastPO = await this.findOne({
    poNumber: { $regex: `^${prefix}` },
  })
    .sort({ poNumber: -1 })
    .lean();

  let nextNum = 1;
  if (lastPO?.poNumber) {
    const match = lastPO.poNumber.match(/(\d+)$/);
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}-${String(nextNum).padStart(4, "0")}`;
};

/**
 * Get POs by supplier
 */
purchaseOrderSchema.statics.getBySupplier = function (
  supplierId,
  status = null
) {
  const query = {
    "supplier.id": supplierId,
  };

  if (status) {
    query.status = Array.isArray(status) ? { $in: status } : status;
  }

  return this.find(query).sort({ poDate: -1 });
};

/**
 * Get pending POs
 */
purchaseOrderSchema.statics.getPending = function () {
  return this.find({
    status: { $in: ["sent", "confirmed", "partial"] },
  }).sort({ expectedDeliveryDate: 1, poDate: -1 });
};

/**
 * Get overdue POs
 */
purchaseOrderSchema.statics.getOverdue = function () {
  return this.find({
    status: { $in: ["sent", "confirmed", "partial"] },
    expectedDeliveryDate: { $lt: new Date() },
  }).sort({ expectedDeliveryDate: 1 });
};

/**
 * Get POs awaiting approval
 */
purchaseOrderSchema.statics.getAwaitingApproval = function () {
  return this.find({
    status: "pending_approval",
  }).sort({ createdAt: 1 });
};

/**
 * Get PO summary stats
 */
purchaseOrderSchema.statics.getSummaryStats = async function (
  startDate,
  endDate
) {
  const match = {
    poDate: { $gte: startDate, $lte: endDate },
    status: { $ne: "cancelled" },
  };

  const result = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalValue: { $sum: "$total" },
      },
    },
  ]);

  return result;
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let PurchaseOrder = models?.PurchaseOrder;

if (!PurchaseOrder) {
  PurchaseOrder = mongoose.model("PurchaseOrder", purchaseOrderSchema);
}

export default PurchaseOrder;