"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { HELPDESK_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/helpdesk";
import * as usersRepo from "../repositories/users";

/**
 * Help Desk actions — 0089. Same shape as technical-actions.ts: Zod validates,
 * `withAuthorizedTenant` scopes and gates, the repository does the SQL. Reads
 * are open to any authenticated member of the company; writes need
 * HELPDESK_WRITE_ROLES. Every mutation returns {success,message} or {error}.
 */

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return { id: user?.id ?? null, name: user?.name || "Unknown User" };
}
function s(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v : "";
}
function bump() {
  revalidatePath("/dashboard/helpdesk");
}
const WRITE = HELPDESK_WRITE_ROLES as unknown as string[];

// ── reads ────────────────────────────────────────────────────────────────────
export async function getHelpdeskData() {
  return withAuthorizedTenant([], async (tx, { companyId }) => {
    await repo.ensureCategories(tx, companyId);
    const [tickets, categories, stats, users] = await Promise.all([
      repo.listTickets(tx),
      repo.listCategories(tx),
      repo.getHelpdeskStats(tx),
      usersRepo.listCompanyUsers(tx),
    ]);
    return {
      tickets: tickets.map((r) => ({ ...r, _id: String(r.id) })),
      categories: categories.map((r) => ({ ...r, _id: String(r.id) })),
      stats,
      users: users
        .filter((u) => u.status !== "Inactive")
        .map((u) => ({ id: u.id, name: u.name, role: u.role })),
    };
  });
}

export async function getTicketDetail(id: string) {
  return withAuthorizedTenant([], async (tx) => {
    const thread = await repo.getTicketThread(tx, id);
    if (!thread) return null;
    return {
      ticket: { ...thread.ticket, _id: String(thread.ticket.id) },
      comments: thread.comments.map((c) => ({ ...c, _id: String(c.id) })),
      history: thread.history.map((h) => ({ ...h, _id: String(h.id) })),
    };
  });
}

// ── create ────────────────────────────────────────────────────────────────────
const ticketSchema = z.object({
  title: z.string().trim().min(1, "A ticket needs a title").max(200),
  description: z.string().trim().max(4000).optional(),
  categoryId: z.string().trim().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  source: z.enum(["manual", "system", "crm", "safety", "scheduled"]).optional(),
  department: z.string().trim().max(120).optional(),
  customerName: z.string().trim().max(200).optional(),
  requesterName: z.string().trim().max(160).optional(),
  requesterEmail: z.string().trim().max(200).optional(),
  assignedToUserId: z.string().trim().optional(),
  assigneeName: z.string().trim().max(160).optional(),
  dueDate: z.string().optional(),
});

export async function createTicket(prevState: unknown, formData: FormData) {
  const parsed = ticketSchema.safeParse({
    title: s(formData.get("title")),
    description: s(formData.get("description")),
    categoryId: s(formData.get("categoryId")),
    priority: s(formData.get("priority")) || undefined,
    source: s(formData.get("source")) || undefined,
    department: s(formData.get("department")),
    customerName: s(formData.get("customerName")),
    requesterName: s(formData.get("requesterName")),
    requesterEmail: s(formData.get("requesterEmail")),
    assignedToUserId: s(formData.get("assignedToUserId")),
    assigneeName: s(formData.get("assigneeName")),
    dueDate: s(formData.get("dueDate")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createTicket(tx, {
        companyId,
        ...d,
        assignedToUserId: d.assignedToUserId || null,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `${row.ticketNumber} raised` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── lifecycle ───────────────────────────────────────────────────────────────
export async function setTicketStatus(
  id: string,
  status: string,
  extra: { resolutionNotes?: string; rootCause?: string; closureReason?: string } = {},
) {
  try {
    const row = await withAuthorizedTenant(WRITE, async (tx, { user }) => {
      const updated = await repo.setTicketStatus(tx, id, status, actorFrom(user), extra);
      if (!updated) throw new Error("Ticket not found");
      return updated;
    });
    bump();
    return { success: true, message: `${row.ticketNumber} → ${status.replace("_", " ")}` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function assignTicket(id: string, userId: string | null, name: string) {
  try {
    const row = await withAuthorizedTenant(WRITE, async (tx, { user }) => {
      const updated = await repo.assignTicket(
        tx,
        id,
        { userId: userId || null, name: name || "" },
        actorFrom(user),
      );
      if (!updated) throw new Error("Ticket not found");
      return updated;
    });
    bump();
    return { success: true, message: name ? `Assigned to ${name}` : "Unassigned" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function escalateTicket(id: string, level: string, reason: string) {
  if (!["Supervisor", "DepartmentHead", "MD"].includes(level)) {
    return { error: "Choose an escalation level" };
  }
  try {
    const row = await withAuthorizedTenant(WRITE, async (tx, { user }) => {
      const updated = await repo.escalateTicket(tx, id, level, reason || "", actorFrom(user));
      if (!updated) throw new Error("Ticket not found");
      return updated;
    });
    bump();
    return { success: true, message: `${row.ticketNumber} escalated to ${level}` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function addTicketComment(id: string, content: string, isInternal: boolean) {
  if (!content?.trim()) return { error: "Write a message first" };
  try {
    await withAuthorizedTenant(WRITE, async (tx, { user, companyId }) => {
      const c = await repo.addComment(tx, {
        companyId,
        ticketId: id,
        content,
        isInternal: !!isInternal,
        authorId: actorFrom(user).id,
        authorName: actorFrom(user).name,
      });
      if (!c) throw new Error("Ticket not found");
      return c;
    });
    bump();
    return { success: true, message: isInternal ? "Internal note added" : "Reply posted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteTicket(id: string) {
  try {
    await withAuthorizedTenant(WRITE, (tx) => repo.deleteTicket(tx, id));
    bump();
    return { success: true, message: "Ticket deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── categories ────────────────────────────────────────────────────────────────
const categorySchema = z.object({
  name: z.string().trim().min(1, "A category needs a name").max(120),
  department: z.string().trim().max(120).optional(),
  defaultPriority: z.enum(["low", "medium", "high", "critical"]).optional(),
  isComplaint: z.boolean().optional(),
});

export async function createCategory(prevState: unknown, formData: FormData) {
  const parsed = categorySchema.safeParse({
    name: s(formData.get("name")),
    department: s(formData.get("department")),
    defaultPriority: s(formData.get("defaultPriority")) || undefined,
    isComplaint: s(formData.get("isComplaint")) === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;
  try {
    await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createCategory(tx, {
        companyId,
        ...d,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `Category "${d.name}" added` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
