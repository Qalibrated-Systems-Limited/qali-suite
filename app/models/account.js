import {
  accountSubType,
  accountSystemTypes,
  accountTypes,
} from "../../lib/utils";
import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// ACCOUNT SCHEMA - CHART OF ACCOUNTS
// ============================================
const accountSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Basic Information
    accountCode: {
      type: String,
      required: [true, "Account code is required"],
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
        values: accountTypes,
        message: "{VALUE} is not a valid account type",
      },
      index: true,
    },

    subType: {
      type: String,
      enum: accountSubType,
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
      enum: accountSystemTypes,
      default: null,
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
  },
);

// ============================================
// COMPOUND INDEXES FOR QUERY EFFICIENCY
// ============================================
// Unique account code per company
accountSchema.index({ companyId: 1, accountCode: 1 }, { unique: true });
// Unique system account per company (only when systemAccount is set)
accountSchema.index(
  { companyId: 1, systemAccount: 1 },
  {
    unique: true,
    partialFilterExpression: { systemAccount: { $type: "string" } },
  },
);
// Query indexes
accountSchema.index({ companyId: 1, accountType: 1, isActive: 1 });
accountSchema.index({ companyId: 1, canPost: 1, isActive: 1 });
accountSchema.index({ companyId: 1, ancestors: 1 }); // Critical for hierarchy queries

// In Account schema, add a pre-remove hook
accountSchema.pre("remove", function (next) {
  if (this.systemAccount) {
    throw new Error(
      `Cannot delete system account: ${this.accountName}. This account is required for system operation.`,
    );
  }
});

// Also add a method to check if account can be deleted
accountSchema.methods.canDelete = function () {
  // Cannot delete if:
  // 1. It's a system account
  if (this.systemAccount) {
    return {
      canDelete: false,
      reason: "System account - required for system operation",
    };
  }

  // 2. It has child accounts
  // (Check would require async, so return true for now)

  // 3. It has transactions
  // (Check would require async, so return true for now)

  return {
    canDelete: true,
    reason: null,
  };
};

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
    companyId: this.companyId,
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
export { Account };
