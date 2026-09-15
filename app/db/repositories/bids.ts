import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { bids } from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * Bids repository — 0111. `tx` is already RLS-scoped; no companyId filtering, no
 * session/role logic (that is bids-actions.ts). The pipeline figures are DERIVED
 * from stage + value + probability in the stats query, never stored.
 */

// Terminal stages — a bid here has left the live pipeline.
const CLOSED_STAGES = "('awarded','lost','stopped')";

type Actor = { id?: string | null; name?: string | null };

async function nextNumber(tx: Tx, companyId: string) {
  const [{ n }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'BID') AS n`,
  )) as unknown as Array<{ n: string }>;
  return n;
}

export function listBids(tx: Tx) {
  return tx.select().from(bids).orderBy(desc(bids.createdAt));
}

export async function getBidById(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(bids).where(eq(bids.id, id));
  return row ?? null;
}

export async function createBid(
  tx: Tx,
  input: {
    companyId: string;
    bidName: string;
    procuringEntity?: string | null;
    value?: number;
    winProbability?: number;
    stage?: string;
    compliance?: string;
    submissionDeadline?: string | null;
    ownerUserId?: string | null;
    ownerName?: string | null;
    notes?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const bidNumber = await nextNumber(tx, input.companyId);
  const [row] = await tx
    .insert(bids)
    .values({
      companyId: input.companyId,
      bidNumber,
      bidName: input.bidName.trim(),
      procuringEntity: input.procuringEntity?.trim() ?? "",
      value: input.value ?? 0,
      winProbability: clampPct(input.winProbability),
      stage: input.stage ?? "draft",
      compliance: input.compliance ?? "pending",
      submissionDeadline: input.submissionDeadline || null,
      ownerUserId: input.ownerUserId || null,
      ownerName: input.ownerName?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedById: input.createdById ?? null,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

function clampPct(n?: number) {
  const v = Math.round(Number(n ?? 0));
  return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
}

export async function updateBid(
  tx: Tx,
  id: string,
  patch: Record<string, unknown>,
  actor: Actor,
) {
  if (!isUuid(id)) return null;
  const set: Record<string, unknown> = {
    lastModifiedById: actor?.id ?? null,
    lastModifiedByName: actor?.name || "System",
    updatedAt: new Date(),
  };
  for (const k of [
    "bidName",
    "procuringEntity",
    "value",
    "stage",
    "compliance",
    "submissionDeadline",
    "ownerUserId",
    "ownerName",
    "outcomeNote",
    "notes",
  ]) {
    if (patch[k] !== undefined) set[k] = patch[k] === "" && k === "submissionDeadline" ? null : patch[k];
  }
  if (patch.winProbability !== undefined) set.winProbability = clampPct(patch.winProbability as number);
  const [row] = await tx.update(bids).set(set).where(eq(bids.id, id)).returning();
  return row ?? null;
}

export async function setBidStage(tx: Tx, id: string, stage: string, actor: Actor) {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .update(bids)
    .set({
      stage,
      lastModifiedById: actor?.id ?? null,
      lastModifiedByName: actor?.name || "System",
      updatedAt: new Date(),
    })
    .where(eq(bids.id, id))
    .returning();
  return row ?? null;
}

export async function deleteBid(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(bids).where(eq(bids.id, id)).returning({ id: bids.id });
  return rows.length > 0;
}

/**
 * Header stats. Pipeline value is the weighted expected value of live bids
 * (Σ value × probability), which is the figure a sales pipeline actually
 * forecasts; a raw sum is also returned for the plain total.
 */
export async function getBidStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE stage NOT IN ${sql.raw(CLOSED_STAGES)})::int AS open,
      COALESCE(SUM(value) FILTER (WHERE stage NOT IN ${sql.raw(CLOSED_STAGES)}), 0)::float8 AS pipeline_value,
      COALESCE(SUM(value * win_probability / 100.0) FILTER (WHERE stage NOT IN ${sql.raw(CLOSED_STAGES)}), 0)::float8 AS weighted_value,
      count(*) FILTER (WHERE stage IN ('stage_2b','evaluation','awarded'))::int AS stage_2b_clear,
      count(*) FILTER (WHERE stage = 'awarded')::int AS awarded,
      count(*) FILTER (WHERE stage = 'stopped')::int AS stopped
    FROM bids
  `)) as unknown as Array<{
    total: number;
    open: number;
    pipeline_value: number;
    weighted_value: number;
    stage_2b_clear: number;
    awarded: number;
    stopped: number;
  }>;
  return {
    total: row?.total ?? 0,
    open: row?.open ?? 0,
    pipelineValue: row?.pipeline_value ?? 0,
    weightedValue: row?.weighted_value ?? 0,
    stage2bClear: row?.stage_2b_clear ?? 0,
    awarded: row?.awarded ?? 0,
    stopped: row?.stopped ?? 0,
  };
}
