import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// BUDGET LINE SCHEMA
// ============================================
const budgetLineSchema = new Schema(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
    },
    accountCode: { type: String, trim: true },
    accountName: { type: String, trim: true },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

// ============================================
// PROJECT BUDGET SCHEMA
// ============================================
const projectBudgetSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },

    version: {
      type: Number,
      required: true,
      default: 1,
    },

    status: {
      type: String,
      enum: ["draft", "approved", "superseded"],
      default: "draft",
    },

    lines: [budgetLineSchema],

    totalAmount: { type: Number, default: 0 },

    // Approval
    approvedBy: {
      name: { type: String },
      id: { type: String },
    },
    approvedAt: { type: Date },
    revisionNotes: { type: String, trim: true, maxlength: 1000, default: "" },

    // Audit
    createdBy: {
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
projectBudgetSchema.index({ companyId: 1, projectId: 1, version: -1 });
projectBudgetSchema.index({ companyId: 1, projectId: 1, status: 1 });

// ============================================
// PRE-SAVE: Calculate totalAmount
// ============================================
projectBudgetSchema.pre("save", function () {
  if (this.isModified("lines")) {
    this.totalAmount = this.lines.reduce((sum, line) => sum + line.amount, 0);
  }
});

// ============================================
// METHOD: Approve budget
// ============================================
projectBudgetSchema.methods.approve = async function (user, session = null) {
  if (this.status !== "draft") {
    throw new Error("Only draft budgets can be approved");
  }

  const Project = mongoose.model("Project");

  // Supersede any previously approved budget for this project
  await this.constructor.updateMany(
    {
      companyId: this.companyId,
      projectId: this.projectId,
      status: "approved",
      _id: { $ne: this._id },
    },
    { $set: { status: "superseded" } },
    session ? { session } : {},
  );

  // Approve this budget
  this.status = "approved";
  this.approvedBy = { name: user.name, id: user.id };
  this.approvedAt = new Date();
  await this.save({ session });

  // Sync totalAmount to project.budget.amount
  await Project.findByIdAndUpdate(
    this.projectId,
    { $set: { "budget.amount": this.totalAmount } },
    session ? { session } : {},
  );

  return this;
};

// ============================================
// STATIC: Get latest approved budget for a project
// ============================================
projectBudgetSchema.statics.getApprovedBudget = async function (
  projectId,
  companyId,
) {
  return this.findOne({
    companyId,
    projectId,
    status: "approved",
  })
    .sort({ version: -1 })
    .lean();
};

// ============================================
// STATIC: Get next version number for a project
// ============================================
projectBudgetSchema.statics.getNextVersion = async function (
  projectId,
  companyId,
) {
  const latest = await this.findOne({
    companyId,
    projectId,
  })
    .sort({ version: -1 })
    .select("version")
    .lean();

  return (latest?.version || 0) + 1;
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let ProjectBudget = models?.ProjectBudget;

if (!ProjectBudget) {
  ProjectBudget = mongoose.model("ProjectBudget", projectBudgetSchema);
}

export default ProjectBudget;
export { ProjectBudget };
