import ExcelJS from "exceljs";

/**
 * Build the standard BOQ template workbook (as a Buffer) that the importer
 * reads back: a Grand Summary, one sheet per bill with the expected header row,
 * and an Instructions sheet. The same layout as the QSL/Kopondo bills, so an
 * existing bill can be pasted straight in.
 */
export async function buildBoqTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QaliSuite";
  wb.created = new Date();

  const BILL_HEADERS = [
    "Item No.",
    "Description",
    "Unit",
    "Quantity",
    "Rate (KShs)",
    "Amount (KShs)",
  ];

  // ── Instructions ──────────────────────────────────────────────
  const ins = wb.addWorksheet("Instructions");
  ins.columns = [{ width: 100 }];
  [
    "BILL OF QUANTITIES — STANDARD TEMPLATE",
    "",
    "How to fill this in, then upload it on the project's Bill of Quantities screen:",
    "",
    "1. One sheet per bill. Name each sheet 'Bill 1 - <title>', 'Bill 2 - <title>', and so on.",
    "2. Keep the header row on each bill sheet exactly: Item No. | Description | Unit | Quantity | Rate (KShs) | Amount (KShs).",
    "3. Section headings: put the section title in the Item No. column and leave Unit/Quantity/Rate blank.",
    "4. Items: put the item number (e.g. 1.1.1) in Item No., the description, the unit (m, m2, m3, kg, No, Item…),",
    "   the quantity and the rate. Amount is Quantity × Rate — the Amount column is optional; it is recomputed.",
    "5. Lump sums: put the lump figure in Rate and leave Quantity blank (it is billed as one).",
    "6. The Grand Summary sheet is optional; the contingency % is read from its 'Add X% Contingencies' row.",
    "",
    "The importer reproduces each bill's total from Quantity × Rate, so check the totals match before uploading.",
  ].forEach((t) => {
    const r = ins.addRow([t]);
    if (t.endsWith("TEMPLATE")) r.font = { bold: true, size: 14 };
  });

  // ── Grand Summary ─────────────────────────────────────────────
  const gs = wb.addWorksheet("Grand Summary");
  gs.columns = [{ width: 16 }, { width: 50 }, { width: 18 }];
  gs.addRow(["GRAND SUMMARY"]).font = { bold: true, size: 13 };
  gs.addRow([]);
  const gh = gs.addRow(["ITEM", "DESCRIPTION", "AMOUNT (KShs)"]);
  gh.font = { bold: true };
  gs.addRow(["Bill No. 1", "Preliminaries and General", null]);
  gs.addRow(["Bill No. 2", "<bill 2 title>", null]);
  gs.addRow([]);
  gs.addRow(["", "Total", null]);
  gs.addRow(["", "Add 5% Contingencies", null]);
  gs.addRow(["", "GRAND TOTAL", null]);

  // ── Bill sheets (two samples) ─────────────────────────────────
  const makeBill = (name, rows) => {
    const ws = wb.addWorksheet(name);
    ws.columns = [
      { width: 12 },
      { width: 52 },
      { width: 10 },
      { width: 12 },
      { width: 14 },
      { width: 16 },
    ];
    const title = ws.addRow([name.toUpperCase()]);
    title.font = { bold: true, size: 12 };
    ws.addRow([]);
    const head = ws.addRow(BILL_HEADERS);
    head.font = { bold: true };
    head.eachCell((c) => {
      c.border = { bottom: { style: "thin" } };
    });
    rows.forEach((r) => {
      const row = ws.addRow(r);
      // Amount = Quantity × Rate when both present.
      const n = row.number;
      row.getCell(6).value = { formula: `IF(AND(D${n}<>"",E${n}<>""),D${n}*E${n},"")` };
    });
  };

  makeBill("Bill 1 - Preliminaries", [
    ["1.1 INSURANCE", "", "", "", "", ""],
    ["1.1.1", "All risks insurance for the works", "Item", 1, 68000, ""],
    ["1.1.2", "Erection and maintenance of a project sign", "No", 1, 20000, ""],
    ["1.2 ATTENDANCE", "", "", "", "", ""],
    ["1.2.1", "Provide a provisional sum for the Resident Engineer", "Months", 6, 50000, ""],
  ]);
  makeBill("Bill 2 - Main Works", [
    ["2.1 SITE CLEARANCE", "", "", "", "", ""],
    ["2.1.1", "General clearance", "M2", 270, 50, ""],
    ["2.2 EARTHWORKS", "", "", "", "", ""],
    ["2.2.1", "Excavate in soft material", "M3", 9, 200, ""],
  ]);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
