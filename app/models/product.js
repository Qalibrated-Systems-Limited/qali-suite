import mongoose from "mongoose";
import { units } from "../utils/units";

const Schema = mongoose.Schema;

// ============================================
// PRODUCT SCHEMA - WITH COSTING & ACCOUNTING
// ============================================
const productSchema =
  Schema &&
  new Schema(
    {
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
        unique: true,
        trim: true,
        uppercase: true,
        index: true,
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
      // INVENTORY (Keep existing stock field for backward compatibility)
      // ============================================
      stock: {
        type: Number,
        required: true,
        default: 0,
        min: [0, "Stock cannot be negative"],
      },

      // NEW: Enhanced inventory tracking
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
          // = quantityOnHand - quantityCommitted
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
      // PRICING (Keep existing price field + enhancements)
      // ============================================
      price: {
        type: Number,
        required: [true, "Price is required"],
        default: 0,
        min: [0, "Price cannot be negative"],
      },

      // NEW: Enhanced pricing
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
          // Calculated: (Selling - Cost) / Cost × 100
        },

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
    }
  );

// ============================================
// INDEXES
// ============================================
// productSchema.index({ name: 1 });
// productSchema.index({ SKU: 1 });
// productSchema.index({ category: 1, status: 1 });
// productSchema.index({ status: 1, isActive: 1 });
// productSchema.index({ "inventory.quantityOnHand": 1 });
// productSchema.index({ "inventory.reorderLevel": 1 });
// productSchema.index({ "costing.costPrice": 1 });
// productSchema.index({ "pricing.sellingPrice": 1 });

// ============================================
// VIRTUALS
// ============================================

/**
 * Inventory value (quantity × cost)
 */
productSchema.virtual("inventoryValue").get(function () {
  const qty = this.inventory?.quantityOnHand || this.stock || 0;
  const cost = this.costing?.costPrice || 0;
  return qty * cost;
});

/**
 * Gross profit per unit
 */
productSchema.virtual("grossProfitPerUnit").get(function () {
  const selling = this.pricing?.sellingPrice || this.price || 0;
  const cost = this.costing?.costPrice || 0;
  return selling - cost;
});

/**
 * Check if below reorder level
 */
productSchema.virtual("needsReorder").get(function () {
  const qty = this.inventory?.quantityOnHand || this.stock || 0;
  const reorderLevel = this.inventory?.reorderLevel || 0;
  return reorderLevel > 0 && qty <= reorderLevel;
});

/**
 * Check if out of stock
 */
productSchema.virtual("isOutOfStock").get(function () {
  const qty = this.inventory?.quantityOnHand || this.stock || 0;
  return qty <= 0;
});

/**
 * Sync stock with inventory.quantityOnHand (for backward compatibility)
 */
productSchema.virtual("syncedStock").get(function () {
  return this.inventory?.quantityOnHand || this.stock || 0;
});

// ============================================
// MIDDLEWARE
// ============================================

/**
 * Before save: Sync stock field with inventory.quantityOnHand
 * FIX: Always keep both fields in sync for backward compatibility
 */
productSchema.pre("save", function (next) {
  // Initialize inventory if missing
  if (!this.inventory) {
    this.inventory = {};
  }

  // CRITICAL: Keep stock and inventory.quantityOnHand in sync
  // If stock changed, sync to inventory
  if (this.isModified("stock")) {
    this.inventory.quantityOnHand = this.stock;
  }
  // If inventory changed, sync to stock
  else if (this.isModified("inventory.quantityOnHand")) {
    this.stock = this.inventory.quantityOnHand || 0;
  }
  // Fallback: ensure they match
  else if (this.stock !== this.inventory.quantityOnHand) {
    this.inventory.quantityOnHand = this.stock;
  }

  // Calculate available quantity
  this.inventory.quantityAvailable =
    (this.inventory.quantityOnHand || 0) -
    (this.inventory.quantityCommitted || 0);

  // Sync pricing
  if (this.isModified("price") && !this.isModified("pricing.sellingPrice")) {
    this.pricing = this.pricing || {};
    this.pricing.sellingPrice = this.price;
  }

  if (this.isModified("pricing.sellingPrice") && !this.isModified("price")) {
    this.price = this.pricing.sellingPrice;
  }

  // Initialize costing with price as default cost if not set (for old products)
  if (!this.costing?.costPrice && this.price) {
    this.costing = this.costing || {};
    if (!this.costing.costPrice) {
      this.costing.costPrice = this.price * 0.7; // Default: 70% of selling price as cost
      this.costing.costingMethod = "average";
    }
  }

  // Calculate margins
  if (
    this.isModified("costing.costPrice") ||
    this.isModified("pricing.sellingPrice") ||
    this.isModified("price")
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
  const selling = this.pricing?.sellingPrice || this.price || 0;
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
  if (cost > 0) {
    this.pricing.markupPercentage = ((selling - cost) / cost) * 100;
  } else {
    this.pricing.markupPercentage = 0;
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

  const currentQty = this.inventory?.quantityOnHand || this.stock || 0;
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
  reason
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
    this.inventory.quantityOnHand - (this.inventory.quantityCommitted || 0);

  // Sync backward compatible stock field
  this.stock = this.inventory.quantityOnHand;

  // Update lifetime totals
  if (!this.lifetimeTotals) {
    this.lifetimeTotals = {};
  }

  this.lifetimeTotals.totalQuantityPurchased =
    (this.lifetimeTotals.totalQuantityPurchased || 0) + quantity;
  this.lifetimeTotals.totalPurchaseValue =
    (this.lifetimeTotals.totalPurchaseValue || 0) + quantity * cost;

  await this.save();

  return this;
};

/**
 * Decrease inventory (sale, issue, adjustment out)
 */
productSchema.methods.decreaseInventory = async function (quantity, reason) {
  if (quantity <= 0) {
    throw new Error("Quantity must be greater than zero");
  }

  const available = this.inventory?.quantityAvailable || this.stock || 0;

  if (quantity > available) {
    throw new Error(
      `Insufficient inventory for ${this.name}. ` +
        `Available: ${available}, Requested: ${quantity}`
    );
  }

  // Update quantities
  if (!this.inventory) {
    this.inventory = {};
  }

  this.inventory.quantityOnHand =
    (this.inventory.quantityOnHand || 0) - quantity;
  this.inventory.quantityAvailable =
    this.inventory.quantityOnHand - (this.inventory.quantityCommitted || 0);

  // Sync backward compatible stock field
  this.stock = this.inventory.quantityOnHand;

  await this.save();

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
      `Cannot commit ${quantity} units of ${this.name}. Only ${available} available.`
    );
  }

  if (!this.inventory) {
    this.inventory = {};
  }

  this.inventory.quantityCommitted =
    (this.inventory.quantityCommitted || 0) + quantity;
  this.inventory.quantityAvailable =
    (this.inventory.quantityOnHand || 0) - this.inventory.quantityCommitted;

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
      `Cannot release ${quantity} units. Only ${committed} committed.`
    );
  }

  this.inventory.quantityCommitted = committed - quantity;
  this.inventory.quantityAvailable =
    (this.inventory.quantityOnHand || 0) - this.inventory.quantityCommitted;

  await this.save();
  return this;
};

/**
 * Setup accounting accounts for this product
 */
productSchema.methods.setupAccountingAccounts = async function () {
  const Account = mongoose.model("Account");

  // Get default accounts
  const inventoryAccount = await Account.findOne({
    systemAccount: "inventory",
  });
  const cogsAccount = await Account.findOne({ systemAccount: "cogs" });
  const revenueAccount = await Account.findOne({
    systemAccount: "sales_revenue",
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
    $or: [{ stock: { $lte: 0 } }, { "inventory.quantityOnHand": { $lte: 0 } }],
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
          $ifNull: ["$inventory.quantityOnHand", "$stock"],
        },
        costPrice: {
          $ifNull: ["$costing.costPrice", 0],
        },
        value: {
          $multiply: [
            { $ifNull: ["$inventory.quantityOnHand", "$stock"] },
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
          $ifNull: ["$inventory.quantityOnHand", "$stock"],
        },
        value: {
          $multiply: [
            { $ifNull: ["$inventory.quantityOnHand", "$stock"] },
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
        error.message
      );
    }
  }

  return { total: products.length, updated };
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
