"use server";

/**
 * Live KPI tiles for the department landing dashboards.
 *
 * Every figure here is composed from an existing, RLS-scoped action — nothing
 * new reaches the database directly. Each department's builder runs its sources
 * with Promise.allSettled and each tile is emitted only if its source settled,
 * so one slow or forbidden query degrades to "fewer tiles", never a broken
 * dashboard. A role that cannot see a figure (the action throws under its
 * tenant guard) simply gets no tile for it.
 */

import { getProjectStats, getProjectFindings } from "./project-actions";
import { getARAgingSummary, getAPAgingSummary } from "./dashboard-actions";
import { getDashboardStats } from "./inventory-dashboard-actions";
import { countPurchaseOrdersPg } from "./purchase-order-actions";
import { getActiveHeadcount } from "./hr-employee-actions";
import { countLeaveAwaitingApproval } from "./hr-leave-actions";
import { countLoansAwaitingApproval } from "./hr-loan-actions";
import { getLeadStatsPg } from "./crm-actions";
import { countQuotesPg } from "./quote-actions";
import {
  countNonconformancesPg,
  countNonconformancesAwaitingAuthorisationPg,
} from "./ncr-actions";

export type DeptKpiTone = "default" | "good" | "warn" | "danger";
export interface DeptKpi {
  key: string;
  label: string;
  value: string;
  sub?: string;
  tone?: DeptKpiTone;
  href?: string;
}

const compactMoney = (n: number) =>
  "KES " +
  new Intl.NumberFormat("en-KE", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.round(Number(n) || 0));

const count = (n: number) =>
  new Intl.NumberFormat("en-KE").format(Math.round(Number(n) || 0));

/** Unwrap a settled promise, or null if it rejected. */
function val<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}

async function projectsKpis(): Promise<DeptKpi[]> {
  const [statsR, findingsR] = await Promise.allSettled([
    getProjectStats(),
    getProjectFindings(),
  ]);
  const stats = val(statsR);
  const f = val(findingsR);
  const out: DeptKpi[] = [];
  if (stats) {
    out.push({
      key: "active",
      label: "Active projects",
      value: count((stats.active ?? 0) + (stats.onHold ?? 0)),
      sub: `${count(stats.planning ?? 0)} in planning`,
      href: "/dashboard/projects",
    });
  }
  if (f) {
    const atRisk = f.noMargin.length + f.overspent.length;
    out.push({
      key: "no-budget",
      label: "No approved budget",
      value: count(f.noApprovedBudget.length),
      sub: "Active jobs, unbudgeted",
      tone: f.noApprovedBudget.length > 0 ? "danger" : "good",
      href: "/dashboard/projects/findings",
    });
    out.push({
      key: "margin-risk",
      label: "Margin at risk",
      value: count(atRisk),
      sub: "No margin or overspent",
      tone: atRisk > 0 ? "danger" : "good",
      href: "/dashboard/projects/findings",
    });
    out.push({
      key: "findings",
      label: "Open findings",
      value: count(f.total),
      tone: f.total > 0 ? "warn" : "good",
      href: "/dashboard/projects/findings",
    });
  }
  return out;
}

async function financeKpis(): Promise<DeptKpi[]> {
  const [arR, apR] = await Promise.allSettled([
    getARAgingSummary(),
    getAPAgingSummary(),
  ]);
  const ar = val(arR);
  const ap = val(apR);
  const sum = (rows: Array<{ bucket: string; amount: number }> | null) =>
    (rows ?? []).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const overdue = (rows: Array<{ bucket: string; amount: number }> | null) =>
    (rows ?? [])
      .filter((r) => r.bucket !== "current")
      .reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const out: DeptKpi[] = [];
  if (ar) {
    out.push({
      key: "ar",
      label: "Receivables outstanding",
      value: compactMoney(sum(ar)),
      href: "/dashboard/reports/ar-aging",
    });
    const od = overdue(ar);
    out.push({
      key: "ar-overdue",
      label: "Receivables overdue",
      value: compactMoney(od),
      sub: "Past due",
      tone: od > 0 ? "danger" : "good",
      href: "/dashboard/reports/ar-aging",
    });
  }
  if (ap) {
    out.push({
      key: "ap",
      label: "Payables outstanding",
      value: compactMoney(sum(ap)),
      tone: "warn",
      href: "/dashboard/reports/ap-aging",
    });
  }
  return out;
}

async function opsKpis(): Promise<DeptKpi[]> {
  const [invR, poR] = await Promise.allSettled([
    getDashboardStats(),
    countPurchaseOrdersPg({ status: ["sent", "partial"] }),
  ]);
  const inv = val(invR);
  const openPo = val(poR);
  const out: DeptKpi[] = [];
  if (inv) {
    out.push({
      key: "stock-value",
      label: "Stock value",
      value: compactMoney(inv.totalStockValue),
      href: "/dashboard/stocks",
    });
    out.push({
      key: "low-stock",
      label: "Low stock",
      value: count(inv.lowStockCount),
      sub: "At or below reorder",
      tone: inv.lowStockCount > 0 ? "warn" : "good",
      href: "/dashboard/stocks",
    });
    out.push({
      key: "out-of-stock",
      label: "Out of stock",
      value: count(inv.outOfStockCount),
      tone: inv.outOfStockCount > 0 ? "danger" : "good",
      href: "/dashboard/stocks",
    });
  }
  if (openPo != null) {
    out.push({
      key: "open-po",
      label: "Open purchase orders",
      value: count(openPo),
      sub: "Sent or part-received",
      href: "/dashboard/purchase-orders",
    });
  }
  return out;
}

async function hrKpis(): Promise<DeptKpi[]> {
  const [hcR, leaveR, loansR] = await Promise.allSettled([
    getActiveHeadcount(),
    countLeaveAwaitingApproval(),
    countLoansAwaitingApproval(),
  ]);
  const hc = val(hcR);
  const leave = val(leaveR);
  const loans = val(loansR);
  const out: DeptKpi[] = [];
  if (hc != null) {
    out.push({
      key: "headcount",
      label: "Active headcount",
      value: count(hc),
      href: "/dashboard/hr/employees",
    });
  }
  if (leave != null) {
    out.push({
      key: "leave",
      label: "Leave to approve",
      value: count(leave),
      tone: leave > 0 ? "warn" : "good",
      href: "/dashboard/hr/leave",
    });
  }
  if (loans != null) {
    out.push({
      key: "loans",
      label: "Loans to approve",
      value: count(loans),
      tone: loans > 0 ? "warn" : "good",
      href: "/dashboard/hr/loans",
    });
  }
  return out;
}

async function businessDevKpis(): Promise<DeptKpi[]> {
  const [leadsR, quotesR] = await Promise.allSettled([
    getLeadStatsPg(),
    countQuotesPg({}),
  ]);
  const leads = val(leadsR);
  const quotes = val(quotesR);
  const out: DeptKpi[] = [];
  if (leads) {
    out.push({
      key: "leads",
      label: "Open leads",
      value: count(leads.open),
      href: "/dashboard/leads",
    });
    out.push({
      key: "pipeline",
      label: "Pipeline value",
      value: compactMoney(leads.value),
      sub: "Open opportunities",
      tone: "good",
      href: "/dashboard/opportunities",
    });
  }
  if (quotes != null) {
    out.push({
      key: "quotes",
      label: "Quotes",
      value: count(quotes),
      href: "/dashboard/quotes",
    });
  }
  return out;
}

async function ictQualityKpis(): Promise<DeptKpi[]> {
  const [ncrR, awaitR] = await Promise.allSettled([
    countNonconformancesPg({}),
    countNonconformancesAwaitingAuthorisationPg(),
  ]);
  const ncr = val(ncrR);
  const awaiting = val(awaitR);
  const out: DeptKpi[] = [];
  if (ncr != null) {
    out.push({
      key: "ncr",
      label: "Nonconformances",
      value: count(ncr),
      tone: ncr > 0 ? "warn" : "good",
      href: "/dashboard/qms",
    });
  }
  if (awaiting != null) {
    out.push({
      key: "ncr-await",
      label: "Awaiting disposition",
      value: count(awaiting),
      tone: awaiting > 0 ? "danger" : "good",
      href: "/dashboard/qms",
    });
  }
  return out;
}

const BUILDERS: Record<string, () => Promise<DeptKpi[]>> = {
  projects: projectsKpis,
  finance: financeKpis,
  "general-ops": opsKpis,
  "hr-admin": hrKpis,
  "business-dev": businessDevKpis,
  "ict-quality": ictQualityKpis,
};

/**
 * The KPI tiles for one department, or [] when the department has no live
 * figures (Technical) or everything its builder needs was unreachable for this
 * user. Never throws — the dashboard renders the rest regardless.
 */
export async function getDepartmentKpis(slug: string): Promise<DeptKpi[]> {
  const build = BUILDERS[slug];
  if (!build) return [];
  try {
    return await build();
  } catch {
    return [];
  }
}
