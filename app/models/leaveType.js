import mongoose from "mongoose";

const leaveTypeSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    code: { type: String, required: true }, // e.g., "annual", "sick", "bereavement"
    name: { type: String, required: true }, // e.g., "Annual Leave", "Sick Leave"
    defaultEntitlement: { type: Number, default: 0 }, // default days per year
    maxCarryOver: { type: Number, default: 0 }, // max days that can carry to next year
    paidLeave: { type: Boolean, default: true }, // paid or unpaid
    requiresDocument: { type: Boolean, default: false }, // e.g., sick leave needs medical cert
    applicableGender: {
      type: String,
      enum: ["all", "male", "female"],
      default: "all",
    }, // maternity=female, paternity=male
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false }, // seeded default, can't be deleted
    sortOrder: { type: Number, default: 0 },
    description: String,
  },
  { timestamps: true }
);

leaveTypeSchema.index({ companyId: 1, code: 1 }, { unique: true });
leaveTypeSchema.index({ companyId: 1, isActive: 1 });

// Seed default Kenya leave types for a company
leaveTypeSchema.statics.seedDefaults = async function (companyId) {
  const existing = await this.countDocuments({ companyId });
  if (existing > 0) return;

  const defaults = [
    { code: "annual", name: "Annual Leave", defaultEntitlement: 21, maxCarryOver: 5, paidLeave: true, applicableGender: "all", sortOrder: 0 },
    { code: "sick", name: "Sick Leave", defaultEntitlement: 30, maxCarryOver: 0, paidLeave: true, requiresDocument: true, applicableGender: "all", sortOrder: 1 },
    { code: "maternity", name: "Maternity Leave", defaultEntitlement: 90, maxCarryOver: 0, paidLeave: true, applicableGender: "female", sortOrder: 2 },
    { code: "paternity", name: "Paternity Leave", defaultEntitlement: 14, maxCarryOver: 0, paidLeave: true, applicableGender: "male", sortOrder: 3 },
    { code: "compassionate", name: "Compassionate Leave", defaultEntitlement: 5, maxCarryOver: 0, paidLeave: true, applicableGender: "all", sortOrder: 4 },
    { code: "unpaid", name: "Leave Without Pay", defaultEntitlement: 0, maxCarryOver: 0, paidLeave: false, applicableGender: "all", sortOrder: 5 },
  ];

  await this.insertMany(defaults.map((d) => ({ ...d, companyId, isDefault: true })));
};

export default mongoose.models.LeaveType || mongoose.model("LeaveType", leaveTypeSchema);
