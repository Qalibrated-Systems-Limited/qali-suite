"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import {
  WORKFLOW_REPORT_WRITE_ROLES,
  WORKFLOW_REPORT_SIGNOFF_ROLES,
} from "@/lib/utils/role-gates";
import * as repo from "../repositories/workflowReports";
import {
  getProjectProgress,
  getProjectFinancialSummary,
} from "./project-actions";

/**
 * Workflow Reports actions — 0076.
 *
 * Same shape as `project-log-actions.ts`: Zod validates the form,
 * `withAuthorizedTenant` resolves the session and scopes the transaction, the
 * repository does the SQL. Every write returns `{success, message}` or
 * `{errors, values}`, the convention the module's client components expect.
 *
 * The one thing this file does that the log actions do not is READ FROM THE
 * PROJECT: on submit it asks `project-actions` for the same schedule-progress
 * and financial figures the Monthly Report shows, and hands them to the
 * repository to snapshot onto the report. That is the "feeds from the projects
 * application" seam — the report does not re-derive project state, it borrows
 * the numbers the Projects module already computes.
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

/**
 * The sheet body arrives as a JSON string in the `data` field. Parse it
 * defensively — a malformed or non-object value is stored as `{}` rather than
 * failing the save, since the narrative columns already carry the required
 * fields. Capped so a runaway payload can't be pushed into the row.
 */
function parseData(formData: FormData): Record<string, unknown> {
  const raw = formData.get("data");
  if (typeof raw !== "string" || !raw) return {};
  if (raw.length > 200_000) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const optionalText = z.preprocess(
  (v) => v ?? "",
  z.string().optional().or(z.literal("")),
);

function revalidateReports(projectId?: string | null, id?: string | null) {
  revalidatePath("/dashboard/technical");
  if (id) revalidatePath(`/dashboard/technical/${id}`);
  if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
}

const reportSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  // The QSL sheet code (WB01–WB06, SI01, TR01). Free text so the sheet
  // catalogue can grow without a schema/enum change; the UI constrains it.
  type: z
    .string()
    .trim()
    .min(1, "Pick a sheet")
    .max(16, "Invalid sheet")
    .transform((v) => v.toUpperCase()),
  title: z.string().min(1, "A title is required").max(200, "Title too long"),
  periodStart: optionalText,
  periodEnd: optionalText,
  summary: z.string().min(1, "A summary is required").max(6000, "Summary too long"),
  workCompleted: optionalText,
  issues: optionalText,
  nextSteps: optionalText,
});

function reportFields(formData: FormData) {
  return {
    projectId: formData.get("projectId"),
    type: formData.get("type") || "TR01",
    title: formData.get("title"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    summary: formData.get("summary"),
    workCompleted: formData.get("workCompleted"),
    issues: formData.get("issues"),
    nextSteps: formData.get("nextSteps"),
  };
}

export async function getWorkflowReports(projectId: string) {
  if (!projectId) return [];
  return withAuthorizedTenant([], async (tx) => {
    const rows = await repo.listReports(tx, projectId);
    return rows.map((r) => ({ ...r, _id: String(r.id) }));
  });
}

export async function getWorkflowReportsSummary(projectId: string) {
  if (!projectId) return { total: 0, draft: 0, submitted: 0, reviewed: 0, approved: 0 };
  return withAuthorizedTenant([], (tx) => repo.getReportsSummary(tx, projectId));
}

export async function getWorkflowReport(id: string) {
  if (!id) return null;
  return withAuthorizedTenant([], async (tx) => {
    const row = await repo.getReportById(tx, id);
    return row ? { ...row, _id: String(row.id) } : null;
  });
}

export async function createWorkflowReport(prevState: unknown, formData: FormData) {
  const values = valuesOf(formData);
  const parsed = reportSchema.safeParse(reportFields(formData));
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  const data = parseData(formData);
  try {
    const row = await withAuthorizedTenant(
      WORKFLOW_REPORT_WRITE_ROLES as unknown as string[],
      async (tx, { user, companyId }) => {
        const actor = actorFrom(user);
        return repo.createReport(tx, {
          companyId,
          projectId: d.projectId,
          type: d.type,
          title: d.title,
          periodStart: d.periodStart || null,
          periodEnd: d.periodEnd || null,
          summary: d.summary,
          workCompleted: d.workCompleted || "",
          issues: d.issues || "",
          nextSteps: d.nextSteps || "",
          data,
          createdById: actor.id,
          createdByName: actor.name,
        });
      },
    );
    revalidateReports(d.projectId, row.id);
    return { success: true, message: `${row.reportNumber} created`, id: row.id };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

export async function updateWorkflowReport(
  id: string,
  prevState: unknown,
  formData: FormData,
) {
  const values = valuesOf(formData);
  const parsed = reportSchema.safeParse(reportFields(formData));
  if (!parsed.success) return { errors: fieldErrorsFrom(parsed.error), values };

  const d = parsed.data;
  const data = parseData(formData);
  try {
    await withAuthorizedTenant(
      WORKFLOW_REPORT_WRITE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const existing = await repo.getReportById(tx, id);
        if (!existing) throw new Error("Report not found");
        if (existing.status !== "draft") {
          throw new Error("Only a draft report can be edited — reopen it first.");
        }
        const actor = actorFrom(user);
        return repo.updateReport(tx, id, {
          type: d.type,
          title: d.title,
          periodStart: d.periodStart || null,
          periodEnd: d.periodEnd || null,
          summary: d.summary,
          workCompleted: d.workCompleted || "",
          issues: d.issues || "",
          nextSteps: d.nextSteps || "",
          data,
          lastModifiedById: actor.id,
          lastModifiedByName: actor.name,
        });
      },
    );
    revalidateReports(d.projectId, id);
    return { success: true, message: "Report updated" };
  } catch (error) {
    return { errors: { _form: [userMessage(error)] }, values };
  }
}

/**
 * draft → submitted. Reads the project's live progress and financials and
 * snapshots them onto the report. The reads are RLS-scoped and independent of
 * the write, so a project with no figures yet simply snapshots nulls rather
 * than failing the submission.
 */
export async function submitWorkflowReport(id: string, projectId: string) {
  try {
    const [progress, financials] = await Promise.all([
      getProjectProgress(projectId).catch(() => null),
      getProjectFinancialSummary(projectId).catch(() => null),
    ]);
    const snapshot = {
      progress:
        typeof progress?.percent === "number" ? Math.round(progress.percent) : null,
      revenue:
        financials?.revenue != null ? Number(financials.revenue).toFixed(4) : null,
      cost: financials?.costs != null ? Number(financials.costs).toFixed(4) : null,
    };

    const row = await withAuthorizedTenant(
      WORKFLOW_REPORT_WRITE_ROLES as unknown as string[],
      async (tx, { user }) => {
        const updated = await repo.submitReport(tx, id, actorFrom(user), snapshot);
        if (!updated) throw new Error("Only a draft report can be submitted.");
        return updated;
      },
    );
    revalidateReports(projectId, id);
    return { success: true, message: `${row.reportNumber} submitted for review` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function reviewWorkflowReport(id: string, projectId: string) {
  try {
    const row = await withAuthorizedTenant(
      WORKFLOW_REPORT_SIGNOFF_ROLES as unknown as string[],
      async (tx, { user }) => {
        const updated = await repo.reviewReport(tx, id, actorFrom(user));
        if (!updated) throw new Error("Only a submitted report can be reviewed.");
        return updated;
      },
    );
    revalidateReports(projectId, id);
    return { success: true, message: `${row.reportNumber} marked reviewed` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function approveWorkflowReport(id: string, projectId: string) {
  try {
    const row = await withAuthorizedTenant(
      WORKFLOW_REPORT_SIGNOFF_ROLES as unknown as string[],
      async (tx, { user }) => {
        const updated = await repo.approveReport(tx, id, actorFrom(user));
        if (!updated) throw new Error("Only a reviewed report can be approved.");
        return updated;
      },
    );
    revalidateReports(projectId, id);
    return { success: true, message: `${row.reportNumber} approved` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/** Send a report back to draft — available to the sign-off group. */
export async function reopenWorkflowReport(id: string, projectId: string) {
  try {
    const row = await withAuthorizedTenant(
      WORKFLOW_REPORT_SIGNOFF_ROLES as unknown as string[],
      async (tx, { user }) => {
        const updated = await repo.reopenReport(tx, id, actorFrom(user));
        if (!updated) throw new Error("Report not found");
        return updated;
      },
    );
    revalidateReports(projectId, id);
    return { success: true, message: `${row.reportNumber} reopened for editing` };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

export async function deleteWorkflowReport(id: string, projectId: string) {
  try {
    await withAuthorizedTenant(
      WORKFLOW_REPORT_WRITE_ROLES as unknown as string[],
      async (tx) => {
        const existing = await repo.getReportById(tx, id);
        if (!existing) throw new Error("Report not found");
        if (existing.status === "approved") {
          throw new Error("An approved report cannot be deleted — reopen it first.");
        }
        return repo.deleteReport(tx, id);
      },
    );
    revalidateReports(projectId, id);
    return { success: true, message: "Report deleted" };
  } catch (error) {
    return { success: false, error: userMessage(error) };
  }
}

/** Company-wide aggregates for the Technical dashboard overview. */
export async function getTechnicalDashboard() {
  return withAuthorizedTenant([], (tx) => repo.getCompanyReportStats(tx));
}
