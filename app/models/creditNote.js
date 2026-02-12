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
// CREDIT NOTE SCHEMA
// ============================================
const creditNoteSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Credit Note Identification
    creditNoteNumber: {
      type: String,
      required: [true, "Credit note number is required"],
      index: true,
    },

    creditNoteDate: {
      type: Date,
      required: [true, "Credit note date is required"],
      default: Date.now,
      index: true,
    },

    // ============================================
    // RELATED INVOICE (Required)
    // ============================================
    invoice: {
      id: {
        type: Schema.Types.ObjectId,
        ref: "Invoice",
        required: [true, "Invoice ID is required"],
        index: true,
      },
      invoiceNumber: {
        type: String,
        required: [true, "Invoice number is required"],
      },
      invoiceDate: Date,
      originalTotal: Number,
    },

    // Customer (cached from invoice)
    customer: {
      id: {
        type: String,
        required: [true, "Customer ID is required"],
        index: true,
      },
      name: {
        type: String,
        required: [true, "Customer name is required"],
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

    // ============================================
    // CREDIT NOTE REASON
    // ============================================
    reason: {
      type: String,
      enum: [
        "return",           // Goods returned
        "damaged",          // Goods damaged
        "overcharge",       // Price correction (overcharged)
        "cancellation",     // Partial/full cancellation
        "discount",         // Post-sale discount
        "defective",        // Defective goods
        "other",            // Other reason
      ],
      required: [true, "Reason is required"],
    },

    reasonDescription: {
      type: String,
      required: [true, "Reason description is required"],
      trim: true,
    },

    // ============================================
    // CREDIT NOTE ITEMS
    // ============================================
    items: {
      type: [
        {
          // Reference to original invoice item
          originalItemIndex: Number,

          // Item type
          itemType: {
            type: String,
            enum: ["product", "service"],
            required: true,
          },

          // Product reference (for products only)
          productId: {
            type: Schema.Types.ObjectId,
            ref: "Product",
          },
          productSKU: String,
          productName: String,

          // Description
          description: {
            type: String,
            required: [true, "Description is required"],
            trim: true,
          },

          unit: {
            type: String,
            default: "pcs",
          },

          // Quantity being credited
          quantity: {
            type: Number,
            required: [true, "Quantity is required"],
            min: [0.001, "Quantity must be greater than zero"],
          },

          // Original values (for reference)
          originalQuantity: Number,
          originalUnitPrice: Number,

          // Credit values
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

          // Tax
          taxRate: {
            type: Number,
            default: 16,
            min: 0,
            max: 100,
          },

          taxAmount: {
            type: Number,
            default: 0,
            min: 0,
          },

          // Inventory adjustment
          restoreInventory: {
            type: Boolean,
            default: false,
          },
        },
      ],
      validate: {
        validator: function (items) {
          return items && items.length > 0;
        },
        message: "Credit note must have at least one item",
      },
    },

    // ============================================
    // AMOUNTS
    // ============================================
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

    // ============================================
    // APPLICATION STATUS
    // ============================================
    status: {
      type: String,
      enum: ["draft", "issued", "applied", "void"],
      default: "draft",
      index: true,
    },

    // Amount that has been applied to invoices/payments
    amountApplied: {
      type: Number,
      default: 0,
      min: 0,
    },

    amountRemaining: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ============================================
    // ACCOUNTING LINKS
    // ============================================
    accounting: {
      // Main credit note journal entry (reverses revenue)
      journalEntryId: {
        type: Schema.Types.ObjectId,
        ref: "JournalEntry",
        index: true,
      },

      // Inventory restoration journal entry (if applicable)
      inventoryJournalEntryId: {
        type: Schema.Types.ObjectId,
        ref: "JournalEntry",
      },

      accountingComplete: {
        type: Boolean,
        default: false,
      },

      accountingCompletedAt: Date,
    },

    // ============================================
    // AUDIT TRAIL
    // ============================================
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

    issuedAt: Date,
    issuedBy: {
      name: String,
      id: String,
    },

    voidedAt: Date,
    voidedBy: {
      name: String,
      id: String,
    },
    voidReason: String,

    notes: String,
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
creditNoteSchema.index({ companyId: 1, creditNoteNumber: 1 }, { unique: true });
creditNoteSchema.index({ companyId: 1, creditNoteDate: -1, status: 1 });
creditNoteSchema.index({ companyId: 1, "customer.id": 1, status: 1 });
creditNoteSchema.index({ companyId: 1, "invoice.id": 1 });

// ============================================
// VIRTUALS
// ============================================
creditNoteSchema.virtual("isFullyApplied").get(function () {
  return this.amountRemaining <= 0.01;
});

// ============================================
// METHODS
// ============================================

/**
 * Calculate amounts from items
 */
creditNoteSchema.methods.calculateAmounts = function () {
  let subtotal = 0;
  let totalTax = 0;

  for (const item of this.items) {
    // Calculate item amount
    item.amount = item.quantity * item.unitPrice;
    subtotal += item.amount;

    // Calculate item tax
    if (item.taxRate > 0) {
      item.taxAmount = (item.amount * item.taxRate) / 100;
      totalTax += item.taxAmount;
    }
  }

  this.subtotal = subtotal;
  this.taxAmount = totalTax;
  this.total = subtotal + totalTax;
  this.amountRemaining = this.total - this.amountApplied;

  return this;
};

/**
 * Issue credit note (create journal entries, update invoice)
 */
creditNoteSchema.methods.issue = async function (issuedBy) {
  if (this.status !== "draft") {
    throw new Error(`Can only issue draft credit notes. Current status: ${this.status}`);
  }

  const userInfo = formatUserForAudit(issuedBy);
  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");
  const Invoice = mongoose.model("Invoice");
  const Product = mongoose.model("Product");
  const StockMovement = mongoose.model("StockMovement");

  // Get accounts
  const arAccount = await Account.findOne({
    companyId: this.companyId,
    systemAccount: "accounts_receivable",
  });
  const revenueAccount = await Account.findOne({
    companyId: this.companyId,
    systemAccount: "sales_revenue",
  });
  const vatOutputAccount = await Account.findOne({
    companyId: this.companyId,
    systemAccount: "vat_output",
  });
  const inventoryAccount = await Account.findOne({
    companyId: this.companyId,
    systemAccount: "inventory",
  });
  const cogsAccount = await Account.findOne({
    companyId: this.companyId,
    systemAccount: "cogs",
  });

  if (!arAccount || !revenueAccount) {
    throw new Error("Required accounts not configured");
  }

  // Generate entry number
  const { generateUniqueEntryNumber } = await import("@/lib/utils/server-utils");
  const entryNumber = await generateUniqueEntryNumber("CN", this.companyId);

  // ============================================
  // 1. CREATE CREDIT NOTE JOURNAL ENTRY
  // (Reverse of revenue entry)
  // Dr: Revenue (reduce revenue)
  // Dr: VAT Output (reduce VAT liability)
  // Cr: Accounts Receivable (reduce customer balance)
  // ============================================
  const lines = [];

  // Debit: Revenue
  lines.push({
    accountId: revenueAccount._id,
    accountCode: revenueAccount.accountCode,
    accountName: revenueAccount.accountName,
    accountType: revenueAccount.accountType,
    debit: this.subtotal,
    credit: 0,
    description: `Credit note - ${this.reasonDescription}`,
  });

  // Debit: VAT Output (if applicable)
  if (this.taxAmount > 0 && vatOutputAccount) {
    lines.push({
      accountId: vatOutputAccount._id,
      accountCode: vatOutputAccount.accountCode,
      accountName: vatOutputAccount.accountName,
      accountType: vatOutputAccount.accountType,
      debit: this.taxAmount,
      credit: 0,
      description: `VAT on credit note`,
    });
  }

  // Credit: Accounts Receivable
  lines.push({
    accountId: arAccount._id,
    accountCode: arAccount.accountCode,
    accountName: arAccount.accountName,
    accountType: arAccount.accountType,
    debit: 0,
    credit: this.total,
    description: `Credit to ${this.customer.name}`,
  });

  // Create journal entry
  const journalEntry = await JournalEntry.create({
    companyId: this.companyId,
    entryNumber,
    entryDate: this.creditNoteDate,
    entryType: "credit_note",
    description: `Credit Note ${this.creditNoteNumber} - ${this.invoice.invoiceNumber}`,
    lines,
    party: {
      type: "customer",
      id: this.customer.id,
      name: this.customer.name,
    },
    relatedDocuments: {
      creditNoteId: this._id,
      creditNoteNumber: this.creditNoteNumber,
      invoiceId: this.invoice.id,
      invoiceNumber: this.invoice.invoiceNumber,
    },
    status: "draft",
    createdBy: userInfo,
  });

  await journalEntry.post(userInfo);
  this.accounting.journalEntryId = journalEntry._id;

  // ============================================
  // 2. RESTORE INVENTORY (if applicable)
  // Dr: Inventory
  // Cr: COGS
  // ============================================
  const productItems = this.items.filter(
    (item) => item.itemType === "product" && item.restoreInventory && item.productId
  );

  if (productItems.length > 0 && inventoryAccount && cogsAccount) {
    let totalCOGS = 0;
    const stockMovements = [];

    for (const item of productItems) {
      const product = await Product.findById(item.productId);
      if (product) {
        const costPrice = product.costing?.costPrice || 0;
        const lineCOGS = item.quantity * costPrice;
        totalCOGS += lineCOGS;

        // Restore inventory
        await product.increaseInventory(
          item.quantity,
          costPrice,
          `Returned - Credit Note ${this.creditNoteNumber}`
        );

        // Create stock movement
        const movementNumber = await StockMovement.generateMovementNumber(this.companyId);
        const movement = await StockMovement.create({
          companyId: this.companyId,
          movementNumber,
          productId: product._id,
          productSnapshot: {
            name: product.name,
            SKU: product.SKU,
            category: product.category,
            unit: product.unit,
          },
          movementType: "return",
          direction: "in",
          quantity: item.quantity,
          previousStock: product.inventory.quantityOnHand - item.quantity,
          newStock: product.inventory.quantityOnHand,
          costing: {
            unitCost: costPrice,
            totalCost: lineCOGS,
          },
          performedBy: userInfo,
          relatedDocuments: {
            creditNoteId: this._id,
            invoiceId: this.invoice.id,
          },
          notes: `Return from Credit Note ${this.creditNoteNumber}`,
          reason: this.reasonDescription,
          status: "posted",
          postedAt: new Date(),
          postedBy: userInfo,
        });

        stockMovements.push(movement);
      }
    }

    // Create inventory journal entry if we have COGS to reverse
    if (totalCOGS > 0) {
      const invEntryNumber = await generateUniqueEntryNumber("COGS-REV", this.companyId);

      const invLines = [
        {
          accountId: inventoryAccount._id,
          accountCode: inventoryAccount.accountCode,
          accountName: inventoryAccount.accountName,
          accountType: inventoryAccount.accountType,
          debit: totalCOGS,
          credit: 0,
          description: `Inventory restored from returns`,
        },
        {
          accountId: cogsAccount._id,
          accountCode: cogsAccount.accountCode,
          accountName: cogsAccount.accountName,
          accountType: cogsAccount.accountType,
          debit: 0,
          credit: totalCOGS,
          description: `COGS reversal for returns`,
        },
      ];

      const invJournalEntry = await JournalEntry.create({
        companyId: this.companyId,
        entryNumber: invEntryNumber,
        entryDate: this.creditNoteDate,
        entryType: "credit_note",
        description: `COGS Reversal - Credit Note ${this.creditNoteNumber}`,
        lines: invLines,
        relatedDocuments: {
          creditNoteId: this._id,
          creditNoteNumber: this.creditNoteNumber,
        },
        status: "draft",
        createdBy: userInfo,
      });

      await invJournalEntry.post(userInfo);
      this.accounting.inventoryJournalEntryId = invJournalEntry._id;

      // Update stock movements with journal entry ID
      for (const movement of stockMovements) {
        movement.accounting = movement.accounting || {};
        movement.accounting.journalEntryId = invJournalEntry._id;
        movement.accounting.accountingPosted = true;
        await movement.save();
      }
    }
  }

  // ============================================
  // 3. UPDATE INVOICE
  // ============================================
  const invoice = await Invoice.findById(this.invoice.id);
  if (invoice) {
    // Add credit note to invoice tracking
    invoice.creditNotes = invoice.creditNotes || [];
    invoice.creditNotes.push({
      creditNoteId: this._id,
      creditNoteNumber: this.creditNoteNumber,
      amount: this.total,
      date: this.creditNoteDate,
    });

    // Reduce the amount due on the invoice
    invoice.amountDue = Math.max(0, invoice.amountDue - this.total);

    // Update payment status if fully credited
    if (invoice.amountDue <= 0.01) {
      invoice.paymentStatus = "paid";
    } else if (invoice.amountDue < invoice.total) {
      invoice.paymentStatus = "partial";
    }

    await invoice.save();
  }

  // ============================================
  // 4. UPDATE CREDIT NOTE STATUS
  // ============================================
  this.status = "issued";
  this.issuedAt = new Date();
  this.issuedBy = userInfo;
  this.amountRemaining = this.total;
  this.accounting.accountingComplete = true;
  this.accounting.accountingCompletedAt = new Date();

  await this.save();

  return this;
};

/**
 * Void credit note (reverse all entries)
 */
creditNoteSchema.methods.void = async function (voidedBy, reason) {
  if (this.status === "void") {
    throw new Error("Credit note is already voided");
  }

  if (this.amountApplied > 0) {
    throw new Error("Cannot void credit note that has been applied to payments");
  }

  const userInfo = formatUserForAudit(voidedBy);
  const JournalEntry = mongoose.model("JournalEntry");
  const Invoice = mongoose.model("Invoice");

  // Reverse journal entries
  if (this.accounting?.journalEntryId) {
    const je = await JournalEntry.findById(this.accounting.journalEntryId);
    if (je && je.status === "posted") {
      await je.reverse(userInfo, reason || "Credit note voided");
    }
  }

  if (this.accounting?.inventoryJournalEntryId) {
    const je = await JournalEntry.findById(this.accounting.inventoryJournalEntryId);
    if (je && je.status === "posted") {
      await je.reverse(userInfo, reason || "Credit note voided");
    }
  }

  // Restore invoice amounts
  const invoice = await Invoice.findById(this.invoice.id);
  if (invoice) {
    invoice.creditNotes = (invoice.creditNotes || []).filter(
      (cn) => cn.creditNoteId.toString() !== this._id.toString()
    );

    invoice.amountDue = Math.min(invoice.total, invoice.amountDue + this.total);

    // Recalculate payment status
    if (invoice.amountDue >= invoice.total) {
      invoice.paymentStatus = "unpaid";
    } else if (invoice.amountDue > 0) {
      invoice.paymentStatus = "partial";
    }

    await invoice.save();
  }

  // Update status
  this.status = "void";
  this.voidedAt = new Date();
  this.voidedBy = userInfo;
  this.voidReason = reason || "No reason provided";

  await this.save();

  return this;
};

// ============================================
// STATICS
// ============================================
creditNoteSchema.statics.generateCreditNoteNumber = async function (companyId) {
  const { generateUniqueEntryNumber } = await import("@/lib/utils/server-utils");
  return generateUniqueEntryNumber("CN", companyId);
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let CreditNote = models?.CreditNote;

if (!CreditNote) {
  CreditNote = mongoose.model("CreditNote", creditNoteSchema);
}

export default CreditNote;
