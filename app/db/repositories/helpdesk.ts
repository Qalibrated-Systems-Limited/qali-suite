import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  helpdeskCategories,
  helpdeskComments,
  helpdeskSlaPolicies,
  helpdeskCannedResponses,
  helpdeskArticles,
  helpdeskHistory,
  helpdeskTickets,
} from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * Help Desk repository — 0089. Same contract as every other repository: `tx`
 * is already RLS-scoped to the company, so nothing here filters on companyId,
 * and no session/role logic lives here (that is helpdesk-actions.ts). The SLA
 * clocks a ticket carries are stamped from the priority matrix below at
 * creation, which is what lets a ticket own its own deadlines without a
 * separate policy table to join on every read.
 */

/** Response / resolution windows, in hours, by priority. */
const SLA_HOURS: Record<string, { resp: number; res: number }> = {
  critical: { resp: 1, res: 4 },
  high: { resp: 2, res: 8 },
  medium: { resp: 4, res: 24 },
  low: { resp: 8, res: 72 },
};

/** The company's SLA policy for a priority, or the matrix above if it set none. */
export async function slaHoursFor(tx: Tx, priority: string) {
  const [row] = await tx
    .select()
    .from(helpdeskSlaPolicies)
    .where(eq(helpdeskSlaPolicies.priority, priority));
  if (row) return { resp: Number(row.responseHours), res: Number(row.resolutionHours) };
  return SLA_HOURS[priority] ?? SLA_HOURS.medium;
}

async function slaDeadlines(tx: Tx, priority: string, from = new Date()) {
  const m = await slaHoursFor(tx, priority);
  return {
    responseDueAt: new Date(from.getTime() + m.resp * 3600_000),
    resolutionDueAt: new Date(from.getTime() + m.res * 3600_000),
  };
}

/** Every priority's policy, the company's own or the default, for Settings. */
export async function listSlaPolicies(tx: Tx) {
  const rows = await tx.select().from(helpdeskSlaPolicies);
  return ["critical", "high", "medium", "low"].map((priority) => {
    const r = rows.find((x) => x.priority === priority);
    const d = SLA_HOURS[priority];
    return {
      priority,
      responseHours: r ? Number(r.responseHours) : d.resp,
      resolutionHours: r ? Number(r.resolutionHours) : d.res,
      custom: Boolean(r),
    };
  });
}

export async function setSlaPolicy(
  tx: Tx,
  companyId: string,
  priority: string,
  responseHours: number,
  resolutionHours: number,
  byName: string,
) {
  await tx
    .insert(helpdeskSlaPolicies)
    .values({ companyId, priority, responseHours: String(responseHours), resolutionHours: String(resolutionHours), updatedByName: byName })
    .onConflictDoUpdate({
      target: [helpdeskSlaPolicies.companyId, helpdeskSlaPolicies.priority],
      set: { responseHours: String(responseHours), resolutionHours: String(resolutionHours), updatedByName: byName, updatedAt: new Date() },
    });
}

async function nextNumber(tx: Tx, companyId: string, prefix: string) {
  const [{ n }] = (await tx.execute(
    sql`SELECT next_entry_number(${companyId}::uuid, ${prefix}) AS n`,
  )) as unknown as Array<{ n: string }>;
  return n;
}

// ── Categories ────────────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  { name: "General Enquiry", department: "Support", defaultPriority: "medium" },
  { name: "IT Support", department: "IT", defaultPriority: "high" },
  { name: "Maintenance", department: "Facilities", defaultPriority: "medium" },
  { name: "Billing & Accounts", department: "Finance", defaultPriority: "medium" },
  { name: "Safety Report", department: "HSE", defaultPriority: "high" },
  { name: "Complaint", department: "Quality", defaultPriority: "high", isComplaint: true },
];

/**
 * Seed the standard category set the first time a company opens the Help Desk.
 * Idempotent — the unique (company_id, name) index + onConflictDoNothing means
 * calling it on every read costs one cheap upsert-of-nothing after the first.
 */
export async function ensureCategories(tx: Tx, companyId: string) {
  await tx
    .insert(helpdeskCategories)
    .values(
      DEFAULT_CATEGORIES.map((c) => ({
        companyId,
        name: c.name,
        department: c.department,
        defaultPriority: c.defaultPriority,
        isComplaint: c.isComplaint ?? false,
        createdByName: "System",
      })),
    )
    .onConflictDoNothing();
}

export function listCategories(tx: Tx) {
  return tx
    .select()
    .from(helpdeskCategories)
    .where(eq(helpdeskCategories.isActive, true))
    .orderBy(asc(helpdeskCategories.name));
}

export async function createCategory(
  tx: Tx,
  input: {
    companyId: string;
    name: string;
    department?: string | null;
    defaultPriority?: string;
    requiresEvidence?: boolean;
    isComplaint?: boolean;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const [row] = await tx
    .insert(helpdeskCategories)
    .values({
      companyId: input.companyId,
      name: input.name.trim(),
      department: input.department?.trim() ?? "",
      defaultPriority: input.defaultPriority ?? "medium",
      requiresEvidence: input.requiresEvidence ?? false,
      isComplaint: input.isComplaint ?? false,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}

// ── Tickets ─────────────────────────────────────────────────────────────────
export function listTickets(tx: Tx) {
  return tx.select().from(helpdeskTickets).orderBy(desc(helpdeskTickets.createdAt));
}

export async function getTicketById(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(helpdeskTickets).where(eq(helpdeskTickets.id, id));
  return row ?? null;
}

export async function getTicketThread(tx: Tx, id: string) {
  const ticket = await getTicketById(tx, id);
  if (!ticket) return null;
  const [comments, history] = await Promise.all([
    tx
      .select()
      .from(helpdeskComments)
      .where(eq(helpdeskComments.ticketId, id))
      .orderBy(asc(helpdeskComments.createdAt)),
    tx
      .select()
      .from(helpdeskHistory)
      .where(eq(helpdeskHistory.ticketId, id))
      .orderBy(desc(helpdeskHistory.occurredAt)),
  ]);
  return { ticket, comments, history };
}

async function logHistory(
  tx: Tx,
  companyId: string,
  ticketId: string,
  actor: { id: string | null; name: string },
  action: string,
  detail: { from?: string | null; to?: string | null; note?: string | null } = {},
) {
  await tx.insert(helpdeskHistory).values({
    companyId,
    ticketId,
    userId: actor.id,
    userName: actor.name,
    action,
    fromValue: detail.from ?? null,
    toValue: detail.to ?? null,
    note: detail.note ?? null,
  });
}

export interface CreateTicketInput {
  companyId: string;
  title: string;
  description?: string | null;
  categoryId?: string | null;
  priority?: string;
  source?: string;
  department?: string | null;
  customerName?: string | null;
  requesterName?: string | null;
  requesterEmail?: string | null;
  assignedToUserId?: string | null;
  assigneeName?: string | null;
  projectId?: string | null;
  dueDate?: string | null;
  ticketType?: string;
  createdById?: string | null;
  createdByName: string;
}

export async function createTicket(tx: Tx, input: CreateTicketInput) {
  const ticketNumber = await nextNumber(tx, input.companyId, "TKT");

  // Resolve the category to fold its name/priority onto the ticket.
  let categoryName = "";
  let priority = input.priority ?? "medium";
  if (input.categoryId && isUuid(input.categoryId)) {
    const [cat] = await tx
      .select()
      .from(helpdeskCategories)
      .where(eq(helpdeskCategories.id, input.categoryId));
    if (cat) {
      categoryName = cat.name;
      if (!input.priority) priority = cat.defaultPriority;
    }
  }

  const assigned = !!input.assignedToUserId;
  const { responseDueAt, resolutionDueAt } = await slaDeadlines(tx, priority);

  const [row] = await tx
    .insert(helpdeskTickets)
    .values({
      companyId: input.companyId,
      ticketNumber,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      categoryId: input.categoryId && isUuid(input.categoryId) ? input.categoryId : null,
      categoryName,
      priority,
      status: assigned ? "assigned" : "new",
      source: input.source ?? "manual",
      department: input.department?.trim() ?? "",
      customerName: input.customerName?.trim() ?? "",
      requesterName: input.requesterName?.trim() ?? "",
      requesterEmail: input.requesterEmail?.trim() ?? "",
      assignedToUserId: input.assignedToUserId || null,
      assigneeName: input.assigneeName?.trim() ?? "",
      projectId: input.projectId && isUuid(input.projectId) ? input.projectId : null,
      dueDate: input.dueDate || null,
      ticketType: input.ticketType || "incident",
      responseDueAt,
      resolutionDueAt,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();

  await logHistory(
    tx,
    input.companyId,
    row.id,
    { id: input.createdById ?? null, name: input.createdByName },
    "created",
    { to: row.status },
  );
  return row;
}

/** Move a ticket through its lifecycle, stamping the clocks and history. */
export async function setTicketStatus(
  tx: Tx,
  id: string,
  status: string,
  actor: { id: string | null; name: string },
  extra: { resolutionNotes?: string; rootCause?: string; closureReason?: string } = {},
) {
  const existing = await getTicketById(tx, id);
  if (!existing) return null;

  const now = new Date();
  const patch: Record<string, unknown> = {
    status,
    lastModifiedById: actor.id,
    lastModifiedByName: actor.name,
    updatedAt: now,
  };
  if (extra.resolutionNotes !== undefined) patch.resolutionNotes = extra.resolutionNotes.trim();
  if (extra.rootCause !== undefined) patch.rootCause = extra.rootCause.trim();
  if (extra.closureReason !== undefined) patch.closureReason = extra.closureReason.trim();

  // "Pending" means waiting on the customer: the SLA clock stops, and when
  // the ticket moves on its deadlines move by the time it waited.
  if (status === "pending" && existing.status !== "pending" && !existing.slaPausedAt) {
    patch.slaPausedAt = now;
  }
  if (status !== "pending" && existing.slaPausedAt) {
    const waited = now.getTime() - new Date(existing.slaPausedAt).getTime();
    patch.slaPausedAt = null;
    if (existing.resolutionDueAt) patch.resolutionDueAt = new Date(new Date(existing.resolutionDueAt).getTime() + waited);
    if (existing.responseDueAt && !existing.firstResponseAt) {
      patch.responseDueAt = new Date(new Date(existing.responseDueAt).getTime() + waited);
    }
  }
  if (status === "resolved" && !existing.resolvedAt) patch.resolvedAt = now;
  if (status === "closed") {
    patch.closedAt = now;
    if (!existing.resolvedAt) patch.resolvedAt = now;
  }
  if (status === "reopened") {
    patch.resolvedAt = null;
    patch.closedAt = null;
  }

  const [row] = await tx
    .update(helpdeskTickets)
    .set(patch)
    .where(eq(helpdeskTickets.id, id))
    .returning();

  await logHistory(tx, existing.companyId, id, actor, "status_changed", {
    from: existing.status,
    to: status,
    note: extra.closureReason || extra.resolutionNotes || null,
  });
  return row ?? null;
}

export async function assignTicket(
  tx: Tx,
  id: string,
  assignee: { userId: string | null; name: string },
  actor: { id: string | null; name: string },
) {
  const existing = await getTicketById(tx, id);
  if (!existing) return null;
  const [row] = await tx
    .update(helpdeskTickets)
    .set({
      assignedToUserId: assignee.userId,
      assigneeName: assignee.name,
      status: existing.status === "new" ? "assigned" : existing.status,
      lastModifiedById: actor.id,
      lastModifiedByName: actor.name,
      updatedAt: new Date(),
    })
    .where(eq(helpdeskTickets.id, id))
    .returning();
  await logHistory(tx, existing.companyId, id, actor, "assigned", {
    from: existing.assigneeName || "Unassigned",
    to: assignee.name || "Unassigned",
  });
  return row ?? null;
}

export async function escalateTicket(
  tx: Tx,
  id: string,
  level: string,
  reason: string,
  actor: { id: string | null; name: string },
) {
  const existing = await getTicketById(tx, id);
  if (!existing) return null;
  const [row] = await tx
    .update(helpdeskTickets)
    .set({
      isEscalated: true,
      escalationLevel: level,
      status: "escalated",
      lastModifiedById: actor.id,
      lastModifiedByName: actor.name,
      updatedAt: new Date(),
    })
    .where(eq(helpdeskTickets.id, id))
    .returning();
  await logHistory(tx, existing.companyId, id, actor, "escalated", {
    to: level,
    note: reason,
  });
  return row ?? null;
}

export async function addComment(
  tx: Tx,
  input: {
    companyId: string;
    ticketId: string;
    content: string;
    isInternal: boolean;
    authorId: string | null;
    authorName: string;
  },
) {
  const ticket = await getTicketById(tx, input.ticketId);
  if (!ticket) return null;

  const [comment] = await tx
    .insert(helpdeskComments)
    .values({
      companyId: input.companyId,
      ticketId: input.ticketId,
      authorId: input.authorId,
      authorName: input.authorName,
      content: input.content.trim(),
      isInternal: input.isInternal,
    })
    .returning();

  // A public staff reply meets the Response SLA the moment it lands.
  if (!input.isInternal && !ticket.firstResponseAt) {
    await tx
      .update(helpdeskTickets)
      .set({ firstResponseAt: new Date(), updatedAt: new Date() })
      .where(eq(helpdeskTickets.id, input.ticketId));
  }
  await logHistory(
    tx,
    input.companyId,
    input.ticketId,
    { id: input.authorId, name: input.authorName },
    input.isInternal ? "internal_note" : "replied",
  );
  return comment;
}

export async function deleteTicket(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.delete(helpdeskTickets).where(eq(helpdeskTickets.id, id));
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export async function getHelpdeskStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status NOT IN ('resolved','closed'))::int AS open_tickets,
      count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND assigned_to_user_id IS NULL)::int AS unassigned,
      count(*) FILTER (WHERE is_escalated AND status NOT IN ('resolved','closed'))::int AS escalated,
      count(*) FILTER (
        WHERE status NOT IN ('resolved','closed')
          AND resolution_due_at IS NOT NULL
          AND resolution_due_at < now()
      )::int AS breaching,
      count(*) FILTER (
        WHERE status NOT IN ('resolved','closed')
          AND resolution_due_at IS NOT NULL
          AND resolution_due_at >= now()
          AND resolution_due_at < now() + interval '4 hours'
      )::int AS due_soon,
      count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
      count(*) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at::date = now()::date)::int AS resolved_today,
      count(*) FILTER (WHERE priority = 'critical' AND status NOT IN ('resolved','closed'))::int AS critical_open,
      count(*) FILTER (WHERE priority = 'high' AND status NOT IN ('resolved','closed'))::int AS high_open,
      count(*) FILTER (WHERE priority = 'medium' AND status NOT IN ('resolved','closed'))::int AS medium_open,
      count(*) FILTER (WHERE priority = 'low' AND status NOT IN ('resolved','closed'))::int AS low_open
    FROM helpdesk_tickets
  `)) as unknown as Array<Record<string, number>>;
  return {
    total: row?.total ?? 0,
    open: row?.open_tickets ?? 0,
    unassigned: row?.unassigned ?? 0,
    escalated: row?.escalated ?? 0,
    breaching: row?.breaching ?? 0,
    dueSoon: row?.due_soon ?? 0,
    resolved: row?.resolved ?? 0,
    resolvedToday: row?.resolved_today ?? 0,
    byPriority: {
      critical: row?.critical_open ?? 0,
      high: row?.high_open ?? 0,
      medium: row?.medium_open ?? 0,
      low: row?.low_open ?? 0,
    },
  };
}

/**
 * Open tickets for the Technical module: those filed to the Technical
 * department (on the ticket or its category) plus any already with someone
 * on the technical team. `all` widens it to every open ticket, so a technical
 * manager can pick up a call the desk filed elsewhere.
 */
export async function listTicketsForTechnical(tx: Tx, technicalUserIds: string[], all = false) {
  const ids = technicalUserIds.length ? technicalUserIds : ["__none__"];
  return (await tx.execute(sql`
    SELECT h.id, h.ticket_number AS "ticketNumber", h.title, h.priority, h.status,
           h.category_name AS "categoryName", h.department, h.customer_name AS "customerName",
           h.assigned_to_user_id AS "assignedToUserId", h.assignee_name AS "assigneeName",
           h.resolution_due_at AS "resolutionDueAt", h.created_at AS "createdAt",
           (h.resolution_due_at IS NOT NULL AND h.resolution_due_at < now()) AS "breached"
      FROM helpdesk_tickets h
      LEFT JOIN helpdesk_categories c ON c.id = h.category_id
     WHERE h.status NOT IN ('resolved','closed')
       AND (
         ${all}
         OR lower(COALESCE(h.department, '')) = 'technical'
         OR lower(COALESCE(c.department, '')) = 'technical'
         OR h.assigned_to_user_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
       )
     ORDER BY CASE h.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              h.resolution_due_at NULLS LAST, h.created_at
  `)) as unknown as Array<{
    id: string; ticketNumber: string; title: string; priority: string; status: string;
    categoryName: string | null; department: string | null; customerName: string | null;
    assignedToUserId: string | null; assigneeName: string | null;
    resolutionDueAt: Date | null; createdAt: Date; breached: boolean;
  }>;
}


// ── Merge, rating ────────────────────────────────────────────────────────────

/**
 * A duplicate is closed INTO the ticket that carries the work: it points at
 * it, says so on both threads, and its conversation stays readable.
 */
export async function mergeTicket(
  tx: Tx,
  duplicateId: string,
  intoId: string,
  actor: { id: string | null; name: string },
) {
  if (duplicateId === intoId) throw new Error("A ticket cannot be merged into itself.");
  const dup = await getTicketById(tx, duplicateId);
  const into = await getTicketById(tx, intoId);
  if (!dup || !into) throw new Error("Ticket not found");
  if (into.mergedIntoId) throw new Error(`${into.ticketNumber} was itself merged; merge into ${into.ticketNumber}'s target instead.`);
  const now = new Date();
  const [row] = await tx
    .update(helpdeskTickets)
    .set({
      mergedIntoId: into.id,
      status: "closed",
      closedAt: now,
      resolvedAt: dup.resolvedAt ?? now,
      closureReason: `Merged into ${into.ticketNumber}`,
      lastModifiedById: actor.id,
      lastModifiedByName: actor.name,
      updatedAt: now,
    })
    .where(eq(helpdeskTickets.id, dup.id))
    .returning();
  for (const [t, text] of [
    [dup, `Merged into ${into.ticketNumber}. Follow that ticket for updates.`],
    [into, `${dup.ticketNumber} (${dup.title}) was merged into this ticket.`],
  ] as const) {
    await tx.insert(helpdeskComments).values({
      companyId: t.companyId,
      ticketId: t.id,
      authorId: actor.id,
      authorName: actor.name,
      content: text,
      isInternal: false,
    });
  }
  await logHistory(tx, dup.companyId, dup.id, actor, "merged", { to: into.ticketNumber });
  return { row, into };
}

export async function rateTicket(tx: Tx, id: string, rating: number, comment: string) {
  const t = await getTicketById(tx, id);
  if (!t) return null;
  if (!["resolved", "closed"].includes(t.status)) throw new Error("A ticket is rated once it is resolved.");
  if (!(rating >= 1 && rating <= 5)) throw new Error("Rate it from 1 to 5.");
  const [row] = await tx
    .update(helpdeskTickets)
    .set({ satisfactionRating: Math.round(rating), satisfactionComment: comment.trim(), ratedAt: new Date() })
    .where(eq(helpdeskTickets.id, id))
    .returning();
  return row ?? null;
}

export async function setTicketType(tx: Tx, id: string, ticketType: string, actor: { id: string | null; name: string }) {
  const t = await getTicketById(tx, id);
  if (!t) return null;
  const [row] = await tx
    .update(helpdeskTickets)
    .set({ ticketType, lastModifiedById: actor.id, lastModifiedByName: actor.name, updatedAt: new Date() })
    .where(eq(helpdeskTickets.id, id))
    .returning();
  await logHistory(tx, t.companyId, id, actor, "type_changed", { from: t.ticketType, to: ticketType });
  return row ?? null;
}

export async function linkSolutionArticle(tx: Tx, id: string, articleId: string | null) {
  const [row] = await tx
    .update(helpdeskTickets)
    .set({ solutionArticleId: articleId && isUuid(articleId) ? articleId : null, updatedAt: new Date() })
    .where(eq(helpdeskTickets.id, id))
    .returning();
  return row ?? null;
}

/** The tickets a person raised or holds — for those who are not on the desk. */
export function listTicketsFor(tx: Tx, userId: string) {
  return tx
    .select()
    .from(helpdeskTickets)
    .where(or(eq(helpdeskTickets.createdById, userId), eq(helpdeskTickets.assignedToUserId, userId)))
    .orderBy(desc(helpdeskTickets.createdAt));
}

// ── Saved replies ────────────────────────────────────────────────────────────
export function listCannedResponses(tx: Tx) {
  return tx.select().from(helpdeskCannedResponses).orderBy(asc(helpdeskCannedResponses.title));
}

export async function createCannedResponse(
  tx: Tx,
  input: { companyId: string; title: string; body: string; createdById: string | null; createdByName: string },
) {
  const [row] = await tx
    .insert(helpdeskCannedResponses)
    .values({ ...input, title: input.title.trim(), body: input.body.trim() })
    .returning();
  return row;
}

export async function deleteCannedResponse(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.delete(helpdeskCannedResponses).where(eq(helpdeskCannedResponses.id, id));
}

// ── Knowledge base ───────────────────────────────────────────────────────────
export function listArticles(tx: Tx, q = "", includeDrafts = false) {
  const conds = [] as ReturnType<typeof eq>[];
  if (!includeDrafts) conds.push(eq(helpdeskArticles.status, "published"));
  const term = q.trim();
  const search = term
    ? or(ilike(helpdeskArticles.title, `%${term}%`), ilike(helpdeskArticles.body, `%${term}%`))
    : undefined;
  const where = [...conds, ...(search ? [search] : [])];
  return tx
    .select()
    .from(helpdeskArticles)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(helpdeskArticles.helpful), desc(helpdeskArticles.views), asc(helpdeskArticles.title))
    .limit(100);
}

export async function getArticle(tx: Tx, id: string, countView = false) {
  if (!isUuid(id)) return null;
  if (countView) {
    await tx.update(helpdeskArticles).set({ views: sql`${helpdeskArticles.views} + 1` }).where(eq(helpdeskArticles.id, id));
  }
  const [row] = await tx.select().from(helpdeskArticles).where(eq(helpdeskArticles.id, id));
  return row ?? null;
}

export async function saveArticle(
  tx: Tx,
  input: {
    id?: string | null;
    companyId: string;
    title: string;
    body: string;
    categoryId?: string | null;
    status?: string;
    actor: { id: string | null; name: string };
  },
) {
  const values = {
    title: input.title.trim(),
    body: input.body.trim(),
    categoryId: input.categoryId && isUuid(input.categoryId) ? input.categoryId : null,
    status: input.status || "published",
    updatedAt: new Date(),
  };
  if (input.id && isUuid(input.id)) {
    const [row] = await tx.update(helpdeskArticles).set(values).where(eq(helpdeskArticles.id, input.id)).returning();
    return row ?? null;
  }
  const articleNumber = await nextNumber(tx, input.companyId, "KB");
  const [row] = await tx
    .insert(helpdeskArticles)
    .values({ ...values, companyId: input.companyId, articleNumber, createdById: input.actor.id, createdByName: input.actor.name })
    .returning();
  return row;
}

export async function markArticleHelpful(tx: Tx, id: string) {
  if (!isUuid(id)) return;
  await tx.update(helpdeskArticles).set({ helpful: sql`${helpdeskArticles.helpful} + 1` }).where(eq(helpdeskArticles.id, id));
}

export async function setCategoryDefaultAssignee(tx: Tx, categoryId: string, to: { id: string; name: string } | null) {
  if (!isUuid(categoryId)) return null;
  const [row] = await tx
    .update(helpdeskCategories)
    .set({ defaultAssigneeId: to?.id ?? null, defaultAssigneeName: to?.name ?? "", updatedAt: new Date() })
    .where(eq(helpdeskCategories.id, categoryId))
    .returning();
  return row ?? null;
}
