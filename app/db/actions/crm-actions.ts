"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import * as crm from "../repositories/crm";
import * as partiesRepo from "../repositories/parties";
import { rolesFor } from "@/lib/capabilities";

/**
 * CRM actions on Postgres — 0096.
 *
 * RESULT SHAPES ARE THE SCREENS'. Every read returns the Mongo document shape
 * the components already render — `_id`, `owner.name`, `account.name`,
 * `convertedTo`, `weightedAmount` — so a screen moves over by changing an
 * import path and nothing else. That is the step the quotes port forgot, and
 * the reason every quote raised through the UI went into a store the list page
 * did not read.
 *
 * WHO MAY DO WHAT. The Mongo actions gate on a sales role; the same set is
 * used here. Reads are open to anyone who can see the module.
 */

const SALES_ROLES = rolesFor("crm.write");

type ActionResult =
  | { success: true; id?: string; message?: string; [k: string]: unknown }
  | { success: false; error: string };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function revalidateCrm(leadId?: string | null, opportunityId?: string | null) {
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/opportunities");
  revalidatePath("/dashboard/executive");
  if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);
  if (opportunityId) revalidatePath(`/dashboard/opportunities/${opportunityId}`);
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function getLeadsPg(status = "") {
  return withAuthorizedTenant([], (tx) => crm.listLeads(tx, status || null));
}

export async function getLeadPg(id: string) {
  if (!id) return null;
  return withAuthorizedTenant([], (tx) => crm.getLead(tx, id));
}

export async function getLeadStatsPg() {
  return withAuthorizedTenant([], (tx) => crm.getLeadStats(tx));
}

export async function getPipelinePg() {
  return withAuthorizedTenant([], (tx) => crm.getPipeline(tx));
}

/**
 * Open pipeline value for the executive overview.
 *
 * Degrades to zeroes rather than taking the whole page down, which is what the
 * Mongo one did and for a better reason now: the other figures on that page
 * come from the ledger, and a CRM outage should not blank them.
 */
export async function getPipelineTotalPg() {
  try {
    return await withAuthorizedTenant([], (tx) => crm.getPipelineTotal(tx));
  } catch {
    return { total: 0, count: 0 };
  }
}

export async function getOpportunityPg(id: string) {
  if (!id) return null;
  return withAuthorizedTenant([], (tx) => crm.getOpportunity(tx, id));
}

/**
 * The timeline for one thing.
 *
 * LOWERCASED HERE, not at the call sites. Mongo's ACTIVITY_TARGETS were model
 * names — "Lead", "Opportunity" — and the Postgres enum is lowercase. Doing
 * the mapping in the action means the screens keep passing exactly what they
 * passed before, which is the whole point of matching the old surface.
 */
export async function getActivitiesPg(targetType: string, targetId: string) {
  if (!targetType || !targetId) return [];
  const kind = String(targetType).toLowerCase();
  return withAuthorizedTenant([], (tx) =>
    crm.listActivities(tx, kind, targetId),
  );
}

// ── Leads ───────────────────────────────────────────────────────────────────

export async function createLeadPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const name = str(formData, "name");
  if (!name) return { success: false, error: "A lead needs a name" };

  try {
    const row = await withAuthorizedTenant(SALES_ROLES, (tx, { user, companyId }) =>
      crm.createLead(tx, {
        companyId,
        name,
        companyName: str(formData, "company"),
        jobTitle: str(formData, "title"),
        email: str(formData, "email"),
        phone: str(formData, "phone"),
        source: str(formData, "source") || "other",
        rating: str(formData, "rating") || null,
        estimatedValue: Number(formData.get("estimatedValue") ?? 0) || 0,
        ownerUserId: user.id ?? null,
        ownerName: user.name ?? null,
        ownerRole: user.role ?? null,
        notes: str(formData, "notes"),
        createdById: user.id ?? null,
        createdByName: user.name || "Unknown User",
      }),
    );
    revalidateCrm();
    return { success: true, id: String(row.id), message: `${row.leadNumber} created` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function updateLeadPg(
  leadId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  if (!leadId) return { success: false, error: "Invalid lead id" };
  try {
    const row = await withAuthorizedTenant(SALES_ROLES, (tx, { user }) =>
      crm.updateLead(tx, leadId, {
        name: str(formData, "name") || undefined,
        companyName: str(formData, "company"),
        jobTitle: str(formData, "title"),
        email: str(formData, "email"),
        phone: str(formData, "phone"),
        source: str(formData, "source") || undefined,
        rating: str(formData, "rating") || null,
        estimatedValue: Number(formData.get("estimatedValue") ?? 0) || 0,
        notes: str(formData, "notes"),
        lastModifiedById: user.id ?? null,
        lastModifiedByName: user.name ?? null,
      }),
    );
    if (!row) return { success: false, error: "Lead not found" };
    revalidateCrm(leadId);
    return { success: true, message: `${row.leadNumber} updated` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/**
 * Move a lead through the funnel, and log it.
 *
 * `converted` is refused here: `leads_conversion_pair` needs a date and
 * `leads_conversion_made_a_party` needs the party only `convertLeadPg`
 * creates. Conversion is a transaction, not a status flip.
 */
export async function setLeadStatusPg(
  leadId: string,
  status: string,
  note = "",
): Promise<ActionResult> {
  if (!leadId) return { success: false, error: "Invalid lead id" };
  if (status === "converted") {
    return {
      success: false,
      error: "Use Convert — a conversion creates the customer and the deal with it.",
    };
  }
  if (!["new", "contacted", "qualified", "unqualified"].includes(status)) {
    return { success: false, error: "Unknown lead status" };
  }

  try {
    const row = await withAuthorizedTenant(SALES_ROLES, async (tx, { user, companyId }) => {
      const updated = await crm.setLeadStatus(
        tx,
        leadId,
        status as never,
        { id: user.id, name: user.name },
        status === "unqualified" ? note : null,
      );
      if (!updated) return null;
      await crm.logActivity(tx, {
        companyId,
        type: "stage_change",
        targetType: "lead",
        targetId: leadId,
        subject: `Status → ${status}`,
        body: note || null,
        byId: user.id ?? null,
        byName: user.name ?? null,
        byRole: user.role ?? null,
      });
      return updated;
    });
    if (!row) return { success: false, error: "Lead not found" };
    revalidateCrm(leadId);
    return { success: true, message: `${row.leadNumber} is now ${status}` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/**
 * The graduation: a lead becomes a customer and a deal, atomically.
 *
 * ONE TRANSACTION, three writes. Mongo used a session for exactly this reason
 * — a party created without its opportunity is a customer nobody is selling
 * to, and a lead stamped converted without either is a dead end. `withTenant`
 * already runs the callback in a transaction, so the guarantee comes free.
 *
 * THE ACCOUNT NAME is the lead's company where there is one and the person's
 * name where there is not, which is the Mongo rule: a sole trader is their own
 * account.
 */
export async function convertLeadPg(
  leadId: string,
  formData?: FormData,
): Promise<ActionResult> {
  if (!leadId) return { success: false, error: "Invalid lead id" };

  const opportunityName = formData ? str(formData, "opportunityName") : "";
  const amountRaw = formData?.get("amount");
  const expectedCloseDate = formData ? str(formData, "expectedCloseDate") : "";

  try {
    const result = await withAuthorizedTenant(
      SALES_ROLES,
      async (tx, { user, companyId }) => {
        const lead = await crm.getLead(tx, leadId);
        if (!lead) throw new Error("Lead not found");
        if (lead.status === "converted") {
          throw new Error("That lead has already been converted.");
        }
        if (lead.status === "unqualified") {
          throw new Error("An unqualified lead cannot be converted.");
        }

        const accountName = (lead.company || "").trim() || lead.name;
        const actor = { id: user.id ?? null, name: user.name || "Unknown User" };

        // 1. The customer enters the financial spine.
        const party = await partiesRepo.createParty(tx, {
          companyId,
          name: accountName,
          primaryType: "customer",
          email: lead.email || null,
          phone: lead.phone || null,
          createdById: actor.id,
        });

        // 2. The deal to work.
        const opportunity = await crm.createOpportunity(tx, {
          companyId,
          name: opportunityName || `${accountName} — opportunity`,
          accountPartyId: String(party.id),
          accountName,
          contactName: lead.name,
          contactEmail: lead.email || null,
          contactPhone: lead.phone || null,
          ownerUserId: lead.owner.id || actor.id,
          ownerName: lead.owner.name || actor.name,
          stage: "qualification",
          amount:
            amountRaw !== null && amountRaw !== undefined && String(amountRaw) !== ""
              ? Number(amountRaw)
              : lead.estimatedValue,
          expectedCloseDate: expectedCloseDate || null,
          source: lead.source,
          leadId,
          leadNumber: lead.leadNumber,
          createdById: actor.id,
          createdByName: actor.name,
        });

        // 3. And the lead is stamped, which is what makes it stop being one.
        //    Its own function rather than `setLeadStatus`, which refuses
        //    `converted` on purpose — the CHECKs need all three fields at once.
        await crm.stampLeadConverted(
          tx,
          leadId,
          String(party.id),
          String(opportunity.id),
          actor,
        );

        await crm.logActivity(tx, {
          companyId,
          type: "conversion",
          targetType: "lead",
          targetId: leadId,
          subject: `Converted to ${opportunity.opportunityNumber}`,
          byId: actor.id,
          byName: actor.name,
          byRole: user.role ?? null,
        });

        return { partyId: String(party.id), opportunity };
      },
    );

    revalidateCrm(leadId, result.opportunity.id);
    revalidatePath("/dashboard/parties");
    return {
      success: true,
      id: String(result.opportunity.id),
      message: `Converted — ${result.opportunity.opportunityNumber} opened`,
    };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

// ── Opportunities ───────────────────────────────────────────────────────────

export async function createOpportunityPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const name = str(formData, "name");
  const accountPartyId = str(formData, "accountPartyId");
  if (!name) return { success: false, error: "A deal needs a name" };
  if (!accountPartyId) return { success: false, error: "Choose the customer" };

  try {
    const row = await withAuthorizedTenant(
      SALES_ROLES,
      async (tx, { user, companyId }) => {
        const party = await partiesRepo.getParty(tx, accountPartyId);
        if (!party) throw new Error("That customer does not exist.");
        return crm.createOpportunity(tx, {
          companyId,
          name,
          accountPartyId,
          accountName: party.displayName || party.name,
          amount: Number(formData.get("amount") ?? 0) || 0,
          currency: str(formData, "currency") || "KES",
          stage: (str(formData, "stage") || "qualification") as never,
          expectedCloseDate: str(formData, "expectedCloseDate") || null,
          source: str(formData, "source"),
          contactName: str(formData, "contactName"),
          contactEmail: str(formData, "contactEmail"),
          contactPhone: str(formData, "contactPhone"),
          ownerUserId: user.id ?? null,
          ownerName: user.name ?? null,
          ownerRole: user.role ?? null,
          createdById: user.id ?? null,
          createdByName: user.name || "Unknown User",
        });
      },
    );
    revalidateCrm();
    return {
      success: true,
      id: String(row.id),
      message: `${row.opportunityNumber} opened`,
    };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/** Advance a deal. The stage history is the trigger's, not ours. */
export async function advanceOpportunityStagePg(
  opportunityId: string,
  stage: string,
  note = "",
): Promise<ActionResult> {
  if (!opportunityId) return { success: false, error: "Invalid opportunity id" };
  if (!crm.OPEN_STAGES.includes(stage as never)) {
    return {
      success: false,
      error: "Use Close to win or lose a deal — advancing only moves it along the pipeline.",
    };
  }

  try {
    const row = await withAuthorizedTenant(
      SALES_ROLES,
      async (tx, { user, companyId }) => {
        const updated = await crm.setOpportunityStage(
          tx,
          opportunityId,
          stage as never,
          { id: user.id, name: user.name },
        );
        if (!updated) return null;
        await crm.logActivity(tx, {
          companyId,
          type: "stage_change",
          targetType: "opportunity",
          targetId: opportunityId,
          subject: `Stage → ${stage}`,
          body: note || null,
          byId: user.id ?? null,
          byName: user.name ?? null,
          byRole: user.role ?? null,
        });
        return updated;
      },
    );
    if (!row) return { success: false, error: "Opportunity not found" };
    revalidateCrm(null, opportunityId);
    return { success: true, message: `${row.opportunityNumber} → ${stage}` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function closeOpportunityPg(
  opportunityId: string,
  outcome: string,
  formData?: FormData,
): Promise<ActionResult> {
  if (!opportunityId) return { success: false, error: "Invalid opportunity id" };
  if (outcome !== "won" && outcome !== "lost") {
    return { success: false, error: "A deal closes won or lost" };
  }

  const stage = outcome === "won" ? "closed_won" : "closed_lost";
  const lostReason = formData ? str(formData, "lostReason") : "";
  const lostNote = formData ? str(formData, "lostNote") : "";

  if (outcome === "lost" && !lostReason) {
    // Win/loss analysis is the whole reason the field exists.
    return { success: false, error: "Say why it was lost — it is what win/loss analysis reads." };
  }

  try {
    const row = await withAuthorizedTenant(
      SALES_ROLES,
      async (tx, { user, companyId }) => {
        const updated = await crm.setOpportunityStage(
          tx,
          opportunityId,
          stage as never,
          { id: user.id, name: user.name },
          { lostReason: lostReason || null, lostNote: lostNote || null },
        );
        if (!updated) return null;
        await crm.logActivity(tx, {
          companyId,
          type: "stage_change",
          targetType: "opportunity",
          targetId: opportunityId,
          subject: `Closed ${outcome}`,
          body: lostNote || null,
          byId: user.id ?? null,
          byName: user.name ?? null,
          byRole: user.role ?? null,
        });
        return updated;
      },
    );
    if (!row) return { success: false, error: "Opportunity not found" };
    revalidateCrm(null, opportunityId);
    return { success: true, message: `${row.opportunityNumber} closed ${outcome}` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

// ── Activities ──────────────────────────────────────────────────────────────

export async function logActivityPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const targetType = str(formData, "targetType").toLowerCase();
  const targetId = str(formData, "targetId");
  const type = str(formData, "type") || "note";
  const body = str(formData, "body");

  if (!targetType || !targetId) {
    return { success: false, error: "An activity needs something to attach to" };
  }
  if (!body && !str(formData, "subject")) {
    return { success: false, error: "Say what happened" };
  }

  try {
    await withAuthorizedTenant(SALES_ROLES, (tx, { user, companyId }) =>
      crm.logActivity(tx, {
        companyId,
        type,
        targetType,
        targetId,
        subject: str(formData, "subject"),
        body,
        direction: str(formData, "direction") || "none",
        occurredAt: str(formData, "occurredAt") || null,
        byId: user.id ?? null,
        byName: user.name ?? null,
        byRole: user.role ?? null,
      }),
    );
    revalidateCrm(
      targetType === "lead" ? targetId : null,
      targetType === "opportunity" ? targetId : null,
    );
    return { success: true, message: "Logged" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}
