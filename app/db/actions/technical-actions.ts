"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { TECHNICAL_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/technical";

/**
 * Technical department actions — Calibration (17025) & Inspection (17020), 0079.
 * Same shape as the report actions: Zod validates, `withAuthorizedTenant`
 * scopes, the repository does the SQL. Writes return {success,message} or
 * {error}; reads are open to any authenticated member of the company.
 */

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return { id: user?.id ?? null, name: user?.name || "Unknown User" };
}
function s(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v : "";
}
function revalidateCal() {
  revalidatePath("/dashboard/calibration");
  revalidatePath("/dashboard/technical/overview");
}
function revalidateIns() {
  revalidatePath("/dashboard/inspection");
}

// ── reads ────────────────────────────────────────────────────────────────────
export async function getCalibrationData() {
  return withAuthorizedTenant([], async (tx) => {
    const [jobs, standards, stats] = await Promise.all([
      repo.listJobs(tx),
      repo.listStandards(tx),
      repo.getCalibrationStats(tx),
    ]);
    return {
      jobs: jobs.map((r) => ({ ...r, _id: String(r.id) })),
      standards: standards.map((r) => ({ ...r, _id: String(r.id) })),
      stats,
    };
  });
}

export async function getInspectionData() {
  return withAuthorizedTenant([], async (tx) => {
    const [rows, inspectors, stats] = await Promise.all([
      repo.listInspections(tx),
      repo.listInspectors(tx),
      repo.getInspectionStats(tx),
    ]);
    return {
      inspections: rows.map((r) => ({ ...r, _id: String(r.id) })),
      inspectors,
      stats,
    };
  });
}

// ── Calibration jobs ──────────────────────────────────────────────────────────
const jobSchema = z.object({
  clientName: z.string().trim().min(1, "Client is required").max(200),
  site: z.string().trim().max(200).optional(),
  serviceType: z.string().trim().max(120).optional(),
  scheduledDate: z.string().optional(),
  technicianName: z.string().trim().max(160).optional(),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createCalibrationJob(prevState: unknown, formData: FormData) {
  const parsed = jobSchema.safeParse({
    clientName: s(formData.get("clientName")),
    site: s(formData.get("site")),
    serviceType: s(formData.get("serviceType")),
    scheduledDate: s(formData.get("scheduledDate")),
    technicianName: s(formData.get("technicianName")),
    status: s(formData.get("status")) || undefined,
    notes: s(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Check the form" };
  }
  const d = parsed.data;
  try {
    const row = await withAuthorizedTenant(
      TECHNICAL_WRITE_ROLES as unknown as string[],
      (tx, { user, companyId }) =>
        repo.createJob(tx, { companyId, ...d, createdById: actorFrom(user).id, createdByName: actorFrom(user).name }),
    );
    revalidateCal();
    return { success: true, message: `${row.jobNumber} created` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function setCalibrationJobOutcome(
  id: string,
  input: { status?: string; result?: string; billingStatus?: string },
) {
  try {
    const row = await withAuthorizedTenant(
      TECHNICAL_WRITE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const updated = await repo.setJobOutcome(tx, id, input, actorFrom(user));
        if (!updated) throw new Error("Job not found");
        return updated;
      },
    );
    revalidateCal();
    return { success: true, message: `${row.jobNumber} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteCalibrationJob(id: string) {
  try {
    await withAuthorizedTenant(TECHNICAL_WRITE_ROLES as unknown as string[], (tx) => repo.deleteJob(tx, id));
    revalidateCal();
    return { success: true, message: "Job deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── Calibration standards ─────────────────────────────────────────────────────
const standardSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  traceability: z.string().trim().max(200).optional(),
  lastCalibration: z.string().optional(),
  nextCalibration: z.string().optional(),
  uncertainty: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createCalibrationStandard(prevState: unknown, formData: FormData) {
  const parsed = standardSchema.safeParse({
    name: s(formData.get("name")),
    traceability: s(formData.get("traceability")),
    lastCalibration: s(formData.get("lastCalibration")),
    nextCalibration: s(formData.get("nextCalibration")),
    uncertainty: s(formData.get("uncertainty")),
    notes: s(formData.get("notes")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;
  try {
    await withAuthorizedTenant(
      TECHNICAL_WRITE_ROLES as unknown as string[],
      (tx, { user, companyId }) =>
        repo.createStandard(tx, { companyId, ...d, createdById: actorFrom(user).id, createdByName: actorFrom(user).name }),
    );
    revalidateCal();
    return { success: true, message: "Reference standard added" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteCalibrationStandard(id: string) {
  try {
    await withAuthorizedTenant(TECHNICAL_WRITE_ROLES as unknown as string[], (tx) => repo.deleteStandard(tx, id));
    revalidateCal();
    return { success: true, message: "Standard removed" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── Inspections ───────────────────────────────────────────────────────────────
const inspectionSchema = z.object({
  clientName: z.string().trim().min(1, "Client is required").max(200),
  type: z.string().trim().max(120).optional(),
  equipmentSerial: z.string().trim().max(120).optional(),
  inspectorName: z.string().trim().max(160).optional(),
  scheduledDate: z.string().optional(),
  ruling: z.enum(["pending", "pass", "fail", "quarantined"]).optional(),
  authorityExpiry: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createInspection(prevState: unknown, formData: FormData) {
  const parsed = inspectionSchema.safeParse({
    clientName: s(formData.get("clientName")),
    type: s(formData.get("type")),
    equipmentSerial: s(formData.get("equipmentSerial")),
    inspectorName: s(formData.get("inspectorName")),
    scheduledDate: s(formData.get("scheduledDate")),
    ruling: s(formData.get("ruling")) || undefined,
    authorityExpiry: s(formData.get("authorityExpiry")),
    notes: s(formData.get("notes")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;
  try {
    const row = await withAuthorizedTenant(
      TECHNICAL_WRITE_ROLES as unknown as string[],
      (tx, { user, companyId }) =>
        repo.createInspection(tx, { companyId, ...d, createdById: actorFrom(user).id, createdByName: actorFrom(user).name }),
    );
    revalidateIns();
    return { success: true, message: `${row.inspectionNumber} created` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function setInspectionOutcome(
  id: string,
  input: { ruling?: string; appealStatus?: string },
) {
  try {
    const row = await withAuthorizedTenant(
      TECHNICAL_WRITE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const updated = await repo.setInspectionOutcome(tx, id, input, actorFrom(user));
        if (!updated) throw new Error("Inspection not found");
        return updated;
      },
    );
    revalidateIns();
    return { success: true, message: `${row.inspectionNumber} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteInspection(id: string) {
  try {
    await withAuthorizedTenant(TECHNICAL_WRITE_ROLES as unknown as string[], (tx) => repo.deleteInspection(tx, id));
    revalidateIns();
    return { success: true, message: "Inspection deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
