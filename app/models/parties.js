import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// PARTY SCHEMA - CUSTOMERS & SUPPLIERS
// ============================================
const partySchema = new Schema(
  {
    // Party Type
    type: {
      type: String,
      enum: ["customer", "supplier", "both"],
      required: [true, "Party type is required"],
      index: true,
    },

    // Basic Information
    name: {
      type: String,
      required: [true, "Party name is required"],
      trim: true,
      index: true,
    },

    displayName: {
      type: String,
      // For invoices/reports (e.g., "KTDA" instead of "Kenya Tea Development Agency")
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },

    phone: {
      type: String,
      trim: true,
    },

    // Tax Information
    taxPin: {
      type: String,
      trim: true,
      uppercase: true,
      // KRA PIN format: A000000000X
    },

    // Address
    address: {
      line1: String,
      line2: String,
      city: String,
      postalCode: String,
      country: { type: String, default: "Kenya" },
    },

    // Financial Settings
    defaultCurrency: {
      type: String,
      default: "KES",
      uppercase: true,
    },

    // Credit Terms (for customers)
    creditTerms: {
      creditLimit: {
        type: Number,
        default: 0,
        min: 0,
      },
      paymentTermsDays: {
        type: Number,
        default: 30, // Net 30
        min: 0,
      },
    },

    // Payment Details (for suppliers)
    paymentDetails: {
      bankName: String,
      accountNumber: String,
      branch: String,
      swiftCode: String,
    },

    // Balances (Cached - NOT source of truth!)
    cachedBalance: {
      type: Number,
      default: 0,
      // Positive = They owe us (AR)
      // Negative = We owe them (AP)
    },

    balanceUpdatedAt: Date,

    // Status
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Audit Trail
    createdBy: {
      name: String,
      id: String,
    },

    lastModifiedBy: {
      name: String,
      id: String,
    },

    notes: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================
// INDEXES FOR QUERY EFFICIENCY
// ============================================
partySchema.index({ name: 1 });
partySchema.index({ type: 1, isActive: 1 });
partySchema.index({ email: 1 }, { sparse: true });
partySchema.index({ taxPin: 1 }, { sparse: true });

// ============================================
// VIRTUALS
// ============================================
partySchema.virtual("isCustomer").get(function () {
  return this.type === "customer" || this.type === "both";
});

partySchema.virtual("isSupplier").get(function () {
  return this.type === "supplier" || this.type === "both";
});

// ============================================
// INSTANCE METHODS
// ============================================

// Calculate actual balance from journal entries
partySchema.methods.calculateActualBalance = async function () {
  const JournalEntry = mongoose.model("JournalEntry");
  const Account = mongoose.model("Account");

  // Get AR and AP accounts
  const arAccount = await Account.findOne({ systemAccount: "accounts_receivable" });
  const apAccount = await Account.findOne({ systemAccount: "accounts_payable" });

  if (!arAccount || !apAccount) {
    throw new Error("AR/AP accounts not configured");
  }

  // Calculate AR balance (they owe us)
  const arBalance = await JournalEntry.aggregate([
    {
      $match: {
        status: "posted",
        "party.id": this._id.toString(),
        "party.type": "customer",
      },
    },
    { $unwind: "$lines" },
    {
      $match: {
        "lines.accountId": arAccount._id,
      },
    },
    {
      $group: {
        _id: null,
        totalDebit: { $sum: "$lines.debit" },
        totalCredit: { $sum: "$lines.credit" },
      },
    },
  ]);

  // Calculate AP balance (we owe them)
  const apBalance = await JournalEntry.aggregate([
    {
      $match: {
        status: "posted",
        "party.id": this._id.toString(),
        "party.type": "supplier",
      },
    },
    { $unwind: "$lines" },
    {
      $match: {
        "lines.accountId": apAccount._id,
      },
    },
    {
      $group: {
        _id: null,
        totalDebit: { $sum: "$lines.debit" },
        totalCredit: { $sum: "$lines.credit" },
      },
    },
  ]);

  const arTotal = arBalance[0] ? arBalance[0].totalDebit - arBalance[0].totalCredit : 0;
  const apTotal = apBalance[0] ? apBalance[0].totalCredit - apBalance[0].totalDebit : 0;

  // Net balance (positive = they owe us, negative = we owe them)
  const balance = arTotal - apTotal;

  // Update cache
  this.cachedBalance = balance;
  this.balanceUpdatedAt = new Date();
  await this.save();

  return balance;
};

// ============================================
// STATIC METHODS
// ============================================

partySchema.statics.getCustomers = function (activeOnly = true) {
  const query = {
    type: { $in: ["customer", "both"] },
  };
  if (activeOnly) query.isActive = true;

  return this.find(query).sort({ name: 1 });
};

partySchema.statics.getSuppliers = function (activeOnly = true) {
  const query = {
    type: { $in: ["supplier", "both"] },
  };
  if (activeOnly) query.isActive = true;

  return this.find(query).sort({ name: 1 });
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Party = models?.Party;

if (!Party) {
  Party = mongoose.model("Party", partySchema);
}

export default Party;