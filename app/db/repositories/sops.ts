import { asc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { sops } from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * SOP Library repository — 0115. `tx` is already RLS-scoped; no companyId
 * filtering, no session/role logic (that is sops-actions.ts). "Review due" is
 * derived from status + next_review, never stored.
 */

type Actor = { id?: string | null; name?: string | null };

async function nextNumber(tx: Tx, companyId: string) {
  const [{ n }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'SOP') AS n`,
  )) as unknown as Array<{ n: string }>;
  return n;
}

export function listSops(tx: Tx) {
  return tx.select().from(sops).orderBy(asc(sops.code));
}

export async function getSop(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(sops).where(eq(sops.id, id));
  return row ?? null;
}

export async function createSop(
  tx: Tx,
  input: {
    companyId: string;
    title: string;
    department?: string | null;
    category?: string | null;
    version?: string | null;
    status?: string;
    ownerUserId?: string | null;
    ownerName?: string | null;
    lastReviewed?: string | null;
    nextReview?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const code = await nextNumber(tx, input.companyId);
  const [row] = await tx
    .insert(sops)
    .values({
      companyId: input.companyId,
      code,
      title: input.title.trim(),
      department: input.department?.trim() ?? "",
      category: input.category?.trim() ?? "",
      version: input.version?.trim() || "v1",
      status: input.status ?? "draft",
      ownerUserId: input.ownerUserId || null,
      ownerName: input.ownerName?.trim() ?? "",
      lastReviewed: input.lastReviewed || null,
      nextReview: input.nextReview || null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedById: input.createdById ?? null,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function updateSop(tx: Tx, id: string, patch: Record<string, unknown>, actor: Actor) {
  if (!isUuid(id)) return null;
  const set: Record<string, unknown> = {
    lastModifiedById: actor?.id ?? null,
    lastModifiedByName: actor?.name || "System",
    updatedAt: new Date(),
  };
  for (const k of ["title", "department", "category", "version", "status", "ownerUserId", "ownerName", "lastReviewed", "nextReview", "reviewNote"]) {
    if (patch[k] !== undefined) set[k] = patch[k] === "" && (k === "lastReviewed" || k === "nextReview" || k === "ownerUserId") ? null : patch[k];
  }
  const [row] = await tx.update(sops).set(set).where(eq(sops.id, id)).returning();
  return row ?? null;
}

/**
 * Mark an SOP reviewed on `when`: stamps last_reviewed, sets the next review a
 * year out (unless a date is given), and moves it to approved.
 */
export async function markReviewed(tx: Tx, id: string, when: string, nextReview: string | null, actor: Actor) {
  if (!isUuid(id)) return null;
  const next = nextReview || (() => {
    const d = new Date(when);
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const [row] = await tx
    .update(sops)
    .set({
      status: "approved",
      lastReviewed: when,
      nextReview: next,
      lastModifiedById: actor?.id ?? null,
      lastModifiedByName: actor?.name || "System",
      updatedAt: new Date(),
    })
    .where(eq(sops.id, id))
    .returning();
  return row ?? null;
}

export async function deleteSop(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(sops).where(eq(sops.id, id)).returning({ id: sops.id });
  return rows.length > 0;
}

export async function getSopStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'approved')::int AS approved,
      count(*) FILTER (WHERE status = 'draft')::int AS drafts,
      count(*) FILTER (
        WHERE status IN ('approved','in_review')
          AND next_review IS NOT NULL AND next_review <= CURRENT_DATE
      )::int AS review_due
    FROM sops
  `)) as unknown as Array<{ total: number; approved: number; drafts: number; review_due: number }>;
  return {
    total: row?.total ?? 0,
    approved: row?.approved ?? 0,
    drafts: row?.drafts ?? 0,
    reviewDue: row?.review_due ?? 0,
  };
}
