"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { canReportOn, reportModule } from "@/lib/reports/catalog";
import { columnsOf, datasetOf, runReport, type ReportDefinition } from "../reportBuilder";

/**
 * The report builder. Who may report on a module is the catalogue's list;
 * what they see is their company's rows (RLS).
 */

function guard(role: string | null | undefined, moduleId: string) {
  if (!canReportOn(role, moduleId)) throw new Error("You don't have access to this module's reports.");
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

export async function getDatasetColumns(moduleId: string, datasetId: string) {
  return withAuthorizedTenant([], async (tx, { user }) => {
    guard(user.role, moduleId);
    const ds = datasetOf(moduleId, datasetId);
    if (!ds) return [];
    return columnsOf(tx, ds.table);
  });
}

export async function runCustomReport(def: ReportDefinition) {
  try {
    const out = await withAuthorizedTenant([], async (tx, { user }) => {
      guard(user.role, def?.module);
      return runReport(tx, def);
    });
    return {
      success: true as const,
      columns: out.columns,
      grouped: out.grouped,
      truncated: out.truncated,
      rows: out.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, iso(v)]))),
    };
  } catch (error) {
    return { success: false as const, error: userMessage(error, "Could not run the report.") };
  }
}

export async function listSavedReports(moduleId: string) {
  return withAuthorizedTenant([], async (tx, { user }) => {
    guard(user.role, moduleId);
    const rows = (await tx.execute(sql`
      SELECT id::text AS id, name, definition, shared, created_by_name AS "createdByName", created_by_id AS "createdById",
             updated_at AS "updatedAt"
        FROM report_definitions
       WHERE module = ${moduleId} AND (shared OR created_by_id = ${String(user.id)})
       ORDER BY name
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({ ...r, updatedAt: iso(r.updatedAt) }));
  });
}

export async function saveReport(name: string, def: ReportDefinition, shared = true, id: string | null = null) {
  const n = String(name ?? "").trim().slice(0, 80);
  if (!n) return { success: false, error: "Name the report." };
  if (!reportModule(def?.module)) return { success: false, error: "Unknown module." };
  try {
    const row = await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      guard(user.role, def.module);
      const clean = JSON.stringify({ ...def, limit: Math.min(Number(def.limit) || 1000, 5000) });
      if (id) {
        const [r] = (await tx.execute(sql`
          UPDATE report_definitions SET name = ${n}, definition = ${clean}::jsonb, shared = ${Boolean(shared)}, updated_at = now()
           WHERE id = ${id}::uuid AND (created_by_id = ${String(user.id)} OR ${["Admin", "SuperAdmin"].includes(String(user.role))})
          RETURNING id::text AS id
        `)) as unknown as Array<{ id: string }>;
        if (!r) throw new Error("Only the person who saved it, or an admin, can change it.");
        return r;
      }
      const [r] = (await tx.execute(sql`
        INSERT INTO report_definitions (company_id, module, name, definition, shared, created_by_id, created_by_name)
        VALUES (${companyId}::uuid, ${def.module}, ${n}, ${clean}::jsonb, ${Boolean(shared)}, ${String(user.id)}, ${user.name || "Staff"})
        RETURNING id::text AS id
      `)) as unknown as Array<{ id: string }>;
      return r;
    });
    revalidatePath(`/dashboard/reports/custom/${def.module}`);
    return { success: true, id: row.id, message: `Saved “${n}”` };
  } catch (error) {
    return { success: false, error: userMessage(error, "Could not save the report.") };
  }
}

export async function deleteSavedReport(id: string) {
  try {
    await withAuthorizedTenant([], async (tx, { user }) => {
      const rows = (await tx.execute(sql`
        DELETE FROM report_definitions
         WHERE id = ${id}::uuid AND (created_by_id = ${String(user.id)} OR ${["Admin", "SuperAdmin"].includes(String(user.role))})
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (!rows.length) throw new Error("Only the person who saved it, or an admin, can delete it.");
    });
    return { success: true, message: "Deleted" };
  } catch (error) {
    return { success: false, error: userMessage(error, "Could not delete it.") };
  }
}
