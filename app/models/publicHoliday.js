import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// PUBLIC HOLIDAY SCHEMA
// ============================================
// Stores public holidays per company.
// Used by:
//   - Working days calculation in leave requests
//   - Payroll period working-day count
//
// Design:
//   - companyId scoped — each company manages their own holiday calendar
//   - isRecurring: true = applies every year on same month/day (e.g. Christmas)
//   - isRecurring: false = one-off (e.g. election day, special gazette notice)
//   - year field only used when isRecurring = false
// ============================================

const publicHolidaySchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    name: {
      type: String,
      required: [true, "Holiday name is required"],
      trim: true,
    },

    // Day + month (1-based). Year ignored for recurring holidays.
    day: { type: Number, required: true, min: 1, max: 31 },
    month: { type: Number, required: true, min: 1, max: 12 },

    // For one-off holidays (election day, national mourning, etc.)
    year: { type: Number, default: null },

    // true = applies every year on same date
    isRecurring: { type: Boolean, default: true },

    // Audit
    createdBy: { name: String, id: String },
  },
  { timestamps: true }
);

publicHolidaySchema.index({ companyId: 1, month: 1, day: 1 });

// ============================================
// STATIC: get holidays that fall within a date range
// Returns Set of "YYYY-MM-DD" strings for fast O(1) lookup
// ============================================
publicHolidaySchema.statics.getDateSet = async function (companyId, fromDate, toDate) {
  const holidays = await this.find({ companyId }).lean();
  const set = new Set();

  const from = new Date(fromDate);
  const to = new Date(toDate);

  for (const h of holidays) {
    if (h.isRecurring) {
      // Apply to every year in the range
      const startYear = from.getUTCFullYear();
      const endYear = to.getUTCFullYear();
      for (let y = startYear; y <= endYear; y++) {
        const d = new Date(Date.UTC(y, h.month - 1, h.day));
        if (d >= from && d <= to) {
          set.add(d.toISOString().slice(0, 10));
        }
      }
    } else if (h.year) {
      const d = new Date(Date.UTC(h.year, h.month - 1, h.day));
      if (d >= from && d <= to) {
        set.add(d.toISOString().slice(0, 10));
      }
    }
  }
  return set;
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let PublicHoliday = models?.PublicHoliday;
if (!PublicHoliday) {
  PublicHoliday = mongoose.model("PublicHoliday", publicHolidaySchema);
}

export default PublicHoliday;
export { PublicHoliday };
