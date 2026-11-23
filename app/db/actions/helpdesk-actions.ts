"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { HELPDESK_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/helpdesk";
import * as usersRepo from "../repositories/users";
import * as notifications from "../repositories/notifications";
import { holdsGate } from "../assigneeAccess";
import { technicalStanding, listTechnicalPeople } from "../technicalAccess";
import { needsResourceApproval, createResourceRequestIn } from "../resourceRequestsService";

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
  return withAuthorizedTenant([], async (tx, { user, companyId }) => {
    await repo.ensureCategories(tx, companyId);
    // The desk (and a technical manager) sees every ticket; everyone else the
    // tickets they raised or hold — a help desk is not a public noticeboard.
    const desk = (await holdsGate(tx, user, companyId, WRITE)) || (await technicalStanding(tx, user, companyId)).isManager;
    const [tickets, categories, stats, users, canned, articles, sla] = await Promise.all([
      desk ? repo.listTickets(tx) : repo.listTicketsFor(tx, String(user.id)),
      repo.listCategories(tx),
      repo.getHelpdeskStats(tx),
      usersRepo.listCompanyUsers(tx),
      desk ? repo.listCannedResponses(tx) : Promise.resolve([]),
      repo.listArticles(tx, "", desk),
      repo.listSlaPolicies(tx),
    ]);
    return {
      desk,
      canned: canned.map((c) => ({ id: String(c.id), title: c.title, body: c.body })),
      articles: articles.map((a) => ({ ...a, _id: String(a.id) })),
      sla,
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
  return withAuthorizedTenant([], async (tx, { user, companyId }) => {
    const thread = await repo.getTicketThread(tx, id);
    if (!thread) return null;
    // Who may read it: the desk, a technical manager, the assignee, and the
    // person who raised it — who does not see the desk's internal notes.
    const me = String(user.id);
    const staff =
      (await holdsGate(tx, user, companyId, WRITE)) ||
      thread.ticket.assignedToUserId === me ||
      (await technicalStanding(tx, user, companyId)).isManager;
    if (!staff && thread.ticket.createdById !== me) return null;
    return {
      viewer: { staff, requester: thread.ticket.createdById === me },
      ticket: { ...thread.ticket, _id: String(thread.ticket.id) },
      comments: thread.comments
        .filter((c) => staff || !c.isInternal)
        .map((c) => ({ ...c, _id: String(c.id) })),
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
  ticketType: z.enum(["incident", "service_request", "question", "problem", "complaint"]).optional(),
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
    ticketType: s(formData.get("ticketType")) || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;
  try {
    // Anyone raises a ticket. Only the desk names an assignee or speaks for a
    // customer; a member of staff raises it as themselves.
    const row = await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      const desk = await holdsGate(tx, user, companyId, WRITE);
      const me = actorFrom(user);
      const wanted = desk ? d.assignedToUserId || "" : "";
      const created = await repo.createTicket(tx, {
        companyId,
        ...d,
        assignedToUserId: null,
        assigneeName: "",
        requesterName: desk ? d.requesterName : me.name,
        requesterEmail: desk ? d.requesterEmail : "",
        customerName: desk ? d.customerName : "",
        createdById: me.id,
        createdByName: me.name,
      });
      // Named on the form, or the category's default assignee — through the
      // same rules as any assignment (technicians via the technical manager).
      let note = "";
      const categories = created.categoryId ? await repo.listCategories(tx) : [];
      const fallback = categories.find((c) => String(c.id) === String(created.categoryId))?.defaultAssigneeId || "";
      const target = wanted || fallback;
      if (target) {
        const r = (await assignTicketIn(tx, user, companyId, created.id, target)) as { assigneeName?: string; _requested?: string };
        note = r._requested ? ` — ${r._requested}` : r.assigneeName ? ` — assigned to ${r.assigneeName}` : "";
      }
      return { ...created, _note: note };
    });
    bump();
    return { success: true, message: `${row.ticketNumber} raised${row._note}`, id: row.id };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

/**
 * The Help Desk team works any ticket; the person a ticket is assigned to
 * works THEIR ticket — moves it along, resolves it, replies — whatever their
 * role. Closing, reopening and escalating stay with the desk.
 */
const ASSIGNEE_STATUSES = ["assigned", "in_progress", "pending", "resolved"];
async function requireDeskOrAssignee(
  tx: Parameters<Parameters<typeof withAuthorizedTenant>[1]>[0],
  user: { id?: string | null; role?: string | null },
  companyId: string,
  ticketId: string,
  status: string | null,
) {
  if (await holdsGate(tx, user, companyId, WRITE)) return;
  const t = await repo.getTicketById(tx, ticketId);
  if (!t) throw new Error("Ticket not found");
  if (t.assignedToUserId !== String(user.id)) {
    throw new Error("You can only work tickets assigned to you.");
  }
  if (status !== null && !ASSIGNEE_STATUSES.includes(status)) {
    throw new Error("Ask the help desk to close, reopen or escalate this ticket.");
  }
}

// ── lifecycle ───────────────────────────────────────────────────────────────
export async function setTicketStatus(
  id: string,
  status: string,
  extra: { resolutionNotes?: string; rootCause?: string; closureReason?: string } = {},
) {
  try {
    const row = await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      await requireDeskOrAssignee(tx, user, companyId, id, status);
      const updated = await repo.setTicketStatus(tx, id, status, actorFrom(user), extra);
      // The person who raised it hears that it is resolved — and can reply
      // to reopen it, or rate it.
      if (updated && status === "resolved" && updated.createdById && updated.createdById !== String(user.id)) {
        await notifications.createMany(tx, [{
          companyId,
          userId: updated.createdById,
          type: "approval_request",
          title: `${updated.ticketNumber} is resolved`,
          body: `${updated.title}${extra.resolutionNotes ? ` — ${extra.resolutionNotes}` : ""}. Reply if it is not fixed, or rate it.`,
          href: `/dashboard/helpdesk?ticket=${updated.id}`,
        }]);
      }
      if (!updated) throw new Error("Ticket not found");
      return updated;
    });
    bump();
    return { success: true, message: `${row.ticketNumber} → ${status.replace("_", " ")}` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

/**
 * Give a ticket to someone (or take it back: empty `userId`). The desk gives
 * it to anyone in the company; a technical manager to the technical team; a
 * Technical-department technician, given by anyone else, is requested from
 * the technical manager instead (the request assigns it when approved).
 * Shared by assignTicket and by a new ticket's category default.
 */
async function assignTicketIn(
  tx: Parameters<Parameters<typeof withAuthorizedTenant>[1]>[0],
  user: { id?: string | null; name?: string | null; role?: string | null },
  companyId: string,
  id: string,
  userId: string | null,
) {
  const desk = await holdsGate(tx, user, companyId, WRITE);
  // A technical manager hands tickets to the technical team from the
  // Technical module, without needing Help Desk authority over the rest.
  let to: { id: string; name: string } | null = null;
  if (desk) {
    if (userId) {
      const u = (await usersRepo.listCompanyUsers(tx)).find((x) => String(x.id) === String(userId));
      if (!u) throw new Error("Choose someone in this company.");
      to = { id: String(u.id), name: String(u.name) };
      // A technician from the Technical department is a technical
      // resource: the desk asks the technical manager rather than
      // assigning them directly. The ticket stays with the desk until the
      // request is approved, which assigns it.
      if (await needsResourceApproval(tx, user, companyId, to.id)) {
        const t = await repo.getTicketById(tx, id);
        if (!t) throw new Error("Ticket not found");
        const today = new Date().toISOString().slice(0, 10);
        const due = t.resolutionDueAt ? new Date(t.resolutionDueAt).toISOString().slice(0, 10) : today;
        const req = await createResourceRequestIn(tx, user, companyId, {
          resourceType: "technician",
          resourceId: to.id,
          sourceType: "ticket",
          sourceId: t.id,
          sourceRef: t.ticketNumber,
          sourceTitle: t.title,
          startDate: today,
          endDate: due < today ? today : due,
          notes: "",
        });
        return { ...t, assigneeName: "", _requested: `${req.requestNumber}: ${to.name} requested from the technical manager` };
      }
    }
  } else {
    const standing = await technicalStanding(tx, user, companyId);
    if (!standing.isManager) throw new Error("You don't have permission to assign tickets.");
    if (userId) {
      const p = (await listTechnicalPeople(tx)).find((x) => x.id === String(userId));
      if (!p) throw new Error("Choose someone from the technical team.");
      to = { id: p.id, name: p.name };
    }
  }
  const updated = await repo.assignTicket(
    tx,
    id,
    { userId: to?.id ?? null, name: to?.name ?? "" },
    actorFrom(user),
  );
  if (!updated) throw new Error("Ticket not found");
  if (to && to.id !== String(user.id)) {
    await notifications.createMany(tx, [
      {
        companyId,
        userId: to.id,
        type: "approval_request",
        title: `Ticket assigned to you: ${updated.ticketNumber}`,
        body: updated.title,
        href: `/dashboard/helpdesk?ticket=${updated.id}`,
      },
    ]);
  }
  return { ...updated, assigneeName: to?.name ?? "" };
}

export async function assignTicket(id: string, userId: string | null, _name?: string) {
  try {
    const row = await withAuthorizedTenant([], (tx, { user, companyId }) =>
      assignTicketIn(tx, user, companyId, id, userId),
    );
    bump();
    revalidatePath("/dashboard/technical/tickets");
    revalidatePath("/dashboard/tasks");
    revalidatePath("/dashboard/technical/resources");
    if ((row as { _requested?: string })._requested) {
      return { success: true, message: (row as { _requested?: string })._requested };
    }
    return { success: true, message: row.assigneeName ? `${row.ticketNumber} assigned to ${row.assigneeName}` : `${row.ticketNumber} unassigned` };
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
    await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      const t = await repo.getTicketById(tx, id);
      if (!t) throw new Error("Ticket not found");
      const isRequester = t.createdById === String(user.id);
      if (isRequester && !(await holdsGate(tx, user, companyId, WRITE)) && t.assignedToUserId !== String(user.id)) {
        // The person who raised it replies on the thread — never internally.
        if (isInternal) throw new Error("Internal notes are for the help desk.");
        if (t.status === "closed") throw new Error("This ticket is closed. Raise a new one and mention its number.");
        if (t.status === "resolved") {
          // A reply to a resolved ticket means it is not resolved: reopen it.
          await repo.setTicketStatus(tx, id, "reopened", actorFrom(user), {});
        }
      } else {
        await requireDeskOrAssignee(tx, user, companyId, id, null);
      }
      const c = await repo.addComment(tx, {
        companyId,
        ticketId: id,
        content,
        isInternal: !!isInternal,
        authorId: actorFrom(user).id,
        authorName: actorFrom(user).name,
      });
      if (!c) throw new Error("Ticket not found");
      // A public reply from the desk reaches the person who raised the ticket.
      if (!isInternal && t.createdById && t.createdById !== String(user.id)) {
        await notifications.createMany(tx, [{
          companyId,
          userId: t.createdById,
          type: "approval_request",
          title: `Reply on ${t.ticketNumber}`,
          body: String(content).slice(0, 160),
          href: `/dashboard/helpdesk?ticket=${t.id}`,
        }]);
      }
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

// ── Service-desk essentials ──────────────────────────────────────────────────

async function requireDesk(
  tx: Parameters<Parameters<typeof withAuthorizedTenant>[1]>[0],
  user: { id?: string | null; role?: string | null },
  companyId: string,
) {
  if (!(await holdsGate(tx, user, companyId, WRITE))) {
    throw new Error("Only the help desk team can do that.");
  }
}

async function run<T>(fn: Parameters<typeof withAuthorizedTenant<T>>[1], message: (r: T) => string) {
  try {
    const r = await withAuthorizedTenant([], fn);
    bump();
    return { success: true, message: message(r) };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

const TYPES = ["incident", "service_request", "question", "problem", "complaint"];

export async function setTicketTypeAction(id: string, ticketType: string) {
  if (!TYPES.includes(ticketType)) return { error: "Unknown ticket type." };
  return run(async (tx, { user, companyId }) => {
    await requireDesk(tx, user, companyId);
    const r = await repo.setTicketType(tx, id, ticketType, actorFrom(user));
    if (!r) throw new Error("Ticket not found");
    return r;
  }, (r) => `${r.ticketNumber} is now a ${ticketType.replace("_", " ")}`);
}

export async function mergeTicketAction(duplicateId: string, intoNumberOrId: string) {
  return run(async (tx, { user, companyId }) => {
    await requireDesk(tx, user, companyId);
    const key = String(intoNumberOrId || "").trim();
    const all = await repo.listTickets(tx);
    const into = all.find((t) => t.id === key || t.ticketNumber.toLowerCase() === key.toLowerCase());
    if (!into) throw new Error(`No ticket ${key}.`);
    const r = await repo.mergeTicket(tx, duplicateId, into.id, actorFrom(user));
    return { from: r.row.ticketNumber, into: r.into.ticketNumber };
  }, (r) => `${r.from} merged into ${r.into}`);
}

export async function rateTicketAction(id: string, rating: number, comment = "") {
  return run(async (tx, { user, companyId }) => {
    const t = await repo.getTicketById(tx, id);
    if (!t) throw new Error("Ticket not found");
    // The requester rates their own; the desk can record a customer's rating.
    if (t.createdById !== String(user.id)) await requireDesk(tx, user, companyId);
    const r = await repo.rateTicket(tx, id, Number(rating), String(comment || ""));
    if (!r) throw new Error("Ticket not found");
    return r;
  }, () => "Thank you — rating recorded");
}

export async function saveSlaPolicy(priority: string, responseHours: number, resolutionHours: number) {
  if (!["critical", "high", "medium", "low"].includes(priority)) return { error: "Unknown priority." };
  const resp = Number(responseHours);
  const res = Number(resolutionHours);
  if (!(resp > 0) || !(res >= resp) || res > 9999) {
    return { error: "Response must be above 0 hours and resolution at least as long as response." };
  }
  return run(async (tx, { user, companyId }) => {
    await requireDesk(tx, user, companyId);
    await repo.setSlaPolicy(tx, companyId, priority, resp, res, actorFrom(user).name);
    return priority;
  }, (p) => `SLA for ${p} saved — it applies to tickets raised from now on`);
}

export async function saveCannedResponse(title: string, body: string) {
  if (!String(title || "").trim() || !String(body || "").trim()) return { error: "A saved reply needs a title and text." };
  return run(async (tx, { user, companyId }) => {
    await requireDesk(tx, user, companyId);
    return repo.createCannedResponse(tx, {
      companyId,
      title: String(title).slice(0, 120),
      body: String(body).slice(0, 4000),
      createdById: actorFrom(user).id,
      createdByName: actorFrom(user).name,
    });
  }, (r) => `Saved reply "${r.title}" added`);
}

export async function deleteCannedResponseAction(id: string) {
  return run(async (tx, { user, companyId }) => {
    await requireDesk(tx, user, companyId);
    await repo.deleteCannedResponse(tx, id);
    return id;
  }, () => "Saved reply removed");
}

export async function saveArticleAction(input: { id?: string; title: string; body: string; categoryId?: string; status?: string }) {
  if (!String(input?.title || "").trim() || !String(input?.body || "").trim()) {
    return { error: "An article needs a title and a body." };
  }
  if (input.status && !["draft", "published", "archived"].includes(input.status)) return { error: "Unknown status." };
  return run(async (tx, { user, companyId }) => {
    await requireDesk(tx, user, companyId);
    const r = await repo.saveArticle(tx, {
      id: input.id || null,
      companyId,
      title: String(input.title).slice(0, 200),
      body: String(input.body).slice(0, 20000),
      categoryId: input.categoryId || null,
      status: input.status,
      actor: actorFrom(user),
    });
    if (!r) throw new Error("Article not found");
    return r;
  }, (r) => `${r.articleNumber} saved`);
}

export async function getArticleAction(id: string) {
  return withAuthorizedTenant([], async (tx, { user, companyId }) => {
    const a = await repo.getArticle(tx, id, true);
    if (!a) return null;
    if (a.status !== "published" && !(await holdsGate(tx, user, companyId, WRITE))) return null;
    return { ...a, _id: String(a.id) };
  });
}

export async function markArticleHelpfulAction(id: string) {
  return run(async (tx) => {
    await repo.markArticleHelpful(tx, id);
    return id;
  }, () => "Thanks for the feedback");
}

export async function linkSolutionArticleAction(ticketId: string, articleId: string | null) {
  return run(async (tx, { user, companyId }) => {
    await requireDeskOrAssignee(tx, user, companyId, ticketId, null);
    const r = await repo.linkSolutionArticle(tx, ticketId, articleId);
    if (!r) throw new Error("Ticket not found");
    return r;
  }, (r) => (r.solutionArticleId ? `Solution article linked to ${r.ticketNumber}` : "Solution article removed"));
}

export async function setCategoryDefaultAssigneeAction(categoryId: string, userId: string | null) {
  return run(async (tx, { user, companyId }) => {
    await requireDesk(tx, user, companyId);
    let to: { id: string; name: string } | null = null;
    if (userId) {
      const u = (await usersRepo.listCompanyUsers(tx)).find((x) => String(x.id) === String(userId));
      if (!u) throw new Error("Choose someone in this company.");
      to = { id: String(u.id), name: String(u.name) };
    }
    const r = await repo.setCategoryDefaultAssignee(tx, categoryId, to);
    if (!r) throw new Error("Category not found");
    return r;
  }, (r) => (r.defaultAssigneeName ? `New "${r.name}" tickets go to ${r.defaultAssigneeName}` : `"${r.name}" has no default assignee`));
}
