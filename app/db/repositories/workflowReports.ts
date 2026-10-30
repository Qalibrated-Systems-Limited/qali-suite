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
export interface SignoffAssignment {
  reviewer: { id: string; name: string };
  approver: { id: string; name: string };
}

/**
 * draft → submitted, naming who signs it off.
 *
 * The supervisor cannot be the person submitting, and the approving manager
 * cannot be the supervisor: two signatures from one pair of hands is one
 * signature. Who may be named at all (the sign-off group) is the action's
 * check, which knows the roles.
 */
export async function submitReport(
  tx: Tx,
  id: string,
  actor: Actor,
  snapshot: { progress: number | null; revenue: string | null; cost: string | null },
  assignment: SignoffAssignment,
) {
  const { reviewer, approver } = assignment;
  if (!reviewer?.id || !approver?.id) {
    throw new Error("Choose the supervisor and the approving manager.");
  }
  if (actor.id && reviewer.id === actor.id) {
    throw new Error("You cannot be the supervisor of a report you submit.");
  }
  if (actor.id && approver.id === actor.id) {
    throw new Error("You cannot approve a report you submit.");
  }
  if (reviewer.id === approver.id) {
    throw new Error("The supervisor and the approving manager must be different people.");
  }

  const [row] = await tx
    .update(workflowReports)
    .set({
      status: "submitted",
      submittedById: actor.id,
      submittedByName: actor.name,
      submittedAt: new Date(),
      assignedReviewerId: reviewer.id,
      assignedReviewerName: reviewer.name,
      assignedApproverId: approver.id,
      assignedApproverName: approver.name,
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

async function getRow(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(workflowReports).where(eq(workflowReports.id, id));
  return row ?? null;
}

/**
 * submitted → reviewed, by the named supervisor. A report submitted before
 * reviewers were named has none, and stays open to the sign-off group.
 */
export async function reviewReport(tx: Tx, id: string, actor: Actor) {
  const current = await getRow(tx, id);
  if (current?.assignedReviewerId && current.assignedReviewerId !== actor.id) {
    throw new Error(
      `This report is waiting for ${current.assignedReviewerName}'s sign-off. Reassign it if they are away.`,
    );
  }
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

/** reviewed → approved, by the named manager — never the one who reviewed it. */
export async function approveReport(tx: Tx, id: string, actor: Actor) {
  const current = await getRow(tx, id);
  if (current?.assignedApproverId && current.assignedApproverId !== actor.id) {
    throw new Error(
      `This report is waiting for ${current.assignedApproverName}'s approval. Reassign it if they are away.`,
    );
  }
  if (current?.reviewedById && actor.id && current.reviewedById === actor.id) {
    throw new Error("The supervisor who signed this report cannot also approve it.");
  }
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
 * Hands the waiting step to somebody else — the supervisor while the report is
 * submitted, the manager once it is reviewed. The same separation holds.
 */
export async function reassignSignoff(
  tx: Tx,
  id: string,
  to: { id: string; name: string },
) {
  const current = await getRow(tx, id);
  if (!current) throw new Error("Report not found");
  if (current.status === "submitted") {
    if (to.id === current.submittedById) throw new Error("The submitter cannot supervise their own report.");
    if (to.id === current.assignedApproverId) {
      throw new Error("The supervisor and the approving manager must be different people.");
    }
    const [row] = await tx
      .update(workflowReports)
      .set({ assignedReviewerId: to.id, assignedReviewerName: to.name, updatedAt: new Date() })
      .where(eq(workflowReports.id, id))
      .returning();
    return { row, step: "supervisor" as const };
  }
  if (current.status === "reviewed") {
    if (to.id === current.submittedById) throw new Error("The submitter cannot approve their own report.");
    if (to.id === current.reviewedById) throw new Error("The supervisor who signed cannot also approve.");
    const [row] = await tx
      .update(workflowReports)
      .set({ assignedApproverId: to.id, assignedApproverName: to.name, updatedAt: new Date() })
      .where(eq(workflowReports.id, id))
      .returning();
    return { row, step: "manager" as const };
  }
  throw new Error("Only a report waiting for a sign-off can be reassigned.");
}

/** People in this company holding one of `roles` — who can be named to sign. */
export async function listSignoffUsers(tx: Tx, roles: readonly string[]) {
  const rows = (await tx.execute(sql`
    SELECT u.id, u.name, COALESCE(a.role, u.role) AS role
      FROM users u
      LEFT JOIN user_company_access a
             ON a.user_id = u.id
            AND a.status = 'active'
            AND a.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
     WHERE COALESCE(u.status, 'active') NOT IN ('inactive', 'Inactive')
       AND COALESCE(a.role, u.role) IN (${sql.join(roles.map((r) => sql`${r}`), sql`, `)})
     ORDER BY u.name
  `)) as unknown as Array<{ id: string; name: string; role: string }>;
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), role: String(r.role) }));
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
      // Named again at the next submission.
      assignedReviewerId: null,
      assignedReviewerName: null,
      assignedApproverId: null,
      assignedApproverName: null,
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
