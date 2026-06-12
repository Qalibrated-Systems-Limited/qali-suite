"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import { safeErrorMessage } from "@/lib/safe-error";

import { canSeeSalesNav } from "@/lib/permissions";
import Opportunity, {
  OPPORTUNITY_STAGES,
  LOST_REASONS,
} from "@/app/models/opportunity";
import Party from "@/app/models/parties";
import Quote from "@/app/models/quote";
import { generateOpportunityNumber } from "@/lib/crm/numbering";
import { recordActivity } from "@/lib/crm/activity-log";

function userInfo(user) {
  return {
    id: user?.id || user?._id?.toString?.() || "system",
    name: user?.name || user?.email || "System",
    role: user?.role,
  };
}

// Server actions are directly invokable endpoints — page-level gating is
// not enough. Same role set the sidebar/pages use (canSeeSalesNav).
function salesRoleGate(user) {
  if (!canSeeSalesNav(user?.role)) {
    return { success: false, error: "Not authorized for CRM actions." };
  }
  return null;
}

const DEFAULT_TAX_RATE = 16; // Kenya VAT

// The won → Quote hand-off: a closed_won deal generates a DRAFT quote so
// the rep refines and sends it from the existing Quote spine. The deal has
// only a headline amount (no line items), so we seed one placeholder
// service line (description = deal name, qty 1, unit price = amount). The
// rep edits it before sending. Totals are computed up front because the
// Quote's required validators run before its pre-save recompute hook.
async function createDraftQuoteFromOpportunity(opp, user) {
  // Snapshot the customer from the Party (immutable on the quote).
  const party = await Party.findOne({
    _id: opp.account?.partyId,
    companyId: opp.companyId,
  })
    .select("name email phone taxPin")
    .lean();
  const name = party?.name || opp.account?.name;
  if (!name) {
    return { success: false, error: "Opportunity has no customer to quote." };
  }

  const price = Number(opp.amount) || 0;
  const amount = price; // qty 1
  const taxAmount = Math.round(amount * (DEFAULT_TAX_RATE / 100) * 100) / 100;
  const lineTotal = amount + taxAmount;

  const quote = new Quote({
    companyId: opp.companyId,
    quoteNumber: await Quote.generateQuoteNumber(opp.companyId),
    quoteDate: new Date(),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    title: opp.name,
    reference: opp.opportunityNumber,
    salesPerson:
      opp.owner?.id && /^[0-9a-fA-F]{24}$/.test(opp.owner.id)
        ? { employeeId: opp.owner.id, name: opp.owner.name }
        : opp.owner?.name
          ? { name: opp.owner.name }
          : undefined,
    customer: {
      partyId: party?._id || opp.account?.partyId,
      id: (party?._id || opp.account?.partyId)?.toString?.(),
      name,
      email: party?.email,
      phone: party?.phone,
      taxPin: party?.taxPin,
    },
    items: [
      {
        lineNumber: 1,
        itemType: "service",
        serviceCategory: "other",
        description: String(opp.name).slice(0, 500),
        quantity: 1,
        unit: "pcs",
        unitPrice: price,
        amount,
        taxRate: DEFAULT_TAX_RATE,
        taxAmount,
        discountPercentage: 0,
        discountAmount: 0,
        lineTotal,
        invoicedQuantity: 0,
        invoices: [],
      },
    ],
    subtotal: amount,
    totalDiscount: 0,
    taxAmount,
    total: lineTotal,
    internalNotes: `Generated from opportunity ${opp.opportunityNumber}`,
    status: "draft",
    createdBy: { name: user.name, id: user.id },
  });

  await quote.save();
  return {
    success: true,
    quoteId: quote._id.toString(),
    quoteNumber: quote.quoteNumber,
  };
}

// Open stages a deal can be moved between with advanceOpportunityStage.
// The two closed_* terminals go through closeOpportunity (they carry
// outcome-specific data).
const OPEN_STAGES = OPPORTUNITY_STAGES.filter((s) => !s.startsWith("closed_"));

// ============================================
// CREATE (standalone — for an existing customer)
// ============================================
const CreateOpportunitySchema = z.object({
  name: z.string().min(1, "Opportunity name is required").max(200),
  partyId: z.string().min(1, "Customer is required"),
  amount: z.coerce.number().min(0).optional().default(0),
  expectedCloseDate: z.coerce.date().optional(),
  source: z.string().max(120).optional().default(""),
  stage: z.enum(OPPORTUNITY_STAGES).optional().default("qualification"),
});

export async function createOpportunity(prevState, formData) {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const denied = salesRoleGate(user);
    if (denied) return denied;

    const parsed = CreateOpportunitySchema.safeParse(
      Object.fromEntries(formData?.entries?.() ?? []),
    );
    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }
    const d = parsed.data;
    if (!mongoose.Types.ObjectId.isValid(d.partyId)) {
      return { success: false, error: "Invalid customer id" };
    }
    if (d.stage.startsWith("closed_")) {
      return { success: false, error: "Create the deal open, then close it." };
    }

    // The account must be a real customer in this tenant.
    const party = await Party.findOne(
      withTenantScope({ _id: d.partyId }, companyId, isSuperAdmin),
    )
      .select("name type")
      .lean();
    if (!party) return { success: false, error: "Customer not found" };

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    const opportunityNumber = await generateOpportunityNumber(tenantCompanyId);
    const me = userInfo(user);

    const [opportunity] = await Opportunity.create([
      {
        companyId: tenantCompanyId,
        opportunityNumber,
        name: d.name,
        account: { partyId: party._id, name: party.name },
        owner: me,
        stage: d.stage,
        amount: d.amount,
        expectedCloseDate: d.expectedCloseDate,
        source: d.source,
        createdBy: me,
        lastModifiedBy: me,
      },
    ]);

    revalidatePath("/dashboard/opportunities");
    return {
      success: true,
      data: { id: opportunity._id.toString(), opportunityNumber },
    };
  } catch (error) {
    console.error("createOpportunity error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to create opportunity") };
  }
}

// ============================================
// ADVANCE STAGE (between open stages)
// ============================================
export async function advanceOpportunityStage(opportunityId, stage, note = "") {
  try {
    if (!mongoose.Types.ObjectId.isValid(opportunityId)) {
      return { success: false, error: "Invalid opportunity id" };
    }
    if (!OPEN_STAGES.includes(stage)) {
      return {
        success: false,
        error: `"${stage}" is not an open stage — use close for won/lost.`,
      };
    }
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const denied = salesRoleGate(user);
    if (denied) return denied;

    const opp = await Opportunity.findOne(
      withTenantScope({ _id: opportunityId }, companyId, isSuperAdmin),
    );
    if (!opp) return { success: false, error: "Opportunity not found" };
    if (!opp.isOpen) {
      return { success: false, error: `Deal already ${opp.stage}; reopen is not supported.` };
    }

    const me = userInfo(user);
    const from = opp.stage;
    opp.stage = stage;
    // Let the stage drive probability unless it was hand-set — clearing it
    // makes the pre-save reseed from STAGE_PROBABILITY.
    opp.probability = undefined;
    opp.lastModifiedBy = me;
    await opp.save(); // pre-save appends to stageHistory

    await recordActivity({
      companyId: opp.companyId,
      type: "stage_change",
      relatedTo: { kind: "Opportunity", id: opp._id },
      subject: `Stage ${from} → ${stage}`,
      body: note || "",
      by: me,
    });

    revalidatePath("/dashboard/opportunities");
    revalidatePath(`/dashboard/opportunities/${opportunityId}`);
    return { success: true };
  } catch (error) {
    console.error("advanceOpportunityStage error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to change stage") };
  }
}

// ============================================
// CLOSE (won / lost)
// ============================================
// won  → closed_won, generates a DRAFT quote (the hand-off into the Quote
//        spine) and stamps wonDetails.{quoteId,wonAt}.
// lost → closed_lost, requires a lostReason for win/loss analysis.
const CloseSchema = z.object({
  lostReason: z.enum(LOST_REASONS).optional(),
  note: z.string().max(2000).optional().default(""),
});

export async function closeOpportunity(opportunityId, outcome, formData) {
  try {
    if (!mongoose.Types.ObjectId.isValid(opportunityId)) {
      return { success: false, error: "Invalid opportunity id" };
    }
    if (outcome !== "won" && outcome !== "lost") {
      return { success: false, error: "Outcome must be 'won' or 'lost'." };
    }
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const denied = salesRoleGate(user);
    if (denied) return denied;

    const parsed = CloseSchema.safeParse(
      Object.fromEntries(formData?.entries?.() ?? []),
    );
    const data = parsed.success ? parsed.data : {};
    if (outcome === "lost" && !data.lostReason) {
      return { success: false, error: "A lost reason is required." };
    }

    const opp = await Opportunity.findOne(
      withTenantScope({ _id: opportunityId }, companyId, isSuperAdmin),
    );
    if (!opp) return { success: false, error: "Opportunity not found" };
    if (!opp.isOpen) {
      return { success: false, error: `Deal already ${opp.stage}.` };
    }

    const me = userInfo(user);
    let quote = null;
    if (outcome === "won") {
      // Create the draft quote FIRST — if it fails, the deal stays open and
      // the rep can retry, rather than being marked won with no hand-off.
      quote = await createDraftQuoteFromOpportunity(opp, me);
      if (!quote.success) {
        return { success: false, error: `Could not create quote: ${quote.error}` };
      }
      opp.stage = "closed_won";
      opp.probability = undefined; // reseeds to 100
      opp.wonDetails = {
        ...(opp.wonDetails || {}),
        quoteId: quote.quoteId,
        wonAt: new Date(),
      };
    } else {
      opp.stage = "closed_lost";
      opp.probability = undefined; // reseeds to 0
      opp.lostReason = data.lostReason;
      opp.lostNote = data.note || "";
    }
    opp.lastModifiedBy = me;
    await opp.save();

    await recordActivity({
      companyId: opp.companyId,
      type: "stage_change",
      relatedTo: { kind: "Opportunity", id: opp._id },
      subject:
        outcome === "won"
          ? `Closed — Won → quote ${quote.quoteNumber}`
          : `Closed — Lost (${data.lostReason})`,
      body: data.note || "",
      by: me,
    });

    revalidatePath("/dashboard/opportunities");
    revalidatePath(`/dashboard/opportunities/${opportunityId}`);
    if (outcome === "won") revalidatePath("/dashboard/quotes");
    return {
      success: true,
      data: outcome === "won" ? { quoteId: quote.quoteId, quoteNumber: quote.quoteNumber } : null,
    };
  } catch (error) {
    console.error("closeOpportunity error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to close opportunity") };
  }
}
