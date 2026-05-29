// ============================================
// KPI QUERIES — Server-only read functions
// ============================================
// NO "use server" — imported directly into Server Components.
// Patterns:
//   - .lean() for plain JS objects
//   - companyId-scoped via withTenantScope
//   - ObjectIds / Dates serialised to strings before crossing the client boundary
// ============================================

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";

import Kpi from "@/app/models/kpi";
import KpiSnapshot from "@/app/models/kpiSnapshot";
import EmployeeProfile from "@/app/models/employeeProfile";

// ============================================
// SERIALIZERS
// ============================================

function serializeKpi(k) {
  if (!k) return null;
  return {
    _id: k._id.toString(),
    name: k.name,
    description: k.description || "",
    category: k.category,
    source: k.source,
    unit: k.unit,
    periodicity: k.periodicity,
    target: k.target,
    targetDirection: k.targetDirection,
    customThresholds: {
      onTargetThreshold: k.customThresholds?.onTargetThreshold ?? null,
      nearTargetThreshold: k.customThresholds?.nearTargetThreshold ?? null,
    },
    statusLabels: {
      onTarget: k.statusLabels?.onTarget || null,
      nearTarget: k.statusLabels?.nearTarget || null,
      offTarget: k.statusLabels?.offTarget || null,
    },
    owner: k.owner
      ? {
          partyId: k.owner.partyId ? k.owner.partyId.toString() : null,
          profileId: k.owner.profileId ? k.owner.profileId.toString() : null,
          userId: k.owner.userId ? k.owner.userId.toString() : null,
          name: k.owner.name || null,
          employeeNumber: k.owner.employeeNumber || null,
        }
      : null,
    isActive: k.isActive,
    createdAt: k.createdAt ? k.createdAt.toISOString() : null,
    updatedAt: k.updatedAt ? k.updatedAt.toISOString() : null,
  };
}

function serializeSnapshot(s) {
  if (!s) return null;
  return {
    _id: s._id.toString(),
    kpiId: s.kpiId.toString(),
    periodicity: s.periodicity || "monthly",
    periodYear: s.periodYear,
    periodMonth: s.periodMonth,
    periodQuarter: s.periodQuarter ?? null,
    actualValue: s.actualValue,
    targetAtTime: s.targetAtTime,
    source: s.source,
    notes: s.notes || "",
    recordedBy: s.recordedBy || null,
    createdAt: s.createdAt ? s.createdAt.toISOString() : null,
  };
}

// ============================================
// PERIOD ARITHMETIC — used for prior + YoY lookups
// ============================================
// Given a snapshot's normalised period coordinate, return the previous
// period coordinate. Rolls year boundaries.
function priorPeriod(periodicity, periodYear, periodMonth) {
  if (periodicity === "yearly") return { periodYear: periodYear - 1, periodMonth: 12 };
  if (periodicity === "quarterly") {
    const newMonth = periodMonth - 3;
    return newMonth < 1
      ? { periodYear: periodYear - 1, periodMonth: 12 }
      : { periodYear, periodMonth: newMonth };
  }
  // monthly
  return periodMonth === 1
    ? { periodYear: periodYear - 1, periodMonth: 12 }
    : { periodYear, periodMonth: periodMonth - 1 };
}

function yoYPeriod(_periodicity, periodYear, periodMonth) {
  return { periodYear: periodYear - 1, periodMonth };
}

function pctChange(current, prior) {
  if (prior == null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

// ============================================
// LIST KPIs (with latest snapshot + recent series for sparkline)
// ============================================
// Pulls the last `seriesLength` snapshots per KPI in two queries (KPIs + a
// single sorted snapshot query) and groups in JS. For typical SMB workloads
// (≤30 KPIs × 12 periods = 360 docs) this is faster than a per-KPI
// aggregation and avoids $lookup.
export async function listKpis({
  category = null,
  includeInactive = false,
  seriesLength = 12,
} = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope({}, companyId, isSuperAdmin);
  if (!includeInactive) query.isActive = true;
  if (category) query.category = category;

  const kpis = await Kpi.find(query).sort({ category: 1, name: 1 }).lean();
  if (kpis.length === 0) return [];

  const kpiIds = kpis.map((k) => k._id);

  // Pull recent snapshots for all KPIs at once. Capped at seriesLength × #KPIs
  // so worst case is bounded; for normal usage this is a small payload.
  const snapshotDocs = await KpiSnapshot.find(
    withTenantScope({ kpiId: { $in: kpiIds } }, companyId, isSuperAdmin)
  )
    .sort({ kpiId: 1, periodYear: -1, periodMonth: -1 })
    .limit(seriesLength * kpiIds.length)
    .lean();

  // Group by kpiId, already sorted desc.
  const seriesByKpi = new Map();
  for (const s of snapshotDocs) {
    const key = s.kpiId.toString();
    if (!seriesByKpi.has(key)) seriesByKpi.set(key, []);
    const arr = seriesByKpi.get(key);
    if (arr.length < seriesLength) arr.push(s);
  }

  return kpis.map((k) => {
    const series = seriesByKpi.get(k._id.toString()) || [];
    const latest = series[0] || null;
    const prior = series[1] || null;
    const priorDelta = latest && prior ? pctChange(latest.actualValue, prior.actualValue) : null;

    return {
      ...serializeKpi(k),
      latestSnapshot: serializeSnapshot(latest),
      priorDeltaPct: priorDelta,
      // Sparkline series — chronological (oldest → newest) for chart consumption.
      series: series
        .slice()
        .reverse()
        .map((s) => ({
          periodYear: s.periodYear,
          periodMonth: s.periodMonth,
          actualValue: s.actualValue,
          targetAtTime: s.targetAtTime,
        })),
    };
  });
}

// ============================================
// GET KPI BY ID
// ============================================
export async function getKpiById(kpiId) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const kpi = await Kpi.findOne(withTenantScope({ _id: kpiId }, companyId, isSuperAdmin)).lean();
  return serializeKpi(kpi);
}

// ============================================
// GET KPI WITH ALL SNAPSHOTS (for detail page)
// ============================================
// Each snapshot is enriched with priorDeltaPct + yoyDeltaPct so the table
// can render "vs prior period" and "vs same period last year" without
// extra queries client-side.
export async function getKpiWithSnapshots(kpiId, { limit = 24 } = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const kpi = await Kpi.findOne(withTenantScope({ _id: kpiId }, companyId, isSuperAdmin)).lean();
  if (!kpi) return null;

  // Pull a wider window than `limit` so we have the prior + YoY comparators
  // even for the oldest visible row. 24 + 12 is enough for a YoY look-back.
  const snapshots = await KpiSnapshot.find(
    withTenantScope({ kpiId: kpi._id }, companyId, isSuperAdmin)
  )
    .sort({ periodYear: -1, periodMonth: -1 })
    .limit(limit + 12)
    .lean();

  // Build a lookup keyed by (year, month) for fast prior/YoY resolution.
  const byKey = new Map(snapshots.map((s) => [`${s.periodYear}-${s.periodMonth}`, s]));

  const enriched = snapshots.slice(0, limit).map((s) => {
    const prior = priorPeriod(s.periodicity || kpi.periodicity, s.periodYear, s.periodMonth);
    const yoy = yoYPeriod(s.periodicity || kpi.periodicity, s.periodYear, s.periodMonth);
    const priorSnap = byKey.get(`${prior.periodYear}-${prior.periodMonth}`);
    const yoySnap = byKey.get(`${yoy.periodYear}-${yoy.periodMonth}`);
    return {
      ...serializeSnapshot(s),
      priorDeltaPct: priorSnap ? pctChange(s.actualValue, priorSnap.actualValue) : null,
      yoyDeltaPct: yoySnap ? pctChange(s.actualValue, yoySnap.actualValue) : null,
    };
  });

  // Chronological series for the line chart (oldest → newest), capped to limit.
  const chartSeries = snapshots
    .slice(0, limit)
    .slice()
    .reverse()
    .map((s) => ({
      periodYear: s.periodYear,
      periodMonth: s.periodMonth,
      actualValue: s.actualValue,
      targetAtTime: s.targetAtTime,
    }));

  return {
    ...serializeKpi(kpi),
    snapshots: enriched,
    chartSeries,
  };
}

// ============================================
// DASHBOARD SUMMARY — KPIs with their latest snapshot, capped
// ============================================
// Used by dashboard widgets. Returns at most `limit` active KPIs,
// ordered by category then name, each with its latest snapshot.
export async function getKpiSummaryForDashboard({ limit = 6 } = {}) {
  const all = await listKpis({ includeInactive: false });
  return all.slice(0, limit);
}

// ============================================
// OWNER CANDIDATES — for the KPI form's owner picker
// ============================================
// Returns active employees for this tenant. Empty array if HR isn't set up
// (no EmployeeProfile records) — the form gracefully falls back to free-text
// name entry. Capped at 200 to keep the dropdown rendering snappy.
export async function getKpiOwnerCandidates({ limit = 200 } = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const employees = await EmployeeProfile.find(
    withTenantScope({ "employment.status": { $in: ["active", "probation"] } }, companyId, isSuperAdmin)
  )
    .select("partyId employeeNumber personalInfo.firstName personalInfo.lastName employment.designation employment.department")
    .sort({ "personalInfo.firstName": 1 })
    .limit(limit)
    .lean();

  return employees.map((e) => {
    const fullName = [e.personalInfo?.firstName, e.personalInfo?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    return {
      partyId: e.partyId?.toString() || null,
      profileId: e._id.toString(),
      name: fullName || e.employeeNumber || "(unnamed)",
      employeeNumber: e.employeeNumber || null,
      designation: e.employment?.designation || null,
      department: e.employment?.department || null,
    };
  });
}
