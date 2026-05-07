"use server";

import { revalidatePath } from "next/cache";
import { FiscalPeriodService } from "../services/fiscalPeriodService";
import {
  getFiscalPeriods,
  getFiscalPeriodById,
  getCurrentFiscalPeriod,
  getOpenFiscalPeriods,
  getPeriodSummary,
  getPeriodClosingChecklist,
  getPeriodsByYear,
  getFiscalPeriodStats,
} from "../queries/fiscalPeriodQueries";
import { auth } from "@/auth";
import { requirePlanAccess } from "@/lib/plan-gate";

// ============================================
// FISCAL PERIOD SERVER ACTIONS
// ============================================

/**
 * Get all fiscal periods with optional filters
 */
export async function fetchFiscalPeriods(filters = {}) {
  try {
    const periods = await getFiscalPeriods(filters);
    return { success: true, periods };
  } catch (error) {
    console.error("Error fetching fiscal periods:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get fiscal period by ID
 */
export async function fetchFiscalPeriodById(periodId) {
  try {
    const period = await getFiscalPeriodById(periodId);
    if (!period) {
      return { success: false, error: "Fiscal period not found" };
    }
    return { success: true, period };
  } catch (error) {
    console.error("Error fetching fiscal period:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get current active fiscal period
 */
export async function fetchCurrentPeriod() {
  try {
    const period = await getCurrentFiscalPeriod();
    return { success: true, period };
  } catch (error) {
    console.error("Error fetching current period:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all open fiscal periods
 */
export async function fetchOpenPeriods() {
  try {
    const periods = await getOpenFiscalPeriods();
    return { success: true, periods };
  } catch (error) {
    console.error("Error fetching open periods:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get periods by year
 */
export async function fetchPeriodsByYear(year) {
  try {
    const periods = await getPeriodsByYear(year);
    return { success: true, periods };
  } catch (error) {
    console.error("Error fetching periods by year:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get period summary with statistics
 */
export async function fetchPeriodSummary(periodId) {
  try {
    const summary = await getPeriodSummary(periodId);
    if (!summary) {
      return { success: false, error: "Fiscal period not found" };
    }
    return { success: true, summary };
  } catch (error) {
    console.error("Error fetching period summary:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get period closing checklist
 */
export async function fetchClosingChecklist(periodId) {
  try {
    const checklist = await getPeriodClosingChecklist(periodId);
    if (!checklist) {
      return { success: false, error: "Fiscal period not found" };
    }
    return { success: true, checklist };
  } catch (error) {
    console.error("Error fetching closing checklist:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get fiscal period dashboard stats
 */
export async function fetchFiscalPeriodStats() {
  try {
    const stats = await getFiscalPeriodStats();
    return { success: true, stats };
  } catch (error) {
    console.error("Error fetching fiscal period stats:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// MUTATION ACTIONS
// ============================================

/**
 * Create a new fiscal period
 */
export async function createFiscalPeriod(data) {
  try {
    await requirePlanAccess("finance");
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const user = {
      name: session.user.name,
      id: session.user.id,
    };

    const period = await FiscalPeriodService.createFiscalPeriod(data, user);

    revalidatePath("/dashboard/settings/fiscal-periods");
    revalidatePath("/dashboard/journal");

    return { success: true, period: JSON.parse(JSON.stringify(period)) };
  } catch (error) {
    console.error("Error creating fiscal period:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Create periods for a full year
 */
export async function createYearPeriods(year, periodType = "month") {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const user = {
      name: session.user.name,
      id: session.user.id,
    };

    const periods = await FiscalPeriodService.createYearPeriods(
      year,
      periodType,
      user
    );

    revalidatePath("/dashboard/settings/fiscal-periods");
    revalidatePath("/dashboard/journal");

    return {
      success: true,
      periods: JSON.parse(JSON.stringify(periods)),
      created: periods.length,
    };
  } catch (error) {
    console.error("Error creating year periods:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Update fiscal period
 */
export async function updateFiscalPeriod(periodId, data) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const user = {
      name: session.user.name,
      id: session.user.id,
    };

    const period = await FiscalPeriodService.updateFiscalPeriod(
      periodId,
      data,
      user
    );

    revalidatePath("/dashboard/settings/fiscal-periods");
    revalidatePath(`/dashboard/settings/fiscal-periods/${periodId}`);

    return { success: true, period: JSON.parse(JSON.stringify(period)) };
  } catch (error) {
    console.error("Error updating fiscal period:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Close fiscal period
 */
export async function closeFiscalPeriod(periodId) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    // Closing periods requires finance authority + Accountant.
    if (
      !["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(
        session.user.role,
      )
    ) {
      return { success: false, error: "You don't have permission to close fiscal periods." };
    }

    const user = {
      name: session.user.name,
      id: session.user.id,
    };

    const period = await FiscalPeriodService.closeFiscalPeriod(periodId, user);

    revalidatePath("/dashboard/settings/fiscal-periods");
    revalidatePath(`/dashboard/settings/fiscal-periods/${periodId}`);
    revalidatePath("/dashboard/journal");

    return { success: true, period: JSON.parse(JSON.stringify(period)) };
  } catch (error) {
    console.error("Error closing fiscal period:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Reopen fiscal period
 */
export async function reopenFiscalPeriod(periodId, reason) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    // Reopening is finance leadership only.
    if (
      !["SuperAdmin", "Admin", "CFO", "Finance Manager"].includes(
        session.user.role,
      )
    ) {
      return {
        success: false,
        error: "You don't have permission to reopen fiscal periods.",
      };
    }

    if (!reason || reason.trim().length === 0) {
      return { success: false, error: "Reason is required to reopen a period" };
    }

    const user = {
      name: session.user.name,
      id: session.user.id,
    };

    const period = await FiscalPeriodService.reopenFiscalPeriod(
      periodId,
      user,
      reason
    );

    revalidatePath("/dashboard/settings/fiscal-periods");
    revalidatePath(`/dashboard/settings/fiscal-periods/${periodId}`);
    revalidatePath("/dashboard/journal");

    return { success: true, period: JSON.parse(JSON.stringify(period)) };
  } catch (error) {
    console.error("Error reopening fiscal period:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Lock fiscal period (permanent - no more changes)
 */
export async function lockFiscalPeriod(periodId, reason) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    // Locking is finance leadership only.
    if (
      !["SuperAdmin", "Admin", "CFO", "Finance Manager"].includes(
        session.user.role,
      )
    ) {
      return {
        success: false,
        error: "You don't have permission to lock fiscal periods.",
      };
    }

    const user = {
      name: session.user.name,
      id: session.user.id,
    };

    const period = await FiscalPeriodService.lockFiscalPeriod(
      periodId,
      user,
      reason
    );

    revalidatePath("/dashboard/settings/fiscal-periods");
    revalidatePath(`/dashboard/settings/fiscal-periods/${periodId}`);
    revalidatePath("/dashboard/journal");

    return { success: true, period: JSON.parse(JSON.stringify(period)) };
  } catch (error) {
    console.error("Error locking fiscal period:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Calculate period statistics
 */
export async function calculatePeriodStatistics(periodId) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const statistics = await FiscalPeriodService.calculatePeriodStatistics(
      periodId
    );

    revalidatePath(`/dashboard/settings/fiscal-periods/${periodId}`);

    return { success: true, statistics };
  } catch (error) {
    console.error("Error calculating period statistics:", error);
    return { success: false, error: error.message };
  }
}
