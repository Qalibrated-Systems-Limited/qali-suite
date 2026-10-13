"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import * as repo from "../repositories/commissions";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";

/**
 * Commission — manual, tiered, in Finance. Reads are open to anyone the tenant
 * guard lets in (RLS scopes them); writes require a finance-write role.
 */

const WRITE = FINANCE_WRITE_ROLES as unknown as string[];

function actor(user: { id?: string | null; name?: string | null }) {
  return { id: user?.id ?? null, name: user?.name ?? "System" };
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v == null ? "" : String(v).trim();
};

/** First day of the month for a `YYYY-MM` or `YYYY-MM-DD` input. */
function monthStart(input: string): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(input || "");
  if (!m) return null;
  return `${m[1]}-${m[2]}-01`;
}

export async function getCommissionOverview(
  month?: string | null,
  status?: string | null,
) {
  return withAuthorizedTenant([], async (tx, { companyId }) => {
    const monthKey = month ? monthStart(month) : null;
    const [tiers, rows, board, sums, months, people] = await Promise.all([
      repo.listTiers(tx, companyId),
      repo.listCommissions(tx, companyId, { month: monthKey, status }),
      repo.leaderboard(tx, companyId, { month: monthKey }),
      repo.totals(tx, companyId, { month: monthKey }),
      repo.listMonths(tx, companyId),
      repo.listEmployeesForPicker(tx, companyId),
    ]);
    return { tiers, rows, leaderboard: board, totals: sums, months, people };
  });
}

export async function recordCommission(formData: FormData) {
  try {
    const employeeId = str(formData, "employeeId");
    const month = monthStart(str(formData, "periodMonth"));
    const revenueAmount = str(formData, "revenueAmount");
    const tierLevel = str(formData, "tierLevel");
    const tierMultiplier = str(formData, "tierMultiplier");
    const note = str(formData, "note");

    if (!employeeId) return { error: "Choose a staff member." };
    if (!month) return { error: "Choose the month." };
    if (!(Number(revenueAmount) >= 0)) return { error: "Enter the revenue." };
    if (!tierLevel || !(Number(tierMultiplier) >= 0))
      return { error: "Choose a tier." };

    await withAuthorizedTenant(WRITE, async (tx, { user, companyId }) => {
      const a = actor(user);
      await repo.createCommission(tx, companyId, {
        employeeId,
        periodMonth: month,
        revenueAmount,
        tierLevel,
        tierMultiplier,
        note,
        createdById: a.id,
        createdByName: a.name,
      });
    });
    revalidatePath("/dashboard/commissions");
    return { success: true, message: "Commission recorded." };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function setCommissionStatusAction(
  id: string,
  status: "pending" | "paid",
) {
  if (!id) return { error: "No commission." };
  try {
    await withAuthorizedTenant(WRITE, (tx, { companyId }) =>
      repo.setCommissionStatus(tx, companyId, id, status),
    );
    revalidatePath("/dashboard/commissions");
    return { success: true, message: status === "paid" ? "Marked paid." : "Marked pending." };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteCommissionAction(id: string) {
  if (!id) return { error: "No commission." };
  try {
    await withAuthorizedTenant(WRITE, (tx, { companyId }) =>
      repo.deleteCommission(tx, companyId, id),
    );
    revalidatePath("/dashboard/commissions");
    return { success: true, message: "Deleted." };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function saveTierAction(formData: FormData) {
  try {
    const level = str(formData, "level");
    const multiplier = str(formData, "multiplier");
    if (!level) return { error: "Tier code is required." };
    if (!(Number(multiplier) >= 0)) return { error: "Multiplier must be a number." };
    const minRevenueRaw = str(formData, "minRevenue");

    await withAuthorizedTenant(WRITE, (tx, { companyId }) =>
      repo.upsertTier(tx, companyId, {
        level,
        name: str(formData, "name"),
        multiplier,
        minRevenue: minRevenueRaw === "" ? null : minRevenueRaw,
        description: str(formData, "description"),
        sortOrder: Number(str(formData, "sortOrder")) || 0,
      }),
    );
    revalidatePath("/dashboard/commissions");
    return { success: true, message: "Tier saved." };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteTierAction(id: string) {
  if (!id) return { error: "No tier." };
  try {
    await withAuthorizedTenant(WRITE, (tx, { companyId }) =>
      repo.deleteTier(tx, companyId, id),
    );
    revalidatePath("/dashboard/commissions");
    return { success: true, message: "Tier deleted." };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
