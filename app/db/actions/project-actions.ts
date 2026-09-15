"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { requirePlanAccess } from "@/lib/plan-gate";
import {
  PROJECT_MANAGE_ROLES,
  PROJECT_LOG_SIGNOFF_ROLES,
  FINANCE_WRITE_ROLES,
  ADMIN_ROLES,
} from "@/lib/utils/role-gates";
import * as repo from "../repositories/projects";
import * as partiesRepo from "../repositories/parties";
import { createInvoice } from "../repositories/invoices";
import { getSystemAccount } from "../repositories/accounts";
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
    typeId: row.typeId ?? null,
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
/**
 * The workspace switcher's list — every project, whatever its status.
 *
 * See `listProjectsForWorkspace`: the site diary and instruction register are
 * read most after a job finishes, so a switcher limited to live projects hides
 * exactly the records people come back for.
 */
export async function getProjectsForWorkspace() {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.listProjectsForWorkspace(tx);
    return rows.map((r) => ({
      _id: r.id,
      id: r.id,
      projectNumber: r.projectNumber,
      name: r.name,
      status: r.status,
    }));
  });
}

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
  /**
   * A `project_types` id, or nothing for "no type" — which shows every section.
   *
   * The Select cannot use "" as an option value (Radix reserves it for the
   * placeholder), so the form posts the sentinel "none". Normalising it HERE
   * rather than at the call site means every caller of this schema gets it:
   * the sentinel is truthy, so `typeId || null` would have sent the literal
   * string "none" to a uuid column and turned a normal choice into a 22P02.
   */
  typeId: z.preprocess(
    (v) => (v === "none" || v === null ? "" : v),
    z.string().optional().or(z.literal("")),
  ),
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
    typeId: formData.get("typeId"),
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
    typeId: data.typeId || null,
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

        /**
         * CLOSING IS TERMINAL — `ProjectStatusActions` offers no way back out
         * of `closed`, and a closed project then refuses edits, roster
         * changes, time and variations. So it is the one status change worth
         * stopping, and the message names what is outstanding rather than
         * saying no.
         *
         * Retention is the reason this exists: it falls due at practical
         * completion and again after the defects period, both AFTER the point
         * somebody wants to close the job, and a closed project is how a
         * contractor forgets to collect the last 5%.
         */
        if (newStatus === "closed") {
          const blockers = await repo.getProjectClosingBlockers(tx, projectId);
          if (blockers.length) {
            throw new Error(
              `This project cannot be closed yet — ${blockers
                .map((b) => b.detail)
                .join("; ")}. Closing is final, so settle these first.`,
            );
          }
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
    /**
     * Returns the CODE, not just a flag.
     *
     * The budget form can now raise one without leaving the page (0073's
     * combobox refused to, for a reason that was about WHO may add a code, not
     * about where). Selecting it on the line that needed it means knowing its
     * id, and the joined account, which only the write knows.
     */
    const created = await withAuthorizedTenant(
      FINANCE_WRITE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const actor = actorFrom(user);
        const row = await repo.createCostCode(tx, {
          companyId,
          code: parsed.data.code,
          name: parsed.data.name,
          accountId: parsed.data.accountId,
          description: parsed.data.description,
          projectId: parsed.data.projectId || null,
          createdById: actor.id,
          createdByName: actor.name,
        });
        // The picker shows the account beneath each code, so the new one has
        // to arrive with it rather than blank until the next page load.
        const account = await repo.getAccountLabel(tx, row.accountId);
        return {
          ...row,
          _id: row.id,
          accountCode: account?.accountCode ?? null,
          accountName: account?.accountName ?? null,
        };
      },
    );
    revalidatePath("/dashboard/projects/cost-codes");
    return { success: true, message: "Cost code created", costCode: created };
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

/**
 * `/dashboard/projects/${projectId}/tasks` IS NOT A ROUTE and never has been —
 * the WBS is a card on the project page, not a page of its own. So the second
 * line of this function revalidated nothing, and adding a task left the
 * Programme showing the old tree until something else happened to invalidate
 * it. Written and never read, in the cache layer.
 *
 * The programme is where tasks are now read (it absorbed the Milestone Tracker,
 * §10.3), and the bill lists the task an item measures, so both go.
 */
function revalidateTask(projectId?: string | null) {
  revalidatePath("/dashboard/projects");
  revalidatePath("/dashboard/projects/programme");
  revalidatePath("/dashboard/projects/boq");
  if (projectId) {
    revalidatePath(`/dashboard/projects/${projectId}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The bill of quantities — 0080
//
// The measured half. `getProjectBoq` is the whole page in one call; everything
// below it writes.
// ─────────────────────────────────────────────────────────────────────────────

/** `numeric(19,4)` as a string, or null. Never a float — see `hours`. */
const decimal = (v: string | undefined | null) => hours(v, 4);

function revalidateBoq(projectId?: string | null) {
  revalidatePath("/dashboard/projects/boq");
  if (projectId) {
    revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath("/dashboard/projects");
  }
}

/**
 * The effective bill for a project, its lines and its totals — one call,
 * because a screen that renders a bill needs all three or none of them.
 *
 * Returns null where the project has no bill at all, which is the common case:
 * a supply job or a lump-sum installation never has one, and §8 decision 5 is
 * that the BILL'S PRESENCE — not the project's type — is what makes a job
 * measured.
 */
export async function getProjectBoq(projectId: string) {
  if (!projectId) return null;
  return withAuthorizedTenant([], async (tx) => {
    const boq = await repo.getEffectiveBoq(tx, projectId);
    if (!boq) return null;

    const [items, summary, versions] = await Promise.all([
      repo.listBoqItems(tx, boq.id),
      repo.getBoqSummary(tx, boq.id),
      repo.listBoqsForProject(tx, projectId),
    ]);

    return {
      boq: { ...boq, _id: boq.id, id: boq.id },
      items: items.map((i) => ({ ...i, _id: i.id })),
      summary,
      /** Every version, so a superseded bill is reachable rather than lost. */
      versions: versions.map((v) => ({ ...v, _id: v.id })),
    };
  });
}

/** The measurement log for one item — the audit behind a remeasured quantity. */
export async function getBoqMeasurements(itemId: string) {
  if (!itemId) return [];
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.listBoqMeasurements(tx, itemId);
    return rows.map((r) => ({ ...r, _id: r.id }));
  });
}

const boqSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  methodOfMeasurement: optionalTextMax(120, "Method of measurement too long"),
  currency: optionalText,
  notes: optionalTextMax(2000, "Notes too long"),
});

export async function createProjectBoq(prevState: unknown, formData: FormData) {
  const values = valuesOf(formData);
  try {
    await requirePlanAccess("projects");
  } catch (e) {
    return { errors: { _form: [(e as Error).message] }, values };
  }

  const parsed = boqSchema.safeParse({
    projectId: formData.get("projectId"),
    methodOfMeasurement: formData.get("methodOfMeasurement"),
    currency: formData.get("currency"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  try {
    const boq = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const project = await repo.getProjectById(tx, d.projectId);
        if (!project) throw new Error("Project not found");
        const actor = actorFrom(user);
        return repo.createBoq(tx, {
          companyId,
          projectId: d.projectId,
          methodOfMeasurement: d.methodOfMeasurement || null,
          currency: d.currency || null,
          notes: d.notes || null,
          createdById: actor.id,
          createdByName: actor.name,
        });
      },
    );
    revalidateBoq(d.projectId);
    return { success: true, message: `Bill v${boq.version} started`, boqId: boq.id };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

export async function updateProjectBoq(
  boqId: string,
  prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const parsed = boqSchema.safeParse({
    projectId: formData.get("projectId"),
    methodOfMeasurement: formData.get("methodOfMeasurement"),
    currency: formData.get("currency"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const actor = actorFrom(user);
        const row = await repo.updateBoq(tx, boqId, {
          methodOfMeasurement: d.methodOfMeasurement || null,
          currency: d.currency || null,
          notes: d.notes || null,
          lastModifiedById: actor.id,
          lastModifiedByName: actor.name,
        });
        if (!row) throw new Error("Bill not found");
        return row;
      },
    );
    revalidateBoq(d.projectId);
    return { success: true, message: "Bill updated" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

/**
 * Award the bill — FINANCE, not project management.
 *
 * Same gate and same reasoning as `approveProjectBudget`: `PROJECT_MANAGE_ROLES`
 * includes `Manager`, and awarding is the commercial act that fixes the
 * contract sum and FREEZES every rate in the bill. A project manager builds and
 * prices the bill; signing it off is the same decision as approving a budget,
 * and it is made by the same people.
 */
export async function awardProjectBoq(boqId: string) {
  try {
    const boq = await withAuthorizedTenant(
      FINANCE_WRITE_ROLES as unknown as string[],
      (tx, { user }) => repo.awardBoq(tx, boqId, actorFrom(user)),
    );
    if (!boq) return { success: false, error: "Bill not found" };
    revalidateBoq(boq.projectId);
    return { success: true, message: `Bill v${boq.version} awarded` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

const boqItemSchema = z.object({
  boqId: z.string().min(1, "Bill is required"),
  projectId: z.string().min(1, "Project is required"),
  parentItemId: optionalText,
  itemCode: optionalTextMax(40, "Item code too long"),
  description: z
    .string()
    .min(1, "A bill item needs a description")
    .max(1000, "Description too long"),
  isHeading: optionalText,
  unit: optionalTextMax(20, "Unit too long"),
  quantity: optionalText,
  rate: optionalText,
  costCodeId: optionalText,
  taskId: optionalText,
  sortOrder: optionalText,
});

function boqItemFields(formData: FormData) {
  return {
    boqId: formData.get("boqId"),
    projectId: formData.get("projectId"),
    parentItemId: formData.get("parentItemId"),
    itemCode: formData.get("itemCode"),
    description: formData.get("description"),
    isHeading: formData.get("isHeading"),
    unit: formData.get("unit"),
    quantity: formData.get("quantity"),
    rate: formData.get("rate"),
    costCodeId: formData.get("costCodeId"),
    taskId: formData.get("taskId"),
    sortOrder: formData.get("sortOrder"),
  };
}

export async function createProjectBoqItem(
  prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const parsed = boqItemSchema.safeParse(boqItemFields(formData));
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  const heading = d.isHeading === "on" || d.isHeading === "true";
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const actor = actorFrom(user);
        return repo.createBoqItem(tx, {
          companyId,
          boqId: d.boqId,
          projectId: d.projectId,
          parentItemId: d.parentItemId || null,
          itemCode: d.itemCode || null,
          description: d.description,
          isHeading: heading,
          // A heading carries no unit, quantity or rate — the CHECK says so,
          // and a form that leaves a stale rate in a hidden field would hit it
          // with a message about a constraint.
          unit: heading ? null : d.unit || null,
          quantity: heading ? null : decimal(d.quantity),
          rate: heading ? null : decimal(d.rate),
          costCodeId: d.costCodeId || null,
          taskId: d.taskId || null,
          sortOrder: parseInt(d.sortOrder || "0", 10) || 0,
          createdById: actor.id,
          createdByName: actor.name,
        });
      },
    );
    revalidateBoq(d.projectId);
    return { success: true, message: "Bill item added" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

export async function updateProjectBoqItem(
  itemId: string,
  prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const parsed = boqItemSchema.safeParse(boqItemFields(formData));
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  const heading = d.isHeading === "on" || d.isHeading === "true";
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const actor = actorFrom(user);
        const row = await repo.updateBoqItem(tx, itemId, {
          parentItemId: d.parentItemId || null,
          itemCode: d.itemCode || null,
          description: d.description,
          isHeading: heading,
          unit: heading ? null : d.unit || null,
          quantity: heading ? null : decimal(d.quantity),
          rate: heading ? null : decimal(d.rate),
          costCodeId: d.costCodeId || null,
          taskId: d.taskId || null,
          sortOrder: parseInt(d.sortOrder || "0", 10) || 0,
          lastModifiedById: actor.id,
          lastModifiedByName: actor.name,
        });
        if (!row) throw new Error("Bill item not found");
        return row;
      },
    );
    revalidateBoq(d.projectId);
    return { success: true, message: "Bill item updated" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

export async function deleteProjectBoqItem(itemId: string, projectId: string) {
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx) => {
        const row = await repo.deleteBoqItem(tx, itemId);
        if (!row) throw new Error("Bill item not found");
        return row;
      },
    );
    revalidateBoq(projectId);
    return { success: true, message: "Bill item removed" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

const measurementSchema = z.object({
  boqItemId: z.string().min(1, "Bill item is required"),
  projectId: z.string().min(1, "Project is required"),
  measuredOn: optionalText,
  quantity: z.string().min(1, "A measurement needs a quantity"),
  reference: optionalTextMax(200, "Reference too long"),
  notes: optionalTextMax(2000, "Notes too long"),
});

/**
 * Record a remeasure.
 *
 * SIGNED, and the form says so: a negative quantity is how last month's
 * over-measure is corrected without editing what was already certified. The
 * database refuses zero, refuses a heading, refuses an unpriced item and
 * refuses anything against a bill that has not been awarded — so this parses
 * the number and gets out of the way.
 */
export async function recordProjectBoqMeasurement(
  prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const parsed = measurementSchema.safeParse({
    boqItemId: formData.get("boqItemId"),
    projectId: formData.get("projectId"),
    measuredOn: formData.get("measuredOn"),
    quantity: formData.get("quantity"),
    reference: formData.get("reference"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  const quantity = decimal(d.quantity);
  if (quantity === null) {
    return {
      errors: { quantity: ["A measurement needs a number"] },
      values,
    };
  }

  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const actor = actorFrom(user);
        return repo.recordBoqMeasurement(tx, {
          companyId,
          boqItemId: d.boqItemId,
          measuredOn: d.measuredOn || null,
          quantity,
          reference: d.reference || null,
          notes: d.notes || null,
          measuredById: actor.id,
          measuredByName: actor.name,
        });
      },
    );
    revalidateBoq(d.projectId);
    return { success: true, message: "Measurement recorded" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

/**
 * Remove a measurement — for a mis-keyed entry, and only that.
 *
 * A quantity that has been certified is corrected by a NEGATIVE measurement,
 * so both the original and the adjustment survive in the log. The screen says
 * which is which; the database cannot tell them apart.
 */
export async function deleteProjectBoqMeasurement(
  measurementId: string,
  projectId: string,
) {
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx) => {
        const row = await repo.deleteBoqMeasurement(tx, measurementId);
        if (!row) throw new Error("Measurement not found");
        return row;
      },
    );
    revalidateBoq(projectId);
    return { success: true, message: "Measurement removed" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/**
 * The project types a tenant may pick from — the built-ins, plus its own.
 *
 * RLS does the filtering: the 0082 policy reads `company_id IS NULL OR
 * company_id = current`, so a built-in is visible to everyone and a tenant's
 * own to nobody else. Nothing here says anything about tenancy, which is why it
 * cannot get it wrong.
 */
export async function getProjectTypes() {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.listProjectTypes(tx);
    return rows.map((r) => ({ ...r, _id: r.id, isBuiltIn: r.companyId === null }));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The contract, and the interim payment certificate — 0081
// ─────────────────────────────────────────────────────────────────────────────

function revalidateCertificates(projectId?: string | null) {
  revalidatePath("/dashboard/projects/ipc");
  revalidatePath("/dashboard/projects");
  if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
}

/**
 * Everything the IPC section renders: the main contract, its certificates with
 * every figure computed, and the contract's position.
 *
 * Returns `{ contract: null }` where a project has no contract — which is the
 * common case and not an error. A project cannot be certified against terms
 * nobody has entered, and saying so is more use than an empty table.
 */
export async function getProjectCertificates(projectId: string) {
  if (!projectId) return null;
  return withAuthorizedTenant([], async (tx) => {
    const contract = await repo.getMainContract(tx, projectId);
    if (!contract) {
      return { contract: null, certificates: [], position: null, basis: null, boq: null };
    }

    const [certificates, position, basis, boq, billableTime, milestones] =
      await Promise.all([
      repo.listCertificates(tx, contract.id),
      repo.getContractPosition(tx, contract.id),
      repo.nextCertificateBasis(tx, contract.id),
      /**
       * The measured value, where an awarded bill exists — it is what the next
       * certificate's "value of permanent work to date" should be, and having
       * to copy it across from another page by hand is how a certificate comes
       * to disagree with the remeasure it is supposed to be based on.
       */
      (async () => {
        const bill = await repo.getEffectiveBoq(tx, projectId);
        if (!bill || bill.status !== "awarded") return null;
        const summary = await repo.getBoqSummary(tx, bill.id);
        /**
         * The PRICED items come with it — 0094. A variation line raised
         * against the bill takes that item's description, unit and rate, and
         * making somebody find the item on another page and retype its rate is
         * how a variation comes to be priced at a rate nobody agreed.
         *
         * Headings and unpriced narrative lines are excluded: there is nothing
         * to omit or remeasure on a line that carries no quantity.
         */
        const items = await repo.listBoqItems(tx, bill.id);
        return {
          boqId: bill.id,
          version: bill.version,
          measured: summary.measured,
          items: items
            .filter((i) => !i.isHeading && i.quantity !== null && i.unit)
            .map((i) => ({
              _id: String(i.id),
              itemCode: i.itemCode ?? "",
              description: i.description,
              unit: i.unit,
              rate: Number(i.rate ?? 0),
            })),
        };
      })(),
      /**
       * Billable time approved on this job, offered beside the dayworks box.
       * OFFERED, not filled: on a time-and-material job it is the dayworks
       * figure, and on a lump-sum contract it is a different thing with a
       * similar name. The QS decides.
       */
      repo.getProjectBillableTimeToDate(tx, projectId),
      /**
       * The schedule's answer to "value of permanent work to date" — 0093, and
       * the reason `valuation_source = 'milestone'` has been a column nothing
       * ever set. Offered beside the measured bill; a job has one or the other,
       * never usually both.
       */
      repo.getMilestoneValueToDate(tx, projectId),
    ]);

    return {
      contract: { ...contract, _id: contract.id },
      certificates,
      position,
      basis,
      boq,
      billableTime,
      milestones,
    };
  });
}

const contractSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  reference: optionalTextMax(120, "Reference too long"),
  title: optionalTextMax(200, "Title too long"),
  counterpartyPartyId: optionalText,
  counterpartyName: optionalTextMax(200, "Name too long"),
  contractSum: optionalText,
  currency: optionalText,
  retentionPercent: optionalText,
  retentionCapPercent: optionalText,
  advanceAmount: optionalText,
  advanceRecoveryPercent: optionalText,
  defectsLiabilityMonths: optionalText,
  commencementDate: optionalText,
  completionDate: optionalText,
  notes: optionalTextMax(2000, "Notes too long"),
});

function contractFields(formData: FormData) {
  return {
    projectId: formData.get("projectId"),
    reference: formData.get("reference"),
    title: formData.get("title"),
    counterpartyPartyId: formData.get("counterpartyPartyId"),
    counterpartyName: formData.get("counterpartyName"),
    contractSum: formData.get("contractSum"),
    currency: formData.get("currency"),
    retentionPercent: formData.get("retentionPercent"),
    retentionCapPercent: formData.get("retentionCapPercent"),
    advanceAmount: formData.get("advanceAmount"),
    advanceRecoveryPercent: formData.get("advanceRecoveryPercent"),
    defectsLiabilityMonths: formData.get("defectsLiabilityMonths"),
    commencementDate: formData.get("commencementDate"),
    completionDate: formData.get("completionDate"),
    notes: formData.get("notes"),
  };
}

/** `numeric(5,2)` as a string, or null. Percentages, not money. */
const percent = (v: string | undefined | null) => hours(v, 2);

function toContractTerms(d: Record<string, string | undefined>) {
  return {
    reference: d.reference || null,
    title: d.title || null,
    counterpartyPartyId: d.counterpartyPartyId || null,
    counterpartyName: d.counterpartyName || null,
    contractSum: decimal(d.contractSum) ?? "0",
    currency: d.currency || null,
    retentionPercent: percent(d.retentionPercent) ?? "0",
    retentionCapPercent: percent(d.retentionCapPercent),
    advanceAmount: decimal(d.advanceAmount) ?? "0",
    advanceRecoveryPercent: percent(d.advanceRecoveryPercent) ?? "0",
    defectsLiabilityMonths: d.defectsLiabilityMonths
      ? parseInt(d.defectsLiabilityMonths, 10) || null
      : null,
    commencementDate: d.commencementDate || null,
    completionDate: d.completionDate || null,
    notes: d.notes || null,
  };
}

/**
 * The contract's terms — FINANCE, not project management.
 *
 * Same gate and same reasoning as approving a budget and awarding a bill:
 * `PROJECT_MANAGE_ROLES` includes `Manager`, and the retention percentage, the
 * advance and the contract sum are the commercial terms every certificate is
 * computed from.
 */
export async function saveProjectContract(prevState: unknown, formData: FormData) {
  const values = valuesOf(formData);
  const parsed = contractSchema.safeParse(contractFields(formData));
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data as Record<string, string | undefined>;
  const contractId = String(formData.get("contractId") ?? "");

  try {
    await withAuthorizedTenant(
      FINANCE_WRITE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const actor = actorFrom(user);
        const terms = toContractTerms(d);

        if (contractId) {
          const row = await repo.updateContract(tx, contractId, {
            ...terms,
            lastModifiedById: actor.id,
            lastModifiedByName: actor.name,
          });
          if (!row) throw new Error("Contract not found");
          return row;
        }

        const project = await repo.getProjectById(tx, d.projectId!);
        if (!project) throw new Error("Project not found");
        return repo.createContract(tx, {
          companyId,
          projectId: d.projectId!,
          direction: "receivable",
          ...terms,
          createdById: actor.id,
          createdByName: actor.name,
        });
      },
    );
    revalidateCertificates(d.projectId);
    return { success: true, message: contractId ? "Contract updated" : "Contract saved" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

const certificateSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  contractId: z.string().min(1, "Contract is required"),
  periodFrom: optionalText,
  periodTo: optionalText,
  valuationDate: optionalText,
  valuationSource: optionalEnum(["measured", "milestone", "manual"] as const),
  workDoneToDate: optionalText,
  materialsOnSite: optionalText,
  dayworksToDate: optionalText,
  retentionReleasedToDate: optionalText,
  notes: optionalTextMax(2000, "Notes too long"),
});

function certificateFields(formData: FormData) {
  return {
    projectId: formData.get("projectId"),
    contractId: formData.get("contractId"),
    periodFrom: formData.get("periodFrom"),
    periodTo: formData.get("periodTo"),
    valuationDate: formData.get("valuationDate"),
    valuationSource: formData.get("valuationSource"),
    workDoneToDate: formData.get("workDoneToDate"),
    materialsOnSite: formData.get("materialsOnSite"),
    dayworksToDate: formData.get("dayworksToDate"),
    retentionReleasedToDate: formData.get("retentionReleasedToDate"),
    notes: formData.get("notes"),
  };
}

export async function createProjectCertificate(
  prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const parsed = certificateSchema.safeParse(certificateFields(formData));
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const actor = actorFrom(user);
        return repo.createCertificate(tx, {
          companyId,
          projectId: d.projectId,
          contractId: d.contractId,
          periodFrom: d.periodFrom || null,
          periodTo: d.periodTo || null,
          valuationDate: d.valuationDate || null,
          valuationSource: d.valuationSource ?? "manual",
          workDoneToDate: decimal(d.workDoneToDate),
          materialsOnSite: decimal(d.materialsOnSite),
          dayworksToDate: decimal(d.dayworksToDate),
          retentionReleasedToDate: decimal(d.retentionReleasedToDate),
          notes: d.notes || null,
          createdById: actor.id,
          createdByName: actor.name,
        });
      },
    );
    revalidateCertificates(d.projectId);
    return { success: true, message: "Certificate started" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

export async function updateProjectCertificate(
  certificateId: string,
  prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const parsed = certificateSchema.safeParse(certificateFields(formData));
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const actor = actorFrom(user);
        const row = await repo.updateCertificate(tx, certificateId, {
          periodFrom: d.periodFrom || null,
          periodTo: d.periodTo || null,
          valuationDate: d.valuationDate || null,
          valuationSource: d.valuationSource ?? undefined,
          workDoneToDate: decimal(d.workDoneToDate),
          materialsOnSite: decimal(d.materialsOnSite),
          dayworksToDate: decimal(d.dayworksToDate),
          retentionReleasedToDate: decimal(d.retentionReleasedToDate),
          notes: d.notes || null,
          lastModifiedById: actor.id,
          lastModifiedByName: actor.name,
        });
        if (!row) throw new Error("Certificate not found");
        return row;
      },
    );
    revalidateCertificates(d.projectId);
    return { success: true, message: "Certificate updated" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

/**
 * Certify — FINANCE, like awarding a bill and approving a budget.
 *
 * This is the act that freezes the figures and states what the client is being
 * asked to pay. Raising the draft invoice is a SEPARATE step, deliberately:
 * they are two decisions, and a certificate issued without an invoice is a
 * normal state on a job where the invoice is raised elsewhere.
 */
export async function certifyProjectCertificate(
  certificateId: string,
  projectId: string,
) {
  try {
    const row = await withAuthorizedTenant(
      FINANCE_WRITE_ROLES as unknown as string[],
      async (tx, { user }) => {
        /**
         * Resolved before certifying, because a certificate that releases
         * retention posts the release as part of being certified — see
         * `certifyCertificate`. Passed as ids so the repository stays one.
         */
        const [held, ar] = await Promise.all([
          getSystemAccount(tx, "retention_receivable"),
          getSystemAccount(tx, "accounts_receivable"),
        ]);
        return repo.certifyCertificate(tx, certificateId, actorFrom(user), {
          retentionAccountId: held?.id ?? "",
          arAccountId: ar?.id ?? "",
        });
      },
    );
    if (!row) return { success: false, error: "Certificate not found" };
    revalidateCertificates(projectId);
    return { success: true, message: `${row.certificateNumber} certified` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function cancelProjectCertificate(
  certificateId: string,
  projectId: string,
) {
  try {
    const row = await withAuthorizedTenant(
      FINANCE_WRITE_ROLES as unknown as string[],
      (tx, { user }) => repo.cancelCertificate(tx, certificateId, actorFrom(user)),
    );
    if (!row) return { success: false, error: "Certificate not found" };
    revalidateCertificates(projectId);
    return { success: true, message: `${row.certificateNumber} cancelled` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function deleteProjectCertificate(
  certificateId: string,
  projectId: string,
) {
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx) => {
        const row = await repo.deleteCertificate(tx, certificateId);
        if (!row) throw new Error("Certificate not found");
        return row;
      },
    );
    revalidateCertificates(projectId);
    return { success: true, message: "Draft certificate removed" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/**
 * Raise the DRAFT invoice for a certified certificate — 0081 decision 3, and
 * the same decision the execution layer made for milestones.
 *
 * A DRAFT and nothing more: reviewable, editable and deletable, and it makes
 * the certificate the source document without committing to a posting. It
 * answers §6 open question 2 in the half that can be undone.
 *
 * ONE SERVICE LINE, at the net certified for THIS certificate. Not the gross,
 * because the net is what the employer is being asked to pay; not with tax
 * worked out here, because the invoice computes VAT with the engine that
 * already exists and the withholding happens at payment.
 */
export async function raiseCertificateInvoice(
  certificateId: string,
  projectId: string,
) {
  try {
    const result = await withAuthorizedTenant(
      FINANCE_WRITE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const certificate = await repo.getCertificateById(tx, certificateId);
        if (!certificate) throw new Error("Certificate not found");
        if (certificate.status !== "certified") {
          throw new Error(
            "Only a certified certificate raises an invoice. Certify it first.",
          );
        }
        if (certificate.invoiceId) {
          throw new Error("This certificate has already raised an invoice.");
        }

        const project = await repo.getProjectById(tx, certificate.projectId);
        if (!project) throw new Error("Project not found");
        if (!project.clientPartyId) {
          throw new Error(
            "This project has no client, so there is nobody to invoice. Set one on the project first.",
          );
        }

        const contract = await repo.getContractById(tx, certificate.contractId);
        if (!contract) throw new Error("Contract not found");

        const chain = await repo.listCertificates(tx, certificate.contractId);
        const figures = chain.find((c) => c.id === certificateId)?.figures;
        if (!figures) throw new Error("Certificate figures could not be computed");
        /**
         * THE INVOICE IS FOR THE GROSS VALUE CERTIFIED THIS PERIOD, not the net.
         *
         * This raised the NET, and that was wrong twice over. Revenue would
         * read short by the retention every month and long when it was
         * released — retention is not a discount, it is money earned and
         * deferred. And VAT is due on the value of the SUPPLY, so invoicing net
         * under-declares output VAT on every certificate for the life of a job
         * that retains.
         *
         * The prototype this module was specified from says the same:
         * "Tax Invoice = Gross Certified × 1.16" — VAT on the gross, retention
         * deducted from the PAYMENT. Every QS-grade system bills it this way.
         *
         * What the employer holds back is reclassified out of receivables when
         * the invoice is completed — DR Retention Receivable / CR Accounts
         * Receivable — so the money owed splits into the part due now and the
         * part held, without touching revenue.
         */
        const grossThisPeriod = figures.grossThisPeriod;
        if (grossThisPeriod <= 0) {
          throw new Error(
            "This certificate certifies nothing further, so there is nothing to invoice.",
          );
        }

        const invoice = await createInvoice(tx, {
          companyId,
          customerId: String(project.clientPartyId),
          invoiceDate: certificate.valuationDate,
          projectId: certificate.projectId,
          title: `Certificate ${certificate.certificateNumber} (IPC ${certificate.sequence})`,
          notes: certificate.notes || null,
          lines: [
            {
              itemType: "service",
              description: `Work executed to ${certificate.valuationDate} — IPC No. ${certificate.sequence}`,
              quantity: "1",
              unitPrice: grossThisPeriod.toFixed(2),
            },
          ],
          createdById: user.id ?? null,
          createdByName: user.name ?? null,
        });

        await repo.attachCertificateInvoice(tx, certificateId, invoice.id);
        return { invoice, certificate };
      },
    );
    revalidateCertificates(projectId);
    revalidatePath("/dashboard/invoices");
    return {
      success: true,
      message: `Draft invoice ${result.invoice.invoiceNumber} raised`,
      invoiceId: result.invoice.id,
    };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/** What a project still needs before it can be run — see the repository. */
/**
 * Where this tenant's project-tagged spend actually is, other than here.
 *
 * The empty state on Cash Requisitions used to say only "nothing linked to
 * this project yet" — true, and indistinguishable from "the claim you tagged
 * did not save".
 */
export async function getProjectSpendElsewhere(projectId: string) {
  if (!projectId) return { claims: 0, expenses: 0, projects: [] };
  return withAuthorizedTenant([], (tx) =>
    repo.countProjectSpendElsewhere(tx, projectId),
  );
}

/**
 * What would stop this project being closed, for the screen that offers the
 * button — so the answer arrives before somebody presses it rather than as a
 * refusal afterwards.
 */
export async function getProjectClosingBlockers(projectId: string) {
  if (!projectId) return [];
  return withAuthorizedTenant([], (tx) =>
    repo.getProjectClosingBlockers(tx, projectId),
  );
}

export async function getProjectSetupState(projectId: string) {
  if (!projectId) return null;
  return withAuthorizedTenant([], (tx) => repo.getProjectSetupState(tx, projectId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Timesheets — 0089.
//
// The join between a project and labour. See the migration for the five
// decisions; the two that matter at this layer:
//
//   A TIMESHEET DOES NOT POST. Nothing below writes a journal entry, and
//   nothing below ever should — labour reaches the ledger through payroll,
//   once, where the PAYE and the NSSF are.
//
//   ALMOST NOTHING IS SENT. The party, the rate, the cost, the account and the
//   bill amount are the database's, written by `project_timesheets_derive`.
//   These actions carry intent and read back what it decided.
//
// PERMISSION IS PROJECT_MANAGE_ROLES throughout, including for logging. There
// is no self-service entry route — an employee cannot open a project and book
// their own day — and inventing one here would be inventing a permission
// model. Where that is wanted it is a role gate, not a looser action.
// ─────────────────────────────────────────────────────────────────────────────

const TIMESHEET_UNITS = ["hour", "day"] as const;
type TimesheetUnit = (typeof TIMESHEET_UNITS)[number];

const TIMESHEET_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

/** YYYY-MM-DD, and a date the database will accept. */
function workDateOf(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

export async function logProjectTime(
  projectId: string,
  input: {
    assignmentId?: string;
    workDate?: string;
    quantity?: number | string;
    unit?: string;
    taskId?: string | null;
    costCodeId?: string | null;
    billable?: boolean;
    billRate?: number | string | null;
    notes?: string;
  } = {},
) {
  try {
    await requirePlanAccess("projects");
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }

  if (!projectId) return { success: false, error: "Invalid project id" };
  if (!input.assignmentId) {
    return { success: false, error: "Choose who the time is for." };
  }

  const workDate = workDateOf(input.workDate);
  if (!workDate) return { success: false, error: "A valid date is required." };

  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { success: false, error: "Enter how long was worked." };
  }

  const unit = TIMESHEET_UNITS.includes(input.unit as TimesheetUnit)
    ? (input.unit as TimesheetUnit)
    : "hour";

  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const project = await repo.getProjectById(tx, projectId);
        if (!project) throw new Error("Project not found");
        // Same rule the roster carries: a closed job does not acquire new
        // cost. Correcting a line already on it is a different action.
        if (project.status === "closed") {
          throw new Error("A closed project cannot have time logged against it.");
        }

        const actor = actorFrom(user);
        return repo.createTimesheet(tx, {
          companyId,
          projectId,
          assignmentId: input.assignmentId!,
          workDate,
          quantity,
          unit,
          taskId: input.taskId ?? null,
          costCodeId: input.costCodeId ?? null,
          billable: input.billable ?? true,
          billRate: input.billRate ?? null,
          notes: input.notes ?? "",
          enteredById: actor.id,
          enteredByName: actor.name,
        });
      },
    );

    revalidatePath(`/dashboard/projects/${projectId}`);
    return {
      success: true,
      timesheetId: row.id,
      message: `${row.quantity} ${unit}${Number(row.quantity) === 1 ? "" : "s"} logged for ${row.partyName}`,
    };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function updateProjectTimesheet(
  timesheetId: string,
  input: {
    workDate?: string;
    quantity?: number | string;
    unit?: string;
    taskId?: string | null;
    costCodeId?: string | null;
    billable?: boolean;
    billRate?: number | string | null;
    notes?: string;
  } = {},
) {
  if (!timesheetId) return { success: false, error: "Invalid timesheet id" };

  const patch: Parameters<typeof repo.updateTimesheet>[2] = {};
  if (input.workDate !== undefined) {
    const workDate = workDateOf(input.workDate);
    if (!workDate) return { success: false, error: "A valid date is required." };
    patch.workDate = workDate;
  }
  if (input.quantity !== undefined) {
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { success: false, error: "Enter how long was worked." };
    }
    patch.quantity = quantity;
  }
  if (input.unit !== undefined) {
    if (!TIMESHEET_UNITS.includes(input.unit as TimesheetUnit)) {
      return { success: false, error: "Time is logged in hours or days." };
    }
    patch.unit = input.unit as TimesheetUnit;
  }
  if (input.taskId !== undefined) patch.taskId = input.taskId;
  if (input.costCodeId !== undefined) patch.costCodeId = input.costCodeId;
  if (input.billable !== undefined) patch.billable = input.billable;
  if (input.billRate !== undefined) patch.billRate = input.billRate;
  if (input.notes !== undefined) patch.notes = input.notes;

  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      (tx) => repo.updateTimesheet(tx, timesheetId, patch),
    );
    if (!row) return { success: false, error: "Timesheet entry not found" };
    revalidatePath(`/dashboard/projects/${row.projectId}`);
    return { success: true, message: "Timesheet updated" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/**
 * Submit, approve, reject, or send a line back to draft.
 *
 * Approving is what makes the time COST — `computeActualsFor` counts approved
 * lines as incurred and submitted ones as committed, on the same basis 0088
 * put bills, claims and expenses on.
 */
export async function setProjectTimesheetStatus(
  timesheetId: string,
  status: string,
) {
  if (!timesheetId) return { success: false, error: "Invalid timesheet id" };
  if (!TIMESHEET_STATUSES.includes(status as TimesheetStatus)) {
    return { success: false, error: "Unknown timesheet status" };
  }

  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      (tx, { user }) =>
        repo.setTimesheetStatus(
          tx,
          timesheetId,
          status as TimesheetStatus,
          actorFrom(user),
        ),
    );
    if (!row) return { success: false, error: "Timesheet entry not found" };
    revalidatePath(`/dashboard/projects/${row.projectId}`);
    return { success: true, message: `Timesheet ${status}` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/** Approve a week in one statement — see the repository for why not a loop. */
export async function approveProjectTimesheets(
  projectId: string,
  timesheetIds: string[],
) {
  if (!Array.isArray(timesheetIds) || !timesheetIds.length) {
    return { success: false, error: "Nothing selected" };
  }

  try {
    const rows = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      (tx, { user }) =>
        repo.approveTimesheets(tx, timesheetIds, actorFrom(user)),
    );
    if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
    return {
      success: true,
      approved: rows.length,
      message:
        rows.length === timesheetIds.length
          ? `${rows.length} approved`
          : // Says what happened rather than claiming everything went
            // through: only a SUBMITTED line is approvable, so a stale
            // checkbox on an already-approved row is silently skipped.
            `${rows.length} of ${timesheetIds.length} approved — the rest were not awaiting approval`,
    };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function deleteProjectTimesheet(timesheetId: string) {
  if (!timesheetId) return { success: false, error: "Invalid timesheet id" };
  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      (tx) => repo.deleteTimesheet(tx, timesheetId),
    );
    if (!row) {
      return {
        success: false,
        // The delete filters on status, so "not found" here usually means
        // "approved". Say the second thing, because the first is confusing
        // when the row is on screen.
        error:
          "An approved entry cannot be deleted. Reject it instead, so the correction is on the record.",
      };
    }
    revalidatePath(`/dashboard/projects/${row.projectId}`);
    return { success: true, message: "Timesheet entry removed" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/** The project's time, in the shape a table renders. */
export async function getProjectTimesheets(
  projectId: string,
  filters: {
    partyId?: string | null;
    taskId?: string | null;
    status?: string | null;
    from?: string | null;
    to?: string | null;
    limit?: number;
  } = {},
) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.listProjectTimesheets(tx, projectId, {
      partyId: filters.partyId ?? null,
      taskId: filters.taskId ?? null,
      status: TIMESHEET_STATUSES.includes(filters.status as TimesheetStatus)
        ? (filters.status as TimesheetStatus)
        : null,
      from: filters.from ?? null,
      to: filters.to ?? null,
      limit: filters.limit,
    });

    return rows.map((r) => ({
      _id: String(r.id),
      id: String(r.id),
      projectId: String(r.projectId),
      assignmentId: String(r.assignmentId),
      partyId: String(r.partyId),
      partyName: r.partyName,
      partyType: r.partyType,
      taskId: r.taskId ? String(r.taskId) : null,
      costCodeId: r.costCodeId ? String(r.costCodeId) : null,
      workDate: r.workDate,
      quantity: Number(r.quantity),
      unit: r.unit,
      // NULL is "not costed here" — a supplier's time is invoiced, not free.
      // The screen must show a dash rather than a zero, so it stays null.
      cost: r.costAmount === null ? null : Number(r.costAmount),
      rate: r.rateAmount === null ? null : Number(r.rateAmount),
      rateUnit: r.rateUnit,
      billable: r.billable,
      billAmount: r.billAmount === null ? null : Number(r.billAmount),
      status: r.status,
      notes: r.notes,
      enteredByName: r.enteredByName,
      approvedByName: r.approvedByName,
      approvedAt: r.approvedAt,
    }));
  });
}

/** Labour cost, days and hours for one project — the roster card's figures. */
export async function getProjectLabourSummary(projectId: string) {
  return withAuthorizedTenant([], async (tx) => {
    const map = await repo.getProjectLabourSummary(tx, [projectId]);
    return (
      map.get(projectId) ?? {
        costIncurred: 0,
        costCommitted: 0,
        days: 0,
        hours: 0,
        billable: 0,
        entries: 0,
      }
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Variations — 0091.
//
// The register that lets a contract sum move, and the last thing standing
// between this module and a FIDIC-form contract.
//
// WHO DOES WHAT, and it is the certificate's split exactly: a project manager
// raises and submits a variation; FINANCE approves or rejects it, because
// approving one changes the contract sum and therefore every "% of contract
// certified" figure downstream of it.
//
// NOTHING HERE POSTS. A variation changes what the contract is WORTH. The
// ledger records what has been EARNED, and the varied work reaches the books
// through a certificate that values it, like every other piece of work.
// ─────────────────────────────────────────────────────────────────────────────

const VARIATION_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
type VariationStatus = (typeof VARIATION_STATUSES)[number];

export async function getProjectVariations(projectId: string) {
  if (!projectId) return { variations: [], summary: null };
  return withAuthorizedTenant([], async (tx) => {
    const [rows, summary] = await Promise.all([
      repo.listVariations(tx, projectId),
      repo.getVariationSummary(tx, projectId),
    ]);
    return {
      variations: rows.map((v) => ({
        _id: String(v.id),
        id: String(v.id),
        variationNumber: v.variationNumber,
        title: v.title,
        description: v.description,
        costEffect: Number(v.costEffect),
        timeEffectDays: v.timeEffectDays,
        status: v.status,
        issuedDate: v.issuedDate,
        reference: v.reference,
        instructionId: v.instructionId ? String(v.instructionId) : null,
        decidedByName: v.decidedByName,
        decidedAt: v.decidedAt,
        decisionNotes: v.decisionNotes,
        createdByName: v.createdByName,
      })),
      summary,
    };
  });
}

export async function createProjectVariation(
  _prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const projectId = String(formData.get("projectId") ?? "");
  const contractId = String(formData.get("contractId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const issuedDate = String(formData.get("issuedDate") ?? "").trim();

  const errors: FieldErrors = {};
  if (!projectId) errors.projectId = ["A project is required"];
  if (!contractId) {
    errors.contractId = ["Enter the contract terms before raising a variation"];
  }
  if (!title) errors.title = ["A variation needs a title"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedDate)) {
    errors.issuedDate = ["A valid date is required"];
  }

  const costEffect = Number(formData.get("costEffect") ?? 0) || 0;
  const timeEffectDays = Math.trunc(Number(formData.get("timeEffectDays") ?? 0)) || 0;
  // The CHECK says the same thing, but a form error beats a constraint here:
  // "a variation with no effect" is a sentence somebody can act on.
  if (costEffect === 0 && timeEffectDays === 0) {
    errors.costEffect = [
      "A variation changes the money, the time, or both. One of them must be non-zero.",
    ];
  }
  if (Object.keys(errors).length) return { errors, values };

  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const project = await repo.getProjectById(tx, projectId);
        if (!project) throw new Error("Project not found");
        if (project.status === "closed") {
          throw new Error("A closed project's contract cannot be varied.");
        }
        const actor = actorFrom(user);
        return repo.createVariation(tx, {
          companyId,
          projectId,
          contractId,
          title,
          description: String(formData.get("description") ?? ""),
          costEffect,
          timeEffectDays,
          issuedDate,
          reference: String(formData.get("reference") ?? ""),
          instructionId: String(formData.get("instructionId") ?? "") || null,
          notes: String(formData.get("notes") ?? ""),
          createdById: actor.id,
          createdByName: actor.name,
        });
      },
    );
    revalidateCertificates(projectId);
    return { success: true, message: `${row.variationNumber} raised` };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

export async function updateProjectVariation(
  variationId: string,
  projectId: string,
  input: {
    title?: string;
    description?: string;
    costEffect?: number | string;
    timeEffectDays?: number | string;
    issuedDate?: string;
    reference?: string | null;
    instructionId?: string | null;
    notes?: string;
  } = {},
) {
  if (!variationId) return { success: false, error: "Invalid variation id" };
  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      (tx, { user }) => {
        const actor = actorFrom(user);
        return repo.updateVariation(tx, variationId, {
          ...input,
          lastModifiedById: actor.id,
          lastModifiedByName: actor.name,
        });
      },
    );
    if (!row) {
      return {
        success: false,
        // The filter is on status, so "not found" here almost always means
        // approved — say the thing that is actually true.
        error:
          "An approved variation cannot be amended. Its figures are in the contract sum and in every certificate since. Reject it and raise another.",
      };
    }
    revalidateCertificates(projectId);
    return { success: true, message: `${row.variationNumber} updated` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/**
 * Submit, approve, reject, or send back.
 *
 * Approving is the act that moves the contract sum and the completion date —
 * by trigger, not here. FINANCE_WRITE_ROLES for a decision; the project
 * manager who raised it may only submit it.
 */
export async function setProjectVariationStatus(
  variationId: string,
  projectId: string,
  status: string,
  decisionNotes?: string,
) {
  if (!variationId) return { success: false, error: "Invalid variation id" };
  if (!VARIATION_STATUSES.includes(status as VariationStatus)) {
    return { success: false, error: "Unknown variation status" };
  }

  const deciding = status === "approved" || status === "rejected";
  const roles = deciding ? FINANCE_WRITE_ROLES : PROJECT_MANAGE_ROLES;

  try {
    const row = await withAuthorizedTenant(
      roles as unknown as string[],
      (tx, { user }) =>
        repo.setVariationStatus(
          tx,
          variationId,
          status as VariationStatus,
          actorFrom(user),
          decisionNotes,
        ),
    );
    if (!row) return { success: false, error: "Variation not found" };
    revalidateCertificates(projectId);
    return { success: true, message: `${row.variationNumber} ${status}` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function deleteProjectVariation(
  variationId: string,
  projectId: string,
) {
  if (!variationId) return { success: false, error: "Invalid variation id" };
  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      (tx) => repo.deleteVariation(tx, variationId),
    );
    if (!row) {
      return {
        success: false,
        error:
          "Only a draft or rejected variation can be deleted. An approved one has moved the contract sum — reject it instead, so the register says so.",
      };
    }
    revalidateCertificates(projectId);
    return { success: true, message: `${row.variationNumber} removed` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Milestones — 0093.
//
// The valuation method for a job with no bill to remeasure. `billing_model =
// 'milestone'` has been declared since 0070 with nothing behind it, and
// `valuation_source = 'milestone'` has been a column no code ever set.
//
// ACHIEVING POSTS NOTHING. It makes a figure available to the next
// certificate, offered with a button exactly as the measured bill is. A stage
// being achieved and the employer being asked to pay for it are two decisions.
//
// WHO DOES WHAT: a project manager builds the schedule and records that a stage
// was achieved; that is a site fact. Nothing here is finance's, because nothing
// here moves money — the certificate does, and finance certifies that.
// ─────────────────────────────────────────────────────────────────────────────

const MILESTONE_STATUSES = ["pending", "achieved", "cancelled"] as const;
type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/**
 * The main contract alone, for a screen that needs its TERMS and not its
 * certificates.
 *
 * `getProjectCertificates` is the only way this surface could reach a contract,
 * and it runs six queries — the chain, the position, the next certificate's
 * basis, the bill, billable time and the milestones — because the IPC page
 * draws all six. The milestone schedule needs the retention percentage and the
 * contract sum and nothing else, so asking through that door would run five
 * queries to throw away.
 */
export async function getProjectMainContract(projectId: string) {
  if (!projectId) return null;
  return withAuthorizedTenant([], async (tx) => {
    const contract = await repo.getMainContract(tx, projectId);
    return contract ? { ...contract, _id: String(contract.id) } : null;
  });
}

export async function getProjectMilestones(projectId: string) {
  if (!projectId) return { milestones: [], summary: null };
  return withAuthorizedTenant([], async (tx) => {
    const [rows, summary] = await Promise.all([
      repo.listMilestones(tx, projectId),
      repo.getMilestoneSummary(tx, projectId),
    ]);
    return {
      milestones: rows.map((m) => ({
        _id: String(m.id),
        id: String(m.id),
        name: m.name,
        description: m.description,
        sequence: m.sequence,
        value: Number(m.value),
        dueDate: m.dueDate,
        achievedOn: m.achievedOn,
        retentionReleasePercent:
          m.retentionReleasePercent === null ? null : Number(m.retentionReleasePercent),
        status: m.status,
        achievedByName: m.achievedByName,
        notes: m.notes,
      })),
      summary,
    };
  });
}

export async function createProjectMilestone(
  _prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const projectId = String(formData.get("projectId") ?? "");
  const contractId = String(formData.get("contractId") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  const errors: FieldErrors = {};
  if (!projectId) errors.projectId = ["A project is required"];
  if (!contractId) {
    errors.contractId = ["Enter the contract terms before building a schedule"];
  }
  if (!name) errors.name = ["A stage needs a name"];

  const value = Number(formData.get("value") ?? 0) || 0;
  if (value < 0) errors.value = ["A stage cannot be worth less than nothing"];
  if (Object.keys(errors).length) return { errors, values };

  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const project = await repo.getProjectById(tx, projectId);
        if (!project) throw new Error("Project not found");
        if (project.status === "closed") {
          throw new Error("A closed project's schedule cannot be changed.");
        }
        const actor = actorFrom(user);
        return repo.createMilestone(tx, {
          companyId,
          projectId,
          contractId,
          name,
          description: String(formData.get("description") ?? ""),
          value,
          sequence: Number(formData.get("sequence") ?? 0) || 0,
          dueDate: String(formData.get("dueDate") ?? "") || null,
          retentionReleasePercent:
            String(formData.get("retentionReleasePercent") ?? "") || null,
          notes: String(formData.get("notes") ?? ""),
          createdById: actor.id,
          createdByName: actor.name,
        });
      },
    );
    revalidateCertificates(projectId);
    return { success: true, message: `${row.name} added to the schedule` };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

export async function updateProjectMilestone(
  milestoneId: string,
  projectId: string,
  input: {
    name?: string;
    description?: string;
    value?: number | string;
    sequence?: number;
    dueDate?: string | null;
    retentionReleasePercent?: number | string | null;
    notes?: string;
  } = {},
) {
  if (!milestoneId) return { success: false, error: "Invalid milestone id" };
  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      (tx, { user }) => {
        const actor = actorFrom(user);
        return repo.updateMilestone(tx, milestoneId, {
          ...input,
          lastModifiedById: actor.id,
          lastModifiedByName: actor.name,
        });
      },
    );
    if (!row) {
      return {
        success: false,
        error:
          "An achieved stage cannot be amended — its value is in a certificate's valuation. Take the achievement back first.",
      };
    }
    revalidateCertificates(projectId);
    return { success: true, message: `${row.name} updated` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/**
 * Record that a stage was achieved, on a DATE.
 *
 * The date is not optional and does not default to today: a certificate values
 * what was achieved by its valuation date, so the date decides which
 * certificate picks the stage up. Defaulting it would quietly put a late
 * sign-off on the wrong month, which is most sign-offs.
 */
export async function setProjectMilestoneStatus(
  milestoneId: string,
  projectId: string,
  status: string,
  achievedOn?: string,
) {
  if (!milestoneId) return { success: false, error: "Invalid milestone id" };
  if (!MILESTONE_STATUSES.includes(status as MilestoneStatus)) {
    return { success: false, error: "Unknown milestone status" };
  }
  if (status === "achieved" && !/^\d{4}-\d{2}-\d{2}$/.test(achievedOn ?? "")) {
    return {
      success: false,
      error: "Give the date the stage was achieved — it decides which certificate values it.",
    };
  }

  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      (tx, { user }) =>
        repo.setMilestoneStatus(
          tx,
          milestoneId,
          status as MilestoneStatus,
          actorFrom(user),
          achievedOn ?? null,
        ),
    );
    if (!row) return { success: false, error: "Milestone not found" };
    revalidateCertificates(projectId);
    return {
      success: true,
      message:
        status === "achieved"
          ? `${row.name} achieved — the next certificate can value it`
          : `${row.name} ${status}`,
    };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function deleteProjectMilestone(
  milestoneId: string,
  projectId: string,
) {
  if (!milestoneId) return { success: false, error: "Invalid milestone id" };
  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      (tx) => repo.deleteMilestone(tx, milestoneId),
    );
    if (!row) {
      return {
        success: false,
        error:
          "An achieved stage cannot be deleted — a certificate has valued it. Take the achievement back, or cancel the stage so the record says what happened.",
      };
    }
    revalidateCertificates(projectId);
    return { success: true, message: `${row.name} removed` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

// ── Variation lines — 0094 ──────────────────────────────────────────────────
//
// Where there are lines they ARE the cost effect, so nothing below sends one:
// the trigger sums them onto the variation and 0091's chain moves the contract
// sum from there. An approved variation's lines are refused by the database.

export async function getVariationItems(projectId: string) {
  if (!projectId) return {};
  return withAuthorizedTenant([], async (tx) => {
    const map = await repo.listVariationItemsForProject(tx, projectId);
    const out: Record<string, unknown[]> = {};
    for (const [variationId, rows] of map) {
      out[variationId] = rows.map((r) => ({
        _id: String(r.id),
        id: String(r.id),
        boqItemId: r.boqItemId ? String(r.boqItemId) : null,
        itemCode: r.itemCode ?? null,
        description: r.description,
        unit: r.unit ?? null,
        quantity: Number(r.quantity),
        rate: Number(r.rate),
        amount: Number(r.amount),
      }));
    }
    return out;
  });
}

export async function addProjectVariationItem(
  variationId: string,
  projectId: string,
  input: {
    description?: string;
    itemCode?: string | null;
    unit?: string | null;
    quantity?: number | string;
    rate?: number | string;
    boqItemId?: string | null;
    sequence?: number;
  } = {},
) {
  if (!variationId) return { success: false, error: "Invalid variation id" };

  const quantity = Number(input.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity === 0) {
    // Zero moves nothing, and a line that moves nothing is a note.
    return {
      success: false,
      error: "Give a quantity. Negative omits work that is in the bill.",
    };
  }

  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      (tx, { companyId }) =>
        repo.addVariationItem(tx, {
          companyId,
          variationId,
          description: input.description ?? null,
          itemCode: input.itemCode ?? null,
          unit: input.unit ?? null,
          quantity,
          rate: input.rate ?? null,
          boqItemId: input.boqItemId ?? null,
          sequence: input.sequence ?? 0,
        }),
    );
    revalidateCertificates(projectId);
    return {
      success: true,
      message: `${row.description} priced at ${Number(row.amount).toLocaleString()}`,
    };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function updateProjectVariationItem(
  itemId: string,
  projectId: string,
  input: {
    description?: string;
    itemCode?: string | null;
    unit?: string | null;
    quantity?: number | string;
    rate?: number | string;
    sequence?: number;
  } = {},
) {
  if (!itemId) return { success: false, error: "Invalid line id" };
  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      (tx) => repo.updateVariationItem(tx, itemId, input),
    );
    if (!row) return { success: false, error: "Line not found" };
    revalidateCertificates(projectId);
    return { success: true, message: "Line updated" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function deleteProjectVariationItem(
  itemId: string,
  projectId: string,
) {
  if (!itemId) return { success: false, error: "Invalid line id" };
  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      (tx) => repo.deleteVariationItem(tx, itemId),
    );
    if (!row) return { success: false, error: "Line not found" };
    revalidateCertificates(projectId);
    return { success: true, message: "Line removed" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Cash requisitions — 0107.
//
// WHO MAY DO WHAT, and it is the split the module already draws twice.
//
//   RAISE     PROJECT_MANAGE_ROLES — anyone who runs the job asks for cash.
//   DECIDE    PROJECT_LOG_SIGNOFF_ROLES — the supervisory group, which is the
//             same one that countersigns a diary and rules on an instruction.
//             It includes the Manager, as the MD's own prototype does
//             (`role==='admin'||role==='pm'`), and drops the Accountant.
//   FUND      FINANCE_WRITE_ROLES — recording that money actually left is
//             finance's act, not the site's, even though this posts nothing.
//
// Approving and funding are deliberately different gates: the first says the
// job may have the money, the second says the cash went out. On a small team
// the same person holds both, and that is their arrangement to make rather
// than one this collapses for them.
// ─────────────────────────────────────────────────────────────────────────────

function revalidateCash(projectId?: string | null) {
  revalidatePath("/dashboard/projects/cash-requisitions");
  revalidatePath("/dashboard/projects");
  if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function getProjectCashRequisitions(projectId: string) {
  if (!projectId) return { requisitions: [], summary: null };
  return withAuthorizedTenant([], async (tx) => {
    const [rows, summary] = await Promise.all([
      repo.listCashRequisitions(tx, projectId),
      repo.getCashRequisitionSummary(tx, projectId),
    ]);
    return {
      requisitions: rows.map((r) => ({
        _id: String(r.id),
        id: String(r.id),
        requisitionNumber: r.requisitionNumber,
        requestDate: r.requestDate,
        neededBy: r.neededBy,
        costCodeId: r.costCodeId,
        costCode: r.costCodeAtRequest,
        purpose: r.purpose,
        amount: Number(r.amount),
        status: r.status,
        requestedByName: r.requestedByName,
        decidedByName: r.decidedByName,
        decidedAt: r.decidedAt,
        decisionNotes: r.decisionNotes,
        fundedSource: r.fundedSource,
        fundedSourceId: r.fundedSourceId,
        fundedAt: r.fundedAt,
        notes: r.notes,
      })),
      summary,
    };
  });
}

export async function createCashRequisition(
  _prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const projectId = String(formData.get("projectId") ?? "");
  const purpose = String(formData.get("purpose") ?? "").trim();
  const amount = Number(formData.get("amount") ?? 0) || 0;

  const errors: FieldErrors = {};
  if (!projectId) errors.projectId = ["A project is required"];
  if (!purpose) errors.purpose = ["Say what the cash is for"];
  if (amount <= 0) errors.amount = ["Enter how much is needed"];
  if (Object.keys(errors).length) return { errors, values };

  try {
    const row = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const project = await repo.getProjectById(tx, projectId);
        if (!project) throw new Error("Project not found");
        if (project.status === "closed") {
          throw new Error("This project is closed, so it cannot request cash.");
        }
        const actor = actorFrom(user);
        return repo.createCashRequisition(tx, {
          companyId,
          projectId,
          purpose,
          amount,
          requestDate: String(formData.get("requestDate") ?? "") || null,
          neededBy: String(formData.get("neededBy") ?? "") || null,
          costCodeId: String(formData.get("costCodeId") ?? "") || null,
          notes: String(formData.get("notes") ?? ""),
          requestedById: actor.id,
          requestedByName: actor.name,
          createdById: actor.id,
          createdByName: actor.name,
          /** The site's request goes out asking; only an explicit "save as
           *  draft" keeps it back. */
          submit: String(formData.get("submit") ?? "true") !== "false",
        });
      },
    );
    revalidateCash(projectId);
    return {
      success: true,
      message: `${row.requisitionNumber} raised for ${Number(row.amount).toLocaleString("en-KE")}`,
      id: row.id,
    };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

export async function updateCashRequisition(
  requisitionId: string,
  _prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const projectId = String(formData.get("projectId") ?? "");
  const purpose = String(formData.get("purpose") ?? "").trim();
  const amount = Number(formData.get("amount") ?? 0) || 0;

  const errors: FieldErrors = {};
  if (!purpose) errors.purpose = ["Say what the cash is for"];
  if (amount <= 0) errors.amount = ["Enter how much is needed"];
  if (Object.keys(errors).length) return { errors, values };

  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const actor = actorFrom(user);
        const row = await repo.updateCashRequisition(tx, requisitionId, {
          purpose,
          amount,
          requestDate: String(formData.get("requestDate") ?? "") || null,
          neededBy: String(formData.get("neededBy") ?? "") || null,
          costCodeId: String(formData.get("costCodeId") ?? "") || null,
          notes: String(formData.get("notes") ?? ""),
          lastModifiedById: actor.id,
          lastModifiedByName: actor.name,
        });
        if (!row) throw new Error("That requisition no longer exists.");
        return row;
      },
    );
    revalidateCash(projectId);
    return { success: true, message: "Requisition updated" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

/**
 * Submit, recall, approve, reject or cancel.
 *
 * One action for five transitions because the trigger is what decides which
 * are legal — duplicating that list here would be a second copy to drift. What
 * this owns is the GATE: asking is the site's, deciding is the supervisor's.
 */
export async function setCashRequisitionStatus(
  requisitionId: string,
  projectId: string,
  input: {
    status: "draft" | "submitted" | "approved" | "rejected" | "cancelled";
    notes?: string;
  },
) {
  const deciding = input.status === "approved" || input.status === "rejected";

  if (input.status === "rejected" && (input.notes ?? "").trim().length < 10) {
    return {
      success: false,
      error: "Say why it was refused — a site cannot act on \"no\" alone.",
    };
  }

  try {
    const row = await withAuthorizedTenant(
      (deciding
        ? PROJECT_LOG_SIGNOFF_ROLES
        : PROJECT_MANAGE_ROLES) as unknown as string[],
      async (tx, { user }) => {
        const updated = await repo.setCashRequisitionStatus(
          tx,
          requisitionId,
          input.status,
          actorFrom(user),
          input.notes ?? null,
        );
        if (!updated) throw new Error("That requisition no longer exists.");
        return updated;
      },
    );
    revalidateCash(projectId);
    return { success: true, message: `${row.requisitionNumber} ${row.status}` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/**
 * Record that the cash went out, and on which existing document.
 *
 * POSTS NOTHING — the advance, the petty cash top-up or the stock request named
 * here is what posted. This closes the loop so an approved request stops
 * looking outstanding.
 */
export async function fundCashRequisition(
  requisitionId: string,
  projectId: string,
  funding: {
    source: "employee_advance" | "petty_cash" | "stock_request" | "other";
    sourceId?: string | null;
  },
) {
  try {
    const row = await withAuthorizedTenant(
      FINANCE_WRITE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const updated = await repo.fundCashRequisition(
          tx,
          requisitionId,
          funding,
          actorFrom(user),
        );
        if (!updated) throw new Error("That requisition no longer exists.");
        return updated;
      },
    );
    revalidateCash(projectId);
    return { success: true, message: `${row.requisitionNumber} marked funded` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function deleteCashRequisition(
  requisitionId: string,
  projectId: string,
) {
  try {
    await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES as unknown as string[],
      async (tx) => {
        const gone = await repo.deleteCashRequisition(tx, requisitionId);
        if (!gone) throw new Error("That requisition no longer exists.");
        return gone;
      },
    );
    revalidateCash(projectId);
    return { success: true, message: "Draft deleted" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}
