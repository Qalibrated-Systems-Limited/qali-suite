import { sql } from "drizzle-orm";
import type { Tx } from "../client";

/**
 * The Projects module's overview: what is happening across every section, and
 * what is waiting on somebody — the first screen of the module.
 *
 * RLS scopes every table to the company, so nothing here filters by it.
 *
 * Core tables only. Technical reports (`workflow_reports`) belong to the
 * Technical vertical, which core must not depend on (lib/modules.mjs), so they
 * keep their own registry rather than appearing here.
 */

export async function getProjectsActivitySummary(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM projects WHERE status = 'planning')::int        AS planning,
      (SELECT COUNT(*) FROM projects WHERE status = 'active')::int          AS active,
      (SELECT COUNT(*) FROM projects WHERE status = 'on_hold')::int         AS on_hold,
      (SELECT COUNT(*) FROM projects WHERE status IN ('completed','closed'))::int AS finished,
      (SELECT COUNT(*) FROM projects
        WHERE status = 'active' AND end_date IS NOT NULL AND end_date < CURRENT_DATE)::int AS past_end,
      (SELECT COUNT(*) FROM projects
        WHERE status = 'active' AND end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS ending_soon,

      (SELECT COUNT(*) FROM project_cash_requisitions WHERE status = 'submitted')::int AS req_awaiting,
      (SELECT COALESCE(SUM(amount), 0) FROM project_cash_requisitions WHERE status = 'submitted') AS req_awaiting_amount,
      (SELECT COUNT(*) FROM project_cash_requisitions WHERE status = 'approved')::int AS req_to_fund,
      (SELECT COALESCE(SUM(amount), 0) FROM project_cash_requisitions WHERE status = 'approved') AS req_to_fund_amount,

      (SELECT COUNT(*) FROM project_certificates WHERE status = 'draft')::int AS ipc_draft,
      (SELECT COUNT(*) FROM project_variations WHERE status = 'submitted')::int AS var_awaiting,
      (SELECT COUNT(*) FROM project_instructions WHERE status = 'pending')::int AS ins_pending,
      (SELECT COUNT(*) FROM project_diary_entries WHERE status = 'submitted')::int AS diary_awaiting,
      (SELECT COUNT(*) FROM project_diary_entries WHERE diary_date >= CURRENT_DATE - 6)::int AS diary_week,
      (SELECT COUNT(*) FROM project_timesheets WHERE status = 'submitted')::int AS ts_awaiting,
      (SELECT COUNT(*) FROM project_milestones
        WHERE status = 'pending' AND due_date < CURRENT_DATE)::int AS ms_overdue,
      (SELECT COUNT(*) FROM project_milestones
        WHERE status = 'pending' AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14)::int AS ms_due_soon,
      (SELECT COUNT(*) FROM project_tasks WHERE status = 'blocked')::int AS tasks_blocked
  `)) as unknown as Array<Record<string, unknown>>;

  const n = (k: string) => Number(row?.[k] ?? 0);
  return {
    projects: {
      planning: n("planning"),
      active: n("active"),
      onHold: n("on_hold"),
      finished: n("finished"),
      pastEnd: n("past_end"),
      endingSoon: n("ending_soon"),
    },
    requisitions: {
      awaiting: n("req_awaiting"),
      awaitingAmount: n("req_awaiting_amount"),
      toFund: n("req_to_fund"),
      toFundAmount: n("req_to_fund_amount"),
    },
    certificatesDraft: n("ipc_draft"),
    variationsAwaiting: n("var_awaiting"),
    instructionsPending: n("ins_pending"),
    diaryAwaiting: n("diary_awaiting"),
    diaryThisWeek: n("diary_week"),
    timesheetsAwaiting: n("ts_awaiting"),
    milestonesOverdue: n("ms_overdue"),
    milestonesDueSoon: n("ms_due_soon"),
    tasksBlocked: n("tasks_blocked"),
  };
}

/** The latest movement across the sections, newest first. */
export async function listRecentProjectActivity(tx: Tx, limit = 10) {
  const rows = (await tx.execute(sql`
    SELECT a.*, p.name AS project_name, p.project_number
      FROM (
        SELECT 'requisition' AS kind, id, project_id, requisition_number AS ref,
               purpose AS label, status::text AS status, updated_at
          FROM project_cash_requisitions
        UNION ALL
        SELECT 'certificate', id, project_id, certificate_number, NULL, status::text, updated_at
          FROM project_certificates
        UNION ALL
        SELECT 'variation', id, project_id, variation_number, title, status::text, updated_at
          FROM project_variations
        UNION ALL
        SELECT 'instruction', id, project_id, instruction_number, description, status::text, updated_at
          FROM project_instructions
        UNION ALL
        SELECT 'diary', id, project_id, entry_number, NULL, status::text, updated_at
          FROM project_diary_entries

        UNION ALL
        SELECT 'project', id, id, project_number, name, status::text, updated_at
          FROM projects
      ) a
      JOIN projects p ON p.id = a.project_id
     ORDER BY a.updated_at DESC
     LIMIT ${limit}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    kind: String(r.kind),
    id: String(r.id),
    projectId: String(r.project_id),
    projectName: String(r.project_name),
    projectNumber: String(r.project_number),
    ref: (r.ref as string) ?? null,
    label: (r.label as string) ?? null,
    status: String(r.status),
    updatedAt: r.updated_at ? new Date(r.updated_at as string).toISOString() : null,
  }));
}
