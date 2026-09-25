import { eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { projectMethodologies } from "../schema";

/**
 * Project methodology repository — 0117. `tx` is already RLS-scoped; no
 * companyId filtering and no role logic (that is methodology-actions.ts).
 * One method statement per project, upserted on the unique project_id.
 */

const SECTION_KEYS = [
  "scope",
  "approach",
  "sequenceOfWorks",
  "resources",
  "healthSafety",
  "qualityControl",
  "programmeSummary",
  "risks",
] as const;

type Actor = { id?: string | null; name?: string | null };

/** Whether the project has an APPROVED budget — the gate for a methodology. */
export async function hasApprovedBudget(tx: Tx, projectId: string) {
  const [row] = (await tx.execute(sql`
    SELECT EXISTS(
      SELECT 1 FROM project_budgets
       WHERE project_id = ${projectId}::uuid AND status = 'approved'
    ) AS ok
  `)) as unknown as Array<{ ok: boolean }>;
  return Boolean(row?.ok);
}

export async function getMethodology(tx: Tx, projectId: string) {
  const [row] = await tx
    .select()
    .from(projectMethodologies)
    .where(eq(projectMethodologies.projectId, projectId));
  return row ?? null;
}

export async function upsertMethodology(
  tx: Tx,
  input: {
    companyId: string;
    projectId: string;
    patch: Record<string, unknown>;
    actor: Actor;
  },
) {
  const values: Record<string, unknown> = {};
  for (const k of SECTION_KEYS) {
    if (input.patch[k] !== undefined) {
      values[k] = String(input.patch[k] ?? "").trim();
    }
  }

  const existing = await getMethodology(tx, input.projectId);
  if (existing) {
    const [row] = await tx
      .update(projectMethodologies)
      .set({
        ...values,
        lastModifiedById: input.actor?.id ?? null,
        lastModifiedByName: input.actor?.name || "System",
        updatedAt: new Date(),
      })
      .where(eq(projectMethodologies.projectId, input.projectId))
      .returning();
    return row;
  }

  const [row] = await tx
    .insert(projectMethodologies)
    .values({
      companyId: input.companyId,
      projectId: input.projectId,
      ...values,
      createdById: input.actor?.id ?? null,
      createdByName: input.actor?.name || "System",
      lastModifiedById: input.actor?.id ?? null,
      lastModifiedByName: input.actor?.name || "System",
    })
    .returning();
  return row;
}
