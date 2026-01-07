import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// ACCOUNT SCHEMA - CHART OF ACCOUNTS
// ============================================
const accountSchema = new Schema(
  {
    // Basic Information
    accountCode: {
      type: String,
      required: [true, "Account code is required"],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    accountName: {
      type: String,
      required: [true, "Account name is required"],
      trim: true,
      index: true,
    },

    // Account Classification
    accountType: {
      type: String,
      required: [true, "Account type is required"],
      enum: {
        values: ["asset", "liability", "equity", "revenue", "expense"],
        message: "{VALUE} is not a valid account type",
      },
      index: true,
    },

    subType: {
      type: String,
      enum: [
        // Assets
        "cash",
        "bank",
        "accounts_receivable",
        "inventory",
        "fixed_asset",
        "other_current_asset",
        "other_asset",

        // Liabilities
        "accounts_payable",
        "loan",
        "tax_payable",
        "other_current_liability",
        "other_liability",

        // Equity
        "owner_equity",
        "retained_earnings",
        "drawings",

        // Revenue
        "sales",
        "service_revenue",
        "other_income",

        // Expenses
        "cogs",
        "operating_expense",
        "other_expense",
      ],
      index: true,
    },

    // Hierarchical Structure
    parentAccount: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      default: null,
      index: true,
    },

    ancestors: [
      {
        type: Schema.Types.ObjectId,
        ref: "Account",
      },
    ],

    path: {
      type: String,
      default: "",
      index: true,
    },

    level: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    // Posting Control
    canPost: {
      type: Boolean,
      default: true,
      index: true,
    },

    // System Integration
    systemAccount: {
      type: String,
      enum: [
        null,
        "cash",
        "bank_main",
        "mpesa",
        "accounts_receivable",
        "accounts_payable",
        "inventory",
        "sales_revenue",
        "service_revenue",
        "cogs",
        "vat_payable",
        "retained_earnings",
      ],
      default: null,
      unique: true,
      sparse: true,
      index: true,
    },

    // Financial Details
    currency: {
      type: String,
      default: "KES",
      uppercase: true,
    },

    // Balance Caching (NOT source of truth!)
    cachedBalance: {
      type: Number,
      default: 0,
    },

    balanceUpdatedAt: Date,

    // Bank Account Details
    bankDetails: {
      bankName: String,
      accountNumber: String,
      branch: String,
      swiftCode: String,
    },

    // Status
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    description: String,

    // Tax Configuration
    taxable: {
      type: Boolean,
      default: false,
    },

    defaultTaxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
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
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================
// COMPOUND INDEXES FOR QUERY EFFICIENCY
// ============================================
accountSchema.index({ accountType: 1, isActive: 1 });
accountSchema.index({ canPost: 1, isActive: 1 });
accountSchema.index({ ancestors: 1 }); // Critical for hierarchy queries

// ============================================
// VIRTUALS
// ============================================
accountSchema.virtual("normalBalanceSide").get(function () {
  return ["asset", "expense"].includes(this.accountType) ? "debit" : "credit";
});

accountSchema.virtual("isHeader").get(function () {
  return !this.canPost;
});

// ============================================
// INSTANCE METHODS
// ============================================

// Calculate actual balance from journal entries
accountSchema.methods.calculateActualBalance = async function () {
  const JournalEntry = mongoose.model("JournalEntry");

  const result = await JournalEntry.aggregate([
    { $match: { status: "posted" } },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": this._id } },
    {
      $group: {
        _id: null,
        totalDebit: { $sum: "$lines.debit" },
        totalCredit: { $sum: "$lines.credit" },
      },
    },
  ]);

  if (result.length === 0) return 0;

  const { totalDebit, totalCredit } = result[0];

  const balance =
    this.normalBalanceSide === "debit"
      ? totalDebit - totalCredit
      : totalCredit - totalDebit;

  // Update cache
  this.cachedBalance = balance;
  this.balanceUpdatedAt = new Date();
  await this.save();

  return balance;
};

// Get balance including descendants
accountSchema.methods.getBalanceWithChildren = async function () {
  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");

  const descendants = await Account.find({
    ancestors: this._id,
    canPost: true,
    isActive: true,
  });

  const accountIds = [this._id, ...descendants.map((d) => d._id)];

  const result = await JournalEntry.aggregate([
    { $match: { status: "posted" } },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": { $in: accountIds } } },
    {
      $group: {
        _id: null,
        totalDebit: { $sum: "$lines.debit" },
        totalCredit: { $sum: "$lines.credit" },
      },
    },
  ]);

  if (result.length === 0) return 0;

  const { totalDebit, totalCredit } = result[0];

  return this.normalBalanceSide === "debit"
    ? totalDebit - totalCredit
    : totalCredit - totalDebit;
};

// ============================================
// STATIC METHODS
// ============================================

accountSchema.statics.getRootAccounts = function () {
  return this.find({
    parentAccount: null,
    isActive: true,
  }).sort({ accountCode: 1 });
};

accountSchema.statics.getPostableAccounts = function (filters = {}) {
  return this.find({
    canPost: true,
    isActive: true,
    ...filters,
  }).sort({ accountCode: 1 });
};

accountSchema.statics.getSystemAccount = function (systemAccountName) {
  return this.findOne({
    systemAccount: systemAccountName,
    isActive: true,
  });
};

accountSchema.statics.getByType = function (accountType) {
  return this.find({
    accountType,
    isActive: true,
  }).sort({ accountCode: 1 });
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Account = models?.Account;

if (!Account) {
  Account = mongoose.model("Account", accountSchema);
}

export default Account;
