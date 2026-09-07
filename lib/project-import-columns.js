/**
 * The column vocabulary the bill and programme importers read.
 *
 * WHY THIS IS NOT IN THE ACTION FILES. Both importers are `"use server"`
 * modules, and Next requires every export from one to be an async function —
 * so `mapColumns` could not be exported, could not be tested, and the template
 * the dialog hands out could not be checked against it. That is not a
 * hypothetical: `ImportBoq` shipped the PROGRAMME template, describing the
 * bill's columns in the dialog while downloading the programme's, and nothing
 * could have caught it.
 *
 * The templates in `app/dashboard/projects/lib/import-templates.js` are now
 * asserted against these aliases in `tests/project-import-templates.test.mjs`,
 * so a column renamed here without the template following fails a test rather
 * than a user's import.
 *
 * MATCHING IS DELIBERATELY LOOSE — case-insensitive, and a header matches if it
 * CONTAINS the alias. A bill exported from Candy says "Qty" and "Unit Rate"; a
 * programme out of MS Project says "Task Name" and "Finish". Neither should
 * need editing before it will import.
 */

/** A bill of quantities — `boq-import-actions.js`. */
export const BOQ_ALIASES = Object.freeze({
  section: ["section", "bill", "phase", "group"],
  code: ["item code", "code", "ref", "item no", "no."],
  description: ["description", "item", "particulars", "activity"],
  unit: ["unit", "uom"],
  quantity: ["quantity", "qty"],
  rate: ["rate", "price", "unit rate"],
});

/** A programme of works — `programme-actions.js`. */
export const PROGRAMME_ALIASES = Object.freeze({
  section: ["section", "phase", "group"],
  activity: ["activity", "task", "description", "item"],
  start: ["start", "from"],
  end: ["end", "finish", "to"],
  percent: ["percent", "%", "progress", "complete"],
});

/** Positional fallback, for a sheet with no header row at all. */
export const BOQ_POSITIONAL = Object.freeze({
  section: 0,
  code: 1,
  description: 2,
  unit: 3,
  quantity: 4,
  rate: 5,
});

/**
 * Where each field sits in this header row, or -1.
 *
 * `looksLikeHeader` decides whether row one is a header at all, and the two
 * importers answer it differently on purpose:
 *
 *   BOQ       — needs a description AND either a rate or a quantity. A bill
 *               whose first row is data would otherwise lose its first item.
 *   Programme — a section or an activity is enough, because a programme has
 *               no numeric column that must be present.
 */
export function matchColumns(headerRow, aliases) {
  const lower = (headerRow ?? []).map((c) =>
    String(c ?? "").toLowerCase().trim(),
  );

  /**
   * EXACT MATCHES FIRST, AND NO COLUMN ANSWERS TWICE.
   *
   * A single loose pass got the canonical header wrong — the one the import
   * dialog itself tells people to use:
   *
   *     Section | Item code | Description | Unit | Quantity | Rate
   *
   * `description`'s aliases include "item", and "item code" CONTAINS "item"
   * and comes first, so Description resolved to the Item code column. Every
   * row imported with its code as its description, and a row with a blank
   * code was dropped for having no description at all. A bill that looked
   * exactly like the template produced a bill of nonsense.
   *
   * Two passes fix it without narrowing what a real export may be called:
   * an exact header name wins its column outright, and the forgiving
   * substring pass then fills what is left from the columns nobody claimed.
   */
  const idx = {};
  const claimed = new Set();

  for (const [field, names] of Object.entries(aliases)) {
    const at = lower.findIndex((h, i) => !claimed.has(i) && names.includes(h));
    idx[field] = at;
    if (at !== -1) claimed.add(at);
  }

  for (const [field, names] of Object.entries(aliases)) {
    if (idx[field] !== -1) continue;
    const at = lower.findIndex(
      (h, i) => !claimed.has(i) && h && names.some((n) => h.includes(n)),
    );
    idx[field] = at;
    if (at !== -1) claimed.add(at);
  }

  return idx;
}

export function mapBoqColumns(headerRow) {
  const idx = matchColumns(headerRow, BOQ_ALIASES);
  const looksLikeHeader =
    idx.description !== -1 && (idx.rate !== -1 || idx.quantity !== -1);
  return { idx, looksLikeHeader };
}

export function mapProgrammeColumns(headerRow) {
  const idx = matchColumns(headerRow, PROGRAMME_ALIASES);
  const looksLikeHeader = idx.section !== -1 || idx.activity !== -1;
  return { idx, looksLikeHeader };
}
