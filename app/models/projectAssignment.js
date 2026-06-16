import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// PROJECT ASSIGNMENT SCHEMA — the labor roster
// ============================================
// Links a Party (worker: employee | contractor/supplier) to a Project. This is
// the OPERATIONS bridge that works WITHOUT the HR module: a tenant that doesn't
// subscribe to HR can still assign people to a project and cost them through
// expenses/bills tagged with the project + party.
//
// Parent-reference (not an embedded array on Project): a project can have
// hundreds of workers, so we keep them in their own collection — same reasoning
// as LeaveRequest / PayrollEntry. Many-to-many: a party can be on several
// projects, a project has many parties.
//
// Assigning a party posts NO cost. Actual cost flows when the party is paid
// (Expense/Bill with projectId) and is aggregated by computeProjectActuals. The
// `rate` here is operational metadata for estimates and the future payroll join
// (employee.partyId ∈ active assignments → route labor cost to the project).
const projectAssignmentSchema = new Schema(
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

    // Embedded snapshot — the roster stays readable even if the Party is later
    // edited or deactivated. partyId remains the authoritative join key.
    party: {
      partyId: {
        type: Schema.Types.ObjectId,
        ref: "Party",
        required: true,
      },
      name: { type: String, trim: true },
      type: {
        type: String,
        enum: ["employee", "supplier", "both"],
        default: "employee",
      },
    },

    // Free-form so it fits any industry (construction, services, etc.)
    role: { type: String, trim: true, maxlength: 100, default: "" },

    // Optional planned rate — drives estimates + the payroll labor join later.
    rate: {
      amount: { type: Number, min: 0, default: null },
      unit: {
        type: String,
        enum: ["hour", "day", "month", "fixed"],
        default: "day",
      },
    },

    status: {
      type: String,
      enum: ["active", "inactive", "removed"],
      default: "active",
      index: true,
    },

    assignedAt: { type: Date, default: Date.now },
    assignedBy: { name: { type: String }, id: { type: String } },
    removedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

// ============================================
// INDEXES
// ============================================
// Roster of a project (the common read), and "which projects is this party on".
projectAssignmentSchema.index({ companyId: 1, projectId: 1, status: 1 });
projectAssignmentSchema.index({ companyId: 1, "party.partyId": 1, status: 1 });
// A party is assigned to a given project at most once (re-assigning reactivates
// the same row rather than creating a duplicate).
projectAssignmentSchema.index(
  { projectId: 1, "party.partyId": 1 },
  { unique: true },
);

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let ProjectAssignment = models?.ProjectAssignment;

if (!ProjectAssignment) {
  ProjectAssignment = mongoose.model(
    "ProjectAssignment",
    projectAssignmentSchema,
  );
}

export default ProjectAssignment;
export { ProjectAssignment };
