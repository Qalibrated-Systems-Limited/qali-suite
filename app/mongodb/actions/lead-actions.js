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
import Lead, { LEAD_SOURCES, LEAD_RATINGS } from "@/app/models/lead";
import Party from "@/app/models/parties";
import Opportunity from "@/app/models/opportunity";
import {
  generateLeadNumber,
  generateOpportunityNumber,
} from "@/lib/crm/numbering";
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

// ============================================
// CREATE
// ============================================
const CreateLeadSchema = z.object({
  name: z.string().min(1, "Lead name is required").max(200),
  company: z.string().max(200).optional().default(""),
  title: z.string().max(120).optional().default(""),
  email: z.string().email().optional().or(z.literal("")).default(""),
  phone: z.string().max(40).optional().default(""),
  source: z.enum(LEAD_SOURCES).optional().default("other"),
  rating: z.enum(LEAD_RATINGS).optional(),
  estimatedValue: z.coerce.number().min(0).optional().default(0),
  notes: z.string().max(5000).optional().default(""),
});

export async function createLead(prevState, formData) {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const denied = salesRoleGate(user);
    if (denied) return denied;

    const parsed = CreateLeadSchema.safeParse(
      Object.fromEntries(formData?.entries?.() ?? []),
    );
    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors,
        formData: Object.fromEntries(formData?.entries?.() ?? []),
      };
    }
    const d = parsed.data;

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    const leadNumber = await generateLeadNumber(tenantCompanyId);
    const me = userInfo(user);

    const lead = await Lead.create({
      companyId: tenantCompanyId,
      leadNumber,
      name: d.name,
      company: d.company,
      title: d.title,
      email: d.email,
      phone: d.phone,
      source: d.source,
      rating: d.rating,
      estimatedValue: d.estimatedValue,
      notes: d.notes,
      // Default owner to the creator — the rep who logged it follows it up.
      owner: me,
      createdBy: me,
      lastModifiedBy: me,
    });

    await recordActivity({
      companyId: tenantCompanyId,
      type: "system",
      relatedTo: { kind: "Lead", id: lead._id },
      subject: `Lead ${leadNumber} created`,
      by: me,
    });

    revalidatePath("/dashboard/leads");
    return {
      success: true,
      data: { id: lead._id.toString(), leadNumber },
    };
  } catch (error) {
    console.error("createLead error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to create lead") };
  }
}

// ============================================
// UPDATE
// ============================================
const UpdateLeadSchema = CreateLeadSchema.partial();

export async function updateLead(leadId, prevState, formData) {
  try {
    if (!mongoose.Types.ObjectId.isValid(leadId)) {
      return { success: false, error: "Invalid lead id" };
    }
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const denied = salesRoleGate(user);
    if (denied) return denied;

    const parsed = UpdateLeadSchema.safeParse(
      Object.fromEntries(formData?.entries?.() ?? []),
    );
    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    const lead = await Lead.findOne(
      withTenantScope({ _id: leadId }, companyId, isSuperAdmin),
    );
    if (!lead) return { success: false, error: "Lead not found" };
    if (lead.status === "converted") {
      return { success: false, error: "Converted leads cannot be edited." };
    }

    Object.assign(lead, parsed.data);
    lead.lastModifiedBy = userInfo(user);
    await lead.save();

    revalidatePath("/dashboard/leads");
    revalidatePath(`/dashboard/leads/${leadId}`);
    return { success: true };
  } catch (error) {
    console.error("updateLead error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to update lead") };
  }
}

// ============================================
// STATUS TRANSITION (contacted / qualified / unqualified)
// ============================================
// Conversion has its own action (convertLead) — it spawns records, so it
// is not just a status flip.
export async function setLeadStatus(leadId, status, note = "") {
  try {
    if (!mongoose.Types.ObjectId.isValid(leadId)) {
      return { success: false, error: "Invalid lead id" };
    }
    const allowed = ["new", "contacted", "qualified", "unqualified"];
    if (!allowed.includes(status)) {
      return { success: false, error: `Cannot set status "${status}" here.` };
    }
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const denied = salesRoleGate(user);
    if (denied) return denied;

    const lead = await Lead.findOne(
      withTenantScope({ _id: leadId }, companyId, isSuperAdmin),
    );
    if (!lead) return { success: false, error: "Lead not found" };
    if (lead.status === "converted") {
      return { success: false, error: "Lead is already converted." };
    }

    const me = userInfo(user);
    lead.status = status;
    if (status === "unqualified") lead.lostReason = note || "";
    lead.lastModifiedBy = me;
    await lead.save();

    await recordActivity({
      companyId: lead.companyId,
      type: "system",
      relatedTo: { kind: "Lead", id: lead._id },
      subject: `Status → ${status}`,
      body: note || "",
      by: me,
    });

    revalidatePath("/dashboard/leads");
    revalidatePath(`/dashboard/leads/${leadId}`);
    return { success: true };
  } catch (error) {
    console.error("setLeadStatus error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to update status") };
  }
}

// ============================================
// CONVERT — the graduation: Lead → Party (customer) + Opportunity
// ============================================
// Atomic: a crash must not leave a half-converted lead (a Party with no
// Opportunity, or a lead stamped converted with nothing to show). All
// writes — counters included — run in one transaction.
const ConvertLeadSchema = z.object({
  opportunityName: z.string().max(200).optional().default(""),
  amount: z.coerce.number().min(0).optional(),
  expectedCloseDate: z.coerce.date().optional(),
});

export async function convertLead(leadId, formData) {
  let session = null;
  try {
    if (!mongoose.Types.ObjectId.isValid(leadId)) {
      return { success: false, error: "Invalid lead id" };
    }
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const denied = salesRoleGate(user);
    if (denied) return denied;

    const parsed = ConvertLeadSchema.safeParse(
      Object.fromEntries(formData?.entries?.() ?? []),
    );
    const opts = parsed.success ? parsed.data : {};

    const lead = await Lead.findOne(
      withTenantScope({ _id: leadId }, companyId, isSuperAdmin),
    );
    if (!lead) return { success: false, error: "Lead not found" };
    if (lead.status === "converted") {
      return { success: false, error: "Lead is already converted." };
    }
    if (lead.status === "unqualified") {
      return { success: false, error: "Cannot convert an unqualified lead." };
    }

    const tenantCompanyId = lead.companyId;
    const me = userInfo(user);
    const accountName = (lead.company || "").trim() || lead.name;

    session = await mongoose.startSession();
    session.startTransaction();

    // 1. The customer enters the financial spine as a Party.
    const [party] = await Party.create(
      [
        {
          companyId: tenantCompanyId,
          type: "customer",
          name: accountName,
          email: lead.email || undefined,
          phone: lead.phone || undefined,
          createdBy: me,
          lastModifiedBy: me,
        },
      ],
      { session },
    );

    // 2. The deal to work.
    const opportunityNumber = await generateOpportunityNumber(
      tenantCompanyId,
      session,
    );
    const [opportunity] = await Opportunity.create(
      [
        {
          companyId: tenantCompanyId,
          opportunityNumber,
          name: opts.opportunityName || `${accountName} — opportunity`,
          account: { partyId: party._id, name: accountName },
          primaryContact: {
            name: lead.name,
            email: lead.email || undefined,
            phone: lead.phone || undefined,
          },
          owner: lead.owner?.id ? lead.owner : me,
          stage: "qualification",
          amount: opts.amount ?? lead.estimatedValue ?? 0,
          expectedCloseDate: opts.expectedCloseDate,
          source: lead.source,
          leadRef: { leadId: lead._id, leadNumber: lead.leadNumber },
          createdBy: me,
          lastModifiedBy: me,
        },
      ],
      { session },
    );

    // 3. Retire the lead.
    lead.status = "converted";
    lead.convertedTo = { partyId: party._id, opportunityId: opportunity._id };
    lead.convertedAt = new Date();
    lead.lastModifiedBy = me;
    await lead.save({ session });

    // 4. Timeline entries on both ends.
    await recordActivity(
      {
        companyId: tenantCompanyId,
        type: "conversion",
        relatedTo: { kind: "Lead", id: lead._id },
        subject: `Converted to ${opportunityNumber}`,
        by: me,
      },
      session,
    );
    await recordActivity(
      {
        companyId: tenantCompanyId,
        type: "conversion",
        relatedTo: { kind: "Opportunity", id: opportunity._id },
        subject: `Created from lead ${lead.leadNumber}`,
        by: me,
      },
      session,
    );

    await session.commitTransaction();

    revalidatePath("/dashboard/leads");
    revalidatePath(`/dashboard/leads/${leadId}`);
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/opportunities");

    return {
      success: true,
      data: {
        partyId: party._id.toString(),
        opportunityId: opportunity._id.toString(),
        opportunityNumber,
      },
    };
  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch {
        // session may already be ended
      }
    }
    console.error("convertLead error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to convert lead") };
  } finally {
    if (session) session.endSession();
  }
}
