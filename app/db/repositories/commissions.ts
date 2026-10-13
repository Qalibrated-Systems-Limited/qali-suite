import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { commissionTiers, staffCommissions } from "../schema/commissions";
import { employees } from "../schema/hr";

/**
 * Commission — manual, tiered. A manager records revenue per staff per month;
 * the tier multiplier turns it into commission; the leaderboard ranks staff by
 * total commission. All reads are RLS-scoped; an explicit company filter is
 * passed too so a privileged connection still sees one tenant.
 */

const DEFAULT_TIERS = [
  { level: "T1", name: "Tier 1", multiplier: "1", sortOrder: 1 },
  { level: "T2", name: "Tier 2", multiplier: "1.25", sortOrder: 2 },
  { level: "T3", name: "Tier 3", multiplier: "1.5", sortOrder: 3 },
  { level: "T4", name: "Tier 4", multiplier: "2", sortOrder: 4 },
];

const num = (v: unknown) => Number(v ?? 0) || 0;

/** The tiers for a company, seeding the prototype's four the first time. */
export async function listTiers(tx: Tx, companyId: string) {
  const rows = await tx
    .select()
    .from(commissionTiers)
    .where(eq(commissionTiers.companyId, companyId))
    .orderBy(asc(commissionTiers.sortOrder), asc(commissionTiers.level));
  if (rows.length > 0) return rows;

  // Lazy seed — first open of the module for this company.
  await tx
    .insert(commissionTiers)
    .values(DEFAULT_TIERS.map((t) => ({ ...t, companyId })))
    .onConflictDoNothing();
  return tx
    .select()
    .from(commissionTiers)
    .where(eq(commissionTiers.companyId, companyId))
    .orderBy(asc(commissionTiers.sortOrder), asc(commissionTiers.level));
}

export async function upsertTier(
  tx: Tx,
  companyId: string,
  input: {
    level: string;
    name?: string;
    multiplier: string;
    minRevenue?: string | null;
    description?: string;
    sortOrder?: number;
  },
) {
  // Match on (company, lower(level)) — a functional unique index, so update the
  // existing tier explicitly rather than relying on ON CONFLICT against it.
  const existing = await tx
    .select({ id: commissionTiers.id })
    .from(commissionTiers)
    .where(
      and(
        eq(commissionTiers.companyId, companyId),
        sql`lower(${commissionTiers.level}) = lower(${input.level})`,
      ),
    )
    .limit(1);

  const fields = {
    name: input.name ?? "",
    multiplier: input.multiplier,
    minRevenue: input.minRevenue ?? null,
    description: input.description ?? "",
    sortOrder: input.sortOrder ?? 0,
  };

  if (existing.length > 0) {
    await tx
      .update(commissionTiers)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(commissionTiers.id, existing[0].id));
  } else {
    await tx
      .insert(commissionTiers)
      .values({ companyId, level: input.level, ...fields });
  }
}

export async function deleteTier(tx: Tx, companyId: string, id: string) {
  await tx
    .delete(commissionTiers)
    .where(
      and(eq(commissionTiers.companyId, companyId), eq(commissionTiers.id, id)),
    );
}

/** Employees to pick from when recording a commission. */
export async function listEmployeesForPicker(tx: Tx, companyId: string) {
  const rows = await tx
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      fullName: employees.fullName,
      employeeNumber: employees.employeeNumber,
    })
    .from(employees)
    .where(
      and(eq(employees.companyId, companyId), eq(employees.status, "active")),
    )
    .orderBy(asc(employees.fullName), asc(employees.firstName));
  return rows.map((e) => ({
    id: e.id,
    name:
      (e.fullName && e.fullName.trim()) ||
      `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() ||
      e.employeeNumber,
    employeeNumber: e.employeeNumber,
  }));
}

const empName = sql<string>`COALESCE(NULLIF(btrim(${employees.fullName}), ''), btrim(${employees.firstName} || ' ' || ${employees.lastName}), ${employees.employeeNumber})`;

/** Commission rows, newest month first, with the staff member's name. */
export async function listCommissions(
  tx: Tx,
  companyId: string,
  filters: { month?: string | null; status?: string | null } = {},
) {
  const where = [eq(staffCommissions.companyId, companyId)];
  if (filters.month) where.push(eq(staffCommissions.periodMonth, filters.month));
  if (filters.status) where.push(eq(staffCommissions.status, filters.status));

  return tx
    .select({
      id: staffCommissions.id,
      employeeId: staffCommissions.employeeId,
      employeeName: empName,
      periodMonth: staffCommissions.periodMonth,
      revenueAmount: staffCommissions.revenueAmount,
      tierLevel: staffCommissions.tierLevel,
      tierMultiplier: staffCommissions.tierMultiplier,
      commissionAmount: staffCommissions.commissionAmount,
      status: staffCommissions.status,
      paidOn: staffCommissions.paidOn,
      note: staffCommissions.note,
    })
    .from(staffCommissions)
    .leftJoin(employees, eq(employees.id, staffCommissions.employeeId))
    .where(and(...where))
    .orderBy(desc(staffCommissions.periodMonth), desc(staffCommissions.commissionAmount));
}

export async function createCommission(
  tx: Tx,
  companyId: string,
  input: {
    employeeId: string;
    periodMonth: string;
    revenueAmount: string;
    tierLevel: string;
    tierMultiplier: string;
    note?: string;
    createdById?: string | null;
    createdByName?: string;
  },
) {
  const commission = (
    num(input.revenueAmount) * num(input.tierMultiplier)
  ).toFixed(4);
  await tx.insert(staffCommissions).values({
    companyId,
    employeeId: input.employeeId,
    periodMonth: input.periodMonth,
    revenueAmount: input.revenueAmount,
    tierLevel: input.tierLevel,
    tierMultiplier: input.tierMultiplier,
    commissionAmount: commission,
    note: input.note ?? "",
    createdById: input.createdById ?? null,
    createdByName: input.createdByName ?? "System",
  });
}

export async function setCommissionStatus(
  tx: Tx,
  companyId: string,
  id: string,
  status: "pending" | "paid",
) {
  await tx
    .update(staffCommissions)
    .set({
      status,
      paidOn: status === "paid" ? sql`CURRENT_DATE` : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(staffCommissions.companyId, companyId),
        eq(staffCommissions.id, id),
      ),
    );
}

export async function deleteCommission(tx: Tx, companyId: string, id: string) {
  await tx
    .delete(staffCommissions)
    .where(
      and(
        eq(staffCommissions.companyId, companyId),
        eq(staffCommissions.id, id),
      ),
    );
}

/** Top earners — total commission per staff member, ranked. */
export async function leaderboard(
  tx: Tx,
  companyId: string,
  filters: { month?: string | null } = {},
) {
  const where = [eq(staffCommissions.companyId, companyId)];
  if (filters.month) where.push(eq(staffCommissions.periodMonth, filters.month));

  const rows = await tx
    .select({
      employeeId: staffCommissions.employeeId,
      employeeName: empName,
      topTier: sql<string>`(array_agg(${staffCommissions.tierLevel} ORDER BY ${staffCommissions.commissionAmount} DESC))[1]`,
      totalRevenue: sql<string>`COALESCE(SUM(${staffCommissions.revenueAmount}), 0)`,
      totalCommission: sql<string>`COALESCE(SUM(${staffCommissions.commissionAmount}), 0)`,
      entries: sql<number>`COUNT(*)::int`,
    })
    .from(staffCommissions)
    .leftJoin(employees, eq(employees.id, staffCommissions.employeeId))
    .where(and(...where))
    .groupBy(staffCommissions.employeeId, empName)
    .orderBy(desc(sql`SUM(${staffCommissions.commissionAmount})`))
    .limit(20);

  return rows.map((r, i) => ({
    rank: i + 1,
    employeeId: r.employeeId,
    name: r.employeeName,
    tier: r.topTier || "—",
    totalRevenue: num(r.totalRevenue),
    totalCommission: num(r.totalCommission),
    entries: r.entries,
  }));
}

/** Headline totals for the KPI row. */
export async function totals(
  tx: Tx,
  companyId: string,
  filters: { month?: string | null } = {},
) {
  const where = [eq(staffCommissions.companyId, companyId)];
  if (filters.month) where.push(eq(staffCommissions.periodMonth, filters.month));
  const [row] = await tx
    .select({
      revenue: sql<string>`COALESCE(SUM(${staffCommissions.revenueAmount}), 0)`,
      commission: sql<string>`COALESCE(SUM(${staffCommissions.commissionAmount}), 0)`,
      paid: sql<string>`COALESCE(SUM(${staffCommissions.commissionAmount}) FILTER (WHERE ${staffCommissions.status} = 'paid'), 0)`,
      pending: sql<string>`COALESCE(SUM(${staffCommissions.commissionAmount}) FILTER (WHERE ${staffCommissions.status} = 'pending'), 0)`,
      people: sql<number>`COUNT(DISTINCT ${staffCommissions.employeeId})::int`,
    })
    .from(staffCommissions)
    .where(and(...where));
  return {
    revenue: num(row?.revenue),
    commission: num(row?.commission),
    paid: num(row?.paid),
    pending: num(row?.pending),
    people: row?.people ?? 0,
  };
}

/** The distinct months that have commission rows, newest first — for the picker. */
export async function listMonths(tx: Tx, companyId: string) {
  const rows = await tx
    .selectDistinct({ periodMonth: staffCommissions.periodMonth })
    .from(staffCommissions)
    .where(eq(staffCommissions.companyId, companyId))
    .orderBy(desc(staffCommissions.periodMonth));
  return rows.map((r) => r.periodMonth);
}
