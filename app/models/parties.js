import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// PARTY SCHEMA - CUSTOMERS, SUPPLIERS & EMPLOYEES
// ============================================
const partySchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Party Type
    type: {
      type: String,
      enum: ["customer", "supplier", "employee", "both"],
      required: [true, "Party type is required"],
      index: true,
    },

    // Link to User (for employees only)
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      sparse: true,
      index: true,
      // Only populated when type = "employee"
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

    // Employee-Specific Fields
    employeeNumber: {
      type: String,
      sparse: true,
      uppercase: true,
    },

    department: {
      type: String,
      // Finance, Sales, Operations, etc.
    },

    designation: {
      type: String,
      // Manager, Accountant, Driver, etc.
    },

    // Contractor Flag (for suppliers who need WHT)
    isContractor: {
      type: Boolean,
      default: false,
      // External contractors (not employees)
    },

    // WHT Settings (for contractors)
    whtApplicable: {
      type: Boolean,
      default: false,
    },

    whtRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 20,
      // Kenya WHT rates: 0%, 5%, 10%, 15%, 20%
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
      // For Customers/Suppliers:
      //   Positive = They owe us (AR)
      //   Negative = We owe them (AP)
      // For Employees:
      //   Positive = Employee owes us (advance not returned)
      //   Negative = We owe employee (reimbursement pending)
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
partySchema.index({ companyId: 1, name: 1 });
partySchema.index({ companyId: 1, type: 1, isActive: 1 });
partySchema.index({ companyId: 1, email: 1 }, { sparse: true });
partySchema.index({ companyId: 1, taxPin: 1 }, { sparse: true });
partySchema.index({ companyId: 1, userId: 1 }, { sparse: true });
// Only enforce uniqueness when employeeNumber is a non-empty string
partySchema.index(
  { companyId: 1, employeeNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      employeeNumber: { $type: "string", $gt: "" }
    }
  }
);

// ============================================
// VIRTUALS
// ============================================
partySchema.virtual("isCustomer").get(function () {
  return this.type === "customer" || this.type === "both";
});

partySchema.virtual("isSupplier").get(function () {
  return this.type === "supplier" || this.type === "both";
});

partySchema.virtual("isEmployee").get(function () {
  return this.type === "employee";
});

// ============================================
// INSTANCE METHODS
// ============================================

// Calculate actual balance from journal entries
partySchema.methods.calculateActualBalance = async function () {
  const JournalEntry = mongoose.model("JournalEntry");
  const Account = mongoose.model("Account");

  const companyId = this.companyId;

  if (this.type === "employee") {
    // For employees, check Employee Advances and Employee Payables (tenant-scoped)
    const advancesAccount = await Account.findOne({
      companyId, systemAccount: "employee_advance",
    });
    const payablesAccount = await Account.findOne({
      companyId, systemAccount: "employee_payables",
    });

    let balance = 0;

    // Calculate advances (asset - employee owes us)
    if (advancesAccount) {
      const advancesResult = await JournalEntry.aggregate([
        {
          $match: {
            status: "posted",
            "party.id": this._id.toString(),
            "party.type": "employee",
          },
        },
        { $unwind: "$lines" },
        {
          $match: {
            "lines.accountId": advancesAccount._id,
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

      if (advancesResult[0]) {
        balance += advancesResult[0].totalDebit - advancesResult[0].totalCredit;
      }
    }

    // Calculate payables (liability - we owe employee)
    if (payablesAccount) {
      const payablesResult = await JournalEntry.aggregate([
        {
          $match: {
            status: "posted",
            "party.id": this._id.toString(),
            "party.type": "employee",
          },
        },
        { $unwind: "$lines" },
        {
          $match: {
            "lines.accountId": payablesAccount._id,
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

      if (payablesResult[0]) {
        balance -= payablesResult[0].totalCredit - payablesResult[0].totalDebit;
      }
    }

    this.cachedBalance = balance;
    this.balanceUpdatedAt = new Date();
    await this.save();

    return balance;
  } else {
    // For customers/suppliers - existing logic (tenant-scoped)
    const arAccount = await Account.findOne({
      companyId, systemAccount: "accounts_receivable",
    });
    const apAccount = await Account.findOne({
      companyId, systemAccount: "accounts_payable",
    });

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

    const arTotal = arBalance[0]
      ? arBalance[0].totalDebit - arBalance[0].totalCredit
      : 0;
    const apTotal = apBalance[0]
      ? apBalance[0].totalCredit - apBalance[0].totalDebit
      : 0;

    // Net balance (positive = they owe us, negative = we owe them)
    const balance = arTotal - apTotal;

    // Update cache
    this.cachedBalance = balance;
    this.balanceUpdatedAt = new Date();
    await this.save();

    return balance;
  }
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

partySchema.statics.getEmployees = function (activeOnly = true) {
  const query = {
    type: "employee",
  };
  if (activeOnly) query.isActive = true;

  return this.find(query).sort({ name: 1 });
};

partySchema.statics.findByUserId = function (userId) {
  return this.findOne({ userId, type: "employee" });
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
