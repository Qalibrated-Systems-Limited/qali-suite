import mongoose from "mongoose";
import { ErpCounter } from "./erp-counter";
import "./Company";

const Schema = mongoose.Schema;

// ============================================
// PROJECT SCHEMA
// ============================================
const projectSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    projectNumber: {
      type: String,
      required: true,
      trim: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    // Client
    client: {
      partyId: { type: Schema.Types.ObjectId, ref: "Party" },
      name: { type: String, trim: true },
      email: { type: String, trim: true },
    },

    // Ownership
    projectManager: {
      userId: { type: Schema.Types.ObjectId, ref: "User" },
      name: { type: String, trim: true },
    },

    // Hierarchy (optional — for subprojects)
    parentProjectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      default: null,
    },

    // Billing
    billingModel: {
      type: String,
      enum: ["fixed", "milestone", "time_material"],
      default: null,
    },

    contractValue: { type: Number, default: null },

    // Progress
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },

    // Lifecycle
    status: {
      type: String,
      enum: ["planning", "active", "on_hold", "completed", "closed"],
      default: "planning",
      index: true,
    },

    startDate: { type: Date },
    endDate: { type: Date },
    actualEndDate: { type: Date },

    // Budget (advisory — warn but don't block)
    budget: {
      amount: { type: Number, default: 0 },
      currency: { type: String, default: "KES" },
    },

    // Cached financials (updated on transaction post)
    financials: {
      totalRevenue: { type: Number, default: 0 },
      totalCosts: { type: Number, default: 0 },
      totalCommitted: { type: Number, default: 0 },
    },

    // Metadata
    tags: [{ type: String, trim: true }],
    priority: {
      type: String,
      enum: ["low", "normal", "high", "critical"],
      default: "normal",
    },

    // Audit
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
projectSchema.index({ companyId: 1, projectNumber: 1 }, { unique: true });
projectSchema.index({ companyId: 1, status: 1 });
projectSchema.index({ companyId: 1, "client.partyId": 1 });
projectSchema.index({ companyId: 1, "projectManager.userId": 1 });
projectSchema.index({ companyId: 1, parentProjectId: 1 });

// ============================================
// VIRTUALS
// ============================================
projectSchema.virtual("budgetUtilization").get(function () {
  if (!this.budget?.amount || this.budget.amount === 0) return 0;
  const used = this.financials.totalCosts + this.financials.totalCommitted;
  return Math.round((used / this.budget.amount) * 100);
});

projectSchema.virtual("margin").get(function () {
  return this.financials.totalRevenue - this.financials.totalCosts;
});

projectSchema.virtual("marginPercent").get(function () {
  if (!this.financials.totalRevenue || this.financials.totalRevenue === 0)
    return 0;
  return Math.round(
    ((this.financials.totalRevenue - this.financials.totalCosts) /
      this.financials.totalRevenue) *
      100,
  );
});

// ============================================
// STATIC: Generate Project Number
// ============================================
projectSchema.statics.generateProjectNumber = async function (
  companyId = null,
  session = null,
) {
  const Company = mongoose.model("Company");

  let companyCode = null;
  if (companyId) {
    const company = await Company.findById(companyId)
      .select("code name")
      .session(session)
      .lean();
    if (company) {
      companyCode =
        company.code || deriveCompanyCode(company.name);
    }
  }

  const date = new Date();
  const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;

  const prefix = companyCode
    ? `PRJ-${companyCode}-${yearMonth}`
    : `PRJ-${yearMonth}`;

  const counterId = companyCode
    ? `prj-${companyCode.toLowerCase()}-${yearMonth}`
    : `prj-${yearMonth}`;

  const seq = await ErpCounter.getNextSequence(counterId, companyId, session);
  return `${prefix}-${String(seq).padStart(4, "0")}`;
};

// ============================================
// HELPER: Derive company code from name
// ============================================
function deriveCompanyCode(name) {
  if (!name) return null;
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return words
      .slice(0, 4)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  } else {
    return name.slice(0, 3).toUpperCase();
  }
}

// ============================================
// STATUS TRANSITIONS
// ============================================
const VALID_TRANSITIONS = {
  planning: ["active"],
  active: ["on_hold", "completed"],
  on_hold: ["active"],
  completed: ["closed"],
  closed: [],
};

projectSchema.methods.canTransitionTo = function (newStatus) {
  const allowed = VALID_TRANSITIONS[this.status] || [];
  return allowed.includes(newStatus);
};

projectSchema.methods.transitionTo = async function (newStatus, user) {
  if (!this.canTransitionTo(newStatus)) {
    throw new Error(
      `Cannot transition from "${this.status}" to "${newStatus}"`,
    );
  }

  this.status = newStatus;
  this.lastModifiedBy = user;

  if (newStatus === "completed" || newStatus === "closed") {
    this.actualEndDate = new Date();
  }

  await this.save();
  return this;
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Project = models?.Project;

if (!Project) {
  Project = mongoose.model("Project", projectSchema);
}

export default Project;
export { Project };
