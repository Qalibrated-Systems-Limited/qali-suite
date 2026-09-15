"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import * as kpisRepo from "../repositories/kpis";
import { listEmployeesForOwnerPicker } from "./hr-employee-actions";
import { KPI_TEMPLATES } from "@/app/dashboard/kpis/lib/kpi-templates";
import { rolesFor } from "@/lib/capabilities";

/**
 * KPI actions on Postgres — 0097.
 *
 * RESULT SHAPES ARE THE SCREENS'. Every read returns the document shape the
 * KPI components already render — `_id`, `customThresholds`, `statusLabels`,
 * `latestSnapshot`, `series` — so a screen moves over by changing an import
 * path. The one exception is `owner`, which gains an `employeeId`: the Mongo
 * version could not store one because employees had become uuids, and the
 * form is updated to send it.
 *
 * WHO MAY DO WHAT. Defining a KPI is a managerial act; entering an actual is
 * a bookkeeping one, so the Accountant is added for that and only that. Both
 * lists are the Mongo action's, unchanged.
 *
 * REDIRECT-FROM-ACTION. `redirect()` throws NEXT_REDIRECT, which Next catches
 * — so it must live OUTSIDE the try, or the catch swallows the navigation and
 * the form sits there looking like it failed.
 */

const MANAGE_ROLES = rolesFor("kpi.manage");
const ENTER_ROLES = rolesFor("kpi.enter");

type ActionResult =
  | { success: true; [k: string]: unknown }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

function revalidateKpis(kpiId?: string | null) {
  revalidatePath("/dashboard/kpis");
  if (kpiId) revalidatePath(`/dashboard/kpis/${kpiId}`);
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listKpisPg(
  opts: { category?: string | null; includeInactive?: boolean } = {},
) {
  return withAuthorizedTenant([], (tx) => kpisRepo.listKpis(tx, opts));
}

export async function getKpiByIdPg(kpiId: string) {
  if (!kpiId) return null;
  return withAuthorizedTenant([], (tx) => kpisRepo.getKpi(tx, kpiId));
}

export async function getKpiWithSnapshotsPg(
  kpiId: string,
  opts: { limit?: number } = {},
) {
  if (!kpiId) return null;
  return withAuthorizedTenant([], (tx) =>
    kpisRepo.getKpiWithSnapshots(tx, kpiId, opts),
  );
}

/**
 * The dashboard widget's read.
 *
 * Unwired, as its Mongo original was — `getKpiSummaryForDashboard` had no
 * caller either, confirmed rather than assumed. Ported because the KPI strip
 * is the obvious next thing to put on a role dashboard, and leaving the read
 * out would mean writing it twice.
 */
export async function getKpiSummaryForDashboardPg(limit = 6) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      kpisRepo.getKpiSummary(tx, { limit }),
    );
  } catch {
    return [];
  }
}

/**
 * Employees for the owner picker.
 *
 * Delegates rather than re-querying: the employee register belongs to HR, and
 * a second copy of that SELECT here would drift. Returns `id` now — the KPI
 * stores it, which is the whole of decision 1 in the migration.
 */
export async function getKpiOwnerCandidatesPg(limit = 200) {
  const employees = await listEmployeesForOwnerPicker(limit);
  return employees.map((e) => ({
    employeeId: e.id,
    id: e.id,
    name: e.name,
    employeeNumber: e.employeeNumber,
    designation: e.designation,
    department: e.department,
  }));
}

// ── Form parsing ────────────────────────────────────────────────────────────

const CATEGORIES = ["financial", "operational", "hr", "customer", "compliance"];
const UNITS = ["currency", "percentage", "days", "count", "ratio"];
const DIRECTIONS = ["higher_is_better", "lower_is_better"];
const PERIODICITIES = ["monthly", "quarterly", "yearly"];

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function parseKpiForm(formData: FormData) {
  const errors: Record<string, string> = {};

  const name = str(formData, "name");
  const category = str(formData, "category");
  const source = str(formData, "source") || "manual";
  const unit = str(formData, "unit") || "currency";
  const periodicity = str(formData, "periodicity") || "monthly";
  const targetDirection = str(formData, "targetDirection") || "higher_is_better";
  const target = parseFloat(String(formData.get("target") ?? "NaN"));

  /**
   * Thresholds arrive as percentages ("95") and are stored as ratios (0.95).
   * Blank means "use the default bands", which is a null and not a zero — a
   * zero would be a threshold every number clears.
   */
  const parsePct = (key: string) => {
    const raw = str(formData, key);
    if (!raw) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n / 100 : null;
  };
  const onTargetThreshold = parsePct("onTargetThreshold");
  const nearTargetThreshold = parsePct("nearTargetThreshold");

  if (!name) errors.name = "Name is required";
  else if (name.length > 80) errors.name = "Name must be 80 characters or less";
  if (!CATEGORIES.includes(category)) errors.category = "Invalid category";
  if (!(kpisRepo.KPI_SOURCES as readonly string[]).includes(source))
    errors.source = "Invalid source";
  if (!UNITS.includes(unit)) errors.unit = "Invalid unit";
  if (!PERIODICITIES.includes(periodicity))
    errors.periodicity = "Invalid periodicity";
  if (!DIRECTIONS.includes(targetDirection))
    errors.targetDirection = "Invalid direction";
  if (!Number.isFinite(target)) errors.target = "Target must be a number";

  /**
   * The same rule `kpis_thresholds_agree_with_direction` enforces. Checked
   * here as well so the message lands on the field rather than as a banner —
   * the constraint is the guarantee, this is the manners.
   */
  if (onTargetThreshold != null && nearTargetThreshold != null) {
    const lowerIsBetter = targetDirection === "lower_is_better";
    if (lowerIsBetter && onTargetThreshold > nearTargetThreshold) {
      errors.nearTargetThreshold =
        "Near-target must be greater than on-target for lower-is-better";
    }
    if (!lowerIsBetter && onTargetThreshold < nearTargetThreshold) {
      errors.nearTargetThreshold =
        "Near-target must be lower than on-target for higher-is-better";
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data: {
      name,
      description: str(formData, "description"),
      category,
      source,
      unit,
      periodicity,
      target,
      targetDirection,
      onTargetThreshold,
      nearTargetThreshold,
      statusLabelOnTarget: str(formData, "statusLabelOnTarget"),
      statusLabelNearTarget: str(formData, "statusLabelNearTarget"),
      statusLabelOffTarget: str(formData, "statusLabelOffTarget"),
      ownerEmployeeId: str(formData, "ownerEmployeeId") || null,
      ownerName: str(formData, "ownerName"),
      ownerEmployeeNumber: str(formData, "ownerEmployeeNumber"),
    },
  };
}

// ── Writes ──────────────────────────────────────────────────────────────────

export async function createKpi(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  let newId: string | null = null;
  try {
    const parsed = parseKpiForm(formData);
    if (!parsed.valid) {
      return {
        success: false,
        error: "Please fix the highlighted fields",
        fieldErrors: parsed.errors,
      };
    }

    const { id } = await withAuthorizedTenant(
      MANAGE_ROLES,
      (tx, { user, companyId }) =>
        kpisRepo.createKpi(tx, {
          ...parsed.data,
          companyId,
          actorId: user.id,
          actorName: user.name ?? "System",
        }),
    );

    revalidateKpis();
    newId = id;
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to create KPI") };
  }
  redirect(`/dashboard/kpis/${newId}`);
}

export async function updateKpi(
  kpiId: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const parsed = parseKpiForm(formData);
    if (!parsed.valid) {
      return {
        success: false,
        error: "Please fix the highlighted fields",
        fieldErrors: parsed.errors,
      };
    }

    await withAuthorizedTenant(MANAGE_ROLES, (tx, { user, companyId }) =>
      kpisRepo.updateKpi(tx, kpiId, {
        ...parsed.data,
        companyId,
        actorId: user.id,
        actorName: user.name ?? "System",
      }),
    );

    revalidateKpis(kpiId);
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to update KPI") };
  }
  redirect(`/dashboard/kpis/${kpiId}`);
}

/**
 * The inline target edit.
 *
 * Historical snapshots keep the `target_at_time` they were recorded against —
 * moving the target does not re-judge a quarter that has already closed.
 */
export async function updateKpiTarget(
  kpiId: string,
  newTarget: number | string,
): Promise<ActionResult> {
  try {
    const target = parseFloat(String(newTarget));
    if (!Number.isFinite(target)) {
      return { success: false, error: "Target must be a number" };
    }

    await withAuthorizedTenant(MANAGE_ROLES, (tx, { user }) =>
      kpisRepo.setKpiTarget(tx, kpiId, target, {
        id: user.id,
        name: user.name ?? null,
      }),
    );

    revalidateKpis(kpiId);
  } catch (error) {
    return {
      success: false,
      error: userMessage(error, "Failed to update target"),
    };
  }
  redirect(`/dashboard/kpis/${kpiId}`);
}

export async function setKpiActive(
  kpiId: string,
  isActive: boolean,
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(MANAGE_ROLES, (tx, { user }) =>
      kpisRepo.setKpiActive(tx, kpiId, !!isActive, {
        id: user.id,
        name: user.name ?? null,
      }),
    );
    revalidateKpis(kpiId);
  } catch (error) {
    return {
      success: false,
      error: userMessage(error, "Failed to update KPI status"),
    };
  }
  redirect(`/dashboard/kpis/${kpiId}`);
}

export async function recordKpiSnapshot(
  kpiId: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const periodYear = parseInt(String(formData.get("periodYear") ?? ""), 10);
    const periodMonth = parseInt(String(formData.get("periodMonth") ?? ""), 10);
    const actualValue = parseFloat(String(formData.get("actualValue") ?? "NaN"));
    const notes = str(formData, "notes");

    const errors: Record<string, string> = {};
    if (!Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 2100)
      errors.periodYear = "Invalid year";
    if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12)
      errors.periodMonth = "Invalid month";
    if (!Number.isFinite(actualValue))
      errors.actualValue = "Actual value must be a number";
    if (Object.keys(errors).length > 0) {
      return {
        success: false,
        error: "Please fix the highlighted fields",
        fieldErrors: errors,
      };
    }

    await withAuthorizedTenant(ENTER_ROLES, (tx, { user }) =>
      kpisRepo.recordSnapshot(
        tx,
        kpiId,
        { periodYear, periodMonth, actualValue, notes, source: "manual" },
        { id: user.id, name: user.name ?? null },
      ),
    );

    revalidateKpis(kpiId);
  } catch (error) {
    return {
      success: false,
      error: userMessage(error, "Failed to record snapshot"),
    };
  }
  redirect(`/dashboard/kpis/${kpiId}`);
}

/**
 * Compute one period's actual from the ledger, payroll, invoices or HR and
 * store it.
 *
 * This is the action that was broken rather than merely stranded: every
 * formula read a Mongo collection that stopped receiving writes, so a KPI on
 * an auto source has been recording zero and the board has been painting it
 * red. See the DEVIATION notes in `repositories/kpis.ts` for the three
 * formulas whose answer also changes.
 */
export async function computeKpiSnapshot(
  kpiId: string,
  periodYear: number,
  periodMonth: number,
): Promise<ActionResult> {
  try {
    if (
      !Number.isInteger(periodYear) ||
      !Number.isInteger(periodMonth) ||
      periodMonth < 1 ||
      periodMonth > 12
    ) {
      return { success: false, error: "Invalid period" };
    }

    await withAuthorizedTenant(ENTER_ROLES, (tx, { user }) =>
      kpisRepo.computeAndRecordSnapshot(tx, kpiId, periodYear, periodMonth, {
        id: user.id,
        name: user.name ?? null,
      }),
    );

    revalidateKpis(kpiId);
  } catch (error) {
    return {
      success: false,
      error: userMessage(error, "Failed to compute KPI snapshot"),
    };
  }
  redirect(`/dashboard/kpis/${kpiId}`);
}

export async function deleteKpiSnapshot(
  snapshotId: string,
): Promise<ActionResult> {
  let kpiId: string | null = null;
  try {
    const result = await withAuthorizedTenant(MANAGE_ROLES, (tx) =>
      kpisRepo.deleteSnapshot(tx, snapshotId),
    );
    kpiId = result.kpiId;
    revalidateKpis(kpiId);
  } catch (error) {
    return {
      success: false,
      error: userMessage(error, "Failed to delete snapshot"),
    };
  }
  redirect(`/dashboard/kpis/${kpiId}`);
}

/**
 * Seed from the curated template library.
 *
 * `selectedKeys` null or empty means all of them, which is what the dialog's
 * "select all" path sends. Idempotent by `kpis_name_uq` rather than by a
 * read-then-diff, so two people pressing the button together cannot produce
 * two Monthly Revenues.
 */
export async function seedStarterKpis(
  selectedKeys: string[] | null = null,
): Promise<ActionResult> {
  try {
    const toSeed =
      Array.isArray(selectedKeys) && selectedKeys.length > 0
        ? KPI_TEMPLATES.filter((t: { key: string }) =>
            selectedKeys.includes(t.key),
          )
        : KPI_TEMPLATES;

    if (toSeed.length === 0) {
      return { success: false, error: "No templates selected" };
    }

    await withAuthorizedTenant(MANAGE_ROLES, (tx, { user, companyId }) =>
      kpisRepo.seedKpisFromTemplates(tx, companyId, toSeed, {
        id: user.id,
        name: user.name ?? "System",
      }),
    );

    revalidateKpis();
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to seed KPIs") };
  }
  // The list page re-renders and the dialog unmounts with it, so there is no
  // client-side close to manage.
  redirect("/dashboard/kpis");
}
