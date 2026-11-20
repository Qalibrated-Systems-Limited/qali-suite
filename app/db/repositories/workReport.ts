import { sql } from "drizzle-orm";
import type { Tx } from "../client";

/**
 * THE PERIODIC REPORT ON ASSIGNED WORK — tasks and tickets, and the rest.
 *
 * For a period [from, to): what was handed out, what got done, what is still
 * open and what is late — by source (Tasks, Help desk, Projects, Calibration,
 * Inspection), by person, and for the help desk its service level: response
 * and resolution times and how many tickets met their SLA.
 *
 * Runs on an RLS-scoped transaction for the screen. The weekly email runs it
 * per company on a privileged connection, so every table is ALSO filtered by
 * `companyId` when one is given — never relying on the caller's scope alone.
 */

export interface WorkReport {
  from: string;
  to: string;
  bySource: Array<{ source: string; assigned: number; completed: number; open: number; overdue: number }>;
  byPerson: Array<{ userId: string; name: string; open: number; completed: number; overdue: number }>;
  tickets: {
    opened: number;
    resolved: number;
    open: number;
    breachedOpen: number;
    slaMet: number;
    slaMeasured: number;
    avgResolutionHours: number | null;
    avgFirstResponseHours: number | null;
  };
  ticketsByCategory: Array<{ category: string; opened: number; resolved: number; open: number }>;
}

export async function getWorkReport(
  tx: Tx,
  from: string,
  to: string,
  companyId: string | null = null,
): Promise<WorkReport> {
  const co = companyId;
  const inCo = (col: string) => sql`${sql.raw(col)} = COALESCE(${co}::uuid, ${sql.raw(col)})`;

  const items = sql`
    WITH items AS (
      SELECT 'Tasks' AS source, t.assigned_to_user_id AS uid, t.assignee_name AS uname,
             t.created_at AS created, t.completed_at AS done_at,
             t.status NOT IN ('completed','cancelled') AS is_open, t.due_date AS due
        FROM tasks t WHERE ${inCo("t.company_id")}
      UNION ALL
      SELECT 'Help desk', h.assigned_to_user_id, h.assignee_name,
             h.created_at, h.resolved_at,
             h.status NOT IN ('resolved','closed'), COALESCE(h.resolution_due_at::date, h.due_date)
        FROM helpdesk_tickets h WHERE ${inCo("h.company_id")}
      UNION ALL
      SELECT 'Projects', pa.user_id::text, pt.assigned_name,
             pt.created_at, CASE WHEN pt.status = 'done' THEN COALESCE(pt.actual_end::timestamptz, pt.updated_at) END,
             pt.status NOT IN ('done','cancelled'), pt.planned_end
        FROM project_tasks pt LEFT JOIN parties pa ON pa.id = pt.assigned_party_id
       WHERE ${inCo("pt.company_id")}
      UNION ALL
      SELECT 'Calibration', j.technician_id, j.technician_name,
             j.created_at, CASE WHEN j.status IN ('approved','completed') THEN COALESCE(j.approved_at, j.updated_at) END,
             j.status IN ('scheduled','in_progress','returned','submitted'), j.scheduled_date
        FROM calibration_jobs j WHERE ${inCo("j.company_id")}
      UNION ALL
      SELECT 'Inspection', i.inspector_id, i.inspector_name,
             i.created_at, CASE WHEN i.status IN ('approved','completed') THEN COALESCE(i.approved_at, i.updated_at) END,
             i.status IN ('scheduled','in_progress','returned','submitted'), i.scheduled_date
        FROM inspections i WHERE ${inCo("i.company_id")}
    )
  `;

  const bySource = (await tx.execute(sql`
    ${items}
    SELECT source,
           count(*) FILTER (WHERE created >= ${from}::date AND created < ${to}::date)::int AS assigned,
           count(*) FILTER (WHERE done_at >= ${from}::date AND done_at < ${to}::date)::int AS completed,
           count(*) FILTER (WHERE is_open)::int AS open,
           count(*) FILTER (WHERE is_open AND due < CURRENT_DATE)::int AS overdue
      FROM items GROUP BY source ORDER BY source
  `)) as unknown as WorkReport["bySource"];

  const byPerson = (await tx.execute(sql`
    ${items}
    SELECT uid AS "userId", COALESCE(max(NULLIF(uname, '')), 'Unknown') AS name,
           count(*) FILTER (WHERE is_open)::int AS open,
           count(*) FILTER (WHERE done_at >= ${from}::date AND done_at < ${to}::date)::int AS completed,
           count(*) FILTER (WHERE is_open AND due < CURRENT_DATE)::int AS overdue
      FROM items WHERE uid IS NOT NULL
     GROUP BY uid
    HAVING count(*) FILTER (WHERE is_open) > 0
        OR count(*) FILTER (WHERE done_at >= ${from}::date AND done_at < ${to}::date) > 0
     ORDER BY overdue DESC, open DESC, name
  `)) as unknown as WorkReport["byPerson"];

  const [t] = (await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE created_at >= ${from}::date AND created_at < ${to}::date)::int AS opened,
      count(*) FILTER (WHERE resolved_at >= ${from}::date AND resolved_at < ${to}::date)::int AS resolved,
      count(*) FILTER (WHERE status NOT IN ('resolved','closed'))::int AS open,
      count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND resolution_due_at < now())::int AS breached_open,
      count(*) FILTER (WHERE resolved_at >= ${from}::date AND resolved_at < ${to}::date
                         AND resolution_due_at IS NOT NULL AND resolved_at <= resolution_due_at)::int AS sla_met,
      count(*) FILTER (WHERE resolved_at >= ${from}::date AND resolved_at < ${to}::date
                         AND resolution_due_at IS NOT NULL)::int AS sla_measured,
      round(avg(extract(epoch FROM resolved_at - created_at) / 3600)
            FILTER (WHERE resolved_at >= ${from}::date AND resolved_at < ${to}::date)::numeric, 1) AS avg_res,
      round(avg(extract(epoch FROM first_response_at - created_at) / 3600)
            FILTER (WHERE created_at >= ${from}::date AND created_at < ${to}::date
                      AND first_response_at IS NOT NULL)::numeric, 1) AS avg_first
      FROM helpdesk_tickets WHERE ${inCo("company_id")}
  `)) as unknown as Array<Record<string, unknown>>;

  const ticketsByCategory = (await tx.execute(sql`
    SELECT COALESCE(NULLIF(category_name, ''), 'Uncategorised') AS category,
           count(*) FILTER (WHERE created_at >= ${from}::date AND created_at < ${to}::date)::int AS opened,
           count(*) FILTER (WHERE resolved_at >= ${from}::date AND resolved_at < ${to}::date)::int AS resolved,
           count(*) FILTER (WHERE status NOT IN ('resolved','closed'))::int AS open
      FROM helpdesk_tickets WHERE ${inCo("company_id")}
     GROUP BY 1
    HAVING count(*) FILTER (WHERE created_at >= ${from}::date AND created_at < ${to}::date) > 0
        OR count(*) FILTER (WHERE status NOT IN ('resolved','closed')) > 0
     ORDER BY opened DESC, category
  `)) as unknown as WorkReport["ticketsByCategory"];

  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    from,
    to,
    // Every source appears, with zeros where nothing happened — a source
    // missing from the report reads as "not tracked", not as "quiet".
    bySource: ["Tasks", "Help desk", "Projects", "Calibration", "Inspection"].map(
      (source) =>
        bySource.find((r) => r.source === source) ?? { source, assigned: 0, completed: 0, open: 0, overdue: 0 },
    ),
    byPerson: byPerson.map((r) => ({ ...r, userId: String(r.userId) })),
    tickets: {
      opened: Number(t?.opened ?? 0),
      resolved: Number(t?.resolved ?? 0),
      open: Number(t?.open ?? 0),
      breachedOpen: Number(t?.breached_open ?? 0),
      slaMet: Number(t?.sla_met ?? 0),
      slaMeasured: Number(t?.sla_measured ?? 0),
      avgResolutionHours: num(t?.avg_res),
      avgFirstResponseHours: num(t?.avg_first),
    },
    ticketsByCategory: ticketsByCategory.map((r) => ({ ...r })),
  };
}

/** The [from, to) dates for a named period ending today, or a custom range. */
export function periodRange(period: string, fromIn?: string, toIn?: string, today = new Date()) {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
  const valid = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
  if (period === "custom" && valid(fromIn) && valid(toIn)) {
    const t = new Date(`${toIn}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1); // inclusive end date on screen
    return { from: fromIn as string, to: iso(t), label: `${fromIn} to ${toIn}` };
  }
  const start = new Date(end);
  if (period === "month") start.setUTCMonth(start.getUTCMonth() - 1);
  else if (period === "quarter") start.setUTCMonth(start.getUTCMonth() - 3);
  else start.setUTCDate(start.getUTCDate() - 7);
  const label = period === "month" ? "Last 30 days" : period === "quarter" ? "Last 3 months" : "Last 7 days";
  return { from: iso(start), to: iso(end), label };
}
