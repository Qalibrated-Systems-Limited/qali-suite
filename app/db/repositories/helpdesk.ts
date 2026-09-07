import { asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  helpdeskCategories,
  helpdeskComments,
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

function slaDeadlines(priority: string, from = new Date()) {
  const m = SLA_HOURS[priority] ?? SLA_HOURS.medium;
  return {
    responseDueAt: new Date(from.getTime() + m.resp * 3600_000),
    resolutionDueAt: new Date(from.getTime() + m.res * 3600_000),
  };
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
  const { responseDueAt, resolutionDueAt } = slaDeadlines(priority);

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
