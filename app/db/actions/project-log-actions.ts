"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { PROJECT_MANAGE_ROLES, PROJECT_LOG_SIGNOFF_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/projectLogs";

/**
 * Engineer's Instructions & Site Diary actions — 0075.
 *
 * Same shape as the task actions in `project-actions.ts`: Zod validates the
 * form, `withAuthorizedTenant` resolves the session and scopes the
 * transaction, the repository does the SQL. Every write returns
 * `{success, message}` or `{errors, values}`, matching the convention every
 * other Projects-module client component already expects.
 */

type FieldErrors = Record<string, string[]>;

function fieldErrorsFrom(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

function valuesOf(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return {
    id: user?.id ?? null,
    name: user?.name || "Unknown User",
  };
}

/** Same treatment `project-actions.ts` gives an absent optional field. */
const optionalText = z.preprocess(
  (v) => v ?? "",
  z.string().optional().or(z.literal("")),
);

const optionalTextMax = (max: number, message: string) =>
  z.preprocess((v) => v ?? "", z.string().max(max, message).optional().or(z.literal("")));

/** `numeric(19,4)` as a string, or null. Never a float. */
const decimalOrNull = (v: string | undefined | null, scale = 2) => {
  const trimmed = (v ?? "").trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n.toFixed(scale) : null;
};

const intOrZero = (v: string | undefined | null) => {
  const n = parseInt((v ?? "").trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

function revalidateLogs(projectId?: string | null) {
  revalidatePath("/dashboard/projects");
  if (projectId) {
    revalidatePath(`/dashboard/projects/instructions`);
    revalidatePath(`/dashboard/projects/diary`);
    revalidatePath(`/dashboard/projects/monthly-report`);
    revalidatePath(`/dashboard/projects/${projectId}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Engineer's Instructions
// ─────────────────────────────────────────────────────────────────────────────

const instructionSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  type: z.enum(["instruction", "ncr", "vo", "rfi_response"]),
  clauseReference: optionalText,
  location: optionalText,
  description: z.string().min(1, "A description is required").max(4000, "Description too long"),
  estimatedCost: optionalText,
  issuedDate: z.string().min(1, "Date is required"),
  issuedByName: z.string().min(1, "Who issued this is required").max(200, "Name too long"),
});

function instructionFields(formData: FormData) {
  return {
    projectId: formData.get("projectId"),
    type: formData.get("type") || "instruction",
    clauseReference: formData.get("clauseReference"),
    location: formData.get("location"),
    description: formData.get("description"),
    estimatedCost: formData.get("estimatedCost"),
    issuedDate: formData.get("issuedDate"),
    issuedByName: formData.get("issuedByName"),
  };
}

export async function getProjectInstructions(projectId: string) {
  if (!projectId) return [];
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.listInstructions(tx, projectId);
    return rows.map((r) => ({ ...r, _id: String(r.id) }));
  });
}

export async function getInstructionsSummary(projectId: string) {
  if (!projectId) return { total: 0, pending: 0, complied: 0, disputed: 0, ncrs: 0 };
  return withAuthorizedTenant([], (tx) => repo.getInstructionsSummary(tx, projectId));
}

export async function createInstruction(prevState: unknown, formData: FormData) {
  const values = valuesOf(formData);
  const parsed = instructionSchema.safeParse(instructionFields(formData));
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const actor = actorFrom(user);
        return repo.createInstruction(tx, {
          companyId,
          projectId: d.projectId,
          type: d.type,
          clauseReference: d.clauseReference || "",
          location: d.location || "",
          description: d.description,
          estimatedCost: decimalOrNull(d.estimatedCost),
          issuedDate: d.issuedDate,
          issuedByName: d.issuedByName,
          createdById: actor.id,
          createdByName: actor.name,
        });
      },
    );
    revalidateLogs(d.projectId);
    return { success: true, message: `${row.instructionNumber} logged`, id: row.id };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

export async function updateInstruction(
  id: string,
  prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const parsed = instructionSchema.safeParse(instructionFields(formData));
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const actor = actorFrom(user);
        const row = await repo.updateInstruction(tx, id, {
          type: d.type,
          clauseReference: d.clauseReference || "",
          location: d.location || "",
          description: d.description,
          estimatedCost: decimalOrNull(d.estimatedCost),
          issuedDate: d.issuedDate,
          issuedByName: d.issuedByName,
          lastModifiedById: actor.id,
          lastModifiedByName: actor.name,
        });
        if (!row) throw new Error("Instruction not found");
        return row;
      },
    );
    revalidateLogs(d.projectId);
    return { success: true, message: "Instruction updated" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

/** The compliance decision — Complied / Disputed / reopened to Pending. */
export async function setInstructionStatus(
  id: string,
  projectId: string,
  input: { status: "pending" | "complied" | "disputed"; responseNotes?: string },
) {
  try {
    const row = await withAuthorizedTenant(
      PROJECT_LOG_SIGNOFF_ROLES as unknown as string[],
      async (tx, { user }) => {
        const updated = await repo.setInstructionStatus(
          tx,
          id,
          input.status,
          input.responseNotes ?? null,
          actorFrom(user),
        );
        if (!updated) throw new Error("Instruction not found");
        return updated;
      },
    );
    revalidateLogs(projectId);
    return { success: true, message: `${row.instructionNumber} marked ${row.status}` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function deleteInstruction(id: string, projectId: string) {
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx) => {
        const existing = await repo.getInstructionById(tx, id);
        if (!existing) throw new Error("Instruction not found");
        if (existing.status !== "pending") {
          throw new Error("Only a pending instruction can be deleted — reopen it first.");
        }
        return repo.deleteInstruction(tx, id);
      },
    );
    revalidateLogs(projectId);
    return { success: true, message: "Instruction deleted" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Site Diary
// ─────────────────────────────────────────────────────────────────────────────

const diarySchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  diaryDate: z.string().min(1, "Date is required"),
  weather: optionalText,
  location: optionalText,
  activities: z.string().min(1, "Activities carried out are required").max(4000, "Too long"),
  plant: optionalText,
  manpowerCount: optionalText,
  incidentCount: optionalText,
  incidentNotes: optionalTextMax(2000, "Too long"),
  loggedByName: z.string().min(1, "Logged by is required").max(200, "Name too long"),
});

function diaryFields(formData: FormData) {
  return {
    projectId: formData.get("projectId"),
    diaryDate: formData.get("diaryDate"),
    weather: formData.get("weather"),
    location: formData.get("location"),
    activities: formData.get("activities"),
    plant: formData.get("plant"),
    manpowerCount: formData.get("manpowerCount"),
    incidentCount: formData.get("incidentCount"),
    incidentNotes: formData.get("incidentNotes"),
    loggedByName: formData.get("loggedByName"),
  };
}

export async function getProjectDiaryEntries(projectId: string) {
  if (!projectId) return [];
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.listDiaryEntries(tx, projectId);
    return rows.map((r) => ({ ...r, _id: String(r.id) }));
  });
}

/** Everything Monthly Report needs from the diary for one date range. */
export async function getDiarySummaryForRange(
  projectId: string,
  range: { from: string; to: string },
) {
  if (!projectId) {
    return { entryCount: 0, unsignedCount: 0, totalIncidents: 0, incidentDays: [], avgManpower: 0, entries: [] };
  }
  return withAuthorizedTenant([], (tx) => repo.getDiarySummary(tx, projectId, range));
}

export async function createDiaryEntry(prevState: unknown, formData: FormData) {
  const values = valuesOf(formData);
  const parsed = diarySchema.safeParse(diaryFields(formData));
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const actor = actorFrom(user);
        return repo.createDiaryEntry(tx, {
          companyId,
          projectId: d.projectId,
          diaryDate: d.diaryDate,
          weather: d.weather || "",
          location: d.location || "",
          activities: d.activities,
          plant: d.plant || "",
          manpowerCount: intOrZero(d.manpowerCount),
          incidentCount: intOrZero(d.incidentCount),
          incidentNotes: d.incidentNotes || "",
          loggedByName: d.loggedByName,
          createdById: actor.id,
          createdByName: actor.name,
        });
      },
    );
    revalidateLogs(d.projectId);
    return { success: true, message: `${row.entryNumber} logged`, id: row.id };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

export async function updateDiaryEntry(
  id: string,
  prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const parsed = diarySchema.safeParse(diaryFields(formData));
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const existing = await repo.getDiaryEntryById(tx, id);
        if (!existing) throw new Error("Diary entry not found");
        if (existing.status === "countersigned") {
          throw new Error("A countersigned diary entry cannot be edited.");
        }
        const actor = actorFrom(user);
        return repo.updateDiaryEntry(tx, id, {
          diaryDate: d.diaryDate,
          weather: d.weather || "",
          location: d.location || "",
          activities: d.activities,
          plant: d.plant || "",
          manpowerCount: intOrZero(d.manpowerCount),
          incidentCount: intOrZero(d.incidentCount),
          incidentNotes: d.incidentNotes || "",
          loggedByName: d.loggedByName,
          lastModifiedById: actor.id,
          lastModifiedByName: actor.name,
        });
      },
    );
    revalidateLogs(d.projectId);
    return { success: true, message: "Diary entry updated" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

/** The RE countersignature. */
export async function signDiaryEntry(id: string, projectId: string) {
  try {
    const row = await withAuthorizedTenant(
      PROJECT_LOG_SIGNOFF_ROLES as unknown as string[],
      async (tx, { user }) => {
        const updated = await repo.signDiaryEntry(tx, id, actorFrom(user));
        if (!updated) throw new Error("Diary entry not found");
        return updated;
      },
    );
    revalidateLogs(projectId);
    return { success: true, message: `${row.entryNumber} countersigned` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function deleteDiaryEntry(id: string, projectId: string) {
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx) => {
        const existing = await repo.getDiaryEntryById(tx, id);
        if (!existing) throw new Error("Diary entry not found");
        if (existing.status === "countersigned") {
          throw new Error("A countersigned diary entry cannot be deleted.");
        }
        return repo.deleteDiaryEntry(tx, id);
      },
    );
    revalidateLogs(projectId);
    return { success: true, message: "Diary entry deleted" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}
