import mongoose from "mongoose";
import { ErpCounter } from "./erp-counter";

const Schema = mongoose.Schema;

// ============================================
// PURCHASE ORDER SCHEMA
// ============================================
// Design Principles:
// 1. PO is a planning document - no accounting entries until converted to Bill
// 2. Supports partial receiving (multiple Bills from one PO)
// 3. Links to Bills for traceability
// 4. Immutable supplier snapshot at creation
// 5. Flexible - Bills can be created without PO
// ============================================

const poLineSchema = new Schema(
  {
    lineNumber: {
      type: Number,
      required: true,
      min: 1,
    },

    // Product Reference
    product: {
      id: { type: Schema.Types.ObjectId, ref: "Product" },
      sku: { type: String, uppercase: true, trim: true },
      name: String,
    },

    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      maxlength: 500,
    },

    // Account for expense/asset categorization
    account: {
      id: { type: Schema.Types.ObjectId, ref: "Account" },
      code: String,
      name: String,
      type: {
        type: String,
        enum: ["expense", "asset"],
      },
    },

    quantity: {
      type: Number,
      required: true,
      min: [0.001, "Quantity must be positive"],
    },

    unit: {
      type: String,
      default: "pcs",
      trim: true,
    },

    unitPrice: {
      type: Number,
      required: true,
      min: [0, "Unit price cannot be negative"],
    },

    // Calculated: quantity × unitPrice
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // VAT on this line
    vat: {
      rate: { type: Number, default: 0, min: 0, max: 100 },
      amount: { type: Number, default: 0, min: 0 },
    },

    // Line total: amount + vat.amount
    lineTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    // ==========================================
    // RECEIVING TRACKING
    // ==========================================
    receivedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Receiving history
    receivings: [
      {
        billId: { type: Schema.Types.ObjectId, ref: "Bill" },
        billNumber: String,
        quantity: Number,
        receivedAt: Date,
        receivedBy: { name: String, id: String },
      },
    ],
  },
  { _id: true }
);

// Virtual: remaining quantity to receive
poLineSchema.virtual("remainingQuantity").get(function () {
  return this.quantity - this.receivedQuantity;
});

poLineSchema.virtual("isFullyReceived").get(function () {
  return this.receivedQuantity >= this.quantity;
});

// ============================================
// MAIN PURCHASE ORDER SCHEMA
// ============================================
const purchaseOrderSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // ==========================================
    // IDENTIFICATION
    // ==========================================
    poNumber: {
      type: String,
      required: [true, "PO number is required"],
      uppercase: true,
      trim: true,
    },

    // ==========================================
    // DATES
    // ==========================================
    poDate: {
      type: Date,
      required: [true, "PO date is required"],
      index: true,
    },

    expectedDeliveryDate: {
      type: Date,
      index: true,
    },

    validUntil: {
      type: Date,
      index: true,
    },

    // ==========================================
    // SUPPLIER (Snapshot - immutable after creation)
    // ==========================================
    supplier: {
      partyId: {
        type: Schema.Types.ObjectId,
        ref: "Party",
        required: [true, "Supplier is required"],
        index: true,
      },
      name: { type: String, required: true, trim: true },
      taxPin: { type: String, uppercase: true, trim: true },
      email: { type: String, lowercase: true, trim: true },
      phone: { type: String, trim: true },
      address: String,
    },

    // WHT Settings (from supplier)
    whtApplicable: {
      type: Boolean,
      default: false,
    },

    whtRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 30,
    },

    // ==========================================
    // LINE ITEMS (max 50 lines)
    // ==========================================
    lines: {
      type: [poLineSchema],
      validate: [
        {
          validator: function (lines) {
            return lines && lines.length > 0;
          },
          message: "PO must have at least one line",
        },
        {
          validator: function (lines) {
            return lines.length <= 50;
          },
          message: "PO cannot have more than 50 lines",
        },
      ],
    },

    // ==========================================
    // AMOUNTS
    // ==========================================
    amounts: {
      subtotal: {
        type: Number,
        required: true,
        min: 0,
      },
      vat: {
        type: Number,
        default: 0,
        min: 0,
      },
      total: {
        type: Number,
        required: true,
        min: 0,
      },
      wht: {
        type: Number,
        default: 0,
        min: 0,
      },
      netPayable: {
        type: Number,
        required: true,
        min: 0,
      },
    },

    currency: {
      type: String,
      default: "KES",
      uppercase: true,
      enum: ["KES", "USD", "EUR", "GBP"],
    },

    // ==========================================
    // STATUS & WORKFLOW
    // ==========================================
    status: {
      type: String,
      enum: [
        "draft",
        "sent",
        "confirmed",
        "partial",
        "received",
        "cancelled",
        "expired",
      ],
      default: "draft",
      index: true,
    },

    // ==========================================
    // WORKFLOW TIMESTAMPS
    // ==========================================
    sentAt: Date,
    sentBy: { name: String, id: String },

    // Email-delivery tracking. `sentAt` = the user clicked "send"; these
    // record what happened with the actual outbound email.
    sentTo: String,                   // Supplier email address used
    deliveredAt: Date,                // Resend confirmed accepted-for-delivery
    deliveryAttempts: { type: Number, default: 0 },
    lastDeliveryError: String,        // Surfaced on the PO detail page if non-empty

    confirmedAt: Date,
    confirmedBy: { name: String, id: String },

    cancelledAt: Date,
    cancelledBy: { name: String, id: String },
    cancellationReason: String,

    // ==========================================
    // BILL REFERENCES (Bills created from this PO)
    // ==========================================
    bills: [
      {
        billId: { type: Schema.Types.ObjectId, ref: "Bill" },
        billNumber: String,
        amount: Number,
        createdAt: Date,
        createdBy: { name: String, id: String },
      },
    ],

    // ==========================================
    // DELIVERY
    // ==========================================
    deliveryAddress: {
      type: String,
      maxlength: 500,
    },

    deliveryInstructions: {
      type: String,
      maxlength: 1000,
    },

    // ==========================================
    // NOTES
    // ==========================================
    notes: {
      type: String,
      maxlength: 1000,
    },

    termsAndConditions: {
      type: String,
      maxlength: 2000,
    },

    internalNotes: {
      type: String,
      maxlength: 2000,
    },

    // ==========================================
    // AUDIT
    // ==========================================
    createdBy: {
      name: { type: String, required: true },
      id: { type: String, required: true },
    },

    lastModifiedBy: {
      name: String,
      id: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================
// INDEXES
// ============================================
// Unique PO number per company
purchaseOrderSchema.index({ companyId: 1, poNumber: 1 }, { unique: true });
// Query indexes - all prefixed with companyId for tenant isolation
purchaseOrderSchema.index({ companyId: 1, poDate: -1, status: 1 });
purchaseOrderSchema.index({ companyId: 1, "supplier.partyId": 1, status: 1 });
purchaseOrderSchema.index({ companyId: 1, status: 1, expectedDeliveryDate: 1 });
purchaseOrderSchema.index({ companyId: 1, validUntil: 1, status: 1 });

// ============================================
// VIRTUALS
// ============================================
purchaseOrderSchema.virtual("isExpired").get(function () {
  if (this.status === "received" || this.status === "cancelled") return false;
  if (!this.validUntil) return false;
  return new Date() > this.validUntil;
});

purchaseOrderSchema.virtual("totalReceived").get(function () {
  return this.lines.reduce((sum, line) => sum + line.receivedQuantity, 0);
});

purchaseOrderSchema.virtual("totalOrdered").get(function () {
  return this.lines.reduce((sum, line) => sum + line.quantity, 0);
});

purchaseOrderSchema.virtual("receivingPercentage").get(function () {
  const total = this.totalOrdered;
  if (total === 0) return 0;
  return Math.round((this.totalReceived / total) * 100);
});

purchaseOrderSchema.virtual("isFullyReceived").get(function () {
  return this.lines.every((line) => line.receivedQuantity >= line.quantity);
});

purchaseOrderSchema.virtual("canEdit").get(function () {
  return this.status === "draft";
});

purchaseOrderSchema.virtual("canSend").get(function () {
  return this.status === "draft";
});

purchaseOrderSchema.virtual("canConfirm").get(function () {
  return this.status === "sent";
});

purchaseOrderSchema.virtual("canConvertToBill").get(function () {
  return ["sent", "confirmed", "partial"].includes(this.status);
});

purchaseOrderSchema.virtual("canCancel").get(function () {
  // Can't cancel if any bills created
  if (this.bills && this.bills.length > 0) return false;
  return ["draft", "sent", "confirmed"].includes(this.status);
});

purchaseOrderSchema.virtual("lineCount").get(function () {
  return this.lines?.length || 0;
});

// ============================================
// PRE-SAVE: Calculate amounts
// ============================================
purchaseOrderSchema.pre("save", function (next) {
  let subtotal = 0;
  let totalVat = 0;

  this.lines.forEach((line, index) => {
    line.lineNumber = index + 1;
    line.amount = Math.round(line.quantity * line.unitPrice * 100) / 100;
    line.vat.amount =
      Math.round(line.amount * (line.vat.rate / 100) * 100) / 100;
    line.lineTotal = line.amount + line.vat.amount;

    subtotal += line.amount;
    totalVat += line.vat.amount;
  });

  this.amounts.subtotal = Math.round(subtotal * 100) / 100;
  this.amounts.vat = Math.round(totalVat * 100) / 100;
  this.amounts.total = this.amounts.subtotal + this.amounts.vat;

  if (this.whtApplicable && this.whtRate > 0) {
    this.amounts.wht =
      Math.round(this.amounts.subtotal * (this.whtRate / 100) * 100) / 100;
  } else {
    this.amounts.wht = 0;
  }

  this.amounts.netPayable = this.amounts.total - this.amounts.wht;

  // Check for expiration
  if (
    this.validUntil &&
    new Date() > this.validUntil &&
    !["received", "cancelled", "expired"].includes(this.status)
  ) {
    this.status = "expired";
  }
});

// ============================================
// HELPER: Format user
// ============================================
function formatUser(user) {
  if (!user) return { name: "System", id: "system" };
  return {
    name: user.name || user.username || "Unknown",
    id: user.id || user._id?.toString() || "unknown",
  };
}

// ============================================
// METHOD: Send to Supplier
// ============================================
purchaseOrderSchema.methods.send = async function (user) {
  if (!this.canSend) {
    throw new Error(`Cannot send PO in status: ${this.status}`);
  }

  const userInfo = formatUser(user);

  this.status = "sent";
  this.sentAt = new Date();
  this.sentBy = userInfo;
  this.lastModifiedBy = userInfo;

  await this.save();
  return this;
};

// ============================================
// METHOD: Confirm (Supplier confirmed)
// ============================================
purchaseOrderSchema.methods.confirm = async function (user) {
  if (!this.canConfirm) {
    throw new Error(`Cannot confirm PO in status: ${this.status}`);
  }

  const userInfo = formatUser(user);

  this.status = "confirmed";
  this.confirmedAt = new Date();
  this.confirmedBy = userInfo;
  this.lastModifiedBy = userInfo;

  await this.save();
  return this;
};

// ============================================
// METHOD: Cancel
// ============================================
purchaseOrderSchema.methods.cancel = async function (user, reason) {
  if (!this.canCancel) {
    throw new Error(`Cannot cancel PO in status: ${this.status}`);
  }

  const userInfo = formatUser(user);

  this.status = "cancelled";
  this.cancelledAt = new Date();
  this.cancelledBy = userInfo;
  this.cancellationReason = reason || "No reason provided";
  this.lastModifiedBy = userInfo;

  await this.save();
  return this;
};

// ============================================
// METHOD: Record Receiving (when Bill is created)
// ============================================
purchaseOrderSchema.methods.recordReceiving = async function (
  billId,
  billNumber,
  receivedItems,
  user
) {
  const userInfo = formatUser(user);

  for (const received of receivedItems) {
    const line = this.lines.find(
      (l) =>
        l._id.toString() === received.lineId ||
        (l.product?.id &&
          l.product.id.toString() === received.productId?.toString())
    );

    if (line) {
      line.receivedQuantity += received.quantity;
      line.receivings.push({
        billId,
        billNumber,
        quantity: received.quantity,
        receivedAt: new Date(),
        receivedBy: userInfo,
      });
    }
  }

  // Add bill reference
  this.bills.push({
    billId,
    billNumber,
    amount: receivedItems.reduce((sum, item) => sum + (item.amount || 0), 0),
    createdAt: new Date(),
    createdBy: userInfo,
  });

  // Update status based on receiving
  if (this.isFullyReceived) {
    this.status = "received";
  } else if (this.totalReceived > 0) {
    this.status = "partial";
  }

  this.lastModifiedBy = userInfo;
  await this.save();
  return this;
};

// ============================================
// METHOD: Get lines available for billing
// ============================================
purchaseOrderSchema.methods.getAvailableLines = function () {
  return this.lines
    .filter((line) => line.receivedQuantity < line.quantity)
    .map((line) => ({
      lineId: line._id,
      product: line.product,
      description: line.description,
      account: line.account,
      unit: line.unit,
      unitPrice: line.unitPrice,
      vat: line.vat,
      orderedQuantity: line.quantity,
      receivedQuantity: line.receivedQuantity,
      availableQuantity: line.quantity - line.receivedQuantity,
    }));
};

// ============================================
// METHOD: Convert to Bill (creates Bill from PO)
// ============================================
purchaseOrderSchema.methods.convertToBill = async function (
  selectedLines,
  billData,
  user
) {
  if (!this.canConvertToBill) {
    throw new Error(`Cannot convert PO to Bill in status: ${this.status}`);
  }

  const Bill = mongoose.model("Bill");
  const userInfo = formatUser(user);

  // Build bill lines from selected PO lines
  const billLines = [];
  const receivedItems = [];

  for (const selection of selectedLines) {
    const poLine = this.lines.find(
      (l) => l._id.toString() === selection.lineId.toString()
    );

    if (!poLine) {
      throw new Error(`PO line not found: ${selection.lineId}`);
    }

    // Available to bill = ordered but not yet received
    // (In this model, receiving happens when creating a bill)
    const availableQty = poLine.quantity - poLine.receivedQuantity;

    if (selection.quantity > availableQty) {
      throw new Error(
        `Quantity ${selection.quantity} exceeds available ${availableQty} for line ${poLine.description}`
      );
    }

    const amount =
      Math.round(selection.quantity * poLine.unitPrice * 100) / 100;
    const vatAmount = Math.round(amount * (poLine.vat.rate / 100) * 100) / 100;

    billLines.push({
      lineNumber: billLines.length + 1,
      product: poLine.product,
      description: poLine.description,
      account: poLine.account || {
        id: billData.defaultAccountId,
        code: billData.defaultAccountCode,
        name: billData.defaultAccountName,
        type: billData.defaultAccountType || "expense",
      },
      quantity: selection.quantity,
      unit: poLine.unit,
      unitPrice: poLine.unitPrice,
      amount,
      vat: {
        rate: poLine.vat.rate,
        amount: vatAmount,
      },
      lineTotal: amount + vatAmount,
      poReference: {
        poId: this._id,
        poNumber: this.poNumber,
        poLineIndex: this.lines.indexOf(poLine),
      },
    });

    receivedItems.push({
      lineId: poLine._id.toString(),
      productId: poLine.product?.id,
      quantity: selection.quantity,
      amount: amount + vatAmount,
    });
  }

  // Generate bill number
  const billNumber = await Bill.generateBillNumber(this.companyId);

  // Calculate fiscal period
  const billDate = billData.billDate || new Date();
  const d = new Date(billDate);
  const fiscalPeriod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}`;

  // Calculate amounts
  const subtotal = billLines.reduce((sum, line) => sum + line.amount, 0);
  const vatTotal = billLines.reduce(
    (sum, line) => sum + (line.vat?.amount || 0),
    0
  );
  const total = subtotal + vatTotal;
  const whtAmount = this.whtApplicable
    ? Math.round(subtotal * (this.whtRate / 100) * 100) / 100
    : 0;
  const netPayable = total - whtAmount;

  // Create bill
  const bill = new Bill({
    billNumber,
    supplierInvoiceNumber: billData.supplierInvoiceNumber,
    billDate,
    dueDate:
      billData.dueDate || new Date(d.getTime() + 30 * 24 * 60 * 60 * 1000),
    fiscalPeriod,
    supplier: { ...this.supplier },
    whtApplicable: this.whtApplicable,
    whtRate: this.whtRate,
    purchaseOrder: {
      poId: this._id,
      poNumber: this.poNumber,
    },
    lines: billLines,
    amounts: {
      subtotal,
      vat: vatTotal,
      total,
      wht: whtAmount,
      netPayable,
    },
    description: billData.description || `Bill from PO ${this.poNumber}`,
    internalNotes: billData.internalNotes,
    createdBy: userInfo,
  });

  await bill.save();

  // Update PO with receiving information
  await this.recordReceiving(bill._id, billNumber, receivedItems, user);

  return bill;
};

// ============================================
// STATIC: Generate PO Number
// ============================================
purchaseOrderSchema.statics.generatePONumber = async function (session = null) {
  const ErpCounter = mongoose.model("ErpCounter");
  const date = new Date();
  const prefix = `QSL-PO-${date.getFullYear()}${String(
    date.getMonth() + 1
  ).padStart(2, "0")}`;
  const counterId = `po-${date.getFullYear()}${String(
    date.getMonth() + 1
  ).padStart(2, "0")}`;
  const queryOptions = session ? { session } : {};

  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const seq = await ErpCounter.getNextSequence(counterId, session);
      const poNumber = `${prefix}-${String(seq).padStart(4, "0")}`;

      const exists = await this.exists({ poNumber }, queryOptions);
      if (!exists) {
        return poNumber;
      }

      console.warn(`PO number ${poNumber} already exists, retrying...`);
      continue;
    } catch (counterError) {
      console.warn(
        `Counter failed for ${counterId}, attempt ${attempt + 1}:`,
        counterError.message
      );

      const lastPO = await this.findOne(
        { poNumber: { $regex: `^${prefix}` } },
        null,
        queryOptions
      )
        .sort({ poNumber: -1 })
        .lean();

      let nextNum = 1;
      if (lastPO?.poNumber) {
        const match = lastPO.poNumber.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }

      const poNumber = `${prefix}-${String(nextNum).padStart(4, "0")}`;

      const exists = await this.exists({ poNumber }, queryOptions);
      if (!exists) {
        return poNumber;
      }
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 50 * Math.pow(2, attempt))
    );
  }

  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 4).toUpperCase();
  return `${prefix}-${timestamp}${random}`;
};

// ============================================
// STATIC: Get by Supplier
// ============================================
purchaseOrderSchema.statics.getBySupplier = function (
  supplierId,
  status = null
) {
  const query = { "supplier.partyId": supplierId };
  if (status) {
    query.status = Array.isArray(status) ? { $in: status } : status;
  }
  return this.find(query).sort({ poDate: -1 });
};

// ============================================
// STATIC: Get Open POs (for receiving)
// ============================================
purchaseOrderSchema.statics.getOpenPOs = function () {
  return this.find({
    status: { $in: ["sent", "confirmed", "partial"] },
  }).sort({ expectedDeliveryDate: 1, poDate: -1 });
};

// ============================================
// STATIC: Get POs with available items
// ============================================
purchaseOrderSchema.statics.getPOsWithAvailableItems = async function (
  supplierId = null
) {
  const query = {
    status: { $in: ["sent", "confirmed", "partial"] },
  };

  if (supplierId) {
    query["supplier.partyId"] = supplierId;
  }

  const pos = await this.find(query).sort({ poDate: -1 }).lean();

  // Filter to only POs with available items
  return pos
    .map((po) => ({
      ...po,
      availableLines: po.lines.filter(
        (line) => line.receivedQuantity < line.quantity
      ),
    }))
    .filter((po) => po.availableLines.length > 0);
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
