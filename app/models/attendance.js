import mongoose from "mongoose";

// ============================================
// ATTENDANCE MODEL
// ============================================
// One record per employee per day.
// Tracks clock-in / clock-out, shift, method, status, overtime.
//
// Status transitions:
//   No record      → absent (after EOD batch)
//   checkIn only   → present / late (if after lateThreshold)
//   checkIn+Out    → present / late / half-day
//   HR override    → any status
//
// Standard shift: 8 hours (configurable per company via standardHours field)
// Late threshold: after 09:15 local time
// ============================================

const { Schema, model, models } = mongoose;

const AttendanceSchema = new Schema(
  {
    // ── Tenant ────────────────────────────────
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },

    // ── Employee (snapshot — avoid $lookup on list queries) ──
    profileId:      { type: Schema.Types.ObjectId, ref: "EmployeeProfile", required: true },
    partyId:        { type: Schema.Types.ObjectId, ref: "Party" },
    employeeName:   { type: String },
    employeeNumber: { type: String },
    department:     { type: String },

    // ── Date & Shift ──────────────────────────
    // date: midnight UTC — used as the unique day key
    date:           { type: Date, required: true },
    shift:          { type: String, enum: ["morning", "afternoon", "night", "custom"], default: "morning" },
    // Expected start time as HH:MM (used to compute "late")
    shiftStart:     { type: String, default: "08:00" },
    // Standard working hours for this shift (for overtime calc)
    standardHours:  { type: Number, default: 8 },

    // ── Clock-In / Out ────────────────────────
    checkIn:        { type: Date },
    checkOut:       { type: Date },
    hoursWorked:    { type: Number, default: 0 },   // calculated on checkOut
    overtime:       { type: Number, default: 0 },   // max(0, hoursWorked - standardHours)
    overtimePay:    { type: Number, default: 0 },   // computed when payroll runs (rate × overtime hours)

    // ── Status ────────────────────────────────
    // present   — clocked in (on time or late)
    // absent    — no clock-in (set by EOD batch or manual)
    // late      — clocked in after shiftStart + 15 min grace
    // half-day  — worked < standardHours / 2 or explicit mark
    // on-leave  — leave approved for this day (set during leave approval)
    // holiday   — public holiday
    status: {
      type: String,
      enum: ["present", "absent", "late", "half-day", "on-leave", "holiday"],
      default: "absent",
    },

    // ── Method ────────────────────────────────
    method: {
      type: String,
      enum: ["web", "mobile", "qr", "biometric", "manual"],
      default: "web",
    },

    // ── Audit ─────────────────────────────────
    ipAddress:  { type: String },                   // web/mobile clock-in
    location:   {                                   // optional GPS
      lat: Number,
      lng: Number,
      accuracy: Number,
    },
    notes:      { type: String },                   // HR override reason
    markedAbsentAt: { type: Date },                 // when EOD batch ran

    // Set by the stale-clock-in sweep when an employee forgot to clock out
    // and the record was auto-closed at shiftEnd. Visible on detail UIs so
    // HR can investigate / correct via manual entry.
    autoClosedOut:  { type: Boolean, default: false },
    autoClosedAt:   { type: Date },

    // ── Modifications ─────────────────────────
    // Track if an HR admin overrode the record
    overriddenBy: {
      name: String,
      id: { type: Schema.Types.ObjectId },
    },
    overriddenAt: { type: Date },
  },
  {
    timestamps: true,
    collection: "attendance",
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────
// Primary lookup: employee + date (unique — one record per employee per day)
AttendanceSchema.index({ profileId: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ companyId: 1, date: 1 });               // daily roster
AttendanceSchema.index({ companyId: 1, profileId: 1, date: -1 }); // employee history

// ── Virtuals ───────────────────────────────────────────────────────────────
AttendanceSchema.virtual("dateStr").get(function () {
  return this.date?.toISOString().slice(0, 10) || "";
});

// ── Statics ────────────────────────────────────────────────────────────────

// getSummary(companyId, profileId, from, to)
// Returns { daysPresent, daysAbsent, daysLate, daysOnLeave, totalHours, totalOvertime }
AttendanceSchema.statics.getSummary = async function (companyId, profileId, from, to) {
  const records = await this.find({
    companyId,
    profileId,
    date: { $gte: from, $lte: to },
  })
    .select("status hoursWorked overtime")
    .lean();

  const summary = {
    daysPresent: 0,
    daysAbsent: 0,
    daysLate: 0,
    daysOnLeave: 0,
    daysHalfDay: 0,
    totalHours: 0,
    totalOvertime: 0,
  };
  for (const r of records) {
    if (r.status === "present") summary.daysPresent++;
    else if (r.status === "absent") summary.daysAbsent++;
    else if (r.status === "late") { summary.daysPresent++; summary.daysLate++; }
    else if (r.status === "on-leave") summary.daysOnLeave++;
    else if (r.status === "half-day") summary.daysHalfDay++;
    summary.totalHours += r.hoursWorked || 0;
    summary.totalOvertime += r.overtime || 0;
  }
  return summary;
};

const Attendance = models.Attendance || model("Attendance", AttendanceSchema);
export default Attendance;
