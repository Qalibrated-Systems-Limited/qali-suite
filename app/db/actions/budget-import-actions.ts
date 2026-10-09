"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import * as repo from "../repositories/projects";
import { parseBudgetWorkbook, parseBudgetCsv } from "@/lib/budget/parse-budget";
import { PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";

const MANAGE = PROJECT_MANAGE_ROLES as unknown as string[];

/**
 * Import a budget from a spreadsheet — the whole bill does not have to be typed
 * into the form line by line. A row names a cost code, a category and an amount,
 * and the cost code charges a GL account (0073). The importer therefore has to
 * MINT the cost codes the budget references before it can create the budget:
 *
 *   • a code already on the project (or company-wide) is reused;
 *   • a new code is created against the account the row names — resolved by
 *     code or name against the company's postable expense accounts — or against
 *     the project's default cost account when the row leaves it blank.
 *
 * Cost-code resolution is raw SQL against the tables, so it does not depend on a
 * repository helper's signature; the budget itself goes through `createBudget`,
 * whose trigger derives each line's account from its code.
 */
export async function importBudgetFile(projectId: string, formData: FormData) {
  if (!projectId) return { error: "No project." };
  const file = formData.get("file");
  if (!file || typeof file === "string") return { error: "No file uploaded." };
  if (file.size > 10 * 1024 * 1024) return { error: "File too large (max 10MB)." };

  let parsed;
  try {
    const name = (file.name || "").toLowerCase();
    const isCsv = name.endsWith(".csv") || file.type === "text/csv";
    if (isCsv) {
      const text = Buffer.from(await file.arrayBuffer()).toString("utf8");
      parsed = parseBudgetCsv(text);
    } else {
      const buf = Buffer.from(await file.arrayBuffer());
      parsed = await parseBudgetWorkbook(buf);
    }
  } catch {
    return { error: "Could not read that file. Use the standard template." };
  }
  if (!parsed.lines.length) {
    return {
      error:
        parsed.warnings[0] ||
        "No budget lines found. The sheet needs 'Cost Code' and 'Amount' columns.",
    };
  }

  try {
    const result = await withAuthorizedTenant(MANAGE, async (tx, { user, companyId }) => {
      const actorId = user?.id ?? null;
      const actorName = user?.name ?? "System";

      // The project's default cost account — the fallback for a row with no
      // account named.
      const projRows = (await tx.execute(sql`
        SELECT default_cost_account_id FROM projects WHERE id = ${projectId}::uuid
      `)) as unknown as Array<{ default_cost_account_id: string | null }>;
      const defaultAccountId = projRows[0]?.default_cost_account_id ?? null;

      // Resolve one row's account id: the named account (by code or name, must be
      // a postable expense account), else the project default.
      async function resolveAccountId(accountText: string): Promise<string> {
        const t = accountText.trim();
        if (t) {
          const rows = (await tx.execute(sql`
            SELECT id FROM accounts
             WHERE company_id = ${companyId}::uuid
               AND account_type = 'expense' AND can_post = true AND is_active = true
               AND (account_code = ${t} OR lower(btrim(account_name)) = lower(${t}))
             LIMIT 1
          `)) as unknown as Array<{ id: string }>;
          if (!rows[0]) {
            throw new Error(
              `No postable expense account matches "${t}". Use an account code or name from the chart.`,
            );
          }
          return String(rows[0].id);
        }
        if (defaultAccountId) return defaultAccountId;
        throw new Error(
          "A line has no account and the project has no default cost account. Set a default on the budget screen, or name an account in the Account column.",
        );
      }

      // Cache codes resolved this run so the same code on two rows mints once.
      const codeCache = new Map<string, string>();
      async function ensureCostCode(
        code: string,
        name: string,
        account: string,
      ): Promise<string> {
        const key = code.toUpperCase();
        const cached = codeCache.get(key);
        if (cached) return cached;

        // Already defined on this project, or company-wide (projectId NULL)?
        const existing = (await tx.execute(sql`
          SELECT id FROM project_cost_codes
           WHERE company_id = ${companyId}::uuid
             AND code = ${key}
             AND (project_id = ${projectId}::uuid OR project_id IS NULL)
           ORDER BY project_id NULLS LAST
           LIMIT 1
        `)) as unknown as Array<{ id: string }>;
        if (existing[0]) {
          const id = String(existing[0].id);
          codeCache.set(key, id);
          return id;
        }

        const accountId = await resolveAccountId(account);
        const created = (await tx.execute(sql`
          INSERT INTO project_cost_codes
            (company_id, code, name, account_id, project_id, created_by_id, created_by_name)
          VALUES (
            ${companyId}::uuid, ${key}, ${name || key}, ${accountId}::uuid,
            ${projectId}::uuid, ${actorId}, ${actorName}
          )
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        const id = String(created[0].id);
        codeCache.set(key, id);
        return id;
      }

      // Build the budget lines, merging rows that repeat a cost code (two lines
      // on one account would each show the full spend in budget-vs-actual).
      const merged = new Map<
        string,
        { costCodeId: string; description: string; category: string | null; amount: number }
      >();
      for (const l of parsed.lines) {
        const costCodeId = await ensureCostCode(l.code, l.name, l.account);
        const prev = merged.get(costCodeId);
        if (prev) {
          prev.amount += l.amount;
          if (!prev.description) prev.description = l.description;
        } else {
          merged.set(costCodeId, {
            costCodeId,
            description: l.description,
            category: l.category || null,
            amount: l.amount,
          });
        }
      }

      const lines = [...merged.values()].map((m) => ({
        costCodeId: m.costCodeId,
        description: m.description,
        category: m.category,
        amount: m.amount.toFixed(4),
      }));

      const budget = await repo.createBudget(tx, {
        companyId,
        projectId,
        revisionNotes: `Imported from ${file.name}`,
        lines,
        createdById: actorId,
        createdByName: actorName,
      });

      return { budgetId: budget.id, version: budget.version, lines: lines.length };
    });

    revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath(`/dashboard/projects/${projectId}/budget`);
    revalidatePath("/dashboard/projects/budget");
    return {
      success: true,
      message: `Budget v${result.version} created with ${result.lines} line${result.lines === 1 ? "" : "s"} (draft).`,
      warnings: parsed.warnings,
      ...result,
    };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
