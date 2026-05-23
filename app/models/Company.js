import mongoose from "mongoose";
import validator from "validator";

const Schema = mongoose.Schema;

// ============================================
// COMPANY SCHEMA - MULTI-TENANT CONFIGURATION
// ============================================
// Each company represents a tenant in the system.
// All transactional data (invoices, bills, products, etc.)
// will be linked to a company via companyId.
// ============================================

const companySchema = new Schema(
  {
    // ============================================
    // BASIC INFORMATION
    // ============================================
    name: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      maxLength: [100, "Company name cannot exceed 100 characters"],
    },

    // Short code used in document numbers (e.g., JE-QSL-REC-0001)
    code: {
      type: String,
      required: [true, "Company code is required"],
      trim: true,
      uppercase: true,
      minLength: [2, "Company code must be at least 2 characters"],
      maxLength: [6, "Company code cannot exceed 6 characters"],
      match: [/^[A-Z0-9]+$/, "Company code must be alphanumeric"],
      unique: true,
      index: true,
    },

    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    tagline: {
      type: String,
      trim: true,
      maxLength: [200, "Tagline cannot exceed 200 characters"],
    },

    logo: {
      type: String, // URL or path to logo
      trim: true,
    },

    // ============================================
    // CONTACT INFORMATION
    // ============================================
    email: {
      type: String,
      required: [true, "Company email is required"],
      validate: [validator.isEmail, "Please enter a valid email address"],
      trim: true,
      lowercase: true,
    },

    phone: {
      type: String,
      trim: true,
    },

    website: {
      type: String,
      trim: true,
    },

    // ============================================
    // ADDRESS
    // ============================================
    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      postalCode: { type: String, trim: true },
      country: { type: String, trim: true, default: "Kenya" },
    },

    // Full address for display on documents
    fullAddress: {
      type: String,
      trim: true,
    },

    // ============================================
    // TAX & LEGAL
    // ============================================
    taxPin: {
      type: String, // KRA PIN for Kenya
      trim: true,
      uppercase: true,
    },

    vatNumber: {
      type: String,
      trim: true,
    },

    registrationNumber: {
      type: String, // Business registration number
      trim: true,
    },

    // ============================================
    // BANKING DETAILS (for invoices/payments)
    // ============================================
    bankName: {
      type: String,
      trim: true,
    },

    bankBranch: {
      type: String,
      trim: true,
    },

    accountName: {
      type: String,
      trim: true,
    },

    accountNumber: {
      type: String,
      trim: true,
    },

    swiftCode: {
      type: String,
      trim: true,
    },

    // ============================================
    // MOBILE MONEY (M-Pesa for Kenya)
    // ============================================
    mpesaPaybill: {
      type: String,
      trim: true,
    },

    mpesaTill: {
      type: String,
      trim: true,
    },

    // ============================================
    // SUBSCRIPTION & BILLING
    // ============================================
    subscription: {
      plan: {
        type: String,
        enum: ["free", "starter", "professional", "enterprise"],
        default: "free",
      },
      status: {
        type: String,
        enum: ["active", "trial", "expired", "cancelled"],
        default: "trial",
      },
      trialEndsAt: Date,
      currentPeriodStart: Date,
      currentPeriodEnd: Date,
      maxUsers: {
        type: Number,
        default: 2, // matches free plan in lib/plans.js (-1 = unlimited)
      },
    },

    // ============================================
    // COMPANY SETTINGS
    // ============================================
    settings: {
      // Currency & Locale
      currency: {
        type: String,
        default: "KES",
      },
      currencySymbol: {
        type: String,
        default: "KES",
      },
      locale: {
        type: String,
        default: "en-KE",
      },
      timezone: {
        type: String,
        default: "Africa/Nairobi",
      },

      // Tax Settings
      defaultVatRate: {
        type: Number,
        default: 16, // 16% VAT in Kenya
      },
      enableWithholdingTax: {
        type: Boolean,
        default: true,
      },
      defaultWhtRate: {
        type: Number,
        default: 5, // 5% WHT
      },

      // ── Inventory / Receiving (SOP §10.1) ─────────────────────────────
      // Industry-standard three-way match: when ON, Bill approval no
      // longer credits inventory — instead it posts to the GR/IR clearing
      // account. Goods are admitted to physical stock only when a Goods
      // Receipt Note is created and accepted by Sales + Finance. The GRN
      // accept clears GR/IR with DR Inventory / CR GR/IR.
      // Default OFF for backward compatibility with existing tenants;
      // new audited / industrial tenants should turn this ON.
      requireGRN: {
        type: Boolean,
        default: false,
      },

      // Fiscal Year
      fiscalYearStart: {
        type: Number, // Month (1-12)
        default: 1, // January
      },

      // Document Numbering
      invoicePrefix: {
        type: String,
        default: "INV",
      },
      invoiceNextNumber: {
        type: Number,
        default: 1,
      },
      billPrefix: {
        type: String,
        default: "BILL",
      },
      billNextNumber: {
        type: Number,
        default: 1,
      },
      quotePrefix: {
        type: String,
        default: "QT",
      },
      quoteNextNumber: {
        type: Number,
        default: 1,
      },
      poPrefix: {
        type: String,
        default: "PO",
      },
      poNextNumber: {
        type: Number,
        default: 1,
      },

      // Inventory Settings
      defaultCostingMethod: {
        type: String,
        enum: ["average", "fifo", "lifo"],
        default: "average",
      },
      lowStockThreshold: {
        type: Number,
        default: 10,
      },

      // Payment Terms
      defaultPaymentTerms: {
        type: String,
        default: "Net 30",
      },
      defaultPaymentTermsDays: {
        type: Number,
        default: 30,
      },

      // Draft Invoice Expiry
      // Number of days a draft invoice can hold committed stock
      // After expiry, stock is auto-released back to available
      draftInvoiceExpiryDays: {
        type: Number,
        default: 14, // Industry standard: 14 days
        min: [1, "Draft expiry must be at least 1 day"],
        max: [90, "Draft expiry cannot exceed 90 days"],
      },

      // Fixed Asset capitalization policy.
      // Items below this amount are treated as expense rather than capitalized.
      // 0 disables the policy entirely (no warning shown). Soft policy — the
      // user is warned but can override.
      capitalizationThreshold: {
        type: Number,
        default: 0,
        min: [0, "Threshold cannot be negative"],
      },

      // ──────────────────────────────────────────
      // APPROVAL THRESHOLDS
      // ──────────────────────────────────────────
      // Per-company-configurable rules driving the approval engine.
      // Replaces hardcoded constants in the action layer so finance teams
      // can tune authority for their risk appetite without code changes.
      approvalThresholds: {
        // Stock adjustments at or below this absolute KES value can be
        // auto-approved by Store Manager / Accountant. Above this they
        // route through the approval engine. 0 = always require approval.
        stockAdjustmentValue: {
          type: Number,
          default: 50_000,
          min: [0, "Threshold cannot be negative"],
        },

        // Stock requests at or below this KES value can be approved by
        // any approver (Manager / Store Manager / Admin / SuperAdmin).
        // Above this, only senior approval is accepted (Admin / CFO /
        // SuperAdmin). Default tracks `billPaymentValue` — same audit
        // weight as cutting a cheque.
        stockRequestValue: {
          type: Number,
          default: 100_000,
          min: [0, "Threshold cannot be negative"],
        },

        // Adjustment types ALWAYS routed through approval engine
        // regardless of value. These are audit-sensitive and irreversible.
        stockHighRiskTypes: {
          type: [String],
          default: ["theft", "write_off", "expiry"],
        },

        // Minimum margin% — selling prices below this floor require
        // approval (or override authority). 0 disables. Industry typical
        // is 5–10% depending on sector.
        minimumMarginPercent: {
          type: Number,
          default: 8,
          min: [0, "Cannot be negative"],
          max: [100, "Cannot exceed 100%"],
        },

        // Customer credit notes / refunds at or below this value can be
        // issued by Sales Manager directly. Above this, finance approval.
        creditNoteValue: {
          type: Number,
          default: 25_000,
          min: [0],
        },

        // Bill payment release threshold — amounts above this need finance
        // sign-off before payment is recorded (industry "two-eyes" rule).
        billPaymentValue: {
          type: Number,
          default: 100_000,
          min: [0],
        },

        // Discount cap — sales discounts above this % require approval.
        discountCapPercent: {
          type: Number,
          default: 15,
          min: [0],
          max: [100],
        },
      },
    },

    // ============================================
    // FEATURE FLAGS (which modules are enabled)
    // ============================================
    features: {
      inventory: { type: Boolean, default: true },
      sales: { type: Boolean, default: true },
      purchases: { type: Boolean, default: true },
      accounting: { type: Boolean, default: true },
      expenses: { type: Boolean, default: true },
      reports: { type: Boolean, default: true },
      multiCurrency: { type: Boolean, default: false },
      advancedReporting: { type: Boolean, default: false },
      apiAccess: { type: Boolean, default: false },
    },

    // ============================================
    // STATUS
    // ============================================
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
      index: true,
    },

    // ============================================
    // AUDIT TRAIL
    // ============================================
    createdBy: {
      name: { type: String },
      id: { type: String },
    },
    lastModifiedBy: {
      name: { type: String },
      id: { type: String },
    },
  },
  {
    timestamps: true,
  },
);

// ============================================
// INDEXES
// ============================================
companySchema.index({ name: 1 });
companySchema.index({ "subscription.status": 1 });
companySchema.index({ status: 1, "subscription.status": 1 });

// ============================================
// PRE-SAVE HOOKS
// ============================================
companySchema.pre("save", function (next) {
  // Auto-generate slug from name if not provided
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  // Build full address from address components
  if (this.address) {
    const parts = [
      this.address.street,
      this.address.city,
      this.address.state,
      this.address.postalCode,
      this.address.country,
    ].filter(Boolean);
    this.fullAddress = parts.join(", ");
  }
});

// ============================================
// INSTANCE METHODS
// ============================================

// Get next document number and increment
companySchema.methods.getNextInvoiceNumber = async function () {
  const prefix = this.settings.invoicePrefix;
  const number = this.settings.invoiceNextNumber;
  this.settings.invoiceNextNumber = number + 1;
  await this.save();
  return `${prefix}-${String(number).padStart(5, "0")}`;
};

companySchema.methods.getNextBillNumber = async function () {
  const prefix = this.settings.billPrefix;
  const number = this.settings.billNextNumber;
  this.settings.billNextNumber = number + 1;
  await this.save();
  return `${prefix}-${String(number).padStart(5, "0")}`;
};

companySchema.methods.getNextQuoteNumber = async function () {
  const prefix = this.settings.quotePrefix;
  const number = this.settings.quoteNextNumber;
  this.settings.quoteNextNumber = number + 1;
  await this.save();
  return `${prefix}-${String(number).padStart(5, "0")}`;
};

companySchema.methods.getNextPONumber = async function () {
  const prefix = this.settings.poPrefix;
  const number = this.settings.poNextNumber;
  this.settings.poNextNumber = number + 1;
  await this.save();
  return `${prefix}-${String(number).padStart(5, "0")}`;
};

// Check if subscription is active
companySchema.methods.isSubscriptionActive = function () {
  if (this.subscription.status === "active") return true;
  if (this.subscription.status === "trial") {
    return new Date() < this.subscription.trialEndsAt;
  }
  return false;
};

// Check if feature is enabled
companySchema.methods.hasFeature = function (featureName) {
  return this.features[featureName] === true;
};

// ============================================
// STATIC METHODS
// ============================================

// Find active companies
companySchema.statics.findActive = function () {
  return this.find({ status: "active" });
};

// Find by slug
companySchema.statics.findBySlug = function (slug) {
  return this.findOne({ slug: slug.toLowerCase() });
};

// ============================================
// VIRTUALS
// ============================================
companySchema.virtual("isActive").get(function () {
  return this.status === "active" && this.isSubscriptionActive();
});

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Company = models?.Company;

if (!Company) {
  Company = mongoose.model("Company", companySchema);
}

export default Company;
