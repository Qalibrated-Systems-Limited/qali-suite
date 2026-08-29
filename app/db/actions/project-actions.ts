"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { requirePlanAccess } from "@/lib/plan-gate";
import {
  PROJECT_MANAGE_ROLES,
  FINANCE_WRITE_ROLES,
  ADMIN_ROLES,
} from "@/lib/utils/role-gates";
import * as repo from "../repositories/projects";
import * as partiesRepo from "../repositories/parties";
import type { Tx } from "../client";

/**
 * Project actions on Postgres — 0070.
 *
 * RESULT SHAPES ARE THE SCREENS'. Every read below returns the Mongo document
 * shape the components already render — `_id`, `client.name`,
 * `budget.amount`, `financials.totalCosts` — so a screen moves over by
 * changing an import path and nothing else. That is the step the quotes port
 * forgot, and the reason every quote raised through the UI went into a store
 * the list page did not read.
 *
 * `financials` IS COMPUTED, NOT STORED. The key survives because the screens
 * read it; the three cached columns behind it do not exist. See 0070 decision
 * 1 — nothing has ever called the `$inc` helper that maintained them, so every
 * project has displayed zeros since the module shipped, and the live figures
 * beside them aggregated four Mongo collections that stopped being written to
 * when invoices, bills, requests and movements ported. Both halves were wrong.
 */

type FieldErrors = Record<string, string[]>;

function fieldErrorsFrom(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

function valuesOf(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return {
    id: user?.id ?? null,
    name: user?.name || "Unknown User",
  };
}

/** A project row in the shape the components render. */
function toScreenProject(
  row: Record<string, unknown>,
  extras: {
    actuals?: repo.ProjectActuals;
    budget?: { amount: number; currency: string };
    progress?: repo.ProjectProgress;
  } = {},
) {
  const actuals = extras.actuals ?? { revenue: 0, costs: 0, committed: 0 };
  return {
    _id: String(row.id),
    id: String(row.id),
    projectNumber: row.projectNumber,
    name: row.name,
    description: row.description,
    status: row.status,
    priority: row.priority,
    tags: row.tags ?? [],
    client: {
      partyId: row.clientPartyId ?? null,
      name: row.clientName ?? "",
      email: row.clientEmail ?? "",
    },
    projectManager: {
      userId: row.projectManagerUserId ?? null,
      name: row.projectManagerName ?? "",
    },
    parentProjectId: row.parentProjectId ?? null,
    billingModel: row.billingModel ?? null,
    contractValue:
      row.contractValue === null || row.contractValue === undefined
        ? null
        : Number(row.contractValue),
    /**
     * DERIVED where the project has a WBS, typed where it does not (0071
     * decision 1). The components read `progressPercent` and go on reading it;
     * what changed is where the number comes from. `progress.source` says
     * which, so a screen can show "earned across 12 tasks" rather than implying
     * somebody measured something they did not.
     */
    progressPercent: extras.progress
      ? extras.progress.percent
      : Number(row.progressPercent ?? 0),
    progress: extras.progress ?? {
      percent: Number(row.progressPercent ?? 0),
      source: "typed" as const,
      taskCount: 0,
      doneCount: 0,
    },
    startDate: row.startDate ?? null,
    endDate: row.endDate ?? null,
    actualEndDate: row.actualEndDate ?? null,
    budget: {
      amount: extras.budget?.amount ?? Number(row.budgetAmount ?? 0),
      currency: extras.budget?.currency ?? row.budgetCurrency ?? "KES",
    },
    /** Live, from the documents. Never a stored column — see the header. */
    financials: {
      totalRevenue: actuals.revenue,
      totalCosts: actuals.costs,
      totalCommitted: actuals.committed,
    },
    createdBy: { id: row.createdById ?? null, name: row.createdByName ?? "" },
    lastModifiedBy: {
      id: row.lastModifiedById ?? null,
      name: row.lastModifiedByName ?? "",
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function searchProjects(
  searchTerm = "",
  page = 1,
  filters: { status?: string; priority?: string } = {},
) {
  return withAuthorizedTenant([], async (tx) => {
    const { projects } = await repo.listProjects(tx, {
      search: searchTerm,
      page,
      status: filters.status,
      priority: filters.priority,
    });
    return projects.map((p) =>
      toScreenProject(p as unknown as Record<string, unknown>, {
        actuals: p.actuals,
        budget: p.effectiveBudget,
        progress: p.progress,
      }),
    );
  });
}

export async function fetchProjectPages(
  searchTerm = "",
  filters: { status?: string; priority?: string } = {},
) {
  return withAuthorizedTenant([], (tx) =>
    repo.countProjectPages(tx, {
      search: searchTerm,
      status: filters.status,
      priority: filters.priority,
    }),
  );
}

export async function getProjectStats() {
  return withAuthorizedTenant([], (tx) => repo.getProjectStats(tx));
}

export async function getProjectById(projectId: string) {
  if (!projectId) return null;
  return withAuthorizedTenant([], async (tx) => {
    const row = await repo.getProjectById(tx, projectId);
    if (!row) return null;
    const [actuals, budget, progress] = await Promise.all([
      repo.computeProjectActuals(tx, projectId),
      repo.getEffectiveBudget(tx, projectId),
      repo.getProjectProgress(tx, projectId),
    ]);
    return toScreenProject(row as unknown as Record<string, unknown>, {
      actuals,
      budget,
      progress,
    });
  });
}

/** The picker five other modules render. */
export async function getActiveProjects() {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.getActiveProjects(tx);
    return rows.map((r) => ({
      _id: r.id,
      id: r.id,
      projectNumber: r.projectNumber,
      name: r.name,
      status: r.status,
      budget: { amount: Number(r.budgetAmount ?? 0), currency: r.budgetCurrency },
    }));
  });
}

export async function getProjectFinancialSummary(projectId: string) {
  if (!projectId) return null;
  return withAuthorizedTenant([], (tx) =>
    repo.getProjectFinancialSummary(tx, projectId),
  );
}

export async function getProjectBudgetVsActual(projectId: string) {
  if (!projectId) return null;
  return withAuthorizedTenant([], (tx) =>
    repo.getProjectBudgetVsActual(tx, projectId),
  );
}

export async function getProjectTransactions(
  projectId: string,
  type: "all" | "claims" | "invoices" | "bills" | "expenses" | "requests" = "all",
  limit = 20,
) {
  if (!projectId) return {};
  return withAuthorizedTenant([], async (tx) => {
    const results = await repo.getProjectTransactions(tx, projectId, type, limit);
    // The drill-down lists key on `_id`; every row above returns `id`.
    for (const key of Object.keys(results)) {
      results[key] = (results[key] as Array<Record<string, unknown>>).map((r) => ({
        ...r,
        _id: String(r.id ?? r._id),
      }));
    }
    return results;
  });
}

/**
 * The budget line shape `BudgetForm` and `BudgetCard` already render.
 *
 * The columns are `account_code_at_budget` / `account_name_at_budget` — the
 * snapshot, so an account renamed in March does not rewrite a budget approved
 * in January. The components ask for `accountCode` / `accountName`.
 */
function toScreenBudgetLine(line: Record<string, unknown>) {
  return {
    _id: String(line.id),
    /** What the budget-holder picked, and what the form edits. */
    costCodeId: line.costCodeId,
    costCode: line.costCode ?? "",
    costCodeName: line.costCodeName ?? "",
    /** What it charges — the trigger's, shown to whoever approves. */
    accountId: line.accountId,
    accountCode: line.accountCodeAtBudget ?? "",
    accountName: line.accountNameAtBudget ?? "",
    description: line.description ?? "",
    amount: Number(line.amount ?? 0),
  };
}

function toScreenBudget(budget: Record<string, unknown>) {
  const lines = ((budget.lines ?? []) as Array<Record<string, unknown>>).map(
    toScreenBudgetLine,
  );
  return {
    _id: String(budget.id),
    id: String(budget.id),
    projectId: budget.projectId,
    version: budget.version,
    status: budget.status,
    revisionNotes: budget.revisionNotes ?? "",
    approvedBy: {
      id: budget.approvedById ?? null,
      name: budget.approvedByName ?? "",
    },
    approvedAt: budget.approvedAt ?? null,
    createdBy: { id: budget.createdById ?? null, name: budget.createdByName ?? "" },
    createdAt: budget.createdAt,
    lines,
    totalAmount: lines.reduce((sum, l) => sum + l.amount, 0),
  };
}

export async function getProjectBudgets(projectId: string) {
  if (!projectId) return [];
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.getProjectBudgets(tx, projectId);
    return rows.map((b) => toScreenBudget(b as unknown as Record<string, unknown>));
  });
}

export async function getBudgetWithLines(budgetId: string) {
  if (!budgetId) return null;
  return withAuthorizedTenant([], async (tx) => {
    const budget = await repo.getBudgetWithLines(tx, budgetId);
    return budget
      ? toScreenBudget(budget as unknown as Record<string, unknown>)
      : null;
  });
}

export async function getCostCodes(projectId: string | null = null) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.getCostCodes(tx, projectId);
    return rows.map((c) => ({ ...c, _id: c.id }));
  });
}

export async function getAllCostCodes() {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.getAllCostCodes(tx);
    return rows.map((c) => ({ ...c, _id: c.id }));
  });
}

export async function getSubprojects(parentProjectId: string) {
  if (!parentProjectId) return [];
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.getSubprojects(tx, parentProjectId);
    return rows.map((r) => ({
      _id: r.id,
      id: r.id,
      projectNumber: r.projectNumber,
      name: r.name,
      status: r.status,
      progressPercent: r.progressPercent,
      budget: { amount: Number(r.budgetAmount ?? 0) },
    }));
  });
}

export async function getProjectsForParentPicker(
  excludeProjectId: string | null = null,
) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.getProjectsForParentPicker(tx, excludeProjectId);
    return rows.map((r) => ({ ...r, _id: r.id }));
  });
}

export async function getProjectAssignments(projectId: string) {
  if (!projectId) return [];
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.getProjectAssignments(tx, projectId);
    return rows.map((a) => ({
      ...a,
      _id: a.id,
      party: { partyId: a.partyId, name: a.partyName, type: a.partyType },
      rate: { amount: a.rateAmount ? Number(a.rateAmount) : null, unit: a.rateUnit },
    }));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An optional text field off a form.
 *
 * `formData.get()` returns NULL for a key that is not present, and a bare
 * `z.string().optional()` rejects null — so an action called with anything
 * less than the full set of form keys failed with "expected string, received
 * null" against every field the caller happened to omit. The screens post all
 * of them, so it never surfaced there; anything else calling the action hit a
 * wall of validation errors naming fields it had no opinion about.
 */
const optionalText = z.preprocess(
  (v) => v ?? "",
  z.string().optional().or(z.literal("")),
);

/** The same, with a length cap — `description`, `notes`, and their kin. */
const optionalTextMax = (max: number, message: string) =>
  z.preprocess((v) => v ?? "", z.string().max(max, message).optional().or(z.literal("")));

/** Same treatment for an optional enum: an absent key is not a bad value. */
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === null || v === "" ? undefined : v), z.enum(values).optional());

const projectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(200, "Name too long"),
  description: optionalTextMax(2000, "Description too long"),
  /**
   * The ONLY client field the form may post — 0072.
   *
   * `clientName` and `clientEmail` used to be accepted here and stored as
   * sent, with nothing checking they had anything to do with the id beside
   * them. They are resolved from `parties` now, so the request body cannot
   * label a project with a client of its choosing, and a project's client is
   * a CUSTOMER rather than a piece of free text.
   */
  clientPartyId: optionalText,
  projectManagerUserId: optionalText,
  projectManagerName: optionalText,
  startDate: optionalText,
  endDate: optionalText,
  budgetAmount: optionalText,
  budgetCurrency: optionalText,
  priority: optionalEnum(["low", "normal", "high", "critical"] as const),
  tags: optionalText,
  parentProjectId: optionalText,
  billingModel: optionalEnum(["fixed", "milestone", "time_material"] as const).transform(
    (v) => v ?? null,
  ),
  contractValue: optionalText,
  progressPercent: optionalText,
});

const budgetLineSchema = z.object({
  /**
   * A cost code, not an account — 0073. The budget-holder works in their own
   * vocabulary and the account is finance's mapping, resolved by the database.
   */
  costCodeId: z.string().min(1, "Cost code is required"),
  description: optionalTextMax(500, "Description too long"),
  amount: z.coerce.number().min(0, "Amount must be positive"),
});

const budgetSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  revisionNotes: optionalTextMax(1000, "Revision notes too long"),
  lines: z.array(budgetLineSchema).min(1, "At least one budget line is required"),
});

const costCodeSchema = z.object({
  code: z.string().min(1, "Code is required").max(20),
  name: z.string().min(1, "Name is required").max(100),
  accountId: z.string().min(1, "Say which account this code charges"),
  description: optionalTextMax(500, "Description too long"),
  projectId: optionalText,
});

/** A money string for numeric(19,4), or null. Never a float. */
const money = (v: string | undefined | null) => {
  const trimmed = (v ?? "").trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n.toFixed(4) : null;
};

function projectFields(formData: FormData) {
  return {
    name: formData.get("name"),
    description: formData.get("description"),
    clientPartyId: formData.get("clientPartyId"),
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
}

/**
 * The client, read from `parties` rather than from the request body — 0072.
 *
 * A project's client is the party its invoices are raised against, so it has
 * to BE one: a name that is not a customer record cannot be invoiced, cannot
 * be aged and cannot appear on a statement. The picker on both forms already
 * offers customers only and has no quick-create beside it; this is the same
 * rule one layer down, where a crafted request reaches.
 *
 * `project_client_is_a_customer` refuses it again in the database. This exists
 * so the person doing it gets a sentence rather than a constraint name, and so
 * the SNAPSHOT is the customer's own name and email rather than whatever was
 * typed — the snapshot is what the project page renders for ever after.
 *
 * Returns `{}` when no client was chosen: the client is optional, because an
 * internal project has no external one and requiring it would push people to
 * invent a party to satisfy the form.
 */
async function resolveClient(tx: Tx, clientPartyId: string | null | undefined) {
  if (!clientPartyId) {
    return { clientPartyId: null, clientName: null, clientEmail: null };
  }

  const party = await partiesRepo.getParty(tx, clientPartyId);
  if (!party) throw new Error("That client is not a party in this company.");
  if (!party.isCustomer) {
    throw new Error(
      `A project's client must be a customer, and ${party.name} is not one. Add the customer role to them first.`,
    );
  }

  return {
    clientPartyId: party.id,
    clientName: party.displayName || party.name,
    clientEmail: party.email ?? null,
  };
}

function toRepoInput(data: z.infer<typeof projectSchema>) {
  const pct = parseInt(data.progressPercent || "0", 10);
  return {
    name: data.name,
    description: data.description || "",
    clientPartyId: data.clientPartyId || null,
    projectManagerUserId: data.projectManagerUserId || null,
    projectManagerName: data.projectManagerName || null,
    parentProjectId: data.parentProjectId || null,
    billingModel: data.billingModel,
    contractValue: money(data.contractValue),
    progressPercent: Math.max(0, Math.min(100, Number.isNaN(pct) ? 0 : pct)),
    priority: data.priority ?? "normal",
    startDate: data.startDate || null,
    endDate: data.endDate || null,
    budgetAmount: money(data.budgetAmount) ?? "0",
    budgetCurrency: data.budgetCurrency || "KES",
    tags: (data.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

export async function createProject(prevState: unknown, formData: FormData) {
  const values = valuesOf(formData);
  let redirectTo: string | null = null;

  try {
    await requirePlanAccess("projects");
  } catch (e) {
    return { errors: { _form: [(e as Error).message] }, values };
  }

  const parsed = projectSchema.safeParse(projectFields(formData));
  if (!parsed.success) {
    return { errors: fieldErrorsFrom(parsed.error), values };
  }

  try {
    const project = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const actor = actorFrom(user);
        return repo.createProject(tx, {
          companyId,
          ...toRepoInput(parsed.data),
          ...(await resolveClient(tx, parsed.data.clientPartyId)),
          createdById: actor.id,
          createdByName: actor.name,
        });
      },
    );
    revalidatePath("/dashboard/projects");
    redirectTo = `/dashboard/projects/${project.id}?success=Project+created`;
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }

  // redirect() throws internally — it must be outside the try.
  redirect(redirectTo);
}

export async function updateProject(
  projectId: string,
  prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const parsed = projectSchema.safeParse(projectFields(formData));
  if (!parsed.success) {
    return { errors: fieldErrorsFrom(parsed.error), values };
  }

  let redirectTo: string | null = null;
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const existing = await repo.getProjectById(tx, projectId);
        if (!existing) throw new Error("Project not found");
        if (existing.status === "closed") {
          throw new Error("A closed project cannot be edited.");
        }
        if (parsed.data.parentProjectId === projectId) {
          throw new Error("A project cannot be its own parent.");
        }
        const actor = actorFrom(user);
        return repo.updateProject(tx, projectId, {
          ...toRepoInput(parsed.data),
          ...(await resolveClient(tx, parsed.data.clientPartyId)),
          lastModifiedById: actor.id,
          lastModifiedByName: actor.name,
        });
      },
    );
    revalidatePath("/dashboard/projects");
    revalidatePath(`/dashboard/projects/${projectId}`);
    redirectTo = `/dashboard/projects/${projectId}?success=Project+updated`;
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }

  redirect(redirectTo);
}

export async function updateProjectStatus(projectId: string, newStatus: string) {
  try {
    const result = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user }) => {
        // Closing settles a project's books, so it stays a finance decision —
        // the same split the Mongo action drew.
        if (
          newStatus === "closed" &&
          !(FINANCE_WRITE_ROLES as unknown as string[]).includes(user.role)
        ) {
          throw new Error("Only Admin or Accountant can close a project");
        }
        const row = await repo.setProjectStatus(
          tx,
          projectId,
          newStatus as never,
          actorFrom(user),
        );
        if (!row) throw new Error("Project not found");
        return row;
      },
    );
    revalidatePath("/dashboard/projects");
    revalidatePath(`/dashboard/projects/${projectId}`);
    return { success: true, message: `Project status updated to ${result.status}` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/**
 * The manual slider, and it now refuses to be the answer where a WBS exists.
 *
 * 0071 decision 1: progress is derived where there are tasks. Letting somebody
 * drag a slider that the read then ignores is worse than not offering it —
 * they would believe they had changed the number.
 */
export async function updateProjectProgress(
  projectId: string,
  progressPercent: number | string,
) {
  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user }) => {
        if ((await repo.countTasks(tx, projectId)) > 0) {
          throw new Error(
            "This project's progress comes from its tasks. Update the tasks instead.",
          );
        }
        return repo.setProjectProgress(
          tx,
          projectId,
          Number(progressPercent) || 0,
          actorFrom(user),
        );
      },
    );
    if (!row) return { success: false, error: "Project not found" };
    revalidatePath(`/dashboard/projects/${projectId}`);
    return { success: true, message: `Progress updated to ${row.progressPercent}%` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/**
 * Delete, guarded on ALL five link types and on subprojects.
 *
 * The Mongo action counts claims only — its own gap list says "Delete only
 * checks claims" — so a project with three invoices against it and no claims
 * deleted cleanly and took the link off all three.
 */
export async function deleteProject(projectId: string) {
  try {
    await withAuthorizedTenant(
      ADMIN_ROLES as unknown as string[],
      async (tx) => {
        const project = await repo.getProjectById(tx, projectId);
        if (!project) throw new Error("Project not found");
        if (project.status !== "planning") {
          throw new Error("Only projects in planning status can be deleted");
        }

        const links = await repo.countProjectLinks(tx, projectId);
        if (links.total > 0) {
          const parts = Object.entries(links)
            .filter(([key, value]) => key !== "total" && value > 0)
            .map(([key, value]) => `${value} ${key}`);
          throw new Error(
            `Cannot delete a project with linked records: ${parts.join(", ")}.`,
          );
        }

        return repo.deleteProject(tx, projectId);
      },
    );
    revalidatePath("/dashboard/projects");
    return { success: true, message: "Project deleted" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

// ── Budgets ──────────────────────────────────────────────────────────────────

function parseBudgetForm(formData: FormData) {
  let lines: unknown;
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    return { ok: false as const, errors: { _form: ["Invalid budget lines data"] } };
  }
  const parsed = budgetSchema.safeParse({
    projectId: formData.get("projectId"),
    revisionNotes: formData.get("revisionNotes") || "",
    lines,
  });
  if (!parsed.success) {
    return { ok: false as const, errors: fieldErrorsFrom(parsed.error) };
  }
  return { ok: true as const, data: parsed.data };
}

export async function createProjectBudget(prevState: unknown, formData: FormData) {
  const parsed = parseBudgetForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };

  try {
    const budget = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const project = await repo.getProjectById(tx, parsed.data.projectId);
        if (!project) throw new Error("Project not found");
        const actor = actorFrom(user);
        return repo.createBudget(tx, {
          companyId,
          projectId: parsed.data.projectId,
          revisionNotes: parsed.data.revisionNotes,
          lines: parsed.data.lines.map((l) => ({
            costCodeId: l.costCodeId,
            description: l.description || "",
            amount: l.amount.toFixed(4),
          })),
          createdById: actor.id,
          createdByName: actor.name,
        });
      },
    );
    revalidatePath(`/dashboard/projects/${parsed.data.projectId}`);
    revalidatePath(`/dashboard/projects/${parsed.data.projectId}/budget`);
    return {
      success: true,
      message: `Budget v${budget.version} created`,
      budgetId: budget.id,
    };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] } };
  }
}

export async function updateProjectBudget(prevState: unknown, formData: FormData) {
  const budgetId = String(formData.get("budgetId") ?? "");
  if (!budgetId) return { errors: { _form: ["Budget is required"] } };

  const parsed = parseBudgetForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };

  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { companyId }) => {
        const budget = await repo.getBudgetWithLines(tx, budgetId);
        if (!budget) throw new Error("Budget not found");
        if (budget.status !== "draft") {
          throw new Error("Only a draft budget can be edited. Create a new version.");
        }
        return repo.replaceBudgetLines(
          tx,
          budgetId,
          companyId,
          parsed.data.lines.map((l) => ({
            costCodeId: l.costCodeId,
            description: l.description || "",
            amount: l.amount.toFixed(4),
          })),
        );
      },
    );
    revalidatePath(`/dashboard/projects/${parsed.data.projectId}`);
    revalidatePath(`/dashboard/projects/${parsed.data.projectId}/budget`);
    return { success: true, message: "Budget updated" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] } };
  }
}

export async function approveProjectBudget(budgetId: string) {
  try {
    const budget = await withAuthorizedTenant(
      FINANCE_WRITE_ROLES as unknown as string[],
      (tx, { user }) => repo.approveBudget(tx, budgetId, actorFrom(user)),
    );
    revalidatePath(`/dashboard/projects/${budget.projectId}`);
    revalidatePath(`/dashboard/projects/${budget.projectId}/budget`);
    return { success: true, message: `Budget v${budget.version} approved` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

// ── Cost codes ───────────────────────────────────────────────────────────────

/**
 * Cost codes are FINANCE'S, not the project manager's — 0073.
 *
 * `PROJECT_MANAGE_ROLES` includes `Manager`, and while a cost code was just a
 * label that was the right gate. It now carries the GL account the code
 * charges, so defining one is a chart-of-accounts decision — and the whole
 * point of putting cost codes in front of the budget form was to keep the
 * chart away from the person filling it in.
 */
export async function createCostCode(prevState: unknown, formData: FormData) {
  const values = valuesOf(formData);
  const parsed = costCodeSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    accountId: formData.get("accountId"),
    description: formData.get("description"),
    projectId: formData.get("projectId"),
  });
  if (!parsed.success) {
    return { errors: fieldErrorsFrom(parsed.error), values };
  }

  try {
    await withAuthorizedTenant(
      FINANCE_WRITE_ROLES as unknown as string[],
      (tx, { user, companyId }) => {
        const actor = actorFrom(user);
        return repo.createCostCode(tx, {
          companyId,
          code: parsed.data.code,
          name: parsed.data.name,
          accountId: parsed.data.accountId,
          description: parsed.data.description,
          projectId: parsed.data.projectId || null,
          createdById: actor.id,
          createdByName: actor.name,
        });
      },
    );
    revalidatePath("/dashboard/projects/cost-codes");
    return { success: true, message: "Cost code created" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

export async function updateCostCode(
  costCodeId: string,
  prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const parsed = costCodeSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    accountId: formData.get("accountId"),
    description: formData.get("description"),
    projectId: formData.get("projectId"),
  });
  if (!parsed.success) {
    return { errors: fieldErrorsFrom(parsed.error), values };
  }

  try {
    const row = await withAuthorizedTenant(
      FINANCE_WRITE_ROLES as unknown as string[],
      (tx) =>
        repo.updateCostCode(tx, costCodeId, {
          code: parsed.data.code,
          name: parsed.data.name,
          accountId: parsed.data.accountId,
          description: parsed.data.description,
          projectId: parsed.data.projectId || null,
        }),
    );
    if (!row) return { errors: { _form: ["Cost code not found"] }, values };
    revalidatePath("/dashboard/projects/cost-codes");
    return { success: true, message: "Cost code updated" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

export async function toggleCostCodeActive(costCodeId: string) {
  try {
    const row = await withAuthorizedTenant(
      FINANCE_WRITE_ROLES as unknown as string[],
      async (tx) => {
        const codes = await repo.getAllCostCodes(tx);
        const current = codes.find((c) => c.id === costCodeId);
        if (!current) throw new Error("Cost code not found");
        return repo.setCostCodeActive(tx, costCodeId, !current.isActive);
      },
    );
    revalidatePath("/dashboard/projects/cost-codes");
    return {
      success: true,
      message: row?.isActive ? "Cost code activated" : "Cost code deactivated",
    };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

// ── The roster ───────────────────────────────────────────────────────────────

/**
 * Put somebody on the project, or bring them back.
 *
 * THE CONTRACT IS THE CALLER'S. `ProjectTeam.jsx` sends
 * `{ partyId, role, rate: { amount, unit } }` and nothing else — the name and
 * the type are looked up here, exactly as the Mongo action does. Taking them
 * from the request body would have let a client label a roster row with any
 * name it liked, and would have written "Unnamed" for every member the screen
 * actually adds.
 */
export async function assignPartyToProject(
  projectId: string,
  input: {
    partyId?: string;
    role?: string;
    rate?: { amount?: number | string | null; unit?: string | null } | null;
  } = {},
) {
  try {
    await requirePlanAccess("projects");
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }

  if (!projectId) return { success: false, error: "Invalid project id" };
  if (!input.partyId) return { success: false, error: "A valid party is required" };

  const RATE_UNITS = ["hour", "day", "month", "fixed"] as const;
  type RateUnit = (typeof RATE_UNITS)[number];

  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const project = await repo.getProjectById(tx, projectId);
        if (!project) throw new Error("Project not found");
        if (project.status === "closed") {
          throw new Error("A closed project's roster cannot be changed.");
        }

        const party = await partiesRepo.getParty(tx, input.partyId!);
        if (!party) throw new Error("Party not found");

        // `parties` carries three booleans rather than one label (0005), so
        // the roster's `party_type` is derived from them.
        const partyType = party.isEmployee
          ? "employee"
          : party.isSupplier && party.isCustomer
            ? "both"
            : party.isSupplier
              ? "supplier"
              : "employee";

        const amount = money(
          input.rate?.amount === null || input.rate?.amount === undefined
            ? ""
            : String(input.rate.amount),
        );
        const unit = RATE_UNITS.includes(input.rate?.unit as RateUnit)
          ? (input.rate!.unit as RateUnit)
          : null;

        const actor = actorFrom(user);
        return repo.upsertAssignment(tx, {
          companyId,
          projectId,
          partyId: input.partyId!,
          partyName: party.displayName || party.name,
          partyType,
          role: (input.role ?? "").trim().slice(0, 100),
          rateAmount: amount,
          rateUnit: unit,
          assignedById: actor.id,
          assignedByName: actor.name,
        });
      },
    );
    revalidatePath(`/dashboard/projects/${projectId}`);
    return {
      success: true,
      assignmentId: row.id,
      message: `${row.partyName} added to the project`,
    };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function updateProjectAssignment(
  assignmentId: string,
  input: {
    role?: string;
    rate?: { amount?: number | string | null; unit?: string | null } | null;
    status?: "active" | "inactive";
  } = {},
) {
  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      (tx) => repo.updateAssignment(tx, assignmentId, input),
    );
    if (!row) return { success: false, error: "Assignment not found" };
    revalidatePath(`/dashboard/projects/${row.projectId}`);
    return { success: true, message: "Assignment updated" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function removePartyFromProject(assignmentId: string) {
  try {
    const row = await withAuthorizedTenant(PROJECT_MANAGE_ROLES as unknown as string[], (tx) =>
      repo.setAssignmentStatus(tx, assignmentId, "removed"),
    );
    if (!row) return { success: false, error: "Assignment not found" };
    revalidatePath(`/dashboard/projects/${row.projectId}`);
    return { success: true, message: "Removed from the project" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The work breakdown — 0071
// ─────────────────────────────────────────────────────────────────────────────

const taskSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  parentTaskId: optionalText,
  title: z.string().min(1, "A task needs a title").max(200, "Title too long"),
  description: optionalTextMax(2000, "Description too long"),
  assignedPartyId: optionalText,
  assignedName: optionalText,
  plannedStart: optionalText,
  plannedEnd: optionalText,
  estimatedHours: optionalText,
  weight: optionalText,
  costCodeId: optionalText,
  sortOrder: optionalText,
});

function taskFields(formData: FormData) {
  return {
    projectId: formData.get("projectId"),
    parentTaskId: formData.get("parentTaskId"),
    title: formData.get("title"),
    description: formData.get("description"),
    assignedPartyId: formData.get("assignedPartyId"),
    assignedName: formData.get("assignedName"),
    plannedStart: formData.get("plannedStart"),
    plannedEnd: formData.get("plannedEnd"),
    estimatedHours: formData.get("estimatedHours"),
    weight: formData.get("weight"),
    costCodeId: formData.get("costCodeId"),
    sortOrder: formData.get("sortOrder"),
  };
}

/** `numeric(12,2)` / `numeric(12,4)` as a string, or null. Never a float. */
const hours = (v: string | undefined | null, scale = 2) => {
  const trimmed = (v ?? "").trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n.toFixed(scale) : null;
};

/** The WBS, depth-first, with each row's rolled-up percentage on it. */
export async function getProjectTasks(projectId: string) {
  if (!projectId) return [];
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.listProjectTasks(tx, projectId);
    return rows.map((t) => ({ ...t, _id: String(t.id) }));
  });
}

export async function getProjectProgress(projectId: string) {
  if (!projectId) return null;
  return withAuthorizedTenant([], (tx) => repo.getProjectProgress(tx, projectId));
}

export async function createProjectTask(prevState: unknown, formData: FormData) {
  const values = valuesOf(formData);
  const parsed = taskSchema.safeParse(taskFields(formData));
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  try {
    const task = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const project = await repo.getProjectById(tx, d.projectId);
        if (!project) throw new Error("Project not found");
        if (project.status === "closed") {
          throw new Error("A closed project's tasks cannot be changed.");
        }
        const actor = actorFrom(user);
        return repo.createTask(tx, {
          companyId,
          projectId: d.projectId,
          parentTaskId: d.parentTaskId || null,
          title: d.title,
          description: d.description,
          assignedPartyId: d.assignedPartyId || null,
          assignedName: d.assignedName || null,
          plannedStart: d.plannedStart || null,
          plannedEnd: d.plannedEnd || null,
          estimatedHours: hours(d.estimatedHours),
          weight: hours(d.weight, 4),
          costCodeId: d.costCodeId || null,
          sortOrder: parseInt(d.sortOrder || "0", 10) || 0,
          createdById: actor.id,
          createdByName: actor.name,
        });
      },
    );
    revalidateTask(d.projectId);
    return { success: true, message: "Task added", taskId: task.id };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

export async function updateProjectTask(
  taskId: string,
  prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const parsed = taskSchema.safeParse(taskFields(formData));
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const actor = actorFrom(user);
        const row = await repo.updateTask(tx, taskId, {
          parentTaskId: d.parentTaskId || null,
          title: d.title,
          description: d.description,
          assignedPartyId: d.assignedPartyId || null,
          assignedName: d.assignedName || null,
          plannedStart: d.plannedStart || null,
          plannedEnd: d.plannedEnd || null,
          estimatedHours: hours(d.estimatedHours),
          weight: hours(d.weight, 4),
          costCodeId: d.costCodeId || null,
          sortOrder: parseInt(d.sortOrder || "0", 10) || 0,
          lastModifiedById: actor.id,
          lastModifiedByName: actor.name,
        });
        if (!row) throw new Error("Task not found");
        return row;
      },
    );
    revalidateTask(d.projectId);
    return { success: true, message: "Task updated" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

/**
 * Where progress actually gets recorded now.
 *
 * Refused by `project_tasks_leaf_owns_progress` on a summary task, with a
 * message that says to set it on the subtasks — which is the whole point of
 * 0071 decision 2.
 */
export async function setProjectTaskProgress(
  taskId: string,
  input: {
    progressPercent?: number | string;
    status?: "todo" | "in_progress" | "blocked" | "done" | "cancelled";
  },
) {
  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const updated = await repo.setTaskProgress(
          tx,
          taskId,
          {
            progressPercent:
              input.progressPercent === undefined
                ? undefined
                : Number(input.progressPercent),
            status: input.status,
          },
          actorFrom(user),
        );
        if (!updated) throw new Error("Task not found");
        return updated;
      },
    );
    revalidateTask(row.projectId);
    return {
      success: true,
      message: `${row.title} is ${row.progressPercent}%`,
      status: row.status,
      progressPercent: row.progressPercent,
    };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function deleteProjectTask(taskId: string) {
  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx) => {
        const task = await repo.getTaskById(tx, taskId);
        if (!task) throw new Error("Task not found");
        return repo.deleteTask(tx, taskId);
      },
    );
    revalidateTask(row?.projectId);
    return { success: true, message: "Task deleted" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

function revalidateTask(projectId?: string | null) {
  revalidatePath("/dashboard/projects");
  if (projectId) {
    revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath(`/dashboard/projects/${projectId}/tasks`);
  }
}
