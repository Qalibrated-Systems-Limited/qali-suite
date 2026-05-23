import mongoose from "mongoose";
const Schema = mongoose.Schema;

// ============================================
// PRODUCT SCHEMA - WITH COSTING & ACCOUNTING
// ============================================
const productSchema =
  Schema &&
  new Schema(
    {
      // Company (Tenant)
      companyId: {
        type: Schema.Types.ObjectId,
        ref: "Company",
        required: [true, "Company ID is required"],
        index: true,
      },

      // ============================================
      // BASIC INFORMATION
      // ============================================
      name: {
        type: String,
        required: [true, "Product name is required"],
        trim: true,
        index: true,
      },
      type: {
        type: String,
        default: "Inventory Item",
      },

      SKU: {
        type: String,
        required: [true, "SKU is required"],
        trim: true,
        uppercase: true,
      },

      description: {
        type: String,

        trim: true,
      },

      category: {
        type: String,
        trim: true,
        index: true,
      },

      unit: {
        type: String,

        default: "pcs",
      },

      // ============================================
      // INVENTORY
      // ============================================
      inventory: {
        quantityOnHand: {
          type: Number,
          default: 0,
          min: [0, "Quantity cannot be negative"],
        },

        quantityCommitted: {
          type: Number,
          default: 0,
          min: [0, "Committed quantity cannot be negative"],
          // Quantity allocated to pending orders/requests
        },

        quantityAvailable: {
          type: Number,
          default: 0,
          min: [0, "Available quantity cannot be negative"],
          // = quantityOnHand - quantityCommitted - quantityOnHold
        },

        // Items physically received but not yet admitted to usable stock
        // (pending Sales + Finance acceptance via Goods Receipt Note workflow).
        // SOP requirement: stock isn't issuable while in HOLD.
        quantityOnHold: {
          type: Number,
          default: 0,
          min: [0, "Hold quantity cannot be negative"],
        },

        reorderLevel: {
          type: Number,
          default: 0,
          min: [0, "Reorder level cannot be negative"],
        },

        reorderQuantity: {
          type: Number,
          default: 0,
          min: [0, "Reorder quantity cannot be negative"],
        },

        minimumStock: {
          type: Number,
          default: 0,
        },

        maximumStock: {
          type: Number,
          default: 0,
        },
      },

      // ============================================
      // COSTING (NEW)
      // ============================================
      costing: {
        // Current average cost per unit
        costPrice: {
          type: Number,
          required: [true, "Cost price is required"],
          min: [0, "Cost price cannot be negative"],
          default: 0,
        },

        // Most recent purchase cost (for reference)
        lastPurchaseCost: {
          type: Number,
          default: 0,
          min: [0, "Last purchase cost cannot be negative"],
        },

        // Date of last purchase
        lastPurchaseDate: Date,

        // Costing method
        costingMethod: {
          type: String,
          enum: {
            values: ["average", "fifo", "lifo", "specific", "weighted_average"],
            message: "{VALUE} is not a valid costing method",
          },
          default: "average",
          // Kenya: Most businesses use "average" or "fifo"
        },

        // Detailed cost breakdown (optional)
        costBreakdown: {
          baseCost: {
            type: Number,
            default: 0,
            // Purchase price from supplier
          },
          freight: {
            type: Number,
            default: 0,
            // Delivery/shipping cost
          },
          duties: {
            type: Number,
            default: 0,
            // Import duties/customs
          },
          handling: {
            type: Number,
            default: 0,
            // Handling charges
          },
          other: {
            type: Number,
            default: 0,
            // Other costs (installation, setup, etc.)
          },
        },

        // Standard cost (for variance analysis)
        standardCost: {
          type: Number,
          default: 0,
        },
      },

      // ============================================
      // PRICING
      // ============================================
      pricing: {
        sellingPrice: {
          type: Number,
          default: 0,
          min: [0, "Selling price cannot be negative"],
        },

        wholesalePrice: {
          type: Number,
          default: 0,
        },

        minimumPrice: {
          type: Number,
          default: 0,
          // Below this price requires approval
        },

        marginPercentage: {
          type: Number,
          default: 0,
          // Calculated: (Selling - Cost) / Selling × 100
        },

        markupPercentage: {
          type: Number,
          default: 0,
          // Markup driver when priceMode = "markup", or computed reflection
          // of (sellingPrice - costPrice) / costPrice × 100 when manual.
        },

        // ──────────────────────────────────────────
        // Pricing mode (industry-standard markup-driven pricing)
        // ──────────────────────────────────────────
        // "manual"  → sellingPrice is the source of truth (legacy behavior).
        //             markup/margin recomputed on save from cost & selling.
        //             ALL existing products default to this — no migration.
        // "markup"  → markupPercentage is the source of truth.
        //             sellingPrice = costPrice × (1 + markupPercentage/100)
        //             auto-recomputed on save and whenever cost changes.
        priceMode: {
          type: String,
          enum: ["manual", "markup"],
          default: "manual",
        },

        // Append-only audit trail of every price change.
        priceHistory: [
          {
            previousPrice: { type: Number, default: 0 },
            newPrice: { type: Number, default: 0 },
            previousMarkup: { type: Number, default: 0 },
            newMarkup: { type: Number, default: 0 },
            costAtChange: { type: Number, default: 0 },
            mode: { type: String, enum: ["manual", "markup"] },
            reason: String,
            changedBy: { name: String, id: String, role: String },
            changedAt: { type: Date, default: Date.now },
          },
        ],

        lastPriceUpdate: Date,
      },

      // ============================================
      // ACCOUNTING INTEGRATION (NEW)
      // ============================================
      accounting: {
        // Inventory account (Asset)
        inventoryAccountId: {
          type: Schema.Types.ObjectId,
          ref: "Account",
        },

        inventoryAccountCode: String,
        inventoryAccountName: String,

        // COGS account (Expense)
        cogsAccountId: {
          type: Schema.Types.ObjectId,
          ref: "Account",
        },

        cogsAccountCode: String,
        cogsAccountName: String,

        // Revenue account (for sales)
        revenueAccountId: {
          type: Schema.Types.ObjectId,
          ref: "Account",
        },

        revenueAccountCode: String,
        revenueAccountName: String,

        // Whether this product affects accounting
        trackedInAccounting: {
          type: Boolean,
          default: true,
        },
      },

      // ============================================
      // LIFETIME TOTALS (REPORTING)
      // ============================================
      lifetimeTotals: {
        totalQuantitySold: {
          type: Number,
          default: 0,
        },

        totalRevenue: {
          type: Number,
          default: 0,
        },

        totalCOGS: {
          type: Number,
          default: 0,
        },

        totalGrossProfit: {
          type: Number,
          default: 0,
        },

        totalQuantityPurchased: {
          type: Number,
          default: 0,
        },

        totalPurchaseValue: {
          type: Number,
          default: 0,
        },
      },

      // ============================================
      // PRODUCT STATUS
      // ============================================
      status: {
        type: String,
        enum: ["active", "inactive", "discontinued"],
        default: "active",
        index: true,
      },

      isActive: {
        type: Boolean,
        default: true,
        index: true,
      },

      // ============================================
      // ADDITIONAL FIELDS (Optional)
      // ============================================
      barcode: {
        type: String,
        trim: true,
        sparse: true,
        index: true,
      },

      supplier: {
        id: String,
        name: String,
        code: String,
        contactPerson: String,
        phone: String,
        email: String,
        leadTime: Number,
      },

      manufacturer: {
        name: String,
        partNumber: String,
      },

      // Product images
      images: [
        {
          url: String,
          altText: String,
          isPrimary: {
            type: Boolean,
            default: false,
          },
        },
      ],

      // Tax information
      taxInfo: {
        taxable: {
          type: Boolean,
          default: true,
        },
        taxRate: {
          type: Number,
          default: 16, // Kenya VAT 16%
        },
      },

      // Metadata
      tags: [String],

      notes: String,

      // Audit trail
      createdBy: {
        name: String,
        id: String,
      },

      lastModifiedBy: {
        name: String,
        id: String,
      },
      // Note: supplier field is defined above at lines 320-326 with full details
      // Removed duplicate definition here that was overwriting the first one
      storeInfo: {
        location: String,
        binNumber: String,
        trackInventory: Boolean,
        allowNegativeStock: {
          type: Boolean,
          default: false,
        },
      },
    },
    {
      timestamps: true,
      toJSON: { virtuals: true },
      toObject: { virtuals: true },
    },
  );

// ============================================
// INDEXES
// ============================================
// Unique SKU per company
productSchema.index({ companyId: 1, SKU: 1 }, { unique: true });
// Query indexes - all prefixed with companyId for tenant isolation
productSchema.index({ companyId: 1, name: 1 });
productSchema.index({ companyId: 1, category: 1, status: 1 });
productSchema.index({ companyId: 1, status: 1, isActive: 1 });
productSchema.index({ companyId: 1, barcode: 1 }, { sparse: true });
// Stock stats + quantity-bucket filter on the products list. Without this
// the in-stock / low-stock / out-of-stock counts COLLSCAN every product.
productSchema.index({ companyId: 1, "inventory.quantityOnHand": 1 });
// List sort (newest-first) + pagination on /dashboard/stocks. Without this
// Mongo does an in-memory sort of all matched docs before slicing 20.
productSchema.index({ companyId: 1, createdAt: -1 });
// Low-stock filter — (companyId, status, reorderLevel, quantityOnHand)
// covers the "active AND qty > 0 AND reorder > 0 AND qty <= reorder"
// predicate used by getDashboardAlerts and buildQuantityFilter
// (low-stock). Without this the dashboard low-stock alert COLLSCANs
// every active product on every dashboard render.
productSchema.index({
  companyId: 1,
  status: 1,
  "inventory.reorderLevel": 1,
  "inventory.quantityOnHand": 1,
});

// ============================================
// VIRTUALS
// ============================================

/**
 * Inventory value (quantity × cost)
 */
productSchema.virtual("inventoryValue").get(function () {
  const qty = this.inventory?.quantityOnHand || 0;
  const cost = this.costing?.costPrice || 0;
  return qty * cost;
});

/**
 * Gross profit per unit
 */
productSchema.virtual("grossProfitPerUnit").get(function () {
  const selling = this.pricing?.sellingPrice || 0;
  const cost = this.costing?.costPrice || 0;
  return selling - cost;
});

/**
 * Check if below reorder level
 */
productSchema.virtual("needsReorder").get(function () {
  const qty = this.inventory?.quantityOnHand || 0;
  const reorderLevel = this.inventory?.reorderLevel || 0;
  return reorderLevel > 0 && qty <= reorderLevel;
});

/**
 * Check if out of stock
 */
productSchema.virtual("isOutOfStock").get(function () {
  const qty = this.inventory?.quantityOnHand || 0;
  return qty <= 0;
});

// ============================================
// MIDDLEWARE
// ============================================

/**
 * Before save: Calculate derived fields
 */
productSchema.pre("save", function () {
  // Initialize inventory if missing
  if (!this.inventory) {
    this.inventory = {};
  }

  // Calculate available quantity. Items in HOLD are physically present
  // but pending Sales+Finance acceptance and not issuable.
  this.inventory.quantityAvailable =
    (this.inventory.quantityOnHand || 0) -
    (this.inventory.quantityCommitted || 0) -
    (this.inventory.quantityOnHold || 0);

  // Initialize costing with sellingPrice as default if not set
  if (!this.costing?.costPrice && this.pricing?.sellingPrice) {
    this.costing = this.costing || {};
    if (!this.costing.costPrice) {
      this.costing.costPrice = this.pricing.sellingPrice * 0.7; // Default: 70% of selling price as cost
      this.costing.costingMethod = "average";
    }
  }

  // ──────────────────────────────────────────
  // Markup-driven selling price (industry standard)
  // ──────────────────────────────────────────
  // When priceMode = "markup", selling price is DERIVED from cost × markup.
  // Recompute when either driver changes. Manual mode keeps the legacy
  // behavior — sellingPrice is taken as-is and the % fields are reflected.
  if (
    this.pricing?.priceMode === "markup" &&
    (this.isModified("costing.costPrice") ||
      this.isModified("pricing.markupPercentage") ||
      this.isModified("pricing.priceMode"))
  ) {
    const cost = Number(this.costing?.costPrice) || 0;
    const markup = Number(this.pricing?.markupPercentage) || 0;
    if (cost > 0) {
      this.pricing.sellingPrice = Math.round(cost * (1 + markup / 100) * 100) / 100;
    }
  }

  // Calculate margins when pricing or costing changes (always run after the
  // markup-driven recompute above so the derived %s stay consistent).
  if (
    this.isModified("costing.costPrice") ||
    this.isModified("pricing.sellingPrice") ||
    this.isModified("pricing.markupPercentage") ||
    this.isModified("pricing.priceMode")
  ) {
    this.calculateMargins();
  }
});

// ============================================
// METHODS
// ============================================

/**
 * Calculate margin and markup percentages
 */
productSchema.methods.calculateMargins = function () {
  const selling = this.pricing?.sellingPrice || 0;
  const cost = this.costing?.costPrice || 0;

  if (!this.pricing) {
    this.pricing = {};
  }

  // Margin = (Selling - Cost) / Selling × 100
  if (selling > 0) {
    this.pricing.marginPercentage = ((selling - cost) / selling) * 100;
  } else {
    this.pricing.marginPercentage = 0;
  }

  // Markup = (Selling - Cost) / Cost × 100
  // In "markup" mode the user-set markup is the SOURCE OF TRUTH — preserve
  // it (don't recompute and lose precision to selling-price rounding).
  // In "manual" mode (legacy / default) markup is reflected from the
  // selling/cost relationship as before.
  if (this.pricing?.priceMode !== "markup") {
    if (cost > 0) {
      this.pricing.markupPercentage = ((selling - cost) / cost) * 100;
    } else {
      this.pricing.markupPercentage = 0;
    }
  }

  return {
    margin: this.pricing.marginPercentage,
    markup: this.pricing.markupPercentage,
  };
};

/**
 * Update average cost (when new inventory purchased)
 * Uses weighted average method
 */
productSchema.methods.updateAverageCost = function (newQuantity, newCost) {
  if (newQuantity <= 0 || newCost < 0) {
    throw new Error("Invalid quantity or cost for average cost calculation");
  }

  const currentQty = this.inventory?.quantityOnHand || 0;
  const currentCost = this.costing?.costPrice || 0;

  // Weighted average: (CurrentQty × CurrentCost + NewQty × NewCost) / TotalQty
  const totalCost = currentQty * currentCost + newQuantity * newCost;
  const totalQty = currentQty + newQuantity;

  if (totalQty > 0) {
    if (!this.costing) {
      this.costing = {};
    }

    this.costing.costPrice = totalCost / totalQty;
    this.costing.lastPurchaseCost = newCost;
    this.costing.lastPurchaseDate = new Date();
  }

  this.calculateMargins();

  return this.costing.costPrice;
};

/**
 * Increase inventory (purchase, adjustment in)
 */
productSchema.methods.increaseInventory = async function (
  quantity,
  cost,
  reason,
  session = null,
) {
  if (quantity <= 0) {
    throw new Error("Quantity must be greater than zero");
  }

  if (cost < 0) {
    throw new Error("Cost cannot be negative");
  }

  // Update cost (if using average method)
  if (
    this.costing?.costingMethod === "average" ||
    !this.costing?.costingMethod
  ) {
    this.updateAverageCost(quantity, cost);
  }

  // Update quantities
  if (!this.inventory) {
    this.inventory = {};
  }

  this.inventory.quantityOnHand =
    (this.inventory.quantityOnHand || 0) + quantity;
  this.inventory.quantityAvailable =
    this.inventory.quantityOnHand -
    (this.inventory.quantityCommitted || 0) -
    (this.inventory.quantityOnHold || 0);

  // Update lifetime totals
  if (!this.lifetimeTotals) {
    this.lifetimeTotals = {};
  }

  this.lifetimeTotals.totalQuantityPurchased =
    (this.lifetimeTotals.totalQuantityPurchased || 0) + quantity;
  this.lifetimeTotals.totalPurchaseValue =
    (this.lifetimeTotals.totalPurchaseValue || 0) + quantity * cost;

  await this.save(session ? { session } : undefined);

  return this;
};

/**
 * Decrease inventory (sale, issue, adjustment out)
 */
productSchema.methods.decreaseInventory = async function (quantity, _reason, session = null) {
  if (quantity <= 0) {
    throw new Error("Quantity must be greater than zero");
  }

  const available = this.inventory?.quantityAvailable || 0;

  if (quantity > available) {
    throw new Error(
      `Insufficient inventory for ${this.name}. ` +
        `Available: ${available}, Requested: ${quantity}`,
    );
  }

  // Update quantities
  if (!this.inventory) {
    this.inventory = {};
  }

  this.inventory.quantityOnHand =
    (this.inventory.quantityOnHand || 0) - quantity;
  this.inventory.quantityAvailable =
    this.inventory.quantityOnHand -
    (this.inventory.quantityCommitted || 0) -
    (this.inventory.quantityOnHold || 0);

  await this.save(session ? { session } : undefined);

  // Return COGS for this transaction
  const cogs = quantity * (this.costing?.costPrice || 0);
  return cogs;
};

/**
 * Record a sale (update sales totals)
 */
productSchema.methods.recordSale = async function (quantity, sellingPrice) {
  if (quantity <= 0) {
    throw new Error("Quantity must be greater than zero");
  }

  const cogs = await this.decreaseInventory(quantity, "sale");

  // Update lifetime totals
  if (!this.lifetimeTotals) {
    this.lifetimeTotals = {};
  }

  const revenue = quantity * sellingPrice;
  const grossProfit = revenue - cogs;

  this.lifetimeTotals.totalQuantitySold =
    (this.lifetimeTotals.totalQuantitySold || 0) + quantity;
  this.lifetimeTotals.totalRevenue =
    (this.lifetimeTotals.totalRevenue || 0) + revenue;
  this.lifetimeTotals.totalCOGS = (this.lifetimeTotals.totalCOGS || 0) + cogs;
  this.lifetimeTotals.totalGrossProfit =
    (this.lifetimeTotals.totalGrossProfit || 0) + grossProfit;

  await this.save();

  return {
    revenue,
    cogs,
    grossProfit,
  };
};

/**
 * Commit inventory (allocate to order/request)
 */
productSchema.methods.commitInventory = async function (quantity) {
  if (quantity <= 0) {
    throw new Error("Quantity must be greater than zero");
  }

  const available = this.inventory?.quantityAvailable || 0;

  if (quantity > available) {
    throw new Error(
      `Cannot commit ${quantity} units of ${this.name}. Only ${available} available.`,
    );
  }

  if (!this.inventory) {
    this.inventory = {};
  }

  this.inventory.quantityCommitted =
    (this.inventory.quantityCommitted || 0) + quantity;
  this.inventory.quantityAvailable =
    (this.inventory.quantityOnHand || 0) -
    this.inventory.quantityCommitted -
    (this.inventory.quantityOnHold || 0);

  await this.save();
  return this;
};

/**
 * Release committed inventory (cancel order/request)
 */
productSchema.methods.releaseInventory = async function (quantity) {
  if (quantity <= 0) {
    throw new Error("Quantity must be greater than zero");
  }

  if (!this.inventory) {
    this.inventory = {};
  }

  const committed = this.inventory.quantityCommitted || 0;

  if (quantity > committed) {
    throw new Error(
      `Cannot release ${quantity} units. Only ${committed} committed.`,
    );
  }

  this.inventory.quantityCommitted = committed - quantity;
  this.inventory.quantityAvailable =
    (this.inventory.quantityOnHand || 0) -
    this.inventory.quantityCommitted -
    (this.inventory.quantityOnHold || 0);

  await this.save();
  return this;
};

/**
 * Setup accounting accounts for this product
 */
productSchema.methods.setupAccountingAccounts = async function () {
  const Account = mongoose.model("Account");

  // Get default accounts (tenant-scoped)
  const companyId = this.companyId;
  const inventoryAccount = await Account.findOne({
    companyId, systemAccount: "inventory",
  });
  const cogsAccount = await Account.findOne({ companyId, systemAccount: "cogs" });
  const revenueAccount = await Account.findOne({
    companyId, systemAccount: "sales_revenue",
  });

  if (!this.accounting) {
    this.accounting = {};
  }

  if (inventoryAccount) {
    this.accounting.inventoryAccountId = inventoryAccount._id;
    this.accounting.inventoryAccountCode = inventoryAccount.accountCode;
    this.accounting.inventoryAccountName = inventoryAccount.accountName;
  }

  if (cogsAccount) {
    this.accounting.cogsAccountId = cogsAccount._id;
    this.accounting.cogsAccountCode = cogsAccount.accountCode;
    this.accounting.cogsAccountName = cogsAccount.accountName;
  }

  if (revenueAccount) {
    this.accounting.revenueAccountId = revenueAccount._id;
    this.accounting.revenueAccountCode = revenueAccount.accountCode;
    this.accounting.revenueAccountName = revenueAccount.accountName;
  }

  await this.save();
  return this;
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get low stock products
 */
productSchema.statics.getLowStockProducts = function () {
  return this.find({
    status: "active",
    $expr: {
      $and: [
        { $gt: ["$inventory.reorderLevel", 0] },
        { $lte: ["$inventory.quantityOnHand", "$inventory.reorderLevel"] },
      ],
    },
  }).sort({ "inventory.quantityOnHand": 1 });
};

/**
 * Get out of stock products
 */
productSchema.statics.getOutOfStockProducts = function () {
  return this.find({
    status: "active",
    "inventory.quantityOnHand": { $lte: 0 },
  }).sort({ name: 1 });
};

/**
 * Get total inventory value
 */
productSchema.statics.getTotalInventoryValue = async function () {
  const result = await this.aggregate([
    {
      $match: {
        status: "active",
      },
    },
    {
      $project: {
        name: 1,
        SKU: 1,
        quantity: {
          $ifNull: ["$inventory.quantityOnHand", 0],
        },
        costPrice: {
          $ifNull: ["$costing.costPrice", 0],
        },
        value: {
          $multiply: [
            { $ifNull: ["$inventory.quantityOnHand", 0] },
            { $ifNull: ["$costing.costPrice", 0] },
          ],
        },
      },
    },
    {
      $group: {
        _id: null,
        totalValue: { $sum: "$value" },
        totalProducts: { $sum: 1 },
        totalQuantity: { $sum: "$quantity" },
      },
    },
  ]);

  return result[0] || { totalValue: 0, totalProducts: 0, totalQuantity: 0 };
};

/**
 * Get products by category with inventory value
 */
productSchema.statics.getInventoryByCategory = async function () {
  return this.aggregate([
    {
      $match: {
        status: "active",
      },
    },
    {
      $project: {
        category: { $ifNull: ["$category", "Uncategorized"] },
        quantity: {
          $ifNull: ["$inventory.quantityOnHand", 0],
        },
        value: {
          $multiply: [
            { $ifNull: ["$inventory.quantityOnHand", 0] },
            { $ifNull: ["$costing.costPrice", 0] },
          ],
        },
      },
    },
    {
      $group: {
        _id: "$category",
        totalQuantity: { $sum: "$quantity" },
        totalValue: { $sum: "$value" },
        productCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        category: "$_id",
        totalQuantity: 1,
        totalValue: 1,
        productCount: 1,
      },
    },
    {
      $sort: { totalValue: -1 },
    },
  ]);
};

/**
 * Get top selling products
 */
productSchema.statics.getTopSellingProducts = function (limit = 10) {
  return this.find({
    status: "active",
    "lifetimeTotals.totalQuantitySold": { $gt: 0 },
  })
    .sort({ "lifetimeTotals.totalQuantitySold": -1 })
    .limit(limit)
    .select("name SKU lifetimeTotals pricing costing");
};

/**
 * Get most profitable products
 */
productSchema.statics.getMostProfitableProducts = function (limit = 10) {
  return this.find({
    status: "active",
    "lifetimeTotals.totalGrossProfit": { $gt: 0 },
  })
    .sort({ "lifetimeTotals.totalGrossProfit": -1 })
    .limit(limit)
    .select("name SKU lifetimeTotals pricing costing");
};

/**
 * Bulk setup accounting accounts for all products
 */
productSchema.statics.bulkSetupAccountingAccounts = async function () {
  const products = await this.find({ status: "active" });
  let updated = 0;

  for (const product of products) {
    try {
      await product.setupAccountingAccounts();
      updated++;
    } catch (error) {
      console.error(
        `Failed to setup accounts for ${product.SKU}:`,
        error.message,
      );
    }
  }

  return { total: products.length, updated };
};

// ============================================
// ATOMIC UPDATE HELPERS (for transactions)
// ============================================

/**
 * Atomically decrease inventory (for use in transactions)
 * Returns the update operation for findByIdAndUpdate
 */
productSchema.statics.getDecreaseInventoryUpdate = function (quantity) {
  return {
    $inc: {
      "inventory.quantityOnHand": -quantity,
      "inventory.quantityAvailable": -quantity,
    },
  };
};

/**
 * Atomically increase inventory (for use in transactions)
 * Returns the update operation for findByIdAndUpdate
 */
productSchema.statics.getIncreaseInventoryUpdate = function (quantity) {
  return {
    $inc: {
      "inventory.quantityOnHand": quantity,
      "inventory.quantityAvailable": quantity,
    },
  };
};

/**
 * Atomically commit inventory (allocate to order)
 * Returns the update operation for findByIdAndUpdate
 */
productSchema.statics.getCommitInventoryUpdate = function (quantity) {
  return {
    $inc: {
      "inventory.quantityCommitted": quantity,
      "inventory.quantityAvailable": -quantity,
    },
  };
};

/**
 * Atomically release committed inventory (cancel order)
 * Returns the update operation for findByIdAndUpdate
 */
productSchema.statics.getReleaseInventoryUpdate = function (quantity) {
  return {
    $inc: {
      "inventory.quantityCommitted": -quantity,
      "inventory.quantityAvailable": quantity,
    },
  };
};

// ============================================
// HOLD bucket — Goods Receipt Note (SOP §10.1)
// ============================================
// Items are physically on premises (counted in quantityOnHand) but pending
// Sales+Finance acceptance. While in HOLD, they don't count toward
// quantityAvailable so they can't be issued.
//
// Lifecycle:
//   onReceiveToHold   →  onHand += qty,  onHold += qty,  available unchanged
//   onAcceptFromHold  →  onHold -= qty                  (becomes available)
//   onRejectFromHold  →  onHand -= qty,  onHold -= qty  (return to supplier)
// ============================================

productSchema.statics.getReceiveToHoldUpdate = function (quantity) {
  return {
    $inc: {
      "inventory.quantityOnHand": quantity,
      "inventory.quantityOnHold": quantity,
      // available NOT changed — onHold cancels onHand
    },
  };
};

productSchema.statics.getAcceptFromHoldUpdate = function (quantity) {
  return {
    $inc: {
      "inventory.quantityOnHold": -quantity,
      "inventory.quantityAvailable": quantity,
    },
  };
};

productSchema.statics.getRejectFromHoldUpdate = function (quantity) {
  return {
    $inc: {
      "inventory.quantityOnHand": -quantity,
      "inventory.quantityOnHold": -quantity,
      // available NOT changed
    },
  };
};

/**
 * Decrease inventory atomically with validation
 * Use this in transactions for stock deductions
 */
productSchema.statics.decreaseInventoryAtomic = async function (
  productId,
  quantity,
  session = null
) {
  if (quantity <= 0) {
    throw new Error("Quantity must be greater than zero");
  }

  const options = session ? { session, new: true } : { new: true };

  // First check availability
  const product = await this.findById(productId).session(session);
  if (!product) {
    throw new Error(`Product not found: ${productId}`);
  }

  const available = product.inventory?.quantityAvailable || 0;
  if (quantity > available) {
    throw new Error(
      `Insufficient inventory for ${product.name}. Available: ${available}, Requested: ${quantity}`
    );
  }

  // Perform atomic update
  const updated = await this.findByIdAndUpdate(
    productId,
    this.getDecreaseInventoryUpdate(quantity),
    options
  );

  return updated;
};

/**
 * Increase inventory atomically
 * Use this in transactions for stock additions
 */
productSchema.statics.increaseInventoryAtomic = async function (
  productId,
  quantity,
  session = null
) {
  if (quantity <= 0) {
    throw new Error("Quantity must be greater than zero");
  }

  const options = session ? { session, new: true } : { new: true };

  const updated = await this.findByIdAndUpdate(
    productId,
    this.getIncreaseInventoryUpdate(quantity),
    options
  );

  if (!updated) {
    throw new Error(`Product not found: ${productId}`);
  }

  return updated;
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Product = models ? models.Product : null;

if (Product) {
  Product = Product;
} else {
  Product = mongoose.model("Product", productSchema);
}

export default Product;

export { Product };
