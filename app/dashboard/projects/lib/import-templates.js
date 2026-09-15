 /**
 * The spreadsheets the import dialogs hand out.
 *
 * ONE MODULE, because the last arrangement was two hand-typed constants in two
 * components and they drifted: `ImportBoq` carried a copy of the PROGRAMME
 * template — right columns described in the dialog, wrong columns in the file,
 * and it downloaded as `programme-template.csv` from the bill importer. Anybody
 * who trusted the template got an import that dropped every priced row.
 *
 * So the columns live beside the rules that read them, and each template is
 * written to demonstrate the things the parser does that nobody would guess:
 * a blank section carrying forward, and a narrative line surviving.
 *
 * Both parsers match headers CASE-INSENSITIVELY and accept aliases, and both
 * fall back to column POSITION when a sheet has no header row at all. The
 * headers below are the canonical spelling, not the only one accepted — a bill
 * exported from Candy with "Qty" and "Unit Rate" imports unchanged.
 */

/** Turn rows into a CSV, quoting only what needs it. */
function csv(rows) {
  return (
    rows
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell ?? "");
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(","),
      )
      .join("\n") + "\n"
  );
}

export function templateHref(content) {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(content)}`;
}

/**
 * A priced bill of quantities.
 *
 * Read by `app/db/actions/boq-import-actions.js`. Columns:
 *   Section | Item code | Description | Unit | Quantity | Rate
 *
 * The two rows that teach something:
 *   - "Rates to include for all necessary fixings" has no unit and no quantity,
 *     so it lands as a NARRATIVE heading rather than being dropped. Printed
 *     bills are full of these.
 *   - The rows after the first "Earthworks" leave Section blank, which carries
 *     the previous section forward the way a printed bill does.
 */
export const BOQ_TEMPLATE = csv([
  ["Section", "Item code", "Description", "Unit", "Quantity", "Rate"],
  ["Preliminaries", "A/1", "Site establishment and mobilisation", "Sum", "1", "1500000"],
  ["Preliminaries", "A/2", "Insurance and performance bond", "Sum", "1", "450000"],
  ["Earthworks", "B/1", "Clear and grub, including disposal", "m2", "12500", "180"],
  ["", "B/2", "Cut to fill, compacted in 200mm layers", "m3", "8400", "620"],
  ["", "", "Rates to include for all necessary fixings", "", "", ""],
  ["", "B/3", "Imported gravel subbase, 150mm", "m3", "2100", "2450"],
  ["Drainage", "C/1", "600mm dia concrete culvert, laid and jointed", "m", "480", "8900"],
  ["Drainage", "C/2", "Headwalls, class 20 concrete", "No", "24", "42000"],
]);

export const BOQ_TEMPLATE_NAME = "bill-of-quantities-template.csv";

/**
 * A programme of works, which becomes the project's WBS.
 *
 * Read by `app/db/actions/programme-actions.js`. Columns:
 *   Section | Activity | Start | End | %
 *
 * DATES ARE YYYY-MM-DD. A blank section carries the previous one forward here
 * too, and `%` is progress to date — leave it empty on a programme for work
 * that has not started.
 */
export const PROGRAMME_TEMPLATE = csv([
  ["Section", "Activity", "Start", "End", "%"],
  ["Mobilisation", "Site establishment", "2026-04-01", "2026-04-20", "100"],
  ["Earthworks", "Clearance — Front 1", "2026-04-15", "2026-05-31", "100"],
  ["", "Earthworks — Front 1", "2026-05-01", "2026-09-30", "60"],
  ["", "Earthworks — Front 2", "2026-06-01", "2026-10-31", "20"],
  ["Drainage", "Culverts 2500LM", "2026-06-01", "2026-11-30", "20"],
  ["Drainage", "Lined side drains", "2026-08-01", "2027-01-31", ""],
  ["Pavement", "Subbase and base", "2026-10-01", "2027-03-31", ""],
]);

export const PROGRAMME_TEMPLATE_NAME = "programme-template.csv";

/**
 * The rules each dialog states on screen.
 *
 * Written here rather than in the components because they are facts about the
 * PARSER, and the parser is what changes.
 */
export const BOQ_RULES = [
  "A blank Section repeats the one above it, as a printed bill does.",
  "A row with a description but no unit or quantity becomes a narrative heading.",
  "Header names are matched loosely — Qty, Unit Rate, Item No. and Particulars all work.",
  "An awarded bill has frozen rates. Start a new version before importing over it.",
];

export const PROGRAMME_RULES = [
  "Dates are YYYY-MM-DD.",
  "A blank Section repeats the one above it.",
  "% is progress to date. Leave it empty for work that has not started.",
  "Header names are matched loosely — Task, Phase, From and Finish all work.",
];
