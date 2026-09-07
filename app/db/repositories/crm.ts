import { and, asc, desc, eq, sql } from "drizzle-orm";
import { isUuid } from "./sqlHelpers";
import type { Tx } from "../client";
import { leads, opportunities, opportunityStageHistory, crmActivities } from "../schema";

/**
 * CRM — 0096. Leads, opportunities and the activity trail.
 *
 * `docs/CURRENT-STATE.md` calls this a whole missing module: "First touch is
 * the Quote — nothing tracks the funnel before that."
 *
 * Contract with the layer above: every function takes a `tx` from
 * withTenant(), so RLS is active; nothing here reads the session or checks
 * permissions. MONEY IS A NUMBER on the way out, because the Mongo queries
 * returned numbers and the screens do arithmetic on them.
 *
 * ── The one thing that is not a transcription ──────────────────────────────
 *
 * PROBABILITY. Mongo seeded it from the stage in a pre-save hook that fired
 * only when it was null, so once seeded it never moved: a deal created at
 * qualification and advanced to negotiation still forecast at 10%, and every
 * weighted figure on the board was wrong for any deal anybody had advanced.
 *
 * Here the column is NULL unless somebody overrides it, and the effective
 * probability is COALESCE(probability, the stage's default) — computed in one
 * place, `effectiveProbability`, so the board, the detail page and the
 * forecast cannot disagree about it.
 */

export const OPPORTUNITY_STAGES = [
  "qualification",
  "needs_analysis",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

/** The open stages, in board order. */
export const OPEN_STAGES: OpportunityStage[] = [
  "qualification",
  "needs_analysis",
  "proposal",
  "negotiation",
];

/** Default win probability per stage, as the Mongo model defined them. */
export const STAGE_PROBABILITY: Record<OpportunityStage, number> = {
  qualification: 10,
  needs_analysis: 25,
  proposal: 50,
  negotiation: 75,
  closed_won: 100,
  closed_lost: 0,
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** NULL follows the stage; a number overrides it. One definition. */
export function effectiveProbability(
  probability: number | string | null | undefined,
  stage: string,
) {
  if (probability === null || probability === undefined || probability === "") {
    return STAGE_PROBABILITY[stage as OpportunityStage] ?? 0;
  }
  return num(probability);
}

export function weightedAmount(
  amount: number | string | null | undefined,
  probability: number | string | null | undefined,
  stage: string,
) {
  return round2(num(amount) * (effectiveProbability(probability, stage) / 100));
}

// ── Leads ───────────────────────────────────────────────────────────────────

type LeadRow = typeof leads.$inferSelect;

/** The shape the lead screens already render. */
function toScreenLead(r: LeadRow) {
  return {
    _id: String(r.id),
    id: String(r.id),
    leadNumber: r.leadNumber,
    name: r.name,
    company: r.companyName ?? "",
    title: r.jobTitle ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    source: r.source,
    rating: r.rating ?? "",
    status: r.status,
    estimatedValue: num(r.estimatedValue),
    owner: { id: r.ownerUserId ?? "", name: r.ownerName ?? "" },
    notes: r.notes ?? "",
    lostReason: r.lostReason ?? "",
    /** Null until it graduates — the screens test for the object. */
    convertedTo: r.convertedAt
      ? {
          partyId: r.convertedPartyId ? String(r.convertedPartyId) : null,
          opportunityId: r.convertedOpportunityId
            ? String(r.convertedOpportunityId)
            : null,
        }
      : null,
    createdAt: r.createdAt?.toISOString?.() ?? null,
  };
}

export async function listLeads(tx: Tx, status?: string | null) {
  const where = status
    ? and(eq(leads.status, status as never))
    : undefined;

  const rows = await tx
    .select()
    .from(leads)
    .where(where)
    .orderBy(desc(leads.createdAt))
    .limit(100);
  return rows.map(toScreenLead);
}

export async function getLead(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(leads).where(eq(leads.id, id)).limit(1);
  return row ? toScreenLead(row) : null;
}

/**
 * The stats strip: one pass, not five counts.
 *
 * OPEN excludes converted and unqualified — a lead that graduated is not still
 * in the funnel, and one that was walked away from never will be.
 */
export async function getLeadStats(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT l.status::text                            AS status,
           COUNT(*)::int                             AS count,
           COALESCE(SUM(l.estimated_value), 0)::float8 AS value
      FROM leads l
     GROUP BY l.status
  `)) as unknown as Array<Record<string, unknown>>;

  const stats = {
    total: 0,
    open: 0,
    value: 0,
    byStatus: {} as Record<string, { count: number; value: number }>,
  };
  for (const r of rows) {
    const status = String(r.status);
    const count = Number(r.count ?? 0);
    const value = num(r.value);
    stats.byStatus[status] = { count, value };
    stats.total += count;
    if (status !== "converted" && status !== "unqualified") {
      stats.open += count;
      stats.value += value;
    }
  }
  return stats;
}

export interface LeadInput {
  companyId: string;
  name: string;
  companyName?: string | null;
  jobTitle?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  rating?: string | null;
  estimatedValue?: number | string | null;
  ownerUserId?: string | null;
  ownerName?: string | null;
  ownerRole?: string | null;
  notes?: string | null;
  createdById?: string | null;
  createdByName: string;
}

const text_ = (v?: string | null) => (v?.trim() ? v.trim() : null);

export async function createLead(tx: Tx, input: LeadInput) {
  const [{ lead_number: leadNumber }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'LEAD') AS lead_number`,
  )) as unknown as Array<{ lead_number: string }>;

  const [row] = await tx
    .insert(leads)
    .values({
      companyId: input.companyId,
      leadNumber,
      name: input.name.trim(),
      companyName: text_(input.companyName),
      jobTitle: text_(input.jobTitle),
      email: text_(input.email)?.toLowerCase() ?? null,
      phone: text_(input.phone),
      source: (input.source ?? "other") as never,
      rating: (text_(input.rating) ?? null) as never,
      estimatedValue: Number(input.estimatedValue ?? 0).toFixed(4),
      ownerUserId: input.ownerUserId ?? null,
      ownerName: text_(input.ownerName),
      ownerRole: text_(input.ownerRole),
      notes: input.notes?.trim() ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function updateLead(
  tx: Tx,
  leadId: string,
  input: Partial<Omit<LeadInput, "companyId" | "createdByName">> & {
    lastModifiedById?: string | null;
    lastModifiedByName?: string | null;
  },
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.companyName !== undefined) patch.companyName = text_(input.companyName);
  if (input.jobTitle !== undefined) patch.jobTitle = text_(input.jobTitle);
  if (input.email !== undefined)
    patch.email = text_(input.email)?.toLowerCase() ?? null;
  if (input.phone !== undefined) patch.phone = text_(input.phone);
  if (input.source !== undefined) patch.source = input.source;
  if (input.rating !== undefined) patch.rating = text_(input.rating);
  if (input.estimatedValue !== undefined)
    patch.estimatedValue = Number(input.estimatedValue).toFixed(4);
  if (input.ownerUserId !== undefined) patch.ownerUserId = input.ownerUserId;
  if (input.ownerName !== undefined) patch.ownerName = text_(input.ownerName);
  if (input.notes !== undefined) patch.notes = input.notes?.trim() ?? "";
  if (input.lastModifiedById !== undefined)
    patch.lastModifiedById = input.lastModifiedById;
  if (input.lastModifiedByName !== undefined)
    patch.lastModifiedByName = input.lastModifiedByName;

  const [row] = await tx
    .update(leads)
    .set(patch)
    .where(eq(leads.id, leadId))
    .returning();
  return row ?? null;
}

/**
 * Move a lead through the funnel.
 *
 * `converted` is NOT settable here — `leads_conversion_pair` requires a
 * `converted_at` and `leads_conversion_made_a_party` requires the party that
 * only `convertLead` creates. Conversion is a transaction, not a status flip,
 * and the database says so.
 */
export async function setLeadStatus(
  tx: Tx,
  leadId: string,
  status: "new" | "contacted" | "qualified" | "unqualified",
  actor: { id?: string | null; name?: string | null },
  lostReason?: string | null,
) {
  const [row] = await tx
    .update(leads)
    .set({
      status,
      lostReason: status === "unqualified" ? text_(lostReason) : null,
      lastModifiedById: actor.id ?? null,
      lastModifiedByName: actor.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId))
    .returning();
  return row ?? null;
}

export async function deleteLead(tx: Tx, leadId: string) {
  const [row] = await tx.delete(leads).where(eq(leads.id, leadId)).returning();
  return row ?? null;
}

// ── Opportunities ───────────────────────────────────────────────────────────

type OpportunityRow = typeof opportunities.$inferSelect;

function toScreenOpportunity(r: OpportunityRow) {
  return {
    _id: String(r.id),
    id: String(r.id),
    opportunityNumber: r.opportunityNumber,
    name: r.name,
    account: { partyId: String(r.accountPartyId), name: r.accountName },
    owner: { id: r.ownerUserId ?? "", name: r.ownerName ?? "" },
    stage: r.stage,
    amount: num(r.amount),
    currency: r.currency,
    probability: effectiveProbability(r.probability, r.stage),
    weightedAmount: weightedAmount(r.amount, r.probability, r.stage),
    expectedCloseDate: r.expectedCloseDate ?? null,
    createdAt: r.createdAt?.toISOString?.() ?? null,
  };
}

/**
 * The pipeline board: open deals grouped by stage, with per-stage count, value
 * and weighted forecast.
 *
 * Capped at 250 like the Mongo one — a rep's board never approaches that, and
 * it keeps the page bounded. EVERY OPEN STAGE GETS A COLUMN even when empty,
 * or the board silently loses a stage the moment it has no deals in it.
 */
export async function getPipeline(tx: Tx) {
  const rows = await tx
    .select()
    .from(opportunities)
    .where(sql`${opportunities.stage} IN ('qualification','needs_analysis','proposal','negotiation')`)
    .orderBy(asc(opportunities.expectedCloseDate), desc(opportunities.createdAt))
    .limit(250);

  const columns = OPEN_STAGES.map((stage) => ({
    stage,
    deals: [] as ReturnType<typeof toScreenOpportunity>[],
    count: 0,
    total: 0,
    weighted: 0,
  }));
  const byStage = Object.fromEntries(columns.map((c) => [c.stage, c]));

  for (const r of rows) {
    const col = byStage[r.stage];
    if (!col) continue;
    const s = toScreenOpportunity(r);
    col.deals.push(s);
    col.count += 1;
    col.total += s.amount;
    col.weighted += s.weightedAmount;
  }

  const totals = columns.reduce(
    (acc, c) => {
      acc.count += c.count;
      acc.total += c.total;
      acc.weighted += round2(c.weighted);
      return acc;
    },
    { count: 0, total: 0, weighted: 0 },
  );

  return { columns, totals };
}

/**
 * Open pipeline value, for the executive overview.
 *
 * The one CRM read on that page, and the handoffs have called it "NOT WORK —
 * correct until opportunities port". This is the port.
 */
export async function getPipelineTotal(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT COALESCE(SUM(o.amount), 0)::float8 AS total, COUNT(*)::int AS count
      FROM opportunities o
     WHERE o.stage IN ('qualification','needs_analysis','proposal','negotiation')
  `)) as unknown as Array<Record<string, unknown>>;
  return { total: num(row?.total), count: Number(row?.count ?? 0) };
}

/** One deal, with the velocity trail the detail page renders. */
export async function getOpportunity(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [r] = await tx
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, id))
    .limit(1);
  if (!r) return null;

  const history = await tx
    .select()
    .from(opportunityStageHistory)
    .where(eq(opportunityStageHistory.opportunityId, id))
    .orderBy(asc(opportunityStageHistory.at));

  return {
    ...toScreenOpportunity(r),
    source: r.source ?? "",
    primaryContact: {
      name: r.contactName ?? "",
      email: r.contactEmail ?? "",
      phone: r.contactPhone ?? "",
    },
    leadRef: r.leadNumber
      ? { leadId: r.leadId ? String(r.leadId) : null, leadNumber: r.leadNumber }
      : null,
    lostReason: r.lostReason ?? "",
    lostNote: r.lostNote ?? "",
    wonDetails: r.wonAt
      ? {
          quoteId: r.wonQuoteId ? String(r.wonQuoteId) : null,
          wonAt: r.wonAt.toISOString(),
        }
      : null,
    stageHistory: history.map((h) => ({
      stage: h.stage,
      at: h.at?.toISOString?.() ?? null,
      by: { name: h.byName ?? "" },
    })),
  };
}

export interface OpportunityInput {
  companyId: string;
  name: string;
  accountPartyId: string;
  accountName: string;
  amount?: number | string | null;
  currency?: string | null;
  stage?: OpportunityStage | null;
  probability?: number | string | null;
  expectedCloseDate?: string | null;
  source?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  ownerUserId?: string | null;
  ownerName?: string | null;
  ownerRole?: string | null;
  leadId?: string | null;
  leadNumber?: string | null;
  createdById?: string | null;
  createdByName: string;
}

export async function createOpportunity(tx: Tx, input: OpportunityInput) {
  const [{ opportunity_number: opportunityNumber }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'OPP') AS opportunity_number`,
  )) as unknown as Array<{ opportunity_number: string }>;

  const [row] = await tx
    .insert(opportunities)
    .values({
      companyId: input.companyId,
      opportunityNumber,
      name: input.name.trim(),
      accountPartyId: input.accountPartyId,
      accountName: input.accountName.trim(),
      contactName: text_(input.contactName),
      contactEmail: text_(input.contactEmail),
      contactPhone: text_(input.contactPhone),
      ownerUserId: input.ownerUserId ?? null,
      ownerName: text_(input.ownerName),
      ownerRole: text_(input.ownerRole),
      stage: (input.stage ?? "qualification") as never,
      amount: Number(input.amount ?? 0).toFixed(4),
      currency: (text_(input.currency) ?? "KES").toUpperCase(),
      /** NULL means "follow the stage" — see the note at the top. */
      probability:
        input.probability === null || input.probability === undefined || input.probability === ""
          ? null
          : Math.trunc(Number(input.probability)),
      expectedCloseDate: input.expectedCloseDate || null,
      source: text_(input.source),
      leadId: input.leadId && isUuid(input.leadId) ? input.leadId : null,
      leadNumber: text_(input.leadNumber),
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
    })
    .returning();
  return row;
}

/**
 * Advance or close a deal.
 *
 * The stage history is NOT written here — `opportunities_record_stage` does it,
 * so no path can leave the trail short. The Mongo pre-save hook could, and did,
 * for any update that skipped `save()`.
 *
 * `lost_reason` only on a lost deal and `won_at` only on a won one are CHECKs,
 * so the clearing below is the code agreeing with the database rather than
 * hoping the caller does.
 */
export async function setOpportunityStage(
  tx: Tx,
  opportunityId: string,
  stage: OpportunityStage,
  actor: { id?: string | null; name?: string | null },
  close?: { lostReason?: string | null; lostNote?: string | null; quoteId?: string | null },
) {
  const [row] = await tx
    .update(opportunities)
    .set({
      stage,
      lostReason: stage === "closed_lost" ? ((close?.lostReason ?? null) as never) : null,
      lostNote: stage === "closed_lost" ? text_(close?.lostNote) : null,
      wonAt: stage === "closed_won" ? new Date() : null,
      wonQuoteId:
        stage === "closed_won" && close?.quoteId && isUuid(close.quoteId)
          ? close.quoteId
          : null,
      lastModifiedById: actor.id ?? null,
      lastModifiedByName: actor.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(opportunities.id, opportunityId))
    .returning();
  return row ?? null;
}

export async function updateOpportunity(
  tx: Tx,
  opportunityId: string,
  input: {
    name?: string;
    amount?: number | string;
    currency?: string;
    probability?: number | string | null;
    expectedCloseDate?: string | null;
    source?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    ownerUserId?: string | null;
    ownerName?: string | null;
    lastModifiedById?: string | null;
    lastModifiedByName?: string | null;
  },
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.amount !== undefined) patch.amount = Number(input.amount).toFixed(4);
  if (input.currency !== undefined)
    patch.currency = (text_(input.currency) ?? "KES").toUpperCase();
  if (input.probability !== undefined) {
    patch.probability =
      input.probability === null || input.probability === ""
        ? null
        : Math.trunc(Number(input.probability));
  }
  if (input.expectedCloseDate !== undefined)
    patch.expectedCloseDate = input.expectedCloseDate || null;
  if (input.source !== undefined) patch.source = text_(input.source);
  if (input.contactName !== undefined) patch.contactName = text_(input.contactName);
  if (input.contactEmail !== undefined) patch.contactEmail = text_(input.contactEmail);
  if (input.contactPhone !== undefined) patch.contactPhone = text_(input.contactPhone);
  if (input.ownerUserId !== undefined) patch.ownerUserId = input.ownerUserId;
  if (input.ownerName !== undefined) patch.ownerName = text_(input.ownerName);
  if (input.lastModifiedById !== undefined)
    patch.lastModifiedById = input.lastModifiedById;
  if (input.lastModifiedByName !== undefined)
    patch.lastModifiedByName = input.lastModifiedByName;

  const [row] = await tx
    .update(opportunities)
    .set(patch)
    .where(eq(opportunities.id, opportunityId))
    .returning();
  return row ?? null;
}

// ── Activities ──────────────────────────────────────────────────────────────

export async function listActivities(
  tx: Tx,
  targetType: string,
  targetId: string,
  limit = 50,
) {
  if (!isUuid(targetId)) return [];
  const rows = await tx
    .select()
    .from(crmActivities)
    .where(
      and(
        eq(crmActivities.targetType, targetType as never),
        eq(crmActivities.targetId, targetId),
      ),
    )
    .orderBy(desc(crmActivities.occurredAt))
    .limit(Math.min(limit, 200));

  return rows.map((r) => ({
    _id: String(r.id),
    type: r.type,
    subject: r.subject ?? "",
    body: r.body ?? "",
    direction: r.direction,
    occurredAt: r.occurredAt?.toISOString?.() ?? null,
    by: { id: r.byId ?? "", name: r.byName ?? "" },
  }));
}

export async function logActivity(
  tx: Tx,
  input: {
    companyId: string;
    type: string;
    targetType: string;
    targetId: string;
    subject?: string | null;
    body?: string | null;
    direction?: string | null;
    occurredAt?: string | null;
    byId?: string | null;
    byName?: string | null;
    byRole?: string | null;
  },
) {
  const [row] = await tx
    .insert(crmActivities)
    .values({
      companyId: input.companyId,
      type: input.type as never,
      targetType: input.targetType as never,
      targetId: input.targetId,
      subject: text_(input.subject),
      body: text_(input.body),
      direction: (input.direction ?? "none") as never,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      byId: input.byId ?? null,
      byName: text_(input.byName),
      byRole: text_(input.byRole),
    })
    .returning();
  return row;
}

/**
 * Stamp a lead as converted — the third write of the conversion.
 *
 * NOT `setLeadStatus`, which refuses `converted` on purpose:
 * `leads_conversion_pair` needs the date and `leads_conversion_made_a_party`
 * needs the party, so all three fields have to land in one statement or the
 * CHECKs reject the row. That is the constraint doing its job — a lead marked
 * converted with nothing to show for it is the state this prevents.
 */
export async function stampLeadConverted(
  tx: Tx,
  leadId: string,
  partyId: string,
  opportunityId: string,
  actor: { id?: string | null; name?: string | null },
) {
  const [row] = await tx
    .update(leads)
    .set({
      status: "converted",
      convertedPartyId: partyId,
      convertedOpportunityId: opportunityId,
      convertedAt: new Date(),
      lastModifiedById: actor.id ?? null,
      lastModifiedByName: actor.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId))
    .returning();
  return row ?? null;
}
