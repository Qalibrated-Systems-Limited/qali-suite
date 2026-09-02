import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { workflowReports } from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * Workflow Reports repository — 0076.
 *
 * Same contract as `repositories/projectLogs.ts`: every function takes a `tx`
 * from `withTenant()`, so RLS is active, and nothing here reads the session or
 * checks a role — that happens one layer up in `workflow-report-actions.ts`.
 */

/**
 * Serial is issued per sheet: the counter prefix is the sheet code, so WB01
 * and TR01 number independently ("WB01-00001", "TR01-00001"). `next_entry_number`
 * creates the counter row on first use, so a new sheet code needs no setup.
 */
async function nextReportNumber(tx: Tx, companyId: string, sheetCode: string) {
  const prefix = (sheetCode || "TR01").toUpperCase();
  const [{ report_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, ${prefix}) AS report_number`,
  )) as unknown as Array<{ report_number: string }>;
  return report_number;
}

export async function listReports(tx: Tx, projectId: string) {
  return tx
    .select()
    .from(workflowReports)
    .where(eq(workflowReports.projectId, projectId))
    .orderBy(desc(workflowReports.createdAt));
}

export async function getReportById(tx: Tx, id: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with the
  // statement in the message — same guard the other detail getters carry.
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select()
    .from(workflowReports)
    .where(eq(workflowReports.id, id));
  return row ?? null;
}

/** Status tallies for the list header, one project. */
export async function getReportsSummary(tx: Tx, projectId: string) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'draft')::int     AS draft,
      count(*) FILTER (WHERE status = 'submitted')::int AS submitted,
      count(*) FILTER (WHERE status = 'reviewed')::int  AS reviewed,
      count(*) FILTER (WHERE status = 'approved')::int  AS approved
    FROM workflow_reports
    WHERE project_id = ${projectId}::uuid
  `)) as unknown as Array<{
    total: number;
    draft: number;
    submitted: number;
    reviewed: number;
    approved: number;
  }>;
  return row ?? { total: 0, draft: 0, submitted: 0, reviewed: 0, approved: 0 };
}

export interface CreateReportInput {
  companyId: string;
  projectId: string;
  /** QSL sheet code — WB01–WB06, SI01, TR01. */
  type: string;
  title: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  summary: string;
  workCompleted?: string | null;
  issues?: string | null;
  nextSteps?: string | null;
  /** The sheet's structured body — see the `data` column. */
  data?: Record<string, unknown> | null;
  createdById?: string | null;
  createdByName: string;
}

export async function createReport(tx: Tx, input: CreateReportInput) {
  const reportNumber = await nextReportNumber(tx, input.companyId, input.type);
  const [row] = await tx
    .insert(workflowReports)
    .values({
      companyId: input.companyId,
      projectId: input.projectId,
      reportNumber,
      type: input.type,
      title: input.title.trim(),
      periodStart: input.periodStart || null,
      periodEnd: input.periodEnd || null,
      summary: input.summary.trim(),
      workCompleted: input.workCompleted?.trim() ?? "",
      issues: input.issues?.trim() ?? "",
      nextSteps: input.nextSteps?.trim() ?? "",
      data: input.data ?? {},
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}

export type UpdateReportInput = Partial<
  Omit<CreateReportInput, "companyId" | "projectId" | "createdById" | "createdByName">
> & {
  lastModifiedById?: string | null;
  lastModifiedByName?: string | null;
};

/** The record edit — the workflow moves through the sign-off helpers below. */
export async function updateReport(tx: Tx, id: string, input: UpdateReportInput) {
  const [row] = await tx
    .update(workflowReports)
    .set({
      ...(input.type !== undefined && { type: input.type }),
      ...(input.title !== undefined && { title: input.title.trim() }),
      ...(input.periodStart !== undefined && { periodStart: input.periodStart || null }),
      ...(input.periodEnd !== undefined && { periodEnd: input.periodEnd || null }),
      ...(input.summary !== undefined && { summary: input.summary.trim() }),
      ...(input.workCompleted !== undefined && {
        workCompleted: input.workCompleted?.trim() ?? "",
      }),
      ...(input.issues !== undefined && { issues: input.issues?.trim() ?? "" }),
      ...(input.nextSteps !== undefined && { nextSteps: input.nextSteps?.trim() ?? "" }),
      ...(input.data !== undefined && { data: input.data ?? {} }),
      lastModifiedById: input.lastModifiedById ?? null,
      lastModifiedByName: input.lastModifiedByName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(workflowReports.id, id))
    .returning();
  return row ?? null;
}

interface Actor {
  id: string | null;
  name: string;
}

/**
 * draft → submitted. Stamps the submitter and copies the project figures the
 * report quotes onto the row, so the report keeps saying what was true on the
 * day it was submitted. Resubmitting after a reopen refreshes the snapshot.
 */
export async function submitReport(
  tx: Tx,
  id: string,
  actor: Actor,
  snapshot: { progress: number | null; revenue: string | null; cost: string | null },
) {
  const [row] = await tx
    .update(workflowReports)
    .set({
      status: "submitted",
      submittedByName: actor.name,
      submittedAt: new Date(),
      snapshotProgress: snapshot.progress,
      snapshotRevenue: snapshot.revenue,
      snapshotCost: snapshot.cost,
      // A resubmit clears any prior review/approval — the report is back in
      // the reviewer's queue, not still carrying the old sign-off.
      reviewedById: null,
      reviewedByName: null,
      reviewedAt: null,
      approvedById: null,
      approvedByName: null,
      approvedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(workflowReports.id, id), eq(workflowReports.status, "draft")))
    .returning();
  return row ?? null;
}

/** submitted → reviewed. */
export async function reviewReport(tx: Tx, id: string, actor: Actor) {
  const [row] = await tx
    .update(workflowReports)
    .set({
      status: "reviewed",
      reviewedById: actor.id,
      reviewedByName: actor.name,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(workflowReports.id, id), eq(workflowReports.status, "submitted")))
    .returning();
  return row ?? null;
}

/** reviewed → approved. */
export async function approveReport(tx: Tx, id: string, actor: Actor) {
  const [row] = await tx
    .update(workflowReports)
    .set({
      status: "approved",
      approvedById: actor.id,
      approvedByName: actor.name,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(workflowReports.id, id), eq(workflowReports.status, "reviewed")))
    .returning();
  return row ?? null;
}

/**
 * Anything → draft. Clears every sign-off so the report starts its journey
 * again; the snapshot is left as-is until the next submit overwrites it.
 */
export async function reopenReport(tx: Tx, id: string, actor: Actor) {
  const [row] = await tx
    .update(workflowReports)
    .set({
      status: "draft",
      reviewedById: null,
      reviewedByName: null,
      reviewedAt: null,
      approvedById: null,
      approvedByName: null,
      approvedAt: null,
      lastModifiedById: actor.id,
      lastModifiedByName: actor.name,
      updatedAt: new Date(),
    })
    .where(eq(workflowReports.id, id))
    .returning();
  return row ?? null;
}

export async function deleteReport(tx: Tx, id: string) {
  await tx.delete(workflowReports).where(eq(workflowReports.id, id));
}

/**
 * Company-wide dashboard aggregates for the Technical overview — modelled on
 * the standalone QSL dashboard (status ring, by-month, by-form-type). RLS
 * scopes every query to the active company, so no company filter is needed.
 */
export async function getCompanyReportStats(tx: Tx) {
  const [totals] = (await tx.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'draft')::int     AS draft,
      count(*) FILTER (WHERE status = 'submitted')::int AS submitted,
      count(*) FILTER (WHERE status = 'reviewed')::int  AS reviewed,
      count(*) FILTER (WHERE status = 'approved')::int  AS approved
    FROM workflow_reports
  `)) as unknown as Array<{
    total: number;
    draft: number;
    submitted: number;
    reviewed: number;
    approved: number;
  }>;

  const byType = (await tx.execute(sql`
    SELECT type, count(*)::int AS count
    FROM workflow_reports
    GROUP BY type
    ORDER BY count DESC
  `)) as unknown as Array<{ type: string; count: number }>;

  const byMonth = (await tx.execute(sql`
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS ym,
           count(*)::int AS count
    FROM workflow_reports
    WHERE created_at >= date_trunc('month', now()) - interval '5 months'
    GROUP BY 1
    ORDER BY 1
  `)) as unknown as Array<{ ym: string; count: number }>;

  return {
    totals: totals ?? { total: 0, draft: 0, submitted: 0, reviewed: 0, approved: 0 },
    byType: byType ?? [],
    byMonth: byMonth ?? [],
  };
}
