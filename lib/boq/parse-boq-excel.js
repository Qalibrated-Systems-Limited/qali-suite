import ExcelJS from "exceljs";

/**
 * Parse a BOQ into a normalised structure the importer turns into one project
 * BOQ. Two shapes are accepted:
 *
 *   • MULTI-BILL workbook (QSL/Kopondo): a "Grand Summary" sheet (optional, the
 *     contingency % is read from it) and one sheet per bill named "Bill N - …".
 *   • SINGLE sheet / CSV: columns Item No. | Description | Unit | Quantity |
 *     Rate [| Amount]. Treated as one bill.
 *
 * Returns { bills: [{ code, title, items: [NormItem] }], contingencyPercent }.
 * NormItem = { itemCode, description, isHeading, unit, quantity, rate } with
 * quantity/rate coerced for the database (a lump sum becomes quantity "1").
 */

const isNum = (v) =>
  v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));

function cellText(cell) {
  if (cell == null) return "";
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.result != null) return String(v.result);
    if (v.text != null) return String(v.text);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    return "";
  }
  return String(v);
}

function worksheetRows(ws, n = 8) {
  const rows = [];
  ws.eachRow((row) => {
    const cells = [];
    for (let c = 1; c <= n; c++) cells.push(cellText(row.getCell(c)).trim());
    rows.push(cells);
  });
  return rows;
}

const leadingCode = (s) => (/^(\d+(?:\.\d+)+)/.exec((s || "").trim()) || [])[1] || null;
const headingCode = (s) => (/^(\d+(?:\.\d+)*)/.exec((s || "").trim()) || [])[1] || null;

/** One data row → an item/heading, or null to skip (empty or a total line). */
function rowToItem(cells) {
  const [a, b, c, d, e, f] = cells.map((x) => (x || "").trim());
  const joined = cells.join(" ").trim();
  if (!joined) return null;

  if (
    /^(sub-?\s*total|total|grand|carried|collection|to\s+collection|amount\s+carried)/i.test(a) ||
    /^(sub-?\s*total|total|grand\s+total)/i.test(b)
  ) {
    return null;
  }

  const code = leadingCode(a);
  const qtyNum = isNum(d);
  const rateNum = isNum(e);
  const amtNum = isNum(f);
  const descB = b;

  if (qtyNum || rateNum) {
    let unit = c || null;
    let quantity = qtyNum ? String(Number(d)) : null;
    const rate = rateNum ? String(Number(e)) : null;
    if (rate && !quantity) quantity = "1";
    if (quantity && !unit) unit = "Item";
    return {
      itemCode: code || null,
      description: descB || a,
      isHeading: false,
      unit: quantity ? unit : null,
      quantity,
      rate,
    };
  }

  if (amtNum && (code || descB)) {
    return {
      itemCode: code || null,
      description: descB || a,
      isHeading: false,
      unit: c || "Item",
      quantity: "1",
      rate: String(Number(f)),
    };
  }

  if (descB) {
    return { itemCode: code || null, description: descB, isHeading: false, unit: null, quantity: null, rate: null };
  }

  if (a) {
    return { itemCode: headingCode(a), description: a, isHeading: true, unit: null, quantity: null, rate: null };
  }
  return null;
}

/** Collect items from an array of cell-rows. Skips everything up to and
 *  including the header row; if no header is found and `assumeHeader`, the
 *  first non-empty row is treated as the header. */
function collectItems(rows, { assumeHeader = false } = {}) {
  const items = [];
  let headerSeen = false;
  let firstNonEmpty = -1;
  rows.forEach((cells, idx) => {
    const a = cells[0] || "";
    const b = cells[1] || "";
    if (firstNonEmpty === -1 && cells.join("").trim()) firstNonEmpty = idx;
    if (!headerSeen) {
      if (/item\s*no/i.test(a) && /description/i.test(b)) {
        headerSeen = true;
        return;
      }
      if (assumeHeader && idx === firstNonEmpty) {
        headerSeen = true; // first row IS the header
        return;
      }
      return;
    }
    const it = rowToItem(cells);
    if (it) items.push(it);
  });
  return items;
}

function readContingency(ws) {
  let pct = null;
  ws.eachRow((row) => {
    const text = [];
    for (let c = 1; c <= 8; c++) text.push(cellText(row.getCell(c)));
    const s = text.join(" ");
    const m =
      /add\s+([\d.]+)\s*%\s*conting/i.exec(s) ||
      /conting\w*\s*\(?\s*([\d.]+)\s*%/i.exec(s) ||
      /([\d.]+)\s*%\s*conting/i.exec(s);
    if (m && pct == null) pct = m[1];
  });
  return pct;
}

export async function parseBoqWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  let contingencyPercent = null;
  const bills = [];

  for (const ws of wb.worksheets) {
    const name = (ws.name || "").trim();
    if (/summary/i.test(name) && !/^bill/i.test(name)) {
      const pct = readContingency(ws);
      if (pct && contingencyPercent == null) contingencyPercent = pct;
      continue;
    }
    if (!/^bill\s*\d+/i.test(name)) continue;
    const code = (/^(bill\s*\d+)/i.exec(name) || [])[1] || name;
    const title = name.replace(/^bill\s*\d+\s*[-–—:]?\s*/i, "").trim() || name;
    const items = collectItems(worksheetRows(ws));
    if (items.length) bills.push({ code, title, items });
  }

  // Single-sheet fallback — a workbook with no "Bill N" sheets: take the first
  // sheet that has priceable rows and treat it as one bill.
  if (bills.length === 0) {
    for (const ws of wb.worksheets) {
      if (/summary|instructions?/i.test(ws.name || "")) continue;
      const items = collectItems(worksheetRows(ws), { assumeHeader: true });
      if (items.some((i) => i.rate)) {
        bills.push({ code: "Bill 1", title: (ws.name || "Bill of Quantities").trim(), items });
        break;
      }
    }
  }

  return { bills, contingencyPercent };
}

/** Parse a CSV BOQ (the single-sheet template) into one bill. */
export function parseBoqCsv(text) {
  const rows = String(text)
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      // Simple CSV: split on commas not inside quotes.
      const out = [];
      let cur = "";
      let q = false;
      for (const ch of line) {
        if (ch === '"') q = !q;
        else if (ch === "," && !q) {
          out.push(cur);
          cur = "";
        } else cur += ch;
      }
      out.push(cur);
      return out.map((c) => c.trim().replace(/^"|"$/g, ""));
    });
  const items = collectItems(rows, { assumeHeader: true });
  return {
    bills: items.length ? [{ code: "Bill 1", title: "Bill of Quantities", items }] : [],
    contingencyPercent: null,
  };
}
