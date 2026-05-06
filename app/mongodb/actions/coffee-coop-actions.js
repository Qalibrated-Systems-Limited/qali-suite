"use server";

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { planIncludes } from "@/lib/plans";
import CoffeeSeason from "@/app/models/coffeeSeason";
import FarmerIntakeEntry from "@/app/models/farmerIntakeEntry";
import { revalidatePath } from "next/cache";

// ============================================
// COFFEE COOP SERVER ACTIONS
// Dashboard data for the coffee coop connector.
// Plan-gated: requires "integration:coffee_coop".
// Role-gated: Admin only.
// ============================================

const ALLOWED_ROLES = [
  "SuperAdmin",
  "Admin",
  "Manager",
  "Procurement Officer",
];

async function getAuthContext() {
  const { user, companyId } = await getTenantContext();
  if (!ALLOWED_ROLES.includes(user.role)) {
    throw new Error("You don't have permission to manage coffee coop settings");
  }
  if (!planIncludes(user.companyPlan, "integration:coffee_coop")) {
    throw new Error("Coffee Coop connector requires an Enterprise plan");
  }
  return { user, companyId };
}

// ── Seasons ───────────────────────────────────────────────

export async function getCoffeeSeasons() {
  try {
    const { companyId } = await getAuthContext();
    await dbConnect();

    const seasons = await CoffeeSeason.find({ companyId })
      .sort({ year: -1, seasonType: 1 })
      .lean();

    return seasons.map((s) => ({
      _id:            s._id.toString(),
      name:           s.name,
      seasonType:     s.seasonType,
      year:           s.year,
      startDate:      s.startDate?.toISOString() ?? null,
      endDate:        s.endDate?.toISOString()   ?? null,
      isActive:       s.isActive,
      targetVolumeKg: s.targetVolumeKg,
      priceSchedule:  s.priceSchedule ?? [],
      notes:          s.notes,
      createdAt:      s.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function createCoffeeSeason(prevState, formData) {
  try {
    const { user, companyId } = await getAuthContext();
    await dbConnect();

    const name       = formData.get("name")?.toString().trim();
    const seasonType = formData.get("seasonType")?.toString();
    const year       = Number(formData.get("year"));
    const isActive   = formData.get("isActive") === "true";

    if (!name)       return { error: "Season name is required" };
    if (!seasonType) return { error: "Season type is required" };
    if (!year)       return { error: "Year is required" };

    // Deactivate other seasons if this one is set active
    if (isActive) {
      await CoffeeSeason.updateMany({ companyId }, { isActive: false });
    }

    await CoffeeSeason.create({
      companyId,
      name,
      seasonType,
      year,
      isActive,
      startDate:      formData.get("startDate")      || null,
      endDate:        formData.get("endDate")        || null,
      targetVolumeKg: Number(formData.get("targetVolumeKg") || 0),
      notes:          formData.get("notes")?.toString().trim() || "",
      createdBy: { id: user.id, name: user.name },
    });

    revalidatePath("/dashboard/integrations/coffee-coop");

    return { success: true };
  } catch (err) {
    return { error: err.message || "Failed to create season" };
  }
}

// ── Intake Entries ────────────────────────────────────────

export async function getCoffeeIntakes({
  seasonId,
  farmerCode,
  grade,
  paymentStatus,
  limit = 100,
} = {}) {
  try {
    const { companyId } = await getAuthContext();
    await dbConnect();

    const query = { companyId };
    if (seasonId)      query.seasonId      = seasonId;
    if (farmerCode)    query.farmerCode    = farmerCode;
    if (grade)         query.grade         = grade;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const entries = await FarmerIntakeEntry.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return entries.map((e) => ({
      _id:                e._id.toString(),
      entryNumber:        e.entryNumber,
      externalRef:        e.externalRef,
      seasonId:           e.seasonId?.toString(),
      seasonName:         e.seasonName,
      farmerCode:         e.farmerCode,
      farmerName:         e.farmerName,
      farmerPhone:        e.farmerPhone,
      coffeeType:         e.coffeeType,
      grade:              e.grade,
      grossWeight:        e.grossWeight,
      moisture:           e.moisture,
      deductionWeight:    e.deductionWeight,
      netWeight:          e.netWeight,
      unitPrice:          e.unitPrice,
      currency:           e.currency,
      totalAmount:        e.totalAmount,
      paymentMethod:      e.paymentMethod,
      paymentStatus:      e.paymentStatus,
      amountPaid:         e.amountPaid,
      journalEntryNumber: e.journalEntryNumber,
      status:             e.status,
      warnings:           e.warnings ?? [],
      notes:              e.notes,
      receivedAt:         e.receivedAt?.toISOString() ?? null,
      createdAt:          e.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}

// ── Stats ─────────────────────────────────────────────────

export async function getCoffeeCoopStats() {
  try {
    const { companyId } = await getAuthContext();
    await dbConnect();

    const [intakeStats, paymentStats, activeSeason] = await Promise.all([
      FarmerIntakeEntry.aggregate([
        { $match: { companyId } },
        {
          $group: {
            _id:          null,
            totalEntries: { $sum: 1 },
            totalNetKg:   { $sum: "$netWeight" },
            totalAmount:  { $sum: "$totalAmount" },
            uniqueFarmers:{ $addToSet: "$farmerCode" },
          },
        },
      ]),
      FarmerIntakeEntry.aggregate([
        { $match: { companyId } },
        {
          $group: {
            _id:        "$paymentStatus",
            count:      { $sum: 1 },
            totalAmount:{ $sum: "$totalAmount" },
            amountPaid: { $sum: "$amountPaid" },
          },
        },
      ]),
      CoffeeSeason.findOne({ companyId, isActive: true }).lean(),
    ]);

    const payMap = {};
    paymentStats.forEach((s) => { payMap[s._id] = s; });

    const pendingAmount = (payMap.pending?.totalAmount ?? 0) + (payMap.partial?.totalAmount ?? 0) - (payMap.partial?.amountPaid ?? 0);

    return {
      totalEntries:   intakeStats[0]?.totalEntries   ?? 0,
      totalNetKg:     intakeStats[0]?.totalNetKg     ?? 0,
      totalAmount:    intakeStats[0]?.totalAmount    ?? 0,
      uniqueFarmers:  intakeStats[0]?.uniqueFarmers?.length ?? 0,
      pendingPayments: payMap.pending?.count ?? 0,
      pendingAmount:  Math.max(0, pendingAmount),
      paidCount:      payMap.paid?.count     ?? 0,
      activeSeason:   activeSeason
        ? { name: activeSeason.name, year: activeSeason.year }
        : null,
    };
  } catch {
    return {
      totalEntries:   0,
      totalNetKg:     0,
      totalAmount:    0,
      uniqueFarmers:  0,
      pendingPayments: 0,
      pendingAmount:  0,
      paidCount:      0,
      activeSeason:   null,
    };
  }
}
