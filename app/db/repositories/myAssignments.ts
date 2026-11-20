import { sql } from "drizzle-orm";
import type { Tx } from "../client";

/**
 * EVERYTHING ASSIGNED TO ONE PERSON, WHEREVER IT WAS ASSIGNED.
 *
 * Work is handed out in six places — Tasks, Help Desk, a project's programme,
 * calibration jobs, inspections, and technical reports waiting for a signature
 * or returned to their author — and each kept its own list. Someone had to
 * open all six to know what was theirs. This reads them together, in one
 * RLS-scoped query, without copying anything: each row says where it came
 * from and links back to it, and the work is still done where it lives.
 *
 * A project task is assigned to a PARTY (a crew member may have no login), so
 * it is the person's when that party is linked to their user.
 */

export type AssignmentSource =
  | "task"
  | "ticket"
  | "project"
  | "calibration"
  | "inspection"
  | "report";

export interface Assignment {
  source: AssignmentSource;
  id: string;
  ref: string;
  title: string;
  detail: string;
  status: string;
  priority: string | null;
  dueDate: string | null;
  href: string;
  updatedAt: string;
  overdue: boolean;
}

export async function listAssignmentsFor(tx: Tx, userId: string): Promise<Assignment[]> {
  const rows = (await tx.execute(sql`
    WITH a AS (
      SELECT 'task'::text AS source, t.id::text AS id, t.task_number AS ref, t.title,
             COALESCE(NULLIF(t.department, ''), 'Task') AS detail, t.status, t.priority,
             t.due_date AS due_date,
             '/dashboard/tasks?task=' || t.id AS href, t.updated_at
        FROM tasks t
       WHERE t.assigned_to_user_id = ${userId}
         AND t.status NOT IN ('completed','cancelled')

      UNION ALL
      SELECT 'ticket', h.id::text, h.ticket_number, h.title,
             COALESCE(NULLIF(h.category_name, ''), 'Help desk')
               || CASE WHEN COALESCE(h.customer_name, '') <> '' THEN ' · ' || h.customer_name ELSE '' END,
             h.status, h.priority,
             COALESCE(h.resolution_due_at::date, h.due_date),
             '/dashboard/helpdesk?ticket=' || h.id, h.updated_at
        FROM helpdesk_tickets h
       WHERE h.assigned_to_user_id = ${userId}
         AND h.status NOT IN ('resolved','closed')

      UNION ALL
      SELECT 'project', pt.id::text, pr.project_number, pt.title,
             pr.name, pt.status::text, NULL,
             pt.planned_end,
             '/dashboard/projects/programme?project=' || pt.project_id, pt.updated_at
        FROM project_tasks pt
        JOIN parties pa ON pa.id = pt.assigned_party_id
        JOIN projects pr ON pr.id = pt.project_id
       WHERE pa.user_id::text = ${userId}
         AND pt.status NOT IN ('done','cancelled')

      UNION ALL
      SELECT 'calibration', j.id::text, j.job_number,
             'Calibration' || CASE WHEN j.service_type <> '' THEN ' — ' || j.service_type ELSE '' END,
             j.client_name || CASE WHEN j.site <> '' THEN ' · ' || j.site ELSE '' END,
             j.status, NULL, j.scheduled_date,
             '/dashboard/technical/my-work', j.updated_at
        FROM calibration_jobs j
       WHERE j.technician_id = ${userId}
         AND j.status IN ('scheduled','in_progress','returned')

      UNION ALL
      SELECT 'inspection', i.id::text, i.inspection_number,
             'Inspection' || CASE WHEN i.type <> '' THEN ' — ' || i.type ELSE '' END,
             i.client_name, i.status, NULL, i.scheduled_date,
             '/dashboard/technical/my-work', i.updated_at
        FROM inspections i
       WHERE i.inspector_id = ${userId}
         AND i.status IN ('scheduled','in_progress','returned')

      UNION ALL
      SELECT 'report', r.id::text, r.report_number, r.title,
             CASE
               WHEN r.status = 'submitted' THEN 'Sign off as supervisor'
               WHEN r.status = 'reviewed' THEN 'Approve as manager'
               ELSE 'Returned to you: ' || COALESCE(r.data->'returned'->>'comment', '')
             END,
             CASE WHEN r.status = 'draft' THEN 'returned' ELSE r.status::text END,
             NULL, NULL,
             '/dashboard/technical/' || r.id, r.updated_at
        FROM workflow_reports r
       WHERE (r.status = 'submitted' AND r.assigned_reviewer_id = ${userId})
          OR (r.status = 'reviewed' AND r.assigned_approver_id = ${userId})
          OR (r.status = 'draft' AND r.data ? 'returned'
              AND COALESCE(r.submitted_by_id, r.created_by_id) = ${userId})
    )
    SELECT a.*, (a.due_date IS NOT NULL AND a.due_date < CURRENT_DATE) AS overdue
      FROM a
     ORDER BY (a.due_date IS NOT NULL AND a.due_date < CURRENT_DATE) DESC,
              a.due_date NULLS LAST, a.updated_at DESC
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    source: String(r.source) as AssignmentSource,
    id: String(r.id),
    ref: String(r.ref ?? ""),
    title: String(r.title ?? ""),
    detail: String(r.detail ?? ""),
    status: String(r.status ?? ""),
    priority: r.priority ? String(r.priority) : null,
    dueDate: r.due_date ? String(r.due_date instanceof Date ? r.due_date.toISOString() : r.due_date).slice(0, 10) : null,
    href: String(r.href),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at ?? ""),
    overdue: Boolean(r.overdue),
  }));
}
