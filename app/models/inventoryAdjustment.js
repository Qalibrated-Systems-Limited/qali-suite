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
// INVENTORY ADJUSTMENT SCHEMA
// ============================================
const inventoryAdjustmentSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Adjustment Identification
    adjustmentNumber: {
      type: String,
      required: [true, "Adjustment number is required"],
    },

    adjustmentDate: {
      type: Date,
      required: [true, "Adjustment date is required"],
      default: Date.now,
      index: true,
    },

    adjustmentType: {
      type: String,
      required: [true, "Adjustment type is required"],
      enum: {
        values: [
          "physical_count", // Stock take revealed difference
          "damage", // Damaged goods
          "expiry", // Expired goods
          "theft", // Stolen/lost goods
          "correction", // Data entry error correction
          "write_off", // Obsolete inventory write-off
          "found", // Unexpected inventory found
          "opening_balance", // Initial stock seeded at product create / data migration
          "other",
        ],
        message: "{VALUE} is not a valid adjustment type",
      },
      index: true,
    },

    // Adjustment Lines
    lines: {
      type: [
        {
          productId: {
            type: Schema.Types.ObjectId,
            ref: "Product",
            required: [true, "Product is required"],
          },
          productSKU: String,
          productName: String,
          productUnit: String,

          // Quantities
          systemQuantity: {
            type: Number,
            required: [true, "System quantity is required"],
            min: [0, "System quantity cannot be negative"],
            // What the system says we have
          },

          physicalQuantity: {
            type: Number,
            required: [true, "Physical quantity is required"],
            min: [0, "Physical quantity cannot be negative"],
            // What was actually counted/adjusted to
          },

          adjustmentQuantity: {
            type: Number,
            required: [true, "Adjustment quantity is required"],
            // Difference (physical - system)
            // Positive = increase, Negative = decrease
          },

          // Costing
          unitCost: {
            type: Number,
            required: [true, "Unit cost is required"],
            min: [0, "Unit cost cannot be negative"],
          },

          adjustmentValue: {
            type: Number,
            required: [true, "Adjustment value is required"],
            // |adjustmentQuantity| × unitCost
          },

          // Explanation
          reason: {
            type: String,
            required: [true, "Reason is required"],
            trim: true,
          },

          // Linked stock movement
          stockMovementId: {
            type: Schema.Types.ObjectId,
            ref: "StockMovement",
          },
        },
      ],
      validate: {
        validator: function (lines) {
          return lines && lines.length > 0;
        },
        message: "Adjustment must have at least one line item",
      },
    },

    // Totals
    totalAdjustmentValue: {
      type: Number,
      default: 0,
      // Sum of absolute adjustment values
    },

    totalIncreaseValue: {
      type: Number,
      default: 0,
      // Sum of positive adjustments
    },

    totalDecreaseValue: {
      type: Number,
      default: 0,
      // Sum of negative adjustments
    },

    // Accounting Link
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
      index: true,
    },

    // Status
    status: {
      type: String,
      enum: {
        values: ["draft", "approved", "cancelled"],
        message: "{VALUE} is not a valid status",
      },
      default: "draft",
      index: true,
    },

    approvedAt: Date,
    approvedBy: {
      name: String,
      id: String,
    },

    cancelledAt: Date,
    cancelledBy: {
      name: String,
      id: String,
    },
    cancellationReason: String,

    // Details
    description: String,
    notes: String,

    // Reference documents
    referenceNumber: String,
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
// Unique adjustment number per company
inventoryAdjustmentSchema.index({ companyId: 1, adjustmentNumber: 1 }, { unique: true });
// Query indexes - prefixed with companyId for tenant isolation
inventoryAdjustmentSchema.index({ companyId: 1, adjustmentDate: -1, status: 1 });
inventoryAdjustmentSchema.index({ companyId: 1, adjustmentType: 1, status: 1 });
inventoryAdjustmentSchema.index({ companyId: 1, status: 1, createdAt: -1 });

// ============================================
// VIRTUALS
// ============================================
inventoryAdjustmentSchema.virtual("hasIncreases").get(function () {
  return this.lines.some((line) => line.adjustmentQuantity > 0);
});

inventoryAdjustmentSchema.virtual("hasDecreases").get(function () {
  return this.lines.some((line) => line.adjustmentQuantity < 0);
});

inventoryAdjustmentSchema.virtual("netAdjustmentValue").get(function () {
  return this.totalIncreaseValue - this.totalDecreaseValue;
});

// ============================================
// VALIDATION METHODS
// ============================================

/**
 * Validate adjustment lines
 */
inventoryAdjustmentSchema.methods.validateLines = function () {
  for (const line of this.lines) {
    // Validate adjustment quantity calculation
    const expectedAdjustment = line.physicalQuantity - line.systemQuantity;

    if (Math.abs(expectedAdjustment - line.adjustmentQuantity) > 0.001) {
      throw new Error(
        `Adjustment quantity for ${line.productName} incorrect. ` +
          `Expected: ${expectedAdjustment}, Got: ${line.adjustmentQuantity}`
      );
    }

    // Validate adjustment value calculation
    const expectedValue = Math.abs(line.adjustmentQuantity) * line.unitCost;

    if (Math.abs(expectedValue - line.adjustmentValue) > 0.01) {
      throw new Error(
        `Adjustment value for ${line.productName} incorrect. ` +
          `Expected: ${expectedValue.toFixed(2)}, Got: ${line.adjustmentValue}`
      );
    }

    // Validate reason provided
    if (!line.reason || line.reason.trim().length === 0) {
      throw new Error(`Reason required for ${line.productName} adjustment`);
    }
  }

  return true;
};

/**
 * Calculate totals
 */
inventoryAdjustmentSchema.methods.calculateTotals = function () {
  let totalIncrease = 0;
  let totalDecrease = 0;
  let totalValue = 0;

  console.log("calculateTotals - Number of lines:", this.lines.length);

  for (const line of this.lines) {
    console.log("Line:", {
      adjustmentQuantity: line.adjustmentQuantity,
      adjustmentValue: line.adjustmentValue,
    });

    if (line.adjustmentQuantity > 0) {
      totalIncrease += line.adjustmentValue;
    } else if (line.adjustmentQuantity < 0) {
      totalDecrease += line.adjustmentValue;
    }
    totalValue += line.adjustmentValue;
  }

  console.log("Calculated totals:", {
    totalIncrease,
    totalDecrease,
    totalValue,
  });

  this.totalIncreaseValue = totalIncrease;
  this.totalDecreaseValue = totalDecrease;
  this.totalAdjustmentValue = totalValue;

  return {
    totalIncreaseValue: totalIncrease,
    totalDecreaseValue: totalDecrease,
    totalAdjustmentValue: totalValue,
  };
};

/**
 * Validate before approval
 *
 * Accepts an optional session so the product lookups participate in the
 * caller's transaction. Without this, callers that create a product +
 * opening-balance adjustment in one txn would throw "Product not found"
 * because the newly-created product isn't visible to a non-session read.
 */
inventoryAdjustmentSchema.methods.validateBeforeApproval = async function (
  session = null,
) {
  this.validateLines();
  this.calculateTotals();

  // Validate products exist
  const Product = mongoose.model("Product");

  for (const line of this.lines) {
    const product = await Product.findById(line.productId).session(
      session || null,
    );

    if (!product) {
      throw new Error(`Product not found: ${line.productId}`);
    }

    // Cache product details
    line.productSKU = product.SKU;
    line.productName = product.name;
    line.productUnit = product.unit;
  }

  return true;
};

// ============================================
// APPROVE ADJUSTMENT
// ============================================
inventoryAdjustmentSchema.methods.approve = async function (approvedBy, session = null) {
  if (this.status !== "draft") {
    throw new Error(
      `Can only approve draft adjustments. Current status: ${this.status}`
    );
  }

  const userInfo = formatUserForAudit(approvedBy);

  // Validate (pass session so it sees in-txn writes)
  await this.validateBeforeApproval(session);

  // Calculate totals from lines
  this.calculateTotals();

  const Product = mongoose.model("Product");
  const StockMovement = mongoose.model("StockMovement");
  const stockMovements = [];

  try {
    // Process each line
    for (const line of this.lines) {
      if (line.adjustmentQuantity === 0) continue; // Skip no-change lines

      const product = await Product.findById(line.productId).session(session || null);

      if (!product) {
        throw new Error(`Product not found: ${line.productId}`);
      }

      // Adjust inventory
      if (line.adjustmentQuantity > 0) {
        // Increase
        await product.increaseInventory(
          line.adjustmentQuantity,
          line.unitCost,
          `Adjustment ${this.adjustmentNumber} - ${this.adjustmentType}: ${line.reason}`,
          session
        );
      } else {
        // Decrease
        await product.decreaseInventory(
          Math.abs(line.adjustmentQuantity),
          `Adjustment ${this.adjustmentNumber} - ${this.adjustmentType}: ${line.reason}`,
          session
        );
      }

      // Create stock movement
      const movementNumber = await StockMovement.generateMovementNumber(this.companyId);

      const [movement] = await StockMovement.create([{
        companyId: this.companyId, // Tenant scoping
        movementNumber,
        productId: product._id,
        productSnapshot: {
          name: product.name,
          SKU: product.SKU,
          category: product.category,
          unit: product.unit,
        },
        movementType: "adjustment",
        direction: line.adjustmentQuantity > 0 ? "in" : "out",
        quantity: Math.abs(line.adjustmentQuantity),
        previousStock: line.systemQuantity,
        newStock: line.physicalQuantity,
        costing: {
          unitCost: line.unitCost,
          totalCost: line.adjustmentValue,
          averageCostAtMovement: product.costing?.costPrice || 0,
        },
        performedBy: {
          name: userInfo.name,
          id: userInfo.id,
          role: "system",
        },
        relatedDocuments: {
          adjustmentId: this._id,
          adjustmentNumber: this.adjustmentNumber,
        },
        notes: `Adjustment - ${this.adjustmentType}`,
        reason: line.reason,
        status: "posted",
        postedAt: new Date(),
        postedBy: userInfo,
        accounting: {
          affectsAccounting: true,
          accountingPosted: false,
        },
      }], session ? { session } : undefined);

      stockMovements.push(movement);
      line.stockMovementId = movement._id;
    }

    // Create journal entry (may be null if no net change)
    const journalEntry = await this.createJournalEntry(userInfo, session);

    if (journalEntry) {
      this.journalEntryId = journalEntry._id;

      // Update stock movements with journal entry ID
      for (const movement of stockMovements) {
        movement.accounting.journalEntryId = journalEntry._id;
        movement.accounting.accountingPosted = true;
        movement.accounting.accountingPostedAt = new Date();
        await movement.save(session ? { session } : undefined);
      }
    }

    // Update adjustment status
    this.status = "approved";
    this.approvedAt = new Date();
    this.approvedBy = userInfo;
    this.lastModifiedBy = userInfo;

    await this.save(session ? { session } : undefined);

    return this;
  } catch (error) {
    // If a caller-owned session was passed, the outer transaction will
    // abort and roll back every write we made inside it — no manual
    // compensation needed (and running compensating writes here would
    // double-revert, because they'd execute outside the aborting txn).
    if (!session) {
      // Non-transactional path: best-effort rollback of any movements
      // we already wrote before the failure.
      for (const movement of stockMovements) {
        const product = await Product.findById(movement.productId);
        if (product) {
          if (movement.direction === "in") {
            await product.decreaseInventory(
              movement.quantity,
              "Rollback: Adjustment approval failed",
            );
          } else {
            await product.increaseInventory(
              movement.quantity,
              movement.costing.unitCost,
              "Rollback: Adjustment approval failed",
            );
          }
        }
        await StockMovement.findByIdAndDelete(movement._id);
      }
    }

    throw new Error(`Adjustment approval failed: ${error.message}`);
  }
};

// ============================================
// CREATE JOURNAL ENTRY
// ============================================
inventoryAdjustmentSchema.methods.createJournalEntry = async function (user, session = null) {
  if (this.journalEntryId) {
    throw new Error("Journal entry already exists for this adjustment");
  }
  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");

  // Get accounts (tenant-scoped)
  const inventoryAccount = await Account.findOne({
    companyId: this.companyId,
    systemAccount: "inventory",
  }).session(session || null);

  // For opening_balance, the offsetting credit should land in Opening
  // Balance Equity if the tenant's CoA has it (per QuickBooks / Zoho /
  // Odoo convention). If not seeded, fall back to inventory_adjustments
  // so the JE still posts — the tenant can reclassify later.
  let adjustmentAccount = null;
  if (this.adjustmentType === "opening_balance") {
    adjustmentAccount = await Account.findOne({
      companyId: this.companyId,
      systemAccount: "opening_balance_equity",
    }).session(session || null);
  }
  if (!adjustmentAccount) {
    adjustmentAccount = await Account.findOne({
      companyId: this.companyId,
      systemAccount: "inventory_adjustments",
    }).session(session || null);
  }

  if (!inventoryAccount) {
    throw new Error("Inventory account not configured");
  }

  if (!adjustmentAccount) {
    throw new Error(
      "Inventory Adjustment account not configured. Please ensure chart of accounts is seeded."
    );
  }

  const lines = [];

  // Calculate net adjustment (increases - decreases)
  const netValue = this.totalIncreaseValue - this.totalDecreaseValue;

  if (netValue > 0) {
    // Net increase: Debit Inventory, Credit Adjustment Income/Contra
    lines.push(
      {
        accountId: inventoryAccount._id,
        accountCode: inventoryAccount.accountCode,
        accountName: inventoryAccount.accountName,
        accountType: inventoryAccount.accountType,
        debit: netValue,
        credit: 0,
        description: `Inventory increase - ${this.adjustmentType}`,
      },
      {
        accountId: adjustmentAccount._id,
        accountCode: adjustmentAccount.accountCode,
        accountName: adjustmentAccount.accountName,
        accountType: adjustmentAccount.accountType,
        debit: 0,
        credit: netValue,
        description: `Adjustment - ${this.adjustmentType}`,
      }
    );
  } else if (netValue < 0) {
    // Net decrease: Debit Adjustment Expense, Credit Inventory
    const absValue = Math.abs(netValue);
    lines.push(
      {
        accountId: adjustmentAccount._id,
        accountCode: adjustmentAccount.accountCode,
        accountName: adjustmentAccount.accountName,
        accountType: adjustmentAccount.accountType,
        debit: absValue,
        credit: 0,
        description: `Adjustment expense - ${this.adjustmentType}`,
      },
      {
        accountId: inventoryAccount._id,
        accountCode: inventoryAccount.accountCode,
        accountName: inventoryAccount.accountName,
        accountType: inventoryAccount.accountType,
        debit: 0,
        credit: absValue,
        description: `Inventory decrease - ${this.adjustmentType}`,
      }
    );
  } else {
    // No net change (equal increases and decreases)
    // Skip journal entry - no financial impact
    console.log("No net change, skipping journal entry");
    return null;
  }

  // Validate balance
  const totalDebits = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredits = lines.reduce((sum, line) => sum + (line.credit || 0), 0);

  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new Error(
      `Journal entry not balanced! Debits: ${totalDebits}, Credits: ${totalCredits}`
    );
  }

  // Generate entry number (in-session so the uniqueness check sees other
  // entries from this txn, e.g. multiple adjustments in a bulk create).
  const entryNumber = await this.generateUniqueEntryNumber(session);

  // Create journal entry (with tenant scoping)
  const [journalEntry] = await JournalEntry.create([{
    companyId: this.companyId, // Tenant scoping
    entryNumber,
    entryDate: this.adjustmentDate,
    entryType: "adjustment",
    description: `Inventory Adjustment - ${this.adjustmentType} - ${this.adjustmentNumber}`,
    lines,
    relatedDocuments: {
      adjustmentId: this._id,
      adjustmentNumber: this.adjustmentNumber,
    },
    status: "draft",
    createdBy: user,
  }], session ? { session } : undefined);

  // Post journal entry
  await journalEntry.post(user, session);

  return journalEntry;
};

/**
 * Generate unique entry number - delegates to centralized utility
 */
inventoryAdjustmentSchema.methods.generateUniqueEntryNumber = async function (session = null) {
  const { generateUniqueEntryNumber } = await import("@/lib/utils/server-utils");
  return generateUniqueEntryNumber("ADJ", this.companyId, session);
};

/**
 * Cancel adjustment
 */
inventoryAdjustmentSchema.methods.cancel = async function (
  cancelledBy,
  reason
) {
  if (this.status !== "draft") {
    throw new Error("Can only cancel draft adjustments");
  }

  const userInfo = formatUserForAudit(cancelledBy);

  this.status = "cancelled";
  this.cancelledAt = new Date();
  this.cancelledBy = userInfo;
  this.cancellationReason = reason || "No reason provided";
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get adjustments by type
 */
inventoryAdjustmentSchema.statics.getByType = function (
  adjustmentType,
  status = null
) {
  const query = { adjustmentType };

  if (status) {
    query.status = status;
  }

  return this.find(query).sort({ adjustmentDate: -1 }).lean();
};

/**
 * Get adjustments for a period
 */
inventoryAdjustmentSchema.statics.getForPeriod = function (startDate, endDate) {
  return this.find({
    adjustmentDate: { $gte: startDate, $lte: endDate },
    status: "approved",
  })
    .sort({ adjustmentDate: -1 })
    .lean();
};

/**
 * Get adjustment summary by type
 */
inventoryAdjustmentSchema.statics.getSummaryByType = async function (
  startDate,
  endDate
) {
  return this.aggregate([
    {
      $match: {
        adjustmentDate: { $gte: startDate, $lte: endDate },
        status: "approved",
      },
    },
    {
      $group: {
        _id: "$adjustmentType",
        count: { $sum: 1 },
        totalValue: { $sum: "$totalAdjustmentValue" },
        totalIncrease: { $sum: "$totalIncreaseValue" },
        totalDecrease: { $sum: "$totalDecreaseValue" },
      },
    },
    {
      $project: {
        _id: 0,
        adjustmentType: "$_id",
        count: 1,
        totalValue: 1,
        totalIncrease: 1,
        totalDecrease: 1,
        netValue: { $subtract: ["$totalIncrease", "$totalDecrease"] },
      },
    },
    {
      $sort: { totalValue: -1 },
    },
  ]);
};

/**
 * Generate adjustment number with company code prefix
 */
inventoryAdjustmentSchema.statics.generateAdjustmentNumber = async function (companyId = null) {
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

  const year = new Date().getFullYear();

  // Build counter ID with company code for tenant isolation
  const counterId = companyCode
    ? `adj-${companyCode.toLowerCase()}-${year}`
    : `adj-${year}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );

  // Format: ADJ-{CODE}-{YYYY}-{NNNN} or ADJ-{YYYY}-{NNNN}
  const prefix = companyCode ? `ADJ-${companyCode}` : "ADJ";
  return `${prefix}-${year}-${String(counter.seq).padStart(4, "0")}`;
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let InventoryAdjustment = models?.InventoryAdjustment;

if (!InventoryAdjustment) {
  InventoryAdjustment = mongoose.model(
    "InventoryAdjustment",
    inventoryAdjustmentSchema
  );
}

export default InventoryAdjustment;
