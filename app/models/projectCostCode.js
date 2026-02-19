import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// PROJECT COST CODE SCHEMA
// ============================================
const projectCostCodeSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    code: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    // Optional — scope to a single project, or leave null for company-wide codes
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      default: null,
    },

    isActive: { type: Boolean, default: true },

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
projectCostCodeSchema.index(
  { companyId: 1, code: 1, projectId: 1 },
  { unique: true },
);
projectCostCodeSchema.index({ companyId: 1, isActive: 1 });
projectCostCodeSchema.index({ companyId: 1, projectId: 1 });

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let ProjectCostCode = models?.ProjectCostCode;

if (!ProjectCostCode) {
  ProjectCostCode = mongoose.model("ProjectCostCode", projectCostCodeSchema);
}

export default ProjectCostCode;
export { ProjectCostCode };
