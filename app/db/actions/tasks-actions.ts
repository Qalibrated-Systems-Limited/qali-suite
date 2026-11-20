"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { TASK_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/tasks";
import * as usersRepo from "../repositories/users";
import { holdsGate } from "../assigneeAccess";
import { listAssignmentsFor } from "../repositories/myAssignments";
import { getWorkReport, periodRange } from "../repositories/workReport";
import { HELPDESK_WRITE_ROLES } from "@/lib/utils/role-gates";
import { technicalStanding } from "../technicalAccess";

/**
 * Tasks actions — 0109. Same shape as helpdesk-actions.ts: Zod validates,
 * `withAuthorizedTenant` scopes and gates, the repository does the SQL. Reads
 * are open to any authenticated member of the company; writes need
 * TASK_WRITE_ROLES. Every mutation returns {success,message} or {error}.
 */

const WRITE = TASK_WRITE_ROLES as unknown as string[];

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return { id: user?.id ?? null, name: user?.name || "Unknown User" };
}
function s(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v : "";
}
function serialize<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = { ...row, _id: String(row.id) };
  for (const k of Object.keys(out)) {
    if (out[k] instanceof Date) out[k] = (out[k] as Date).toISOString();
  }
  return out;
}
function bump() {
  revalidatePath("/dashboard/tasks");
}

// ── reads ────────────────────────────────────────────────────────────────────
export async function getTasksData() {
  return withAuthorizedTenant([], async (tx) => {
    const [rows, stats, users] = await Promise.all([
      repo.listTasks(tx),
      repo.getTaskStats(tx),
      usersRepo.listCompanyUsers(tx),
    ]);
    return {
      tasks: rows.map(serialize),
      stats,
      users: users
        .filter((u) => u.status !== "Inactive" && u.status !== "inactive")
        .map((u) => ({ id: u.id, name: u.name, role: u.role, department: u.department })),
    };
  });
}

/**
 * Everything assigned to the viewer across the application — tasks, help
 * desk tickets, project tasks, calibration jobs, inspections and technical
 * reports — each marked with where it came from.
 */
export async function getMyAssignments() {
  return withAuthorizedTenant([], (tx, { user }) => listAssignmentsFor(tx, String(user.id)));
}

// ── create ────────────────────────────────────────────────────────────────────
const taskSchema = z.object({
  title: z.string().trim().min(1, "A task needs a title").max(200),
  description: z.string().trim().max(4000).optional(),
  department: z.string().trim().max(120).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  assignedToUserId: z.string().trim().optional(),
  assigneeName: z.string().trim().max(160).optional(),
  dueDate: z.string().trim().optional(),
});

export async function createTask(prevState: unknown, formData: FormData) {
  const parsed = taskSchema.safeParse({
    title: s(formData.get("title")),
    description: s(formData.get("description")),
    department: s(formData.get("department")),
    priority: s(formData.get("priority")) || undefined,
    assignedToUserId: s(formData.get("assignedToUserId")),
    assigneeName: s(formData.get("assigneeName")),
    dueDate: s(formData.get("dueDate")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createTask(tx, {
        companyId,
        ...d,
        assignedToUserId: d.assignedToUserId || null,
        dueDate: d.dueDate || null,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `${row.taskNumber} created` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── update ────────────────────────────────────────────────────────────────────
export async function updateTask(id: string, patch: Record<string, unknown>) {
  const parsed = taskSchema.partial().safeParse(patch);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.updateTask(tx, id, parsed.data, actorFrom(user)),
    );
    if (!row) return { error: "Task not found." };
    bump();
    return { success: true, message: `${row.taskNumber} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── lifecycle ───────────────────────────────────────────────────────────────
const STATUSES = ["open", "in_progress", "blocked", "completed", "cancelled"];

export async function setTaskStatus(id: string, status: string) {
  if (!STATUSES.includes(status)) return { error: "Unknown status." };
  try {
    const row = await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      // The person a task is assigned to moves their own task along — that is
      // the point of assigning it — whatever their role.
      if (!(await holdsGate(tx, user, companyId, WRITE))) {
        const t = await repo.getTaskById(tx, id);
        if (!t) return null;
        if (t.assignedToUserId !== String(user.id)) {
          throw new Error("You can only update tasks assigned to you.");
        }
      }
      return repo.setTaskStatus(tx, id, status, actorFrom(user));
    });
    if (!row) return { error: "Task not found." };
    bump();
    return { success: true, message: `${row.taskNumber} → ${status.replace("_", " ")}` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteTask(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteTask(tx, id));
    if (!ok) return { error: "Task not found." };
    bump();
    return { success: true, message: "Task deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

/**
 * The periodic report on tasks and tickets. For the people who hand work out:
 * task or help desk managers, and technical managers.
 */
export async function getWorkReportFor(period: string, from?: string, to?: string) {
  return withAuthorizedTenant([], async (tx, { user, companyId }) => {
    const allowed =
      (await holdsGate(tx, user, companyId, WRITE)) ||
      (await holdsGate(tx, user, companyId, HELPDESK_WRITE_ROLES as unknown as string[])) ||
      (await technicalStanding(tx, user, companyId)).isManager;
    if (!allowed) throw new Error("The work report is for managers who assign tasks and tickets.");
    const range = periodRange(period, from, to);
    const report = await getWorkReport(tx, range.from, range.to);
    return { ...report, label: range.label };
  });
}
