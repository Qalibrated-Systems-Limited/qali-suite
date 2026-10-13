import ExcelJS from "exceljs";

/**
 * Build the standard budget-upload template (as a Buffer) the importer reads
 * back: an Instructions sheet and a Budget sheet with the expected header and a
 * couple of worked sample lines. One row per budget line.
 */
export async function buildBudgetTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QaliSuite";
  wb.created = new Date();

  const HEADERS = [
    "Cost Code",
    "Name",
    "Description",
    "Category",
    "Account",
    "Amount (KShs)",
  ];

  // ── Instructions ──────────────────────────────────────────────
  const ins = wb.addWorksheet("Instructions");
  ins.columns = [{ width: 104 }];
  [
    "PROJECT BUDGET — STANDARD TEMPLATE",
    "",
    "Fill in the Budget sheet, then upload it on the project's Budget screen. Each row is one budget line.",
    "",
    "Columns (keep the header row exactly as it is):",
    "  • Cost Code  — the code this line budgets, e.g. LAB-01. Required. A code you already use is reused;",
    "                 a new code is created automatically against the account named beside it.",
    "  • Name       — a label for a NEW cost code, e.g. 'Labour — site'. Optional (defaults to the description).",
    "  • Description— what the line is for. Optional.",
    "  • Category   — Materials, Labour, Plant hire, Plant purchase, Transport, Subcontract, Bonds and insurance,",
    "                 Bank and finance, Statutory and permits, Preliminaries, Overhead. Optional (defaults to Materials).",
    "  • Account    — the GL expense account the code charges: an account CODE or NAME from the chart. Optional —",
    "                 left blank, the line uses the project's default cost account (set one on the Budget screen first).",
    "  • Amount     — the budgeted figure in KShs. Required, a positive number.",
    "",
    "Notes:",
    "  • Two rows with the same Cost Code are added together — one account shows the full spend in budget-vs-actual.",
    "  • The budget is created as a DRAFT. Finance approves it on the Budget screen.",
  ].forEach((t) => {
    const r = ins.addRow([t]);
    if (t.endsWith("TEMPLATE")) r.font = { bold: true, size: 14 };
  });

  // ── Budget ────────────────────────────────────────────────────
  const ws = wb.addWorksheet("Budget");
  ws.columns = [
    { width: 14 },
    { width: 26 },
    { width: 40 },
    { width: 18 },
    { width: 24 },
    { width: 16 },
  ];
  const head = ws.addRow(HEADERS);
  head.font = { bold: true };
  head.eachCell((c) => {
    c.border = { bottom: { style: "thin" } };
  });
  [
    ["LAB-01", "Labour — site", "Masons and general labour", "Labour", "6200 Wages", 1200000],
    ["MAT-01", "Cement and aggregates", "Cement, sand, ballast", "Materials", "5000 Materials", 3400000],
    ["PLT-01", "Plant hire", "Excavator and roller hire", "Plant hire", "", 850000],
  ].forEach((r) => ws.addRow(r));

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
