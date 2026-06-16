"use server";

import { revalidatePath } from "next/cache";
import mongoose from "mongoose";

import dbConnect from "../../config/dbConnect";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";
import Project from "../../models/project";
import Party from "../../models/parties";
import ProjectAssignment from "../../models/projectAssignment";

// ============================================
// PROJECT ASSIGNMENTS — the labor roster (HR-free)
// ============================================
// Assigning a party to a project posts NO cost. Cost still flows via
// expenses/bills to the party tagged with the project; this roster gives
// visibility and the join key for the (HR-gated) payroll→project mapping.
//
// Gated by "projects", NOT "hr" — tenants without the HR module can use it.

const PROJECT_WRITE_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
  "Manager",
]);

function canWrite(user) {
  return PROJECT_WRITE_ROLES.has(user?.role);
}

function sanitizeRate(rate) {
  if (!rate || rate.amount == null || rate.amount === "") return undefined;
  const amount = Number(rate.amount);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const unit = ["hour", "day", "month", "fixed"].includes(rate.unit)
    ? rate.unit
    : "day";
  return { amount, unit };
}

// ============================================
// ASSIGN PARTY TO PROJECT
// ============================================
// Idempotent: re-assigning a party that was previously removed reactivates the
// same row (the unique index is on (projectId, party.partyId)).
export async function assignPartyToProject(projectId, input = {}) {
  try {
    await requirePlanAccess("projects");
  } catch (e) {
    return { success: false, error: e.message };
  }

  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!canWrite(user)) {
      return { success: false, error: "Not authorized to manage the project team" };
    }
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return { success: false, error: "Invalid project id" };
    }
    const { partyId, role = "", rate } = input;
    if (!partyId || !mongoose.Types.ObjectId.isValid(partyId)) {
      return { success: false, error: "A valid party is required" };
    }

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    // Project must exist within the tenant.
    const project = await Project.findOne(
      withTenantScope({ _id: projectId }, companyId, isSuperAdmin),
    ).select("_id");
    if (!project) return { success: false, error: "Project not found" };

    // Party must exist within the tenant — snapshot its name + type.
    const party = await Party.findOne(
      withTenantScope({ _id: partyId }, companyId, isSuperAdmin),
    ).select("name type");
    if (!party) return { success: false, error: "Party not found" };

    const cleanRate = sanitizeRate(rate);

    const assignment = await ProjectAssignment.findOneAndUpdate(
      { projectId, "party.partyId": party._id },
      {
        $set: {
          status: "active",
          role: String(role || "").trim().slice(0, 100),
          "party.name": party.name,
          "party.type": ["employee", "supplier", "both"].includes(party.type)
            ? party.type
            : "employee",
          ...(cleanRate ? { rate: cleanRate } : {}),
          removedAt: null,
        },
        $setOnInsert: {
          companyId: tenantCompanyId,
          projectId: new mongoose.Types.ObjectId(projectId),
          "party.partyId": party._id,
          assignedAt: new Date(),
          assignedBy: { name: user?.name || "Unknown", id: user?.id || "unknown" },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    revalidatePath(`/dashboard/projects/${projectId}`);
    return { success: true, assignmentId: assignment._id.toString() };
  } catch (error) {
    // Unique-index race: the party is already on the project.
    if (error?.code === 11000) {
      return { success: false, error: "That party is already assigned to this project" };
    }
    console.error("assignPartyToProject error:", error);
    return { success: false, error: error.message || "Failed to assign party" };
  }
}

// ============================================
// UPDATE ASSIGNMENT (role / rate / status)
// ============================================
export async function updateProjectAssignment(assignmentId, input = {}) {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!canWrite(user)) {
      return { success: false, error: "Not authorized to manage the project team" };
    }
    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return { success: false, error: "Invalid assignment id" };
    }

    const set = {};
    if (typeof input.role === "string") set.role = input.role.trim().slice(0, 100);
    if (input.rate !== undefined) {
      const cleanRate = sanitizeRate(input.rate);
      if (cleanRate) set.rate = cleanRate;
    }
    if (input.status && ["active", "inactive"].includes(input.status)) {
      set.status = input.status;
    }
    if (Object.keys(set).length === 0) {
      return { success: false, error: "Nothing to update" };
    }

    const assignment = await ProjectAssignment.findOneAndUpdate(
      withTenantScope({ _id: assignmentId }, companyId, isSuperAdmin),
      { $set: set },
      { new: true },
    );
    if (!assignment) return { success: false, error: "Assignment not found" };

    revalidatePath(`/dashboard/projects/${assignment.projectId}`);
    return { success: true };
  } catch (error) {
    console.error("updateProjectAssignment error:", error);
    return { success: false, error: error.message || "Failed to update assignment" };
  }
}

// ============================================
// REMOVE PARTY FROM PROJECT (soft — keeps history)
// ============================================
export async function removePartyFromProject(assignmentId) {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!canWrite(user)) {
      return { success: false, error: "Not authorized to manage the project team" };
    }
    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return { success: false, error: "Invalid assignment id" };
    }

    const assignment = await ProjectAssignment.findOneAndUpdate(
      withTenantScope({ _id: assignmentId }, companyId, isSuperAdmin),
      { $set: { status: "removed", removedAt: new Date() } },
      { new: true },
    );
    if (!assignment) return { success: false, error: "Assignment not found" };

    revalidatePath(`/dashboard/projects/${assignment.projectId}`);
    return { success: true };
  } catch (error) {
    console.error("removePartyFromProject error:", error);
    return { success: false, error: error.message || "Failed to remove party" };
  }
}
