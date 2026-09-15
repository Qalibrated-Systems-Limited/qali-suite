import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { tasks } from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * Tasks repository — 0109. Same contract as every other repository: `tx` is
 * already RLS-scoped to the company, so nothing here filters on companyId, and
 * no session/role logic lives here (that is tasks-actions.ts).
 *
 * "Overdue" and "open" are DERIVED, never stored: a task is overdue when it is
 * not finished and its due date is past, so a stored flag could only go stale.
 */

const OPEN_STATES = ["open", "in_progress", "blocked"] as const;

async function nextNumber(tx: Tx, companyId: string) {
  const [{ n }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, 'TSK') AS n`,
  )) as unknown as Array<{ n: string }>;
  return n;
}

export function listTasks(tx: Tx) {
  return tx.select().from(tasks).orderBy(desc(tasks.createdAt));
}

export async function getTaskById(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(tasks).where(eq(tasks.id, id));
  return row ?? null;
}

export async function createTask(
  tx: Tx,
  input: {
    companyId: string;
    title: string;
    description?: string | null;
    department?: string | null;
    priority?: string;
    status?: string;
    assignedToUserId?: string | null;
    assigneeName?: string | null;
    dueDate?: string | null;
    source?: string;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const taskNumber = await nextNumber(tx, input.companyId);
  const [row] = await tx
    .insert(tasks)
    .values({
      companyId: input.companyId,
      taskNumber,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      department: input.department?.trim() ?? "",
      priority: input.priority ?? "medium",
      status: input.status ?? "open",
      assignedToUserId: input.assignedToUserId || null,
      assigneeName: input.assigneeName?.trim() ?? "",
      dueDate: input.dueDate || null,
      source: input.source ?? "manual",
      relatedEntityType: input.relatedEntityType || null,
      relatedEntityId: input.relatedEntityId || null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedById: input.createdById ?? null,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function updateTask(
  tx: Tx,
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    department?: string | null;
    priority?: string;
    assignedToUserId?: string | null;
    assigneeName?: string | null;
    dueDate?: string | null;
  },
  actor: { id?: string | null; name?: string | null },
) {
  if (!isUuid(id)) return null;
  const set: Record<string, unknown> = {
    lastModifiedById: actor?.id ?? null,
    lastModifiedByName: actor?.name || "System",
    updatedAt: new Date(),
  };
  if (patch.title !== undefined) set.title = patch.title.trim();
  if (patch.description !== undefined) set.description = patch.description?.trim() ?? "";
  if (patch.department !== undefined) set.department = patch.department?.trim() ?? "";
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.assignedToUserId !== undefined) set.assignedToUserId = patch.assignedToUserId || null;
  if (patch.assigneeName !== undefined) set.assigneeName = patch.assigneeName?.trim() ?? "";
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate || null;

  const [row] = await tx.update(tasks).set(set).where(eq(tasks.id, id)).returning();
  return row ?? null;
}

/**
 * Move a task's status. Stamps completed_at when it lands on 'completed' and
 * clears it if the task is reopened, so the completion date is always true.
 */
export async function setTaskStatus(
  tx: Tx,
  id: string,
  status: string,
  actor: { id?: string | null; name?: string | null },
) {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .update(tasks)
    .set({
      status,
      completedAt: status === "completed" ? new Date() : null,
      lastModifiedById: actor?.id ?? null,
      lastModifiedByName: actor?.name || "System",
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, id))
    .returning();
  return row ?? null;
}

export async function deleteTask(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id });
  return rows.length > 0;
}

/** Header stat cards: totals, overdue, critical (both derived), completed. */
export async function getTaskStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (
        WHERE status IN ('open','in_progress','blocked')
          AND due_date IS NOT NULL AND due_date < CURRENT_DATE
      )::int AS overdue,
      count(*) FILTER (
        WHERE status IN ('open','in_progress','blocked') AND priority = 'critical'
      )::int AS critical,
      count(*) FILTER (WHERE status = 'completed')::int AS completed,
      count(*) FILTER (WHERE status IN ('open','in_progress','blocked'))::int AS open
    FROM tasks
  `)) as unknown as Array<{
    total: number;
    overdue: number;
    critical: number;
    completed: number;
    open: number;
  }>;
  return {
    total: row?.total ?? 0,
    overdue: row?.overdue ?? 0,
    critical: row?.critical ?? 0,
    completed: row?.completed ?? 0,
    open: row?.open ?? 0,
  };
}

export { OPEN_STATES };
