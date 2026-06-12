"use server";

import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
  getCompanyIdForCreate,
} from "@/lib/utils/tenant-utils";
import { roleAllowed } from "@/lib/permissions";
import Kpi from "@/app/models/kpi";
import KpiSnapshot from "@/app/models/kpiSnapshot";
import Account from "@/app/models/account";
import JournalEntry from "@/app/models/JournalEntry";
import EmployeeProfile from "@/app/models/employeeProfile";
import PayrollRun from "@/app/models/payrollRun";
import Invoice from "@/app/models/invoice";
import { KPI_TEMPLATES } from "@/app/dashboard/kpis/lib/kpi-templates";

const ObjectId = mongoose.Types.ObjectId;

// ============================================
// ROLE AUTHORIZATION
// ============================================
// KPI definition is a managerial concern — restrict to leadership roles.
// Snapshot entry can be more permissive (anyone with access to the data).
const KPI_ROLES = {
  MANAGE: ["SuperAdmin", "Admin", "CEO", "Manager", "CFO", "HR"],
  ENTER_SNAPSHOT: ["SuperAdmin", "Admin", "CEO", "Manager", "CFO", "HR", "Accountant"],
};

function guard(user, allowed) {
  if (!user) return "Not authenticated";
  if (!roleAllowed(user.role, allowed)) return "Not permitted";
  return null;
}

// ============================================
// VALIDATION
// ============================================
const CATEGORIES = ["financial", "operational", "hr", "customer", "compliance"];
const SOURCES = [
  "manual",
  "monthly_revenue",
  "monthly_payroll_cost",
  "ar_days_outstanding",
  "cash_position",
  "active_headcount",
  "gross_margin_percent",
  "opex_ratio",
  "payroll_to_revenue_ratio",
  "avg_order_value",
];
const UNITS = ["currency", "percentage", "days", "count", "ratio"];
const DIRECTIONS = ["higher_is_better", "lower_is_better"];
const PERIODICITIES = ["monthly", "quarterly", "yearly"];

function parseKpiFormData(formData) {
  const name = formData.get("name")?.toString().trim();
  const description = formData.get("description")?.toString().trim() || "";
  const category = formData.get("category")?.toString();
  const source = formData.get("source")?.toString() || "manual";
  const unit = formData.get("unit")?.toString() || "currency";
  const periodicity = formData.get("periodicity")?.toString() || "monthly";
  const target = parseFloat(formData.get("target") || "NaN");
  const targetDirection = formData.get("targetDirection")?.toString() || "higher_is_better";

  // Custom thresholds — submitted as percentages (e.g. "95" for 95%); stored as ratios.
  // Empty/blank means "use defaults".
  const parsePct = (key) => {
    const raw = formData.get(key)?.toString().trim();
    if (!raw) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n / 100 : null;
  };
  const onTargetThreshold = parsePct("onTargetThreshold");
  const nearTargetThreshold = parsePct("nearTargetThreshold");

  const statusLabelOnTarget = formData.get("statusLabelOnTarget")?.toString().trim() || "";
  const statusLabelNearTarget = formData.get("statusLabelNearTarget")?.toString().trim() || "";
  const statusLabelOffTarget = formData.get("statusLabelOffTarget")?.toString().trim() || "";

  // Owner — three accepted shapes from the form:
  //   1. ownerPartyId set → look up EmployeeProfile, snapshot { partyId, profileId, name, employeeNumber }
  //   2. ownerUserId set → snapshot { userId, name }
  //   3. just ownerName → free text only (for tenants without HR / non-employee owners)
  const ownerPartyId = formData.get("ownerPartyId")?.toString().trim() || "";
  const ownerUserId = formData.get("ownerUserId")?.toString().trim() || "";
  const ownerName = formData.get("ownerName")?.toString().trim() || "";

  const errors = {};
  if (!name) errors.name = "Name is required";
  else if (name.length > 80) errors.name = "Name must be 80 characters or less";

  if (!CATEGORIES.includes(category)) errors.category = "Invalid category";
  if (!SOURCES.includes(source)) errors.source = "Invalid source";
  if (!UNITS.includes(unit)) errors.unit = "Invalid unit";
  if (!PERIODICITIES.includes(periodicity)) errors.periodicity = "Invalid periodicity";
  if (!DIRECTIONS.includes(targetDirection)) errors.targetDirection = "Invalid direction";
  if (Number.isNaN(target)) errors.target = "Target must be a number";

  // Threshold sanity: if both supplied, on-target should be stricter than near-target.
  // Sense depends on direction.
  if (onTargetThreshold != null && nearTargetThreshold != null) {
    const isLowerBetter = targetDirection === "lower_is_better";
    if (isLowerBetter && onTargetThreshold > nearTargetThreshold) {
      errors.nearTargetThreshold = "Near-target must be greater than on-target for lower-is-better";
    }
    if (!isLowerBetter && onTargetThreshold < nearTargetThreshold) {
      errors.nearTargetThreshold = "Near-target must be lower than on-target for higher-is-better";
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data: {
      name,
      description,
      category,
      source,
      unit,
      periodicity,
      target,
      targetDirection,
      onTargetThreshold,
      nearTargetThreshold,
      statusLabelOnTarget,
      statusLabelNearTarget,
      statusLabelOffTarget,
      ownerPartyId,
      ownerUserId,
      ownerName,
    },
  };
}

// Build the owner sub-doc from parsed form data. If a partyId is provided,
// snapshot name + employeeNumber from EmployeeProfile so the list view
// doesn't need to $lookup. If only a free-text name is provided, just store
// that. Returns undefined if no owner info at all.
async function buildOwnerSubdoc(companyId, isSuperAdmin, parsed) {
  const { ownerPartyId, ownerUserId, ownerName } = parsed;

  if (ownerPartyId) {
    const profile = await EmployeeProfile.findOne(
      withTenantScope({ partyId: new ObjectId(ownerPartyId) }, companyId, isSuperAdmin)
    )
      .select("partyId employeeNumber personalInfo.firstName personalInfo.lastName")
      .lean();

    if (profile) {
      const fullName = [profile.personalInfo?.firstName, profile.personalInfo?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      return {
        partyId: profile.partyId,
        profileId: profile._id,
        userId: ownerUserId ? new ObjectId(ownerUserId) : undefined,
        name: ownerName || fullName,
        employeeNumber: profile.employeeNumber,
      };
    }
    // partyId provided but no matching EmployeeProfile — fall through to name-only owner
  }

  if (ownerUserId) {
    return {
      userId: new ObjectId(ownerUserId),
      name: ownerName || null,
    };
  }

  if (ownerName) {
    return { name: ownerName };
  }

  return undefined;
}

// ============================================
// CREATE KPI
// ============================================
// On success the action does a server-side redirect to the new KPI's detail
// page — Next 16 pattern. `redirect()` lives outside the try/catch because
// it works by throwing NEXT_REDIRECT, which Next's framework catches; if
// we caught it here we'd swallow the navigation.
export async function createKpi(_prev, formData) {
  let newKpiId = null;
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user, KPI_ROLES.MANAGE);
    if (err) return { success: false, error: err };

    const parsed = parseKpiFormData(formData);
    if (!parsed.valid) {
      return { success: false, error: "Please fix the highlighted fields", fieldErrors: parsed.errors };
    }
    const d = parsed.data;

    await dbConnect();

    const tenantId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    const owner = await buildOwnerSubdoc(companyId, isSuperAdmin, d);

    const kpi = await Kpi.create({
      companyId: tenantId,
      name: d.name,
      description: d.description,
      category: d.category,
      source: d.source,
      unit: d.unit,
      periodicity: d.periodicity,
      target: d.target,
      targetDirection: d.targetDirection,
      customThresholds: {
        onTargetThreshold: d.onTargetThreshold,
        nearTargetThreshold: d.nearTargetThreshold,
      },
      statusLabels: {
        onTarget: d.statusLabelOnTarget || null,
        nearTarget: d.statusLabelNearTarget || null,
        offTarget: d.statusLabelOffTarget || null,
      },
      owner,
      isActive: true,
      createdBy: { name: user.name, id: user.id },
    });

    revalidatePath("/dashboard/kpis");
    newKpiId = kpi._id.toString();
  } catch (error) {
    console.error("createKpi:", error);
    return { success: false, error: error.message || "Failed to create KPI" };
  }
  redirect(`/dashboard/kpis/${newKpiId}`);
}

// ============================================
// UPDATE KPI
// ============================================
// Same redirect-from-action pattern as createKpi — Next 16 idiom. On any
// validation/DB error we return state; on success we fall through to the
// redirect at the bottom (which throws NEXT_REDIRECT, hence outside the try).
export async function updateKpi(kpiId, _prev, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user, KPI_ROLES.MANAGE);
    if (err) return { success: false, error: err };

    const parsed = parseKpiFormData(formData);
    if (!parsed.valid) {
      return { success: false, error: "Please fix the highlighted fields", fieldErrors: parsed.errors };
    }
    const d = parsed.data;

    await dbConnect();

    const kpi = await Kpi.findOne(withTenantScope({ _id: kpiId }, companyId, isSuperAdmin));
    if (!kpi) return { success: false, error: "KPI not found" };

    const owner = await buildOwnerSubdoc(companyId, isSuperAdmin, d);

    kpi.name = d.name;
    kpi.description = d.description;
    kpi.category = d.category;
    kpi.source = d.source;
    kpi.unit = d.unit;
    kpi.periodicity = d.periodicity;
    kpi.target = d.target;
    kpi.targetDirection = d.targetDirection;
    kpi.customThresholds = {
      onTargetThreshold: d.onTargetThreshold,
      nearTargetThreshold: d.nearTargetThreshold,
    };
    kpi.statusLabels = {
      onTarget: d.statusLabelOnTarget || null,
      nearTarget: d.statusLabelNearTarget || null,
      offTarget: d.statusLabelOffTarget || null,
    };
    kpi.owner = owner;
    kpi.lastModifiedBy = { name: user.name, id: user.id };
    await kpi.save();

    revalidatePath("/dashboard/kpis");
    revalidatePath(`/dashboard/kpis/${kpiId}`);
  } catch (error) {
    console.error("updateKpi:", error);
    return { success: false, error: error.message || "Failed to update KPI" };
  }
  redirect(`/dashboard/kpis/${kpiId}`);
}

// ============================================
// UPDATE TARGET ONLY
// ============================================
// Lightweight action for the inline "edit target" affordance on the detail
// page. Doesn't touch any other field — historical snapshots keep the
// targetAtTime they were recorded against; only future snapshots use the
// new value.
export async function updateKpiTarget(kpiId, newTarget) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user, KPI_ROLES.MANAGE);
    if (err) return { success: false, error: err };

    const target = parseFloat(newTarget);
    if (!Number.isFinite(target)) {
      return { success: false, error: "Target must be a number" };
    }

    await dbConnect();
    const kpi = await Kpi.findOne(withTenantScope({ _id: kpiId }, companyId, isSuperAdmin));
    if (!kpi) return { success: false, error: "KPI not found" };

    kpi.target = target;
    kpi.lastModifiedBy = { name: user.name, id: user.id };
    await kpi.save();

    revalidatePath(`/dashboard/kpis/${kpiId}`);
    revalidatePath("/dashboard/kpis");
  } catch (error) {
    console.error("updateKpiTarget:", error);
    return { success: false, error: error.message || "Failed to update target" };
  }
  redirect(`/dashboard/kpis/${kpiId}`);
}

// ============================================
// DEACTIVATE / REACTIVATE KPI
// ============================================
export async function setKpiActive(kpiId, isActive) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user, KPI_ROLES.MANAGE);
    if (err) return { success: false, error: err };

    await dbConnect();
    const kpi = await Kpi.findOne(withTenantScope({ _id: kpiId }, companyId, isSuperAdmin));
    if (!kpi) return { success: false, error: "KPI not found" };

    kpi.isActive = !!isActive;
    kpi.lastModifiedBy = { name: user.name, id: user.id };
    await kpi.save();

    revalidatePath("/dashboard/kpis");
    revalidatePath(`/dashboard/kpis/${kpiId}`);
  } catch (error) {
    console.error("setKpiActive:", error);
    return { success: false, error: error.message || "Failed to update KPI status" };
  }
  redirect(`/dashboard/kpis/${kpiId}`);
}

// ============================================
// RECORD MANUAL SNAPSHOT
// ============================================
export async function recordKpiSnapshot(kpiId, _prev, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user, KPI_ROLES.ENTER_SNAPSHOT);
    if (err) return { success: false, error: err };

    const periodYear = parseInt(formData.get("periodYear") || "", 10);
    const periodMonth = parseInt(formData.get("periodMonth") || "", 10);
    const actualValue = parseFloat(formData.get("actualValue") || "NaN");
    const notes = formData.get("notes")?.toString().trim() || "";

    const errors = {};
    if (!Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 2100) errors.periodYear = "Invalid year";
    if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) errors.periodMonth = "Invalid month";
    if (Number.isNaN(actualValue)) errors.actualValue = "Actual value must be a number";
    if (Object.keys(errors).length > 0) {
      return { success: false, error: "Please fix the highlighted fields", fieldErrors: errors };
    }

    await dbConnect();
    const kpi = await Kpi.findOne(withTenantScope({ _id: kpiId }, companyId, isSuperAdmin));
    if (!kpi) return { success: false, error: "KPI not found" };

    const tenantId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    const normalised = normalisePeriod(kpi.periodicity, periodYear, periodMonth);

    // Upsert — one snapshot per (kpi, period). The unique index is
    // { companyId, kpiId, periodYear, periodMonth } so we key on the
    // normalised month (end-of-quarter for quarterly, 12 for yearly).
    await KpiSnapshot.findOneAndUpdate(
      {
        companyId: tenantId,
        kpiId: kpi._id,
        periodYear: normalised.periodYear,
        periodMonth: normalised.periodMonth,
      },
      {
        $set: {
          actualValue,
          targetAtTime: kpi.target,
          periodicity: kpi.periodicity,
          periodQuarter: normalised.periodQuarter,
          source: "manual",
          notes,
          recordedBy: { name: user.name, id: user.id },
        },
        $setOnInsert: {
          companyId: tenantId,
          kpiId: kpi._id,
          periodYear: normalised.periodYear,
          periodMonth: normalised.periodMonth,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    revalidatePath(`/dashboard/kpis/${kpiId}`);
    revalidatePath("/dashboard/kpis");
  } catch (error) {
    console.error("recordKpiSnapshot:", error);
    return { success: false, error: error.message || "Failed to record snapshot" };
  }
  redirect(`/dashboard/kpis/${kpiId}`);
}

// ============================================
// PERIOD MATH
// ============================================
// Given a periodicity + (year, month) coordinate, return the [start, end)
// JS Date bounds in local time. For quarterly the month is the END of quarter
// (3/6/9/12); for yearly it's December.
function getPeriodBounds(periodicity, periodYear, periodMonth) {
  if (periodicity === "yearly") {
    return {
      start: new Date(periodYear, 0, 1),
      end: new Date(periodYear + 1, 0, 1),
    };
  }
  if (periodicity === "quarterly") {
    // periodMonth is end-of-quarter (3,6,9,12) → start = first month of quarter
    const startMonth = periodMonth - 2; // 1, 4, 7, 10
    return {
      start: new Date(periodYear, startMonth - 1, 1),
      end: new Date(periodYear, periodMonth, 1),
    };
  }
  // monthly
  return {
    start: new Date(periodYear, periodMonth - 1, 1),
    end: new Date(periodYear, periodMonth, 1),
  };
}

// Normalises a snapshot's (year, month) and quarter for storage.
// For quarterly: if caller passes month=1-12, we coerce to end-of-quarter.
// For yearly: month → 12. Returns { periodYear, periodMonth, periodQuarter|null }.
function normalisePeriod(periodicity, periodYear, periodMonth) {
  if (periodicity === "yearly") {
    return { periodYear, periodMonth: 12, periodQuarter: 4 };
  }
  if (periodicity === "quarterly") {
    const quarter = Math.ceil(periodMonth / 3); // 1-4
    const endMonth = quarter * 3; // 3, 6, 9, 12
    return { periodYear, periodMonth: endMonth, periodQuarter: quarter };
  }
  return { periodYear, periodMonth, periodQuarter: null };
}

// ============================================
// LOW-LEVEL COMPUTATION HELPERS
// ============================================

// Sum (credit - debit) on the given account ids for posted JEs in the window.
async function sumJournalAggregate({ baseMatch, accountIds, start, end, side = "credit_minus_debit" }) {
  if (!accountIds || accountIds.length === 0) return 0;
  const formula =
    side === "debit_minus_credit"
      ? { $subtract: ["$lines.debit", "$lines.credit"] }
      : { $subtract: ["$lines.credit", "$lines.debit"] };

  const result = await JournalEntry.aggregate([
    { $match: { ...baseMatch, status: "posted", entryDate: { $gte: start, $lt: end } } },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": { $in: accountIds } } },
    { $group: { _id: null, total: { $sum: formula } } },
  ]);
  return result[0]?.total || 0;
}

// Returns balance of a single account *as of* the given date.
// Sum (debit - credit) for asset/expense; (credit - debit) for liability/equity/revenue.
async function getAccountBalanceAsOf({ baseMatch, account, asOf }) {
  if (!account) return 0;
  const isAssetOrExpense = ["asset", "expense"].includes(account.accountType);
  const formula = isAssetOrExpense
    ? { $subtract: ["$lines.debit", "$lines.credit"] }
    : { $subtract: ["$lines.credit", "$lines.debit"] };

  const result = await JournalEntry.aggregate([
    { $match: { ...baseMatch, status: "posted", entryDate: { $lt: asOf } } },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": account._id } },
    { $group: { _id: null, balance: { $sum: formula } } },
  ]);
  return result[0]?.balance || 0;
}

function buildBaseMatch(companyId, isSuperAdmin) {
  return isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };
}

function buildAccountFilter(companyId, isSuperAdmin, extra = {}) {
  return isSuperAdmin
    ? { isActive: true, ...extra }
    : { companyId: new ObjectId(companyId), isActive: true, ...extra };
}

// ============================================
// AUTO FORMULAS
// ============================================
// Each formula receives { companyId, isSuperAdmin, periodicity, periodYear, periodMonth }
// and returns a numeric actual value (or 0 when nothing to count).

async function computeMonthlyRevenue(ctx) {
  const { start, end } = getPeriodBounds(ctx.periodicity, ctx.periodYear, ctx.periodMonth);
  const baseMatch = buildBaseMatch(ctx.companyId, ctx.isSuperAdmin);
  const revenueAccounts = await Account.find(
    buildAccountFilter(ctx.companyId, ctx.isSuperAdmin, { accountType: "revenue" })
  )
    .select("_id")
    .lean();
  const accountIds = revenueAccounts.map((a) => a._id);
  return sumJournalAggregate({ baseMatch, accountIds, start, end });
}

async function computeMonthlyPayrollCost(ctx) {
  // Sum totalGrossPay + employer contributions for runs *paid* in the period.
  const { start, end } = getPeriodBounds(ctx.periodicity, ctx.periodYear, ctx.periodMonth);
  const tenantMatch = ctx.isSuperAdmin ? {} : { companyId: new ObjectId(ctx.companyId) };

  const result = await PayrollRun.aggregate([
    {
      $match: {
        ...tenantMatch,
        status: { $in: ["paid", "approved", "posted"] },
        paidAt: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: null,
        total: {
          $sum: {
            $add: [
              { $ifNull: ["$totals.totalGrossPay", 0] },
              { $ifNull: ["$totals.totalEmployerNSSF", 0] },
              { $ifNull: ["$totals.totalEmployerAHL", 0] },
            ],
          },
        },
      },
    },
  ]);
  return result[0]?.total || 0;
}

async function computeARDaysOutstanding(ctx) {
  const { start, end } = getPeriodBounds(ctx.periodicity, ctx.periodYear, ctx.periodMonth);
  const baseMatch = buildBaseMatch(ctx.companyId, ctx.isSuperAdmin);

  const arAccount = await Account.findOne(
    buildAccountFilter(ctx.companyId, ctx.isSuperAdmin, { systemAccount: "accounts_receivable" })
  ).lean();
  if (!arAccount) return 0;

  const arBalance = await getAccountBalanceAsOf({ baseMatch, account: arAccount, asOf: end });
  if (arBalance <= 0) return 0;

  // Period revenue (Cr - Dr on revenue accounts in window)
  const revenueAccounts = await Account.find(
    buildAccountFilter(ctx.companyId, ctx.isSuperAdmin, { accountType: "revenue" })
  )
    .select("_id")
    .lean();
  const periodRevenue = await sumJournalAggregate({
    baseMatch,
    accountIds: revenueAccounts.map((a) => a._id),
    start,
    end,
  });

  if (periodRevenue <= 0) return 0;

  const daysInPeriod = Math.round((end - start) / (1000 * 60 * 60 * 24));
  // DSO = AR / (revenue / days) = AR × days / revenue
  return (arBalance * daysInPeriod) / periodRevenue;
}

async function computeCashPosition(ctx) {
  const { end } = getPeriodBounds(ctx.periodicity, ctx.periodYear, ctx.periodMonth);
  const baseMatch = buildBaseMatch(ctx.companyId, ctx.isSuperAdmin);

  const cashAccounts = await Account.find(
    buildAccountFilter(ctx.companyId, ctx.isSuperAdmin, {
      systemAccount: { $in: ["cash", "petty_cash", "cash_at_bank", "bank_main", "mpesa"] },
    })
  ).lean();
  if (cashAccounts.length === 0) return 0;

  const balances = await Promise.all(
    cashAccounts.map((a) => getAccountBalanceAsOf({ baseMatch, account: a, asOf: end }))
  );
  return balances.reduce((sum, b) => sum + b, 0);
}

async function computeActiveHeadcount(ctx) {
  // Point-in-time as of period end. Note: uses current employment.status —
  // EmploymentHistory could give a true as-of count later, but for SMBs the
  // current status is usually a good enough proxy for recent periods.
  const tenantMatch = ctx.isSuperAdmin ? {} : { companyId: new ObjectId(ctx.companyId) };
  return EmployeeProfile.countDocuments({
    ...tenantMatch,
    "employment.status": { $in: ["active", "probation"] },
  });
}

async function computeGrossMarginPercent(ctx) {
  const { start, end } = getPeriodBounds(ctx.periodicity, ctx.periodYear, ctx.periodMonth);
  const baseMatch = buildBaseMatch(ctx.companyId, ctx.isSuperAdmin);

  const [revenueAccounts, cogsAccounts] = await Promise.all([
    Account.find(
      buildAccountFilter(ctx.companyId, ctx.isSuperAdmin, { accountType: "revenue" })
    )
      .select("_id")
      .lean(),
    Account.find(
      buildAccountFilter(ctx.companyId, ctx.isSuperAdmin, {
        systemAccount: { $in: ["cogs", "cost_of_sales"] },
      })
    )
      .select("_id")
      .lean(),
  ]);

  const revenue = await sumJournalAggregate({
    baseMatch,
    accountIds: revenueAccounts.map((a) => a._id),
    start,
    end,
  });
  if (revenue <= 0) return 0;

  const cogs = await sumJournalAggregate({
    baseMatch,
    accountIds: cogsAccounts.map((a) => a._id),
    start,
    end,
    side: "debit_minus_credit", // expense normal balance
  });

  return ((revenue - cogs) / revenue) * 100;
}

// ============================================
// AUTO FORMULAS — defensive twins
// ============================================

async function computeOpexRatio(ctx) {
  // Operating expense ratio = non-COGS expenses ÷ revenue × 100.
  // The defensive twin of Revenue — if both go up together, you're not
  // actually getting more efficient; if OpEx outpaces revenue you're
  // burning cash to grow. COGS is excluded because Gross Margin already
  // covers that side.
  const { start, end } = getPeriodBounds(ctx.periodicity, ctx.periodYear, ctx.periodMonth);
  const baseMatch = buildBaseMatch(ctx.companyId, ctx.isSuperAdmin);

  const [revenueAccounts, expenseAccounts, cogsAccounts] = await Promise.all([
    Account.find(buildAccountFilter(ctx.companyId, ctx.isSuperAdmin, { accountType: "revenue" }))
      .select("_id")
      .lean(),
    Account.find(buildAccountFilter(ctx.companyId, ctx.isSuperAdmin, { accountType: "expense" }))
      .select("_id")
      .lean(),
    Account.find(
      buildAccountFilter(ctx.companyId, ctx.isSuperAdmin, {
        systemAccount: { $in: ["cogs", "cost_of_sales"] },
      })
    )
      .select("_id")
      .lean(),
  ]);

  const revenue = await sumJournalAggregate({
    baseMatch,
    accountIds: revenueAccounts.map((a) => a._id),
    start,
    end,
  });
  if (revenue <= 0) return 0;

  const cogsIdSet = new Set(cogsAccounts.map((a) => a._id.toString()));
  const opexAccountIds = expenseAccounts
    .filter((a) => !cogsIdSet.has(a._id.toString()))
    .map((a) => a._id);

  const opex = await sumJournalAggregate({
    baseMatch,
    accountIds: opexAccountIds,
    start,
    end,
    side: "debit_minus_credit",
  });
  return (opex / revenue) * 100;
}

async function computePayrollToRevenueRatio(ctx) {
  // Payroll-as-share-of-revenue. For service-heavy SMBs payroll is the
  // single biggest fixed cost; this metric exposes overstaffing or
  // revenue contraction faster than either number alone.
  const [payroll, revenue] = await Promise.all([
    computeMonthlyPayrollCost(ctx),
    computeMonthlyRevenue(ctx),
  ]);
  if (revenue <= 0) return 0;
  return (payroll / revenue) * 100;
}

async function computeAvgOrderValue(ctx) {
  // AOV = total revenue ÷ count of completed invoices in period. Watching
  // only revenue masks discount-led growth — if AOV drifts down while
  // revenue is up, you're winning more deals at worse prices.
  const { start, end } = getPeriodBounds(ctx.periodicity, ctx.periodYear, ctx.periodMonth);
  const tenantMatch = ctx.isSuperAdmin ? {} : { companyId: new ObjectId(ctx.companyId) };

  const result = await Invoice.aggregate([
    {
      $match: {
        ...tenantMatch,
        status: { $in: ["sent", "completed"] },
        invoiceDate: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: null,
        revenue: { $sum: "$total" },
        count: { $sum: 1 },
      },
    },
  ]);

  if (!result[0] || result[0].count === 0) return 0;
  return result[0].revenue / result[0].count;
}

// Source → compute function map
const AUTO_COMPUTERS = {
  monthly_revenue: computeMonthlyRevenue,
  monthly_payroll_cost: computeMonthlyPayrollCost,
  ar_days_outstanding: computeARDaysOutstanding,
  cash_position: computeCashPosition,
  active_headcount: computeActiveHeadcount,
  gross_margin_percent: computeGrossMarginPercent,
  opex_ratio: computeOpexRatio,
  payroll_to_revenue_ratio: computePayrollToRevenueRatio,
  avg_order_value: computeAvgOrderValue,
};

// ============================================
// COMPUTE & STORE AUTO SNAPSHOT
// ============================================
// Pulls the actual for an auto KPI for a specific period and upserts it
// as a snapshot. The period coordinate is interpreted per the KPI's
// periodicity (monthly → month 1-12, quarterly → month coerced to
// end-of-quarter, yearly → month forced to 12).
export async function computeKpiSnapshot(kpiId, periodYear, periodMonth) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user, KPI_ROLES.ENTER_SNAPSHOT);
    if (err) return { success: false, error: err };

    if (!Number.isInteger(periodYear) || !Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) {
      return { success: false, error: "Invalid period" };
    }

    await dbConnect();

    const kpi = await Kpi.findOne(withTenantScope({ _id: kpiId }, companyId, isSuperAdmin));
    if (!kpi) return { success: false, error: "KPI not found" };
    if (kpi.source === "manual") {
      return { success: false, error: "This KPI is manual-entry; auto-compute is not available" };
    }

    const compute = AUTO_COMPUTERS[kpi.source];
    if (!compute) {
      return { success: false, error: `Unsupported auto source: ${kpi.source}` };
    }

    const normalised = normalisePeriod(kpi.periodicity, periodYear, periodMonth);

    const actualValue = await compute({
      companyId: kpi.companyId.toString(),
      isSuperAdmin,
      periodicity: kpi.periodicity,
      periodYear: normalised.periodYear,
      periodMonth: normalised.periodMonth,
    });

    const tenantId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    await KpiSnapshot.findOneAndUpdate(
      {
        companyId: tenantId,
        kpiId: kpi._id,
        periodYear: normalised.periodYear,
        periodMonth: normalised.periodMonth,
      },
      {
        $set: {
          actualValue,
          targetAtTime: kpi.target,
          periodicity: kpi.periodicity,
          periodQuarter: normalised.periodQuarter,
          source: "auto",
          recordedBy: { name: user.name, id: user.id },
        },
        $setOnInsert: {
          companyId: tenantId,
          kpiId: kpi._id,
          periodYear: normalised.periodYear,
          periodMonth: normalised.periodMonth,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    revalidatePath(`/dashboard/kpis/${kpiId}`);
    revalidatePath("/dashboard/kpis");
  } catch (error) {
    console.error("computeKpiSnapshot:", error);
    return { success: false, error: error.message || "Failed to compute KPI snapshot" };
  }
  redirect(`/dashboard/kpis/${kpiId}`);
}

// ============================================
// DELETE SNAPSHOT (admin-only; undoes a recorded actual)
// ============================================
export async function deleteKpiSnapshot(snapshotId) {
  let kpiIdForRedirect = null;
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user, KPI_ROLES.MANAGE);
    if (err) return { success: false, error: err };

    await dbConnect();
    const snap = await KpiSnapshot.findOne(withTenantScope({ _id: snapshotId }, companyId, isSuperAdmin));
    if (!snap) return { success: false, error: "Snapshot not found" };

    kpiIdForRedirect = snap.kpiId.toString();
    await snap.deleteOne();

    revalidatePath(`/dashboard/kpis/${kpiIdForRedirect}`);
  } catch (error) {
    console.error("deleteKpiSnapshot:", error);
    return { success: false, error: error.message || "Failed to delete snapshot" };
  }
  redirect(`/dashboard/kpis/${kpiIdForRedirect}`);
}

// ============================================
// SEED STARTER KPIs (from the curated template library)
// ============================================
// Idempotent: skips templates whose `name` already exists for this company
// so re-running doesn't create duplicates. Returns lists of what was created
// vs skipped so the UI can give an honest summary.
//
// `selectedKeys` is an array of template `key`s. If null/undefined, all
// templates are seeded.
export async function seedStarterKpis(selectedKeys = null) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user, KPI_ROLES.MANAGE);
    if (err) return { success: false, error: err };

    await dbConnect();

    const tenantId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    const toSeed = Array.isArray(selectedKeys) && selectedKeys.length > 0
      ? KPI_TEMPLATES.filter((t) => selectedKeys.includes(t.key))
      : KPI_TEMPLATES;

    if (toSeed.length === 0) {
      return { success: false, error: "No templates selected" };
    }

    // Single round-trip: find any KPIs that already match the names we'd create.
    const names = toSeed.map((t) => t.name);
    const existing = await Kpi.find(
      withTenantScope({ name: { $in: names } }, companyId, isSuperAdmin)
    )
      .select("name")
      .lean();
    const existingNames = new Set(existing.map((k) => k.name));

    const created = [];
    const skipped = [];

    for (const t of toSeed) {
      if (existingNames.has(t.name)) {
        skipped.push(t.name);
        continue;
      }
      const doc = await Kpi.create({
        companyId: tenantId,
        name: t.name,
        description: t.description || "",
        category: t.category,
        source: t.source,
        unit: t.unit,
        periodicity: t.periodicity,
        target: t.target,
        targetDirection: t.targetDirection,
        // Templates don't carry custom thresholds / labels — use defaults.
        customThresholds: { onTargetThreshold: null, nearTargetThreshold: null },
        statusLabels: { onTarget: null, nearTarget: null, offTarget: null },
        isActive: true,
        createdBy: { name: user.name, id: user.id },
      });
      created.push({ _id: doc._id.toString(), name: doc.name });
    }

    revalidatePath("/dashboard/kpis");
  } catch (error) {
    console.error("seedStarterKpis:", error);
    return { success: false, error: error.message || "Failed to seed KPIs" };
  }
  // Navigate to the populated list. The dialog unmounts as the page
  // re-renders, so no client-side state management needed for closing.
  redirect("/dashboard/kpis");
}
