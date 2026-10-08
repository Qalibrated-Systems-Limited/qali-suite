"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { parseBoqWorkbook, parseBoqCsv } from "@/lib/boq/parse-boq-excel";
import { PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";

const MANAGE = PROJECT_MANAGE_ROLES as unknown as string[];

const segs = (code: string | null | undefined) =>
  code ? code.split(".").length : 0;

/** Is `prefix` an ancestor code of `code` ("1.1" of "1.1.1")? */
function isPrefix(prefix: string | null, code: string | null): boolean {
  if (!prefix || !code) return false;
  return code === prefix || code.startsWith(prefix + ".");
}

/**
 * Import a BOQ workbook (the QSL/Kopondo multi-bill Excel) into one new draft
 * project BOQ. Each sheet "Bill N - …" becomes a top-level heading; its section
 * rows become sub-headings and its priced rows become items, nested by their
 * dotted item numbers. Verified against the Kopondo file: the per-bill totals
 * reproduce the Grand Summary exactly.
 *
 * Deliberately written against the raw `project_boqs` / `project_boq_items`
 * tables rather than the projects repository: the importer must not break when
 * a helper's signature drifts, and every column it touches is one the BOQ
 * screen already renders. The `path` ltree column is owned by a trigger and is
 * never written here; `amount` is a generated column.
 */
export async function importBoqFile(projectId: string, formData: FormData) {
  if (!projectId) return { error: "No project." };
  const file = formData.get("file");
  if (!file || typeof file === "string") return { error: "No file uploaded." };
  if (file.size > 15 * 1024 * 1024) return { error: "File too large (max 15MB)." };

  let parsed;
  try {
    const name = (file.name || "").toLowerCase();
    const isCsv = name.endsWith(".csv") || file.type === "text/csv";
    if (isCsv) {
      const text = Buffer.from(await file.arrayBuffer()).toString("utf8");
      parsed = parseBoqCsv(text);
    } else {
      const buf = Buffer.from(await file.arrayBuffer());
      parsed = await parseBoqWorkbook(buf);
    }
  } catch {
    return { error: "Could not read that file. Use the standard template." };
  }
  if (!parsed.bills.length) {
    return {
      error:
        "No bills found. Each bill must be on its own sheet named 'Bill 1 - …' with an 'Item No. / Description / Unit / Quantity / Rate' header.",
    };
  }

  try {
    const result = await withAuthorizedTenant(MANAGE, async (tx, { user, companyId }) => {
      const actorId = user?.id ?? null;
      const actorName = user?.name ?? "System";

      // Header — next version for this project, draft by default.
      const boqRows = await tx.execute(sql`
        INSERT INTO project_boqs
          (company_id, project_id, version, currency, notes, created_by_id, created_by_name)
        VALUES (
          ${companyId}::uuid,
          ${projectId}::uuid,
          (SELECT COALESCE(MAX(version), 0) + 1 FROM project_boqs WHERE project_id = ${projectId}::uuid),
          'KES',
          ${`Imported from ${file.name}`},
          ${actorId},
          ${actorName}
        )
        RETURNING id
      `);
      const boqId = (boqRows as any)[0].id as string;

      if (parsed.contingencyPercent) {
        await tx.execute(sql`
          UPDATE project_boqs
             SET contingency_percent = ${String(parsed.contingencyPercent)}::numeric
           WHERE id = ${boqId}::uuid
        `);
      }

      // Insert one item and return its id. The `path` ltree is trigger-owned;
      // `amount` is generated — neither is written here.
      async function insertItem(opts: {
        parentItemId: string | null;
        itemCode: string | null;
        description: string;
        isHeading: boolean;
        unit: string | null;
        quantity: string | null;
        rate: string | null;
        sortOrder: number;
      }): Promise<string> {
        const rows = await tx.execute(sql`
          INSERT INTO project_boq_items
            (company_id, boq_id, project_id, parent_item_id, item_code,
             description, is_heading, unit, quantity, rate, sort_order,
             created_by_id, created_by_name)
          VALUES (
            ${companyId}::uuid,
            ${boqId}::uuid,
            ${projectId}::uuid,
            ${opts.parentItemId}::uuid,
            ${opts.itemCode},
            ${opts.description},
            ${opts.isHeading},
            ${opts.unit},
            ${opts.quantity}::numeric,
            ${opts.rate}::numeric,
            ${opts.sortOrder},
            ${actorId},
            ${actorName}
          )
          RETURNING id
        `);
        return (rows as any)[0].id as string;
      }

      // Codes must be unique within a BOQ — null a duplicate rather than fail.
      const seenCodes = new Set<string>();
      const uniqueCode = (code: string | null) => {
        if (!code) return null;
        if (seenCodes.has(code)) return null;
        seenCodes.add(code);
        return code;
      };

      let sort = 0;
      let pricedItems = 0;
      let headings = 0;

      for (const bill of parsed.bills) {
        const billId = await insertItem({
          parentItemId: null,
          itemCode: uniqueCode(bill.code),
          description: bill.title,
          isHeading: true,
          unit: null,
          quantity: null,
          rate: null,
          sortOrder: sort++,
        });
        headings++;

        // Prefix stack — a row nests under the deepest heading whose code is an
        // ancestor of its own; otherwise under the bill.
        const stack: Array<{ code: string | null; id: string }> = [
          { code: null, id: billId },
        ];

        for (const row of bill.items) {
          const heading =
            !row.quantity &&
            !row.rate &&
            (!row.itemCode || segs(row.itemCode) <= 2 || /\.0$/.test(row.itemCode));

          while (
            stack.length > 1 &&
            !isPrefix(stack[stack.length - 1].code, row.itemCode)
          ) {
            stack.pop();
          }
          const parentId = stack[stack.length - 1].id;

          const nodeId = await insertItem({
            parentItemId: parentId,
            itemCode: uniqueCode(row.itemCode),
            description: row.description,
            isHeading: heading,
            unit: heading ? null : row.unit,
            quantity: heading ? null : row.quantity,
            rate: heading ? null : row.rate,
            sortOrder: sort++,
          });

          if (heading) {
            headings++;
            stack.push({ code: row.itemCode, id: nodeId });
          } else if (row.rate) {
            pricedItems++;
          }
        }
      }

      return { boqId, bills: parsed.bills.length, headings, pricedItems };
    });

    revalidatePath("/dashboard/projects/boq");
    return {
      success: true,
      message: `Imported ${result.bills} bill${result.bills === 1 ? "" : "s"} and ${result.pricedItems} priced items.`,
      ...result,
    };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
