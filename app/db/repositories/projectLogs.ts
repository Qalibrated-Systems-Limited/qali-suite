import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { projectInstructions, projectDiaryEntries } from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * Engineer's Instructions & Site Diary repository — 0075.
 *
 * Same contract as `repositories/projects.ts` §4.1: every function takes a
 * `tx` from `withTenant()`, so RLS is active, and nothing here reads the
 * session or checks a role. That happens one layer up, in
 * `project-log-actions.ts`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Engineer's Instructions
// ─────────────────────────────────────────────────────────────────────────────

async function nextInstructionNumber(tx: Tx, companyId: string) {
  const [{ instruction_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'EI') AS instruction_number`,
  )) as unknown as Array<{ instruction_number: string }>;
  return instruction_number;
}

export async function listInstructions(tx: Tx, projectId: string) {
  return tx
    .select()
    .from(projectInstructions)
    .where(eq(projectInstructions.projectId, projectId))
    .orderBy(desc(projectInstructions.issuedDate), desc(projectInstructions.createdAt));
}

export async function getInstructionById(tx: Tx, id: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with the
  // statement in the message. See isUuid in sqlHelpers — the same guard the
  // other 22 detail getters carry.
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select()
    .from(projectInstructions)
    .where(eq(projectInstructions.id, id));
  return row ?? null;
}

export interface CreateInstructionInput {
  companyId: string;
  projectId: string;
  type: "instruction" | "ncr" | "vo" | "rfi_response";
  clauseReference?: string | null;
  location?: string | null;
  description: string;
  estimatedCost?: string | null;
  issuedDate: string;
  issuedByName: string;
  createdById?: string | null;
  createdByName: string;
}

export async function createInstruction(tx: Tx, input: CreateInstructionInput) {
  const instructionNumber = await nextInstructionNumber(tx, input.companyId);
  const [row] = await tx
    .insert(projectInstructions)
    .values({
      companyId: input.companyId,
      projectId: input.projectId,
      instructionNumber,
      type: input.type,
      clauseReference: input.clauseReference?.trim() ?? "",
      location: input.location?.trim() ?? "",
      description: input.description.trim(),
      estimatedCost: input.estimatedCost ?? null,
      issuedDate: input.issuedDate,
      issuedByName: input.issuedByName.trim(),
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}

export type UpdateInstructionInput = Partial<
  Omit<CreateInstructionInput, "companyId" | "projectId" | "createdById" | "createdByName">
> & {
  lastModifiedById?: string | null;
  lastModifiedByName?: string | null;
};

/** The record, not the decision — status moves through `setInstructionStatus`. */
export async function updateInstruction(
  tx: Tx,
  id: string,
  input: UpdateInstructionInput,
) {
  const [row] = await tx
    .update(projectInstructions)
    .set({
      ...(input.type !== undefined && { type: input.type }),
      ...(input.clauseReference !== undefined && {
        clauseReference: input.clauseReference?.trim() ?? "",
      }),
      ...(input.location !== undefined && { location: input.location?.trim() ?? "" }),
      ...(input.description !== undefined && { description: input.description.trim() }),
      ...(input.estimatedCost !== undefined && { estimatedCost: input.estimatedCost }),
      ...(input.issuedDate !== undefined && { issuedDate: input.issuedDate }),
      ...(input.issuedByName !== undefined && { issuedByName: input.issuedByName.trim() }),
      lastModifiedById: input.lastModifiedById ?? null,
      lastModifiedByName: input.lastModifiedByName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(projectInstructions.id, id))
    .returning();
  return row ?? null;
}

/**
 * The sign-off. `pending` clears the responder; `complied`/`disputed` stamp
 * one on, matching `project_instructions_response_signed`.
 */
export async function setInstructionStatus(
  tx: Tx,
  id: string,
  status: "pending" | "complied" | "disputed",
  responseNotes: string | null,
  actor: { id?: string | null; name?: string | null },
) {
  const signed = status !== "pending";
  const [row] = await tx
    .update(projectInstructions)
    .set({
      status,
      responseNotes: responseNotes?.trim() || null,
      respondedById: signed ? actor.id ?? null : null,
      respondedByName: signed ? actor.name || "Unknown User" : null,
      respondedAt: signed ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(projectInstructions.id, id))
    .returning();
  return row ?? null;
}

export async function deleteInstruction(tx: Tx, id: string) {
  const [row] = await tx
    .delete(projectInstructions)
    .where(eq(projectInstructions.id, id))
    .returning();
  return row ?? null;
}

export async function getInstructionsSummary(tx: Tx, projectId: string) {
  const rows = await tx
    .select({
      status: projectInstructions.status,
      type: projectInstructions.type,
    })
    .from(projectInstructions)
    .where(eq(projectInstructions.projectId, projectId));

  return {
    total: rows.length,
    pending: rows.filter((r) => r.status === "pending").length,
    complied: rows.filter((r) => r.status === "complied").length,
    disputed: rows.filter((r) => r.status === "disputed").length,
    ncrs: rows.filter((r) => r.type === "ncr").length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Site Diary
// ─────────────────────────────────────────────────────────────────────────────

async function nextDiaryNumber(tx: Tx, companyId: string) {
  const [{ entry_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'CSD') AS entry_number`,
  )) as unknown as Array<{ entry_number: string }>;
  return entry_number;
}

export async function listDiaryEntries(tx: Tx, projectId: string) {
  return tx
    .select()
    .from(projectDiaryEntries)
    .where(eq(projectDiaryEntries.projectId, projectId))
    .orderBy(desc(projectDiaryEntries.diaryDate), desc(projectDiaryEntries.createdAt));
}

export async function getDiaryEntryById(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select()
    .from(projectDiaryEntries)
    .where(eq(projectDiaryEntries.id, id));
  return row ?? null;
}

export interface CreateDiaryEntryInput {
  companyId: string;
  projectId: string;
  diaryDate: string;
  weather?: string | null;
  location?: string | null;
  activities: string;
  plant?: string | null;
  manpowerCount?: number;
  incidentCount?: number;
  incidentNotes?: string | null;
  loggedByName: string;
  createdById?: string | null;
  createdByName: string;
}

export async function createDiaryEntry(tx: Tx, input: CreateDiaryEntryInput) {
  const entryNumber = await nextDiaryNumber(tx, input.companyId);
  const [row] = await tx
    .insert(projectDiaryEntries)
    .values({
      companyId: input.companyId,
      projectId: input.projectId,
      entryNumber,
      diaryDate: input.diaryDate,
      weather: input.weather?.trim() ?? "",
      location: input.location?.trim() ?? "",
      activities: input.activities.trim(),
      plant: input.plant?.trim() ?? "",
      manpowerCount: input.manpowerCount ?? 0,
      incidentCount: input.incidentCount ?? 0,
      incidentNotes: input.incidentNotes?.trim() ?? "",
      loggedByName: input.loggedByName.trim(),
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}

export type UpdateDiaryEntryInput = Partial<
  Omit<CreateDiaryEntryInput, "companyId" | "projectId" | "createdById" | "createdByName">
> & {
  lastModifiedById?: string | null;
  lastModifiedByName?: string | null;
};

/** The record, not the countersignature — that moves through `signDiaryEntry`. */
export async function updateDiaryEntry(
  tx: Tx,
  id: string,
  input: UpdateDiaryEntryInput,
) {
  const [row] = await tx
    .update(projectDiaryEntries)
    .set({
      ...(input.diaryDate !== undefined && { diaryDate: input.diaryDate }),
      ...(input.weather !== undefined && { weather: input.weather?.trim() ?? "" }),
      ...(input.location !== undefined && { location: input.location?.trim() ?? "" }),
      ...(input.activities !== undefined && { activities: input.activities.trim() }),
      ...(input.plant !== undefined && { plant: input.plant?.trim() ?? "" }),
      ...(input.manpowerCount !== undefined && { manpowerCount: input.manpowerCount }),
      ...(input.incidentCount !== undefined && { incidentCount: input.incidentCount }),
      ...(input.incidentNotes !== undefined && {
        incidentNotes: input.incidentNotes?.trim() ?? "",
      }),
      ...(input.loggedByName !== undefined && { loggedByName: input.loggedByName.trim() }),
      lastModifiedById: input.lastModifiedById ?? null,
      lastModifiedByName: input.lastModifiedByName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(projectDiaryEntries.id, id))
    .returning();
  return row ?? null;
}

/** The RE countersignature. One-way in this pass — no "un-sign". */
export async function signDiaryEntry(
  tx: Tx,
  id: string,
  actor: { id?: string | null; name?: string | null },
) {
  const [row] = await tx
    .update(projectDiaryEntries)
    .set({
      status: "countersigned",
      countersignedById: actor.id ?? null,
      countersignedByName: actor.name || "Unknown User",
      countersignedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectDiaryEntries.id, id))
    .returning();
  return row ?? null;
}

export async function deleteDiaryEntry(tx: Tx, id: string) {
  const [row] = await tx
    .delete(projectDiaryEntries)
    .where(eq(projectDiaryEntries.id, id))
    .returning();
  return row ?? null;
}

/** Everything Monthly Report needs from the diary for one reporting period. */
export async function getDiarySummary(
  tx: Tx,
  projectId: string,
  range: { from: string; to: string },
) {
  const rows = await tx
    .select()
    .from(projectDiaryEntries)
    .where(
      and(
        eq(projectDiaryEntries.projectId, projectId),
        gte(projectDiaryEntries.diaryDate, range.from),
        lte(projectDiaryEntries.diaryDate, range.to),
      ),
    )
    .orderBy(desc(projectDiaryEntries.diaryDate));

  const incidentDays = rows.filter((r) => r.incidentCount > 0);
  return {
    entryCount: rows.length,
    unsignedCount: rows.filter((r) => r.status === "submitted").length,
    totalIncidents: rows.reduce((sum, r) => sum + r.incidentCount, 0),
    incidentDays,
    avgManpower:
      rows.length > 0
        ? Math.round(rows.reduce((sum, r) => sum + r.manpowerCount, 0) / rows.length)
        : 0,
    entries: rows,
  };
}
