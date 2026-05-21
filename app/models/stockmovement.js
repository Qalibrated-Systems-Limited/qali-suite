import { format } from "date-fns";
import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// HELPER: Derive company code from name
// ============================================
function deriveCompanyCode(name) {
  if (!name) return null;
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return words.slice(0, 4).map((w) => w[0]).join("").toUpperCase();
  }
  return name.slice(0, 3).toUpperCase();
}

// ============================================
// STOCK MOVEMENT SCHEMA (IMMUTABLE + FINANCE)
// ============================================
const stockMovementSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Movement Identification
    movementNumber: {
      type: String,
      required: true,
    },

    // Product Information
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    productSnapshot: {
      name: String,
      SKU: String,
      category: String,
      unit: String,
    },

    // Movement Type & Direction
    movementType: {
      type: String,
      enum: [
        "issue", // Internal issue (loan/use)
        "return", // Return from loan
        "sale", // Sale to customer
        "purchase", // Purchase from supplier
        "adjustment", // Stock adjustment
        "damage", // Damaged goods write-off
        "transfer", // Transfer between locations
        "initial", // Opening balance
      ],
      required: true,
      index: true,
    },

    direction: {
      type: String,
      enum: ["in", "out"],
      required: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: [0, "Quantity cannot be negative"],
    },

    // Stock Tracking
    previousStock: {
      type: Number,
      required: true,
    },

    newStock: {
      type: Number,
      required: true,
    },

    // ============================================
    // NEW: COSTING & VALUATION (FOR FINANCE)
    // ============================================
    costing: {
      // Cost per unit at time of movement
      unitCost: {
        type: Number,
        default: 0,
        min: [0, "Unit cost cannot be negative"],
      },

      // Total cost (quantity × unitCost)
      totalCost: {
        type: Number,
        default: 0,
      },

      // Selling price (for sales only)
      unitPrice: Number,

      // Total value (for sales: quantity × unitPrice)
      totalValue: Number,

      // Average cost at time of movement (snapshot)
      averageCostAtMovement: Number,
    },

    // ============================================
    // NEW: ACCOUNTING INTEGRATION
    // ============================================
    accounting: {
      // Link to journal entry (for inventory accounting)
      journalEntryId: {
        type: Schema.Types.ObjectId,
        ref: "JournalEntry",
        index: true,
      },

      // Link to COGS journal entry (for sales)
      cogsJournalEntryId: {
        type: Schema.Types.ObjectId,
        ref: "JournalEntry",
      },

      // Whether this movement affects accounting
      affectsAccounting: {
        type: Boolean,
        default: false,
      },

      // Accounting posted status
      accountingPosted: {
        type: Boolean,
        default: false,
      },

      accountingPostedAt: Date,
    },

    // Related Documents
    relatedDocuments: {
      requestId: {
        type: Schema.Types.ObjectId,
        ref: "StockRequest",
      },
      invoiceId: {
        type: Schema.Types.ObjectId,
        ref: "Invoice",
      },
      checkoutId: {
        type: Schema.Types.ObjectId,
        ref: "ItemCheckout",
      },
      purchaseOrderId: {
        type: Schema.Types.ObjectId,
        ref: "PurchaseOrder",
      },
      // NEW: Finance documents
      billId: {
        type: Schema.Types.ObjectId,
        ref: "Bill",
      },
      adjustmentId: {
        type: Schema.Types.ObjectId,
        ref: "InventoryAdjustment",
      },
      deliveryNoteId: {
        type: Schema.Types.ObjectId,
        ref: "DeliveryNote",
      },
    },

    // User who performed the movement
    performedBy: {
      name: { type: String, required: true },
      id: { type: String, required: true },
      role: {
        type: String,
        enum: [
          "storekeeper",
          "manager",
          "finance",
          "technician",
          "Store Manager",
          "admin",
          "Admin",
          "system",
        ],
      },
    },

    // Issued To (for loans/issues)
    issuedTo: {
      name: String,
      id: String,
      department: String,
      purpose: String,
    },

    // Returned By (for returns)
    returnedBy: {
      name: String,
      id: String,
      condition: {
        type: String,
        enum: ["good", "damaged", "lost", "partial"],
      },
      conditionNotes: String,
    },

    // Serial Numbers
    serialNo: String,

    // Locations
    fromLocation: String,
    toLocation: String,

    // Notes
    notes: String,
    reason: String,

    // Return Tracking
    requiresReturn: {
      type: Boolean,
      default: false,
    },

    expectedReturnDate: Date,
    actualReturnDate: Date,

    // Verification
    verifiedBy: {
      name: String,
      id: String,
      verifiedAt: Date,
    },

    // ============================================
    // REVERSAL TRACKING (IMMUTABILITY)
    // ============================================
    isReversed: {
      type: Boolean,
      default: false,
      index: true,
    },

    reversedBy: {
      movementId: Schema.Types.ObjectId,
      reason: String,
      reversedAt: Date,
      performedBy: {
        name: String,
        id: String,
      },
    },

    // Original movement (if this is a reversal)
    originalMovementId: {
      type: Schema.Types.ObjectId,
      ref: "StockMovement",
    },

    // ============================================
    // NEW: STATUS (FOR ACCOUNTING WORKFLOW)
    // ============================================
    status: {
      type: String,
      enum: ["draft", "posted", "reversed"],
      default: "posted", // Default to posted (backward compatible)
      index: true,
    },

    postedAt: Date,
    postedBy: {
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
// Unique movement number per company
stockMovementSchema.index({ companyId: 1, movementNumber: 1 }, { unique: true });
// Query indexes - all prefixed with companyId for tenant isolation
stockMovementSchema.index({ companyId: 1, productId: 1, createdAt: -1 });
stockMovementSchema.index({ companyId: 1, movementType: 1, status: 1 });
stockMovementSchema.index({ companyId: 1, "performedBy.id": 1 });
stockMovementSchema.index({ companyId: 1, createdAt: -1 });
stockMovementSchema.index({ companyId: 1, direction: 1, movementType: 1 });

// Finance-related indexes
stockMovementSchema.index({ companyId: 1, "accounting.journalEntryId": 1 });
stockMovementSchema.index({ companyId: 1, "accounting.affectsAccounting": 1, status: 1 });
stockMovementSchema.index({ companyId: 1, "relatedDocuments.billId": 1 });
stockMovementSchema.index({ companyId: 1, "relatedDocuments.invoiceId": 1 });

// ============================================
// VIRTUALS
// ============================================
stockMovementSchema.virtual("isInbound").get(function () {
  return this.direction === "in";
});

stockMovementSchema.virtual("isOutbound").get(function () {
  return this.direction === "out";
});

stockMovementSchema.virtual("signedQuantity").get(function () {
  return this.direction === "in" ? this.quantity : -this.quantity;
});

stockMovementSchema.virtual("needsAccounting").get(function () {
  return (
    ["purchase", "sale", "adjustment", "damage"].includes(this.movementType) &&
    !this.accounting?.accountingPosted
  );
});

// ============================================
// MIDDLEWARE - IMMUTABILITY CHECK
// ============================================
stockMovementSchema.pre("save", function (next) {
  // Allow updates only for specific fields
  if (!this.isNew && this.isModified()) {
    const allowedUpdates = [
      "accounting",
      "verifiedBy",
      "actualReturnDate",
      "isReversed",
      "reversedBy",
      "status",
      "postedAt",
      "postedBy",
      "updatedAt", // Mongoose auto-updates this timestamp
    ];

    const modifiedPaths = this.modifiedPaths();

    console.log("StockMovement modified paths:", modifiedPaths);

    const hasDisallowedChange = modifiedPaths.some((path) => {
      const isAllowed = allowedUpdates.some((allowed) =>
        path.startsWith(allowed)
      );
      if (!isAllowed) {
        console.log(`Disallowed change detected: ${path}`);
      }
      return !isAllowed;
    });

    if (hasDisallowedChange) {
      const err = new Error(
        "Stock movements are immutable. Create a reversal instead."
      );
      throw err;
    }
  }
});

// ============================================
// METHODS
// ============================================

/**
 * Create journal entry for this movement (if affects accounting)
 */
stockMovementSchema.methods.createJournalEntry = async function (user) {
  // Only certain movement types affect accounting
  const accountingTypes = ["purchase", "sale", "adjustment", "damage"];

  if (!accountingTypes.includes(this.movementType)) {
    return null;
  }

  if (this.accounting?.journalEntryId) {
    throw new Error("Journal entry already exists for this movement");
  }

  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");
  const companyId = this.companyId;

  // Get inventory account (tenant-scoped)
  const inventoryAccount = await Account.findOne({
    companyId, systemAccount: "inventory",
  });
  if (!inventoryAccount) {
    throw new Error("Inventory account not configured");
  }

  let lines = [];
  let entryType = "";
  let description = "";

  // ============================================
  // PURCHASE: Debit Inventory, Credit AP (handled by Bill)
  // ============================================
  if (this.movementType === "purchase") {
    // Purchases are handled by Bill schema
    // This is just for reference/tracking
    return null;
  }

  // ============================================
  // SALE: Debit COGS, Credit Inventory
  // ============================================
  if (this.movementType === "sale") {
    const cogsAccount = await Account.findOne({ companyId, systemAccount: "cogs" });
    if (!cogsAccount) {
      throw new Error("COGS account not configured");
    }

    const unitCost = this.costing?.unitCost || 0;
    const totalCost = this.quantity * unitCost;

    lines = [
      {
        accountId: cogsAccount._id,
        accountCode: cogsAccount.accountCode,
        accountName: cogsAccount.accountName,
        accountType: cogsAccount.accountType,
        debit: totalCost,
        credit: 0,
        description: `COGS - ${this.productSnapshot?.name}`,
      },
      {
        accountId: inventoryAccount._id,
        accountCode: inventoryAccount.accountCode,
        accountName: inventoryAccount.accountName,
        accountType: inventoryAccount.accountType,
        debit: 0,
        credit: totalCost,
        description: `Inventory reduction - ${this.productSnapshot?.name}`,
      },
    ];

    entryType = "sale";
    description = `COGS for sale - Movement ${this.movementNumber}`;
  }

  // ============================================
  // ADJUSTMENT: Debit/Credit Inventory vs Adjustment Expense
  // ============================================
  if (this.movementType === "adjustment") {
    const adjustmentAccount = await Account.findOne({
      companyId, systemAccount: "inventory_adjustments",
    });

    if (!adjustmentAccount) {
      throw new Error("Inventory Adjustment account not configured");
    }

    const totalCost = Math.abs(this.costing?.totalCost || 0);

    if (this.direction === "in") {
      // Inventory increase
      lines = [
        {
          accountId: inventoryAccount._id,
          accountCode: inventoryAccount.accountCode,
          accountName: inventoryAccount.accountName,
          accountType: inventoryAccount.accountType,
          debit: totalCost,
          credit: 0,
          description: `Inventory increase - ${this.productSnapshot?.name}`,
        },
        {
          accountId: adjustmentAccount._id,
          accountCode: adjustmentAccount.accountCode,
          accountName: adjustmentAccount.accountName,
          accountType: adjustmentAccount.accountType,
          debit: 0,
          credit: totalCost,
          description: `Adjustment - ${this.reason}`,
        },
      ];
    } else {
      // Inventory decrease
      lines = [
        {
          accountId: adjustmentAccount._id,
          accountCode: adjustmentAccount.accountCode,
          accountName: adjustmentAccount.accountName,
          accountType: adjustmentAccount.accountType,
          debit: totalCost,
          credit: 0,
          description: `Adjustment - ${this.reason}`,
        },
        {
          accountId: inventoryAccount._id,
          accountCode: inventoryAccount.accountCode,
          accountName: inventoryAccount.accountName,
          accountType: inventoryAccount.accountType,
          debit: 0,
          credit: totalCost,
          description: `Inventory decrease - ${this.productSnapshot?.name}`,
        },
      ];
    }

    entryType = "adjustment";
    description = `Inventory adjustment - Movement ${this.movementNumber}`;
  }

  // ============================================
  // DAMAGE: Debit Damage Expense, Credit Inventory
  // ============================================
  if (this.movementType === "damage") {
    const damageAccount = await Account.findOne({
      companyId, systemAccount: "inventory_adjustments",
    });

    if (!damageAccount) {
      throw new Error("Damage/Loss account not configured");
    }

    const totalCost = this.costing?.totalCost || 0;

    lines = [
      {
        accountId: damageAccount._id,
        accountCode: damageAccount.accountCode,
        accountName: damageAccount.accountName,
        accountType: damageAccount.accountType,
        debit: totalCost,
        credit: 0,
        description: `Damaged goods - ${this.productSnapshot?.name}`,
      },
      {
        accountId: inventoryAccount._id,
        accountCode: inventoryAccount.accountCode,
        accountName: inventoryAccount.accountName,
        accountType: inventoryAccount.accountType,
        debit: 0,
        credit: totalCost,
        description: `Inventory write-off - ${this.productSnapshot?.name}`,
      },
    ];

    entryType = "adjustment";
    description = `Damaged goods write-off - Movement ${this.movementNumber}`;
  }

  // Create journal entry
  if (lines.length > 0) {
    const { generateUniqueEntryNumber } = await import("@/lib/utils/server-utils");
    const entryNumber = await generateUniqueEntryNumber("STK", this.companyId);

    const journalEntry = await JournalEntry.create({
      companyId: this.companyId,
      entryNumber,
      entryDate: this.createdAt || new Date(),
      entryType,
      description,
      lines,
      relatedDocuments: {
        stockMovementId: this._id,
        movementNumber: this.movementNumber,
      },
      status: "draft",
      createdBy: user,
    });

    // Post journal entry
    await journalEntry.post(user);

    // Link to movement
    this.accounting = this.accounting || {};
    this.accounting.journalEntryId = journalEntry._id;
    this.accounting.affectsAccounting = true;
    this.accounting.accountingPosted = true;
    this.accounting.accountingPostedAt = new Date();

    await this.save();

    return journalEntry;
  }

  return null;
};

/**
 * Reverse this movement (create opposite movement)
 *
 * Atomic: product mutation, reversal movement, JE reversal, and the
 * "original is now reversed" flip all happen inside a single transaction.
 * Accepts an optional external session — if the caller already has a txn
 * open (e.g. when voiding a multi-document operation), pass it through
 * to participate in their unit of work. Otherwise we start our own.
 */
stockMovementSchema.methods.reverse = async function (
  reversedBy,
  reason,
  externalSession = null,
) {
  if (this.isReversed) {
    throw new Error("Movement is already reversed");
  }

  const StockMovement = mongoose.model("StockMovement");
  const Product = mongoose.model("Product");

  const ownsSession = !externalSession;
  const session = externalSession || (await mongoose.startSession());
  if (ownsSession) session.startTransaction();

  try {
    // Get product (in-session so we read its current value consistently)
    const product = await Product.findById(this.productId).session(session);
    if (!product) {
      throw new Error("Product not found");
    }

    // Check stock availability for reversal
    const currentStock = product.inventory?.quantityOnHand ?? 0;
    if (this.direction === "in") {
      // Original was IN, reversal is OUT
      if (currentStock < this.quantity) {
        throw new Error(
          `Insufficient stock to reverse. Need ${this.quantity}, have ${currentStock}`,
        );
      }
    }

    // Counter read is outside the txn; the unique index on movementNumber
    // catches any concurrent collisions on insert below.
    const reversalNumber = await generateReversalNumber();
    const oppositeDirection = this.direction === "in" ? "out" : "in";

    // Model.create with a session requires array form
    const [reversalMovement] = await StockMovement.create(
      [
        {
          movementNumber: reversalNumber,
          productId: this.productId,
          productSnapshot: this.productSnapshot,
          movementType: this.movementType,
          direction: oppositeDirection,
          quantity: this.quantity,
          previousStock: currentStock,
          newStock:
            oppositeDirection === "in"
              ? currentStock + this.quantity
              : currentStock - this.quantity,
          costing: {
            unitCost: this.costing?.unitCost || 0,
            totalCost: this.costing?.totalCost || 0,
            unitPrice: this.costing?.unitPrice,
            totalValue: this.costing?.totalValue,
          },
          performedBy: {
            name: reversedBy.name,
            id: reversedBy.id,
            role: reversedBy.role || "system",
          },
          notes: `Reversal of ${this.movementNumber}: ${reason}`,
          reason: reason,
          originalMovementId: this._id,
          status: "posted",
          postedAt: new Date(),
          postedBy: {
            name: reversedBy.name,
            id: reversedBy.id,
          },
          companyId: this.companyId,
        },
      ],
      { session },
    );

    // Update product stock
    const delta = oppositeDirection === "in" ? this.quantity : -this.quantity;
    await Product.findByIdAndUpdate(
      this.productId,
      {
        $inc: {
          "inventory.quantityOnHand": delta,
          "inventory.quantityAvailable": delta,
        },
      },
      { session },
    );

    // Reverse journal entry if exists — propagate session so the JE
    // reversal joins our atomic unit.
    if (this.accounting?.journalEntryId) {
      const JournalEntry = mongoose.model("JournalEntry");
      const je = await JournalEntry.findById(
        this.accounting.journalEntryId,
      ).session(session);

      if (je && je.status === "posted") {
        await je.reverse(reversedBy, reason, session);

        reversalMovement.accounting = {
          journalEntryId: je.reversalEntryId,
          affectsAccounting: true,
          accountingPosted: true,
          accountingPostedAt: new Date(),
        };
        await reversalMovement.save({ session });
      }
    }

    // Mark original as reversed
    this.isReversed = true;
    this.status = "reversed";
    this.reversedBy = {
      movementId: reversalMovement._id,
      reason: reason,
      reversedAt: new Date(),
      performedBy: {
        name: reversedBy.name,
        id: reversedBy.id,
      },
    };
    await this.save({ session });

    if (ownsSession) await session.commitTransaction();
    return reversalMovement;
  } catch (e) {
    if (ownsSession) await session.abortTransaction();
    throw e;
  } finally {
    if (ownsSession) session.endSession();
  }
};

// ============================================
// STATIC METHODS (KEEP EXISTING + ADD NEW)
// ============================================

// Existing methods (keep as is)
stockMovementSchema.statics.getProductHistory = function (
  productId,
  limit = 50
) {
  return this.find({ productId, status: { $ne: "reversed" } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("relatedDocuments.requestId")
    .populate("relatedDocuments.invoiceId");
};

stockMovementSchema.statics.getByDateRange = function (startDate, endDate) {
  return this.find({
    createdAt: { $gte: startDate, $lte: endDate },
    status: { $ne: "reversed" },
  }).sort({ createdAt: -1 });
};

stockMovementSchema.statics.getByType = function (type, limit = 100) {
  return this.find({
    movementType: type,
    status: { $ne: "reversed" },
  })
    .sort({ createdAt: -1 })
    .limit(limit);
};

stockMovementSchema.statics.getUserActivity = function (userId) {
  return this.find({
    "performedBy.id": userId,
    status: { $ne: "reversed" },
  }).sort({ createdAt: -1 });
};

stockMovementSchema.statics.getIssuedToUser = function (userId) {
  return this.find({
    "issuedTo.id": userId,
    requiresReturn: true,
    actualReturnDate: null,
    status: { $ne: "reversed" },
  });
};

stockMovementSchema.statics.generateMovementNumber = async function (companyId = null) {
  const Company = mongoose.model("Company");
  const Counter = mongoose.model("Counter");

  // Fetch company code for prefix
  let companyCode = null;
  if (companyId) {
    const company = await Company.findById(companyId).select("code name").lean();
    if (company) {
      // Use explicit code if set, otherwise derive from company name
      companyCode = company.code || deriveCompanyCode(company.name);
    }
  }

  const today = format(new Date(), "ddMMyy");

  // Build counter ID with company code for tenant isolation
  const counterId = companyCode
    ? `mov-${companyCode.toLowerCase()}-${today}`
    : `mov-${today}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );

  // Format: MOV-{CODE}-{DDMMYY}-{NNNN} or MOV-{DDMMYY}-{NNNN}
  const prefix = companyCode ? `MOV-${companyCode}` : "MOV";
  return `${prefix}-${today}-${String(counter.seq).padStart(4, "0")}`;
};

// ============================================
// NEW: FINANCE METHODS
// ============================================

/**
 * Get inventory valuation at a specific date
 *
 *
 */
stockMovementSchema.statics.getInventoryValuation = async function (
  asOfDate = new Date()
) {
  const result = await this.aggregate([
    {
      $match: {
        status: "posted",
        createdAt: { $lte: asOfDate },
      },
    },
    {
      $project: {
        productId: 1,
        signedQuantity: {
          $cond: [
            { $eq: ["$direction", "in"] },
            "$quantity",
            { $multiply: ["$quantity", -1] },
          ],
        },
        signedCost: {
          $cond: [
            { $eq: ["$direction", "in"] },
            "$costing.totalCost",
            { $multiply: ["$costing.totalCost", -1] },
          ],
        },
      },
    },
    {
      $group: {
        _id: "$productId",
        totalQuantity: { $sum: "$signedQuantity" },
        totalValue: { $sum: "$signedCost" },
        movements: { $sum: 1 },
      },
    },
    {
      $match: {
        totalQuantity: { $gt: 0 },
      },
    },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $unwind: "$product",
    },
    {
      $project: {
        _id: 0,
        productId: "$_id",
        productName: "$product.name",
        productSKU: "$product.SKU",
        quantity: "$totalQuantity",
        averageCost: {
          $cond: [
            { $gt: ["$totalQuantity", 0] },
            { $divide: ["$totalValue", "$totalQuantity"] },
            0,
          ],
        },
        totalValue: 1,
        movements: 1,
      },
    },
    {
      $sort: { productName: 1 },
    },
  ]);

  return {
    asOfDate,
    totalProducts: result.length,
    totalValue: result.reduce((sum, item) => sum + (item.totalValue || 0), 0),
    totalQuantity: result.reduce((sum, item) => sum + (item.quantity || 0), 0),
    products: result,
  };
};

/**
 * Get COGS for a period
 */
stockMovementSchema.statics.getCOGSForPeriod = async function (
  startDate,
  endDate
) {
  const result = await this.aggregate([
    {
      $match: {
        movementType: "sale",
        status: "posted",
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: null,
        totalCOGS: { $sum: "$costing.totalCost" },
        totalRevenue: { $sum: "$costing.totalValue" },
        totalQuantity: { $sum: "$quantity" },
        count: { $sum: 1 },
      },
    },
  ]);

  if (result.length === 0) {
    return {
      totalCOGS: 0,
      totalRevenue: 0,
      totalQuantity: 0,
      grossProfit: 0,
      grossMargin: 0,
      count: 0,
    };
  }

  const data = result[0];
  const grossProfit = (data.totalRevenue || 0) - (data.totalCOGS || 0);
  const grossMargin =
    data.totalRevenue > 0 ? (grossProfit / data.totalRevenue) * 100 : 0;

  return {
    totalCOGS: data.totalCOGS || 0,
    totalRevenue: data.totalRevenue || 0,
    totalQuantity: data.totalQuantity || 0,
    grossProfit,
    grossMargin,
    count: data.count || 0,
  };
};

/**
 * Get movements needing accounting
 */
stockMovementSchema.statics.getNeedingAccounting = function () {
  return this.find({
    movementType: { $in: ["purchase", "sale", "adjustment", "damage"] },
    "accounting.accountingPosted": false,
    status: "posted",
  }).sort({ createdAt: 1 });
};

// ============================================
// HELPER FUNCTIONS
// ============================================
async function generateReversalNumber() {
  const StockMovement = mongoose.model("StockMovement");

  const lastReversal = await StockMovement.findOne({
    movementNumber: /^SMR-/,
  })
    .sort({ movementNumber: -1 })
    .limit(1)
    .lean();

  let nextNum = 1;
  if (lastReversal?.movementNumber) {
    const match = lastReversal.movementNumber.match(/\d+$/);
    if (match) {
      nextNum = parseInt(match[0], 10) + 1;
    }
  }

  return `SMR-${String(nextNum).padStart(6, "0")}`;
}

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let StockMovement = models?.StockMovement;

if (!StockMovement) {
  StockMovement = mongoose.model("StockMovement", stockMovementSchema);
}

export { StockMovement };
