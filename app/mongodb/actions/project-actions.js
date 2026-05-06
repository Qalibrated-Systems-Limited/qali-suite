"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import mongoose from "mongoose";
import dbConnect from "../../config/dbConnect";
import Project from "../../models/project";
import ProjectBudget from "../../models/projectBudget";
import ProjectCostCode from "../../models/projectCostCode";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";

// ============================================
// HELPERS
// ============================================
function formatUser(user) {
  if (!user) return { name: "System", id: "system" };
  return {
    name: user.name || user.username || "Unknown User",
    id: user.id || user._id?.toString() || "unknown",
  };
}

// ============================================
// VALIDATION SCHEMAS
// ============================================
const CreateProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(200, "Name too long"),
  description: z
    .string()
    .max(2000, "Description too long")
    .optional()
    .or(z.literal("")),
  clientPartyId: z.string().optional().or(z.literal("")),
  clientName: z.string().optional().or(z.literal("")),
  clientEmail: z.preprocess(
    (v) => v ?? "",
    z.string().email("Invalid email").or(z.literal("")),
  ),
  projectManagerUserId: z.string().optional().or(z.literal("")),
  projectManagerName: z.string().optional().or(z.literal("")),
  startDate: z.string().optional().or(z.literal("")),
  endDate: z.string().optional().or(z.literal("")),
  budgetAmount: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? parseFloat(v) : 0)),
  budgetCurrency: z.string().optional().default("KES"),
  priority: z
    .enum(["low", "normal", "high", "critical"])
    .optional()
    .default("normal"),
  tags: z.string().optional().or(z.literal("")),
  // Construction / engineering fields
  parentProjectId: z.string().optional().or(z.literal("")),
  billingModel: z
    .enum(["fixed", "milestone", "time_material", ""])
    .optional()
    .transform((v) => v || null),
  contractValue: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? parseFloat(v) : null)),
  progressPercent: z.preprocess(
    (v) => v ?? "",
    z
      .string()
      .optional()
      .or(z.literal(""))
      .transform((v) => {
        if (!v) return 0;
        const n = parseInt(v, 10);
        return Math.max(0, Math.min(100, isNaN(n) ? 0 : n));
      }),
  ),
});

const BudgetLineSchema = z.object({
  accountId: z.string().min(1, "Account is required"),
  accountCode: z.string().optional().or(z.literal("")),
  accountName: z.string().optional().or(z.literal("")),
  description: z
    .string()
    .max(500, "Description too long")
    .optional()
    .or(z.literal("")),
  amount: z.number().min(0, "Amount must be positive"),
});

const CreateBudgetSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  revisionNotes: z.string().max(1000).optional().or(z.literal("")),
  lines: z
    .array(BudgetLineSchema)
    .min(1, "At least one budget line is required"),
});

// ============================================
// 1. CREATE PROJECT
// ============================================
export async function createProject(prevState, formData) {
  let session;
  let redirectUrl;

  try { await requirePlanAccess("projects"); } catch (e) {
    return { success: false, error: e.message };
  }

  // Extract form values early so all error paths can return them
  const rawValues = {
    name: formData.get("name"),
    description: formData.get("description"),
    clientPartyId: formData.get("clientPartyId"),
    clientName: formData.get("clientName"),
    clientEmail: formData.get("clientEmail"),
    projectManagerUserId: formData.get("projectManagerUserId"),
    projectManagerName: formData.get("projectManagerName"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    budgetAmount: formData.get("budgetAmount"),
    budgetCurrency: formData.get("budgetCurrency"),
    priority: formData.get("priority"),
    tags: formData.get("tags"),
    parentProjectId: formData.get("parentProjectId"),
    billingModel: formData.get("billingModel"),
    contractValue: formData.get("contractValue"),
    progressPercent: formData.get("progressPercent"),
  };

  try {
    await dbConnect();

    // Auth + tenant
    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return { errors: { _form: [error.message] }, values: rawValues };
    }

    // Role check
    if (!["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant", "Manager"].includes(user.role)) {
      return {
        errors: {
          _form: ["Unauthorized: Admin, Accountant, or Manager role required"],
        },
        values: rawValues,
      };
    }

    const tenantCompanyId = getCompanyIdForCreate(
      null,
      companyId,
      isSuperAdmin,
    );

    // Validate
    const validatedFields = CreateProjectSchema.safeParse(rawValues);
    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      return {
        errors: fieldErrors,
        values: rawValues,
      };
    }

    const data = validatedFields.data;

    // Validate parent project if provided
    if (data.parentProjectId) {
      const parent = await Project.findOne(
        withTenantScope(
          { _id: new mongoose.Types.ObjectId(data.parentProjectId) },
          tenantCompanyId,
          isSuperAdmin,
        ),
      );
      if (!parent) {
        return {
          errors: { _form: ["Parent project not found"] },
          values: rawValues,
        };
      }
    }

    // Start transaction
    session = await mongoose.startSession();
    session.startTransaction();

    // Generate project number
    const projectNumber = await Project.generateProjectNumber(
      tenantCompanyId,
      session,
    );

    // Build project document
    const projectData = {
      companyId: tenantCompanyId,
      projectNumber,
      name: data.name.trim(),
      description: data.description?.trim() || "",
      status: "planning",
      priority: data.priority,
      parentProjectId: data.parentProjectId
        ? new mongoose.Types.ObjectId(data.parentProjectId)
        : null,
      billingModel: data.billingModel || null,
      contractValue: data.contractValue,
      progressPercent: data.progressPercent || 0,
      budget: {
        amount: data.budgetAmount || 0,
        currency: data.budgetCurrency || "KES",
      },
      financials: {
        totalRevenue: 0,
        totalCosts: 0,
        totalCommitted: 0,
      },
      createdBy: formatUser(user),
    };

    // Client info (optional)
    if (data.clientPartyId || data.clientName) {
      projectData.client = {
        partyId: data.clientPartyId
          ? new mongoose.Types.ObjectId(data.clientPartyId)
          : undefined,
        name: data.clientName?.trim() || "",
        email: data.clientEmail?.trim() || "",
      };
    }

    // Project Manager (optional)
    if (data.projectManagerUserId || data.projectManagerName) {
      projectData.projectManager = {
        userId: data.projectManagerUserId
          ? new mongoose.Types.ObjectId(data.projectManagerUserId)
          : undefined,
        name: data.projectManagerName?.trim() || "",
      };
    }

    // Dates
    if (data.startDate) projectData.startDate = new Date(data.startDate);
    if (data.endDate) projectData.endDate = new Date(data.endDate);

    // Tags
    if (data.tags) {
      projectData.tags = data.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }

    const project = await Project.create([projectData], { session });

    await session.commitTransaction();

    revalidatePath("/dashboard/projects");

    redirectUrl = `/dashboard/projects/${project[0]._id}?success=Project+created`;
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("Error creating project:", error);
    return {
      errors: {
        _form: [error.message || "Failed to create project. Please try again."],
      },
      values: rawValues,
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }

  // redirect() throws internally — must be called outside try/catch
  redirect(redirectUrl);
}

// ============================================
// 2. UPDATE PROJECT
// ============================================
export async function updateProject(projectId, prevState, formData) {
  let redirectUrl;

  // Extract form values early so all error paths can return them
  const rawValues = {
    name: formData.get("name"),
    description: formData.get("description"),
    clientPartyId: formData.get("clientPartyId"),
    clientName: formData.get("clientName"),
    clientEmail: formData.get("clientEmail"),
    projectManagerUserId: formData.get("projectManagerUserId"),
    projectManagerName: formData.get("projectManagerName"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    budgetAmount: formData.get("budgetAmount"),
    budgetCurrency: formData.get("budgetCurrency"),
    priority: formData.get("priority"),
    tags: formData.get("tags"),
    parentProjectId: formData.get("parentProjectId"),
    billingModel: formData.get("billingModel"),
    contractValue: formData.get("contractValue"),
    progressPercent: formData.get("progressPercent"),
  };

  try {
    await dbConnect();

    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant", "Manager"].includes(user.role)) {
      return {
        errors: { _form: ["Unauthorized"] },
        values: rawValues,
      };
    }

    const project = await Project.findOne(
      withTenantScope(
        { _id: new mongoose.Types.ObjectId(projectId) },
        companyId,
        isSuperAdmin,
      ),
    );

    if (!project) {
      return { errors: { _form: ["Project not found"] }, values: rawValues };
    }

    if (project.status === "closed") {
      return {
        errors: { _form: ["Cannot edit a closed project"] },
        values: rawValues,
      };
    }

    // Validate
    const validatedFields = CreateProjectSchema.safeParse(rawValues);
    if (!validatedFields.success) {
      const fieldErrors = validatedFields.error.flatten().fieldErrors;
      return {
        errors: fieldErrors,
        values: rawValues,
      };
    }

    const data = validatedFields.data;

    // Validate parent project if provided (cannot parent to self)
    if (data.parentProjectId) {
      if (data.parentProjectId === projectId) {
        return {
          errors: { _form: ["A project cannot be its own parent"] },
          values: rawValues,
        };
      }
      const parent = await Project.findOne(
        withTenantScope(
          { _id: new mongoose.Types.ObjectId(data.parentProjectId) },
          companyId,
          isSuperAdmin,
        ),
      );
      if (!parent) {
        return {
          errors: { _form: ["Parent project not found"] },
          values: rawValues,
        };
      }
    }

    // Update fields
    project.name = data.name.trim();
    project.description = data.description?.trim() || "";
    project.priority = data.priority;
    project.budget.amount = data.budgetAmount || 0;
    project.budget.currency = data.budgetCurrency || "KES";
    project.parentProjectId = data.parentProjectId
      ? new mongoose.Types.ObjectId(data.parentProjectId)
      : null;
    project.billingModel = data.billingModel || null;
    project.contractValue = data.contractValue;
    project.progressPercent = data.progressPercent || 0;

    // Client
    project.client = {
      partyId: data.clientPartyId
        ? new mongoose.Types.ObjectId(data.clientPartyId)
        : undefined,
      name: data.clientName?.trim() || "",
      email: data.clientEmail?.trim() || "",
    };

    // PM
    project.projectManager = {
      userId: data.projectManagerUserId
        ? new mongoose.Types.ObjectId(data.projectManagerUserId)
        : undefined,
      name: data.projectManagerName?.trim() || "",
    };

    // Dates
    project.startDate = data.startDate ? new Date(data.startDate) : undefined;
    project.endDate = data.endDate ? new Date(data.endDate) : undefined;

    // Tags
    project.tags = data.tags
      ? data.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    project.lastModifiedBy = formatUser(user);

    await project.save();

    revalidatePath("/dashboard/projects");
    revalidatePath(`/dashboard/projects/${projectId}`);

    redirectUrl = `/dashboard/projects/${projectId}?success=Project+updated`;
  } catch (error) {
    console.error("Error updating project:", error);
    return {
      errors: { _form: [error.message || "Failed to update project"] },
      values: rawValues,
    };
  }

  // redirect() throws internally — must be called outside try/catch
  redirect(redirectUrl);
}

// ============================================
// 3. UPDATE PROJECT STATUS
// ============================================
export async function updateProjectStatus(projectId, newStatus) {
  try {
    await dbConnect();

    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant", "Manager"].includes(user.role)) {
      return { success: false, error: "Unauthorized" };
    }

    // Only Admin/Accountant can close
    if (
      newStatus === "closed" &&
      !["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(user.role)
    ) {
      return {
        success: false,
        error: "Only Admin or Accountant can close a project",
      };
    }

    const project = await Project.findOne(
      withTenantScope(
        { _id: new mongoose.Types.ObjectId(projectId) },
        companyId,
        isSuperAdmin,
      ),
    );

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    await project.transitionTo(newStatus, formatUser(user));

    revalidatePath("/dashboard/projects");
    revalidatePath(`/dashboard/projects/${projectId}`);

    return {
      success: true,
      message: `Project status updated to ${newStatus}`,
    };
  } catch (error) {
    console.error("Error updating project status:", error);
    return {
      success: false,
      error: error.message || "Failed to update status",
    };
  }
}

// ============================================
// 4. DELETE PROJECT
// ============================================
export async function deleteProject(projectId) {
  try {
    await dbConnect();

    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (user.role !== "Admin") {
      return { success: false, error: "Unauthorized: Admin role required" };
    }

    const project = await Project.findOne(
      withTenantScope(
        { _id: new mongoose.Types.ObjectId(projectId) },
        companyId,
        isSuperAdmin,
      ),
    );

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    if (project.status !== "planning") {
      return {
        success: false,
        error: "Only projects in planning status can be deleted",
      };
    }

    // Check for linked transactions
    const EmployeeClaim = mongoose.model("EmployeeClaim");
    const linkedClaims = await EmployeeClaim.countDocuments({
      projectId: project._id,
    });

    if (linkedClaims > 0) {
      return {
        success: false,
        error: "Cannot delete project with linked transactions",
      };
    }

    // Delete any budgets
    await ProjectBudget.deleteMany({ projectId: project._id });

    await project.deleteOne();

    revalidatePath("/dashboard/projects");

    return { success: true, message: "Project deleted" };
  } catch (error) {
    console.error("Error deleting project:", error);
    return {
      success: false,
      error: error.message || "Failed to delete project",
    };
  }
}

// ============================================
// 5. CREATE PROJECT BUDGET
// ============================================
export async function createProjectBudget(prevState, formData) {
  let session;

  try {
    await dbConnect();

    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return { errors: { _form: [error.message] } };
    }

    if (!["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant", "Manager"].includes(user.role)) {
      return { errors: { _form: ["Unauthorized"] } };
    }

    const tenantCompanyId = getCompanyIdForCreate(
      null,
      companyId,
      isSuperAdmin,
    );

    // Parse lines from formData
    const projectId = formData.get("projectId");
    const revisionNotes = formData.get("revisionNotes") || "";
    const linesJson = formData.get("lines");

    let lines;
    try {
      lines = JSON.parse(linesJson);
    } catch {
      return { errors: { _form: ["Invalid budget lines data"] } };
    }

    const validatedFields = CreateBudgetSchema.safeParse({
      projectId,
      revisionNotes,
      lines,
    });

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
      };
    }

    const data = validatedFields.data;

    // Verify project exists and belongs to tenant
    const project = await Project.findOne(
      withTenantScope(
        { _id: new mongoose.Types.ObjectId(data.projectId) },
        tenantCompanyId,
        isSuperAdmin,
      ),
    );

    if (!project) {
      return { errors: { _form: ["Project not found"] } };
    }

    session = await mongoose.startSession();
    session.startTransaction();

    const version = await ProjectBudget.getNextVersion(
      project._id,
      tenantCompanyId,
    );

    const budget = await ProjectBudget.create(
      [
        {
          companyId: tenantCompanyId,
          projectId: project._id,
          version,
          status: "draft",
          lines: data.lines.map((line) => ({
            accountId: new mongoose.Types.ObjectId(line.accountId),
            accountCode: line.accountCode || "",
            accountName: line.accountName || "",
            description: line.description || "",
            amount: line.amount,
          })),
          revisionNotes: data.revisionNotes || "",
          createdBy: formatUser(user),
        },
      ],
      { session },
    );

    await session.commitTransaction();

    revalidatePath(`/dashboard/projects/${data.projectId}`);
    revalidatePath(`/dashboard/projects/${data.projectId}/budget`);

    return {
      success: true,
      message: `Budget v${version} created`,
      budgetId: budget[0]._id.toString(),
    };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("Error creating project budget:", error);
    return {
      errors: { _form: [error.message || "Failed to create budget"] },
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// 6. UPDATE PROJECT BUDGET (draft only)
// ============================================
export async function updateProjectBudget(prevState, formData) {
  try {
    await dbConnect();

    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return { errors: { _form: [error.message] } };
    }

    if (!["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant", "Manager"].includes(user.role)) {
      return { errors: { _form: ["Unauthorized"] } };
    }

    const budgetId = formData.get("budgetId");
    const revisionNotes = formData.get("revisionNotes") || "";
    const linesJson = formData.get("lines");

    let lines;
    try {
      lines = JSON.parse(linesJson);
    } catch {
      return { errors: { _form: ["Invalid budget lines data"] } };
    }

    const validatedFields = CreateBudgetSchema.safeParse({
      projectId: formData.get("projectId"),
      revisionNotes,
      lines,
    });

    if (!validatedFields.success) {
      return { errors: validatedFields.error.flatten().fieldErrors };
    }

    const data = validatedFields.data;

    // Find the budget and ensure it's still a draft
    const budget = await ProjectBudget.findOne(
      withTenantScope(
        { _id: new mongoose.Types.ObjectId(budgetId), status: "draft" },
        companyId,
        isSuperAdmin,
      ),
    );

    if (!budget) {
      return {
        errors: { _form: ["Budget not found or is no longer a draft"] },
      };
    }

    // Update lines and notes
    budget.lines = data.lines.map((line) => ({
      accountId: new mongoose.Types.ObjectId(line.accountId),
      accountCode: line.accountCode || "",
      accountName: line.accountName || "",
      description: line.description || "",
      amount: line.amount,
    }));
    budget.revisionNotes = data.revisionNotes || "";

    await budget.save(); // pre-save hook recalculates totalAmount

    revalidatePath(`/dashboard/projects/${data.projectId}`);
    revalidatePath(`/dashboard/projects/${data.projectId}/budget`);

    return {
      success: true,
      message: `Budget v${budget.version} updated`,
    };
  } catch (error) {
    console.error("Error updating project budget:", error);
    return {
      errors: { _form: [error.message || "Failed to update budget"] },
    };
  }
}

// ============================================
// 7. APPROVE PROJECT BUDGET
// ============================================
export async function approveProjectBudget(budgetId) {
  let session;

  try {
    await dbConnect();

    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(user.role)) {
      return {
        success: false,
        error: "Unauthorized: Admin or Accountant required",
      };
    }

    const budget = await ProjectBudget.findOne(
      withTenantScope(
        { _id: new mongoose.Types.ObjectId(budgetId) },
        companyId,
        isSuperAdmin,
      ),
    );

    if (!budget) {
      return { success: false, error: "Budget not found" };
    }

    session = await mongoose.startSession();
    session.startTransaction();

    await budget.approve(formatUser(user), session);

    await session.commitTransaction();

    revalidatePath(`/dashboard/projects/${budget.projectId}`);
    revalidatePath(`/dashboard/projects/${budget.projectId}/budget`);

    return {
      success: true,
      message: `Budget v${budget.version} approved`,
    };
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("Error approving budget:", error);
    return {
      success: false,
      error: error.message || "Failed to approve budget",
    };
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

// ============================================
// 8. UPDATE PROJECT PROGRESS
// ============================================
export async function updateProjectProgress(projectId, progressPercent) {
  try {
    await dbConnect();

    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant", "Manager"].includes(user.role)) {
      return { success: false, error: "Unauthorized" };
    }

    const pct = Math.max(0, Math.min(100, parseInt(progressPercent, 10) || 0));

    const project = await Project.findOneAndUpdate(
      withTenantScope(
        { _id: new mongoose.Types.ObjectId(projectId) },
        companyId,
        isSuperAdmin,
      ),
      {
        $set: { progressPercent: pct, lastModifiedBy: formatUser(user) },
      },
      { new: true },
    );

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    revalidatePath(`/dashboard/projects/${projectId}`);

    return { success: true, message: `Progress updated to ${pct}%` };
  } catch (error) {
    console.error("Error updating progress:", error);
    return {
      success: false,
      error: error.message || "Failed to update progress",
    };
  }
}

// ============================================
// 9. COST CODE CRUD
// ============================================
const CostCodeSchema = z.object({
  code: z.string().min(1, "Code is required").max(20),
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional().or(z.literal("")),
  projectId: z.string().optional().or(z.literal("")),
});

export async function createCostCode(prevState, formData) {
  try {
    await dbConnect();

    let companyId, isSuperAdmin, user;
    try {
      ({ companyId, isSuperAdmin, user } = await getTenantContext());
    } catch (error) {
      return { errors: { _form: [error.message] } };
    }

    if (!["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant", "Manager"].includes(user.role)) {
      return { errors: { _form: ["Unauthorized"] } };
    }

    const tenantCompanyId = getCompanyIdForCreate(
      null,
      companyId,
      isSuperAdmin,
    );

    const rawValues = {
      code: formData.get("code"),
      name: formData.get("name"),
      description: formData.get("description"),
      projectId: formData.get("projectId"),
    };

    const validatedFields = CostCodeSchema.safeParse(rawValues);
    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        values: rawValues,
      };
    }

    const data = validatedFields.data;

    const costCode = await ProjectCostCode.create({
      companyId: tenantCompanyId,
      code: data.code.trim().toUpperCase(),
      name: data.name.trim(),
      description: data.description?.trim() || "",
      projectId: data.projectId
        ? new mongoose.Types.ObjectId(data.projectId)
        : null,
      createdBy: formatUser(user),
    });

    revalidatePath("/dashboard/projects");

    return {
      success: true,
      message: `Cost code ${costCode.code} created`,
      costCode: {
        _id: costCode._id.toString(),
        code: costCode.code,
        name: costCode.name,
      },
    };
  } catch (error) {
    if (error.code === 11000) {
      return {
        errors: { _form: ["A cost code with this code already exists"] },
      };
    }
    console.error("Error creating cost code:", error);
    return {
      errors: { _form: [error.message || "Failed to create cost code"] },
    };
  }
}

export async function updateCostCode(costCodeId, prevState, formData) {
  try {
    await dbConnect();

    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant", "Manager"].includes(user.role)) {
      return { errors: { _form: ["Unauthorized"] } };
    }

    const rawValues = {
      code: formData.get("code"),
      name: formData.get("name"),
      description: formData.get("description"),
      projectId: formData.get("projectId"),
    };

    const validatedFields = CostCodeSchema.safeParse(rawValues);
    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        values: rawValues,
      };
    }

    const data = validatedFields.data;

    const costCode = await ProjectCostCode.findOneAndUpdate(
      withTenantScope(
        { _id: new mongoose.Types.ObjectId(costCodeId) },
        companyId,
        isSuperAdmin,
      ),
      {
        $set: {
          code: data.code.trim().toUpperCase(),
          name: data.name.trim(),
          description: data.description?.trim() || "",
          projectId: data.projectId
            ? new mongoose.Types.ObjectId(data.projectId)
            : null,
        },
      },
      { new: true },
    );

    if (!costCode) {
      return { errors: { _form: ["Cost code not found"] } };
    }

    revalidatePath("/dashboard/projects");

    return { success: true, message: `Cost code ${costCode.code} updated` };
  } catch (error) {
    if (error.code === 11000) {
      return {
        errors: { _form: ["A cost code with this code already exists"] },
      };
    }
    console.error("Error updating cost code:", error);
    return {
      errors: { _form: [error.message || "Failed to update cost code"] },
    };
  }
}

export async function toggleCostCodeActive(costCodeId) {
  try {
    await dbConnect();

    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(user.role)) {
      return { success: false, error: "Unauthorized" };
    }

    const costCode = await ProjectCostCode.findOne(
      withTenantScope(
        { _id: new mongoose.Types.ObjectId(costCodeId) },
        companyId,
        isSuperAdmin,
      ),
    );

    if (!costCode) {
      return { success: false, error: "Cost code not found" };
    }

    costCode.isActive = !costCode.isActive;
    await costCode.save();

    revalidatePath("/dashboard/projects");

    return {
      success: true,
      message: `Cost code ${costCode.code} ${costCode.isActive ? "activated" : "deactivated"}`,
    };
  } catch (error) {
    console.error("Error toggling cost code:", error);
    return {
      success: false,
      error: error.message || "Failed to update cost code",
    };
  }
}

// ============================================
// UPDATE PROJECT FINANCIALS (called from other modules)
// ============================================
export async function updateProjectFinancials(
  projectId,
  { revenue = 0, cost = 0, committed = 0 },
  session = null,
) {
  if (!projectId) return;

  const update = {};
  if (revenue !== 0) update["financials.totalRevenue"] = revenue;
  if (cost !== 0) update["financials.totalCosts"] = cost;
  if (committed !== 0) update["financials.totalCommitted"] = committed;

  if (Object.keys(update).length === 0) return;

  const opts = session ? { session } : {};
  await Project.findByIdAndUpdate(projectId, { $inc: update }, opts);
}
