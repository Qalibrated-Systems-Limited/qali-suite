/**
 * Reading a spreadsheet somebody actually has.
 *
 * A programme lives in MS Project or Excel and a bill of quantities lives in
 * Excel; neither is going to be re-typed into a web form, and a module whose
 * tasks and bill are both empty is a module nobody uses. These are the readers
 * behind both imports.
 *
 * Extracted from `programme-actions.js` unchanged — a `"use server"` file can
 * only export async functions, so its helpers could not be shared from where
 * they were. Behaviour is identical by construction: the code was moved, not
 * rewritten.
 */

/** A CSV line, respecting quotes and doubled quotes inside them. */
export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * The rows of a .csv/.txt or .xlsx, as arrays of cell values.
 *
 * exceljs is already a dependency; the `default ?? mod` dance is CJS interop.
 */
export async function rowsFromFile(file) {
  const name = (file.name || "").toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = buffer.toString("utf8").replace(/\r\n?/g, "\n");
    return text.split("\n").filter((l) => l.trim() !== "").map(splitCsvLine);
  }

  // xlsx via the already-installed exceljs (CJS interop-safe)
  const mod = await import("exceljs");
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow((row) => {
    const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(vals.map((c) => (c && typeof c === "object" && "text" in c ? c.text : c)));
  });
  return rows;
}
