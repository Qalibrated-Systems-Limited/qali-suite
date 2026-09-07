/**
 * The templates the import dialogs hand out must parse.
 *
 * This exists because they did not. `ImportBoq` carried a copy of the
 * PROGRAMME template: the dialog named the bill's columns — Section, Item
 * code, Description, Unit, Quantity, Rate — and the download served
 * `Section,Activity,Start,End,%` under the filename `programme-template.csv`.
 * Anybody who took the offered template at its word imported a file with no
 * units, no quantities and no rates, and got a bill of narrative headings.
 *
 * Nothing could have caught it: both importers are `"use server"` modules, so
 * their column matching could not be exported and could not be compared with
 * what the dialog was giving out. The matcher now lives in
 * `lib/project-import-columns.js` and this asserts the two against each other.
 *
 * No database. This is a parser contract, not a query.
 */
import { describe, it, expect } from "vitest";

import {
  BOQ_TEMPLATE,
  BOQ_TEMPLATE_NAME,
  PROGRAMME_TEMPLATE,
  PROGRAMME_TEMPLATE_NAME,
} from "@/app/dashboard/projects/lib/import-templates";
import {
  mapBoqColumns,
  mapProgrammeColumns,
  BOQ_ALIASES,
  PROGRAMME_ALIASES,
} from "@/lib/project-import-columns";

/**
 * The importers read a sheet; here the sheet is the CSV we hand out.
 *
 * Quotes are honoured, because a bill's descriptions are full of commas —
 * "Cut to fill, compacted in 200mm layers" — and a naive split shifts every
 * column after it, which reads as a broken template rather than a broken test.
 */
const rows = (csv) =>
  csv
    .trim()
    .split("\n")
    .map((line) => {
      const out = [];
      let cell = "";
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
          else if (ch === '"') quoted = false;
          else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ",") { out.push(cell); cell = ""; }
        else cell += ch;
      }
      out.push(cell);
      return out;
    });

describe("the bill of quantities template", () => {
  const sheet = rows(BOQ_TEMPLATE);
  const { idx, looksLikeHeader } = mapBoqColumns(sheet[0]);

  it("is recognised as having a header at all", () => {
    // False here means row one is treated as DATA and the first item is lost
    // into the positional fallback.
    expect(looksLikeHeader).toBe(true);
  });

  it("maps every column the importer looks for", () => {
    for (const field of Object.keys(BOQ_ALIASES)) {
      expect(idx[field], `column "${field}" is not in the template`).toBeGreaterThanOrEqual(0);
    }
  });

  it("does not map two fields onto one column", () => {
    // "Description" matches the `item` alias and "Item code" matches `code`;
    // if either drifted, one column would answer for two fields and the bill
    // would import with the code as its description.
    const used = Object.values(idx);
    expect(new Set(used).size).toBe(used.length);
  });

  it("carries priced rows the importer will accept", () => {
    // Priced means a quantity AND a unit — `project_boq_items_quantity_needs_unit`
    // refuses anything else, so a template of bare descriptions would import
    // as headings and measure nothing.
    const priced = sheet
      .slice(1)
      .filter((r) => r[idx.unit]?.trim() && Number(r[idx.quantity]) >= 0 && r[idx.quantity]?.trim());
    expect(priced.length).toBeGreaterThanOrEqual(5);
  });

  it("demonstrates a narrative line, which is a real bill's shape", () => {
    const narrative = sheet
      .slice(1)
      .filter((r) => r[idx.description]?.trim() && !r[idx.unit]?.trim());
    expect(narrative.length).toBeGreaterThanOrEqual(1);
  });

  it("demonstrates a blank section carrying forward", () => {
    const blankSection = sheet
      .slice(1)
      .filter((r) => !r[idx.section]?.trim() && r[idx.description]?.trim());
    expect(blankSection.length).toBeGreaterThanOrEqual(1);
  });

  it("is not named after the other importer", () => {
    // The literal bug: a bill template downloading as programme-template.csv.
    expect(BOQ_TEMPLATE_NAME).not.toMatch(/programme/i);
    expect(BOQ_TEMPLATE_NAME).toMatch(/\.csv$/);
  });

  it("is not the programme template wearing a different name", () => {
    expect(BOQ_TEMPLATE).not.toBe(PROGRAMME_TEMPLATE);
    expect(sheet[0].join(",").toLowerCase()).not.toContain("activity");
  });
});

describe("the programme template", () => {
  const sheet = rows(PROGRAMME_TEMPLATE);
  const { idx, looksLikeHeader } = mapProgrammeColumns(sheet[0]);

  it("is recognised as having a header at all", () => {
    expect(looksLikeHeader).toBe(true);
  });

  it("maps every column the importer looks for", () => {
    for (const field of Object.keys(PROGRAMME_ALIASES)) {
      expect(idx[field], `column "${field}" is not in the template`).toBeGreaterThanOrEqual(0);
    }
  });

  it("does not map two fields onto one column", () => {
    const used = Object.values(idx);
    expect(new Set(used).size).toBe(used.length);
  });

  it("writes its dates the way the importer reads them", () => {
    for (const row of sheet.slice(1)) {
      for (const key of ["start", "end"]) {
        const value = row[idx[key]]?.trim();
        if (!value) continue;
        expect(value, `${key} is not YYYY-MM-DD`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(value))).toBe(false);
      }
    }
  });

  it("ends every activity on or after it starts", () => {
    for (const row of sheet.slice(1)) {
      const start = row[idx.start]?.trim();
      const end = row[idx.end]?.trim();
      if (!start || !end) continue;
      expect(Date.parse(end)).toBeGreaterThanOrEqual(Date.parse(start));
    }
  });

  it("keeps progress a percentage", () => {
    for (const row of sheet.slice(1)) {
      const pct = row[idx.percent]?.trim();
      if (!pct) continue;
      expect(Number(pct)).toBeGreaterThanOrEqual(0);
      expect(Number(pct)).toBeLessThanOrEqual(100);
    }
  });

  it("keeps its own name", () => {
    expect(PROGRAMME_TEMPLATE_NAME).toMatch(/programme/i);
  });
});

describe("the aliases a real export will arrive with", () => {
  it("reads a Candy-style bill header", () => {
    // "Qty" and "Unit Rate" rather than Quantity and Rate. Nobody should have
    // to edit a spreadsheet before it will import.
    const { idx, looksLikeHeader } = mapBoqColumns([
      "Bill", "Item No.", "Particulars", "Unit", "Qty", "Unit Rate",
    ]);
    expect(looksLikeHeader).toBe(true);
    for (const field of Object.keys(BOQ_ALIASES)) {
      expect(idx[field]).toBeGreaterThanOrEqual(0);
    }
  });

  it("reads an MS Project-style programme header", () => {
    const { idx, looksLikeHeader } = mapProgrammeColumns([
      "Phase", "Task Name", "Start", "Finish", "% Complete",
    ]);
    expect(looksLikeHeader).toBe(true);
    for (const field of Object.keys(PROGRAMME_ALIASES)) {
      expect(idx[field]).toBeGreaterThanOrEqual(0);
    }
  });
});
