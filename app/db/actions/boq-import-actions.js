"use server";

import { revalidatePath } from "next/cache";
import { mapBoqColumns, BOQ_POSITIONAL } from "@/lib/project-import-columns";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";
import { rowsFromFile } from "@/lib/spreadsheet";
import * as repo from "../repositories/projects";

/**
 * Bill of quantities import.
 *
 * A priced bill arrives as a spreadsheet — from the client, the QS, or Candy —
 * and a three-hundred-line bill is not going to be typed into a web form. That
 * matters more than convenience: the bill is what measured progress, earned
 * value and every certificate are computed from, so a module where entering one
 * is a day's typing is a module where nobody has one, and the whole measured
 * half sits unused.
 *
 * The same shape as the programme import, deliberately, so the two feel like
 * one feature: same readers, same forgiving header matching, same "a blank
 * carries the previous one forward".
 *
 * Columns (header row optional; matched case-insensitively, else positional):
 *   Section | Item code | Description | Unit | Quantity | Rate
 *
 * A row with a description and no quantity is a NARRATIVE line — printed bills
 * are full of them ("Rates to include for all fixings") — and lands as an
 * unpriced heading rather than being dropped.
 */

const MAX_ROWS = 5000;

function toDecimal(v) {
  if (v == null || v === "") return null;
  // Strip thousands separators and any currency symbol; a bill exported from
  // Excel routinely carries both.
  const n = Number(String(v).replace(/[^0-9.\-]/g, "").trim());
  return Number.isFinite(n) ? n.toFixed(4) : null;
}

function text(v) {
  return v == null ? "" : String(v).trim();
}

// The column vocabulary lives in `lib/project-import-columns.js`, because a
// "use server" module can export nothing but async functions — so it could not
// be tested here, and the template the dialog hands out could not be checked
// against it. It shipped the wrong template for exactly that long.

export async function importBoqFile(projectId, formData) {
  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) {
    return { error: "Choose a .csv or .xlsx file" };
  }

  let rows;
  try {
    rows = await rowsFromFile(file);
  } catch {
    return { error: "Could not read that file — is it a valid .csv or .xlsx?" };
  }
  if (!rows.length) return { error: "That file has no rows in it" };
  if (rows.length > MAX_ROWS) {
    return { error: `That file has ${rows.length} rows; the limit is ${MAX_ROWS}.` };
  }

  const { idx: headerIdx, looksLikeHeader } = mapBoqColumns(rows[0] ?? []);
  const idx = looksLikeHeader ? headerIdx : BOQ_POSITIONAL;
  const body = looksLikeHeader ? rows.slice(1) : rows;
  const at = (row, key) => (idx[key] >= 0 ? row[idx[key]] : undefined);

  try {
    const result = await withAuthorizedTenant(
      PROJECT_MANAGE_ROLES,
      async (tx, { user, companyId }) => {
        const project = await repo.getProjectById(tx, projectId);
        if (!project) throw new Error("Project not found");

        /**
         * Into a DRAFT bill, and only a draft.
         *
         * An awarded bill's rates are frozen — that is what makes a final
         * account answerable — so importing into one is refused rather than
         * silently creating a second bill nobody asked for. A project with no
         * bill at all gets one.
         */
        let boq = await repo.getEffectiveBoq(tx, projectId);
        if (boq && boq.status !== "draft") {
          throw new Error(
            `Bill v${boq.version} is ${boq.status} and its rates are frozen. Start a new version before importing.`,
          );
        }
        if (!boq) {
          boq = await repo.createBoq(tx, {
            companyId,
            projectId,
            createdById: user.id ?? null,
            createdByName: user.name || "Import",
          });
        }

        const actor = {
          createdById: user.id ?? null,
          createdByName: user.name || "Import",
        };

        let currentSection = null;
        let sectionName = "";
        let sortOrder = 0;
        let sections = 0;
        let items = 0;
        let skipped = 0;

        for (const row of body) {
          if (!Array.isArray(row)) continue;
          const description = text(at(row, "description"));
          const rawSection = text(at(row, "section"));

          // A blank section carries the previous one forward, the way a printed
          // bill writes the heading once and not on every line.
          if (rawSection && rawSection !== sectionName) {
            sectionName = rawSection;
            currentSection = await repo.createBoqItem(tx, {
              companyId,
              boqId: boq.id,
              projectId,
              description: rawSection,
              isHeading: true,
              sortOrder: (sortOrder += 10),
              ...actor,
            });
            sections++;
          }

          if (!description) {
            if (!rawSection) skipped++;
            continue;
          }

          const quantity = toDecimal(at(row, "quantity"));
          const rate = toDecimal(at(row, "rate"));
          const unit = text(at(row, "unit")) || null;

          // Priced only where the row actually carries a quantity AND a unit —
          // `project_boq_items_quantity_needs_unit` refuses the rest, and a
          // narrative line is a legitimate row rather than an error.
          const priced = quantity !== null && Number(quantity) >= 0 && !!unit;

          await repo.createBoqItem(tx, {
            companyId,
            boqId: boq.id,
            projectId,
            parentItemId: currentSection?.id ?? null,
            itemCode: text(at(row, "code")) || null,
            description,
            isHeading: !priced,
            unit: priced ? unit : null,
            quantity: priced ? quantity : null,
            rate: priced && rate !== null ? rate : null,
            sortOrder: (sortOrder += 10),
            ...actor,
          });
          items++;
        }

        if (items === 0 && sections === 0) {
          throw new Error(
            "Nothing recognisable in that file. Expected columns: Section, Item code, Description, Unit, Quantity, Rate.",
          );
        }
        return { boqId: boq.id, sections, items, skipped };
      },
    );

    revalidatePath("/dashboard/projects/boq");
    revalidatePath(`/dashboard/projects/${projectId}`);
    return {
      success: true,
      message: `Imported ${result.items} item${result.items === 1 ? "" : "s"} in ${result.sections} section${result.sections === 1 ? "" : "s"}`,
      ...result,
    };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
