"use server";

import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope, getCompanyIdForCreate } from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";
import PublicHoliday from "@/app/models/publicHoliday";

const ALLOWED = ["SuperAdmin", "Admin", "HR"];

function guard(user) {
  if (!user) return "Not authenticated";
  if (!ALLOWED.includes(user.role)) return "Only Admin or HR can manage public holidays";
  return null;
}

// Kenya standard public holidays — fixed-date recurring holidays per Public Holidays Act Cap. 110
// (as amended April 2024 — Utamaduni Day renamed to Mazingira Day)
//
// NOT included here (must be added as one-off holidays each year):
//   • Good Friday      — computed from Easter formula, varies March/April
//   • Easter Monday    — computed from Easter formula, varies March/April
//   • Idd-ul-Fitr      — gazetted annually after moon sighting, varies
//   • Idd-ul-Azha      — gazetted annually after moon sighting (for persons of Islamic faith)
const KENYA_HOLIDAYS = [
  { name: "New Year's Day",    month: 1,  day: 1  },
  { name: "Labour Day",        month: 5,  day: 1  },
  { name: "Madaraka Day",      month: 6,  day: 1  },
  { name: "Mazingira Day",     month: 10, day: 10 },
  { name: "Mashujaa Day",      month: 10, day: 20 },
  { name: "Jamhuri Day",       month: 12, day: 12 },
  { name: "Christmas Day",     month: 12, day: 25 },
  { name: "Boxing Day",        month: 12, day: 26 },
];

// ============================================
// SEED KENYA DEFAULTS
// ============================================
export async function seedKenyaHolidays() {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    await dbConnect();

    // Only insert holidays that don't already exist
    const existing = await PublicHoliday.find(
      withTenantScope({}, tenantCompanyId, isSuperAdmin)
    ).lean();
    const existingKeys = new Set(existing.map((h) => `${h.month}-${h.day}`));

    const toInsert = KENYA_HOLIDAYS
      .filter((h) => !existingKeys.has(`${h.month}-${h.day}`))
      .map((h) => ({
        companyId: tenantCompanyId,
        name: h.name,
        month: h.month,
        day: h.day,
        isRecurring: true,
        createdBy: { name: user.name, id: user.id },
      }));

    if (toInsert.length === 0) {
      return { success: true, inserted: 0, message: "All Kenya holidays already exist" };
    }

    await PublicHoliday.insertMany(toInsert);
    revalidatePath("/dashboard/settings/public-holidays");
    return { success: true, inserted: toInsert.length };
  } catch (error) {
    return { success: false, error: error.message || "Failed to seed holidays" };
  }
}

// ============================================
// CREATE HOLIDAY
// ============================================
export async function createPublicHoliday(_prevState, formData) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    const name = formData.get("name")?.toString().trim();
    const month = parseInt(formData.get("month") || "0");
    const day = parseInt(formData.get("day") || "0");
    const isRecurring = formData.get("isRecurring") !== "false";
    const year = !isRecurring ? parseInt(formData.get("year") || "0") : null;

    if (!name) return { success: false, error: "Holiday name is required", fieldErrors: { name: "Required" } };
    if (!month || month < 1 || month > 12) return { success: false, error: "Invalid month", fieldErrors: { month: "1–12" } };
    if (!day || day < 1 || day > 31) return { success: false, error: "Invalid day", fieldErrors: { day: "1–31" } };
    if (!isRecurring && (!year || year < 2020)) return { success: false, error: "Valid year required for one-off holidays" };

    await dbConnect();

    await PublicHoliday.create({
      companyId: tenantCompanyId,
      name,
      month,
      day,
      year,
      isRecurring,
      createdBy: { name: user.name, id: user.id },
    });

    revalidatePath("/dashboard/settings/public-holidays");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to create holiday" };
  }
}

// ============================================
// DELETE HOLIDAY
// ============================================
export async function deletePublicHoliday(holidayId) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    await dbConnect();

    const result = await PublicHoliday.deleteOne(
      withTenantScope({ _id: holidayId }, companyId, isSuperAdmin)
    );

    if (result.deletedCount === 0) return { success: false, error: "Holiday not found" };

    revalidatePath("/dashboard/settings/public-holidays");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to delete holiday" };
  }
}
