import ExcelJS from "exceljs";

/**
 * Parse an uploaded budget into rows the importer turns into one draft budget.
 *
 * A budget line names a COST CODE, and a cost code charges a GL account (0073).
 * So the sheet carries, per line:
 *
 *   Cost Code | Name | Description | Category | Account | Amount
 *
 * Only Cost Code and Amount are required. Name defaults to the description (or
 * the code); Category defaults to "Materials"; Account is a GL account code or
 * name — left blank, the line falls back to the project's default cost account.
 *
 * Returns { lines: [BudgetRow], warnings: [string] }.
 * BudgetRow = { code, name, description, category, account, amount, rowNo }.
 */

const isNum = (v) =>
  v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));

/** A money cell may arrive as "1,234.50" or "KES 1,234". Strip to a number. */
function money(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

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

/** Map a header cell to one of our known fields. */
function classifyHeader(h) {
  const s = (h || "").toLowerCase().replace(/[^a-z]/g, "");
  if (/^costcode|^code$/.test(s) || s === "costcode") return "code";
  if (s === "code") return "code";
  if (s.startsWith("name")) return "name";
  if (s.startsWith("desc")) return "description";
  if (s.startsWith("categor")) return "category";
  if (s.startsWith("account") || s === "glaccount" || s === "accountcode")
    return "account";
  if (s.startsWith("amount") || s.startsWith("budget") || s.startsWith("value"))
    return "amount";
  return null;
}

/** Find the header row in a grid of string cells; return its column map. */
function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const map = {};
    rows[r].forEach((cell, c) => {
      const field = classifyHeader(cell);
      if (field && !(field in map)) map[field] = c;
    });
    // A real header names at least a code/amount pair.
    if ("code" in map && "amount" in map) return { row: r, map };
  }
  return null;
}

function rowsToLines(rows) {
  const warnings = [];
  const header = findHeader(rows);
  if (!header) {
    return {
      lines: [],
      warnings: [
        "No header row found. The sheet needs a row naming at least 'Cost Code' and 'Amount'.",
      ],
    };
  }
  const { row: headerRow, map } = header;
  // When Amount is the last column, a CSV writer that left a thousands-grouped
  // figure like 1,200,000 unquoted splits it across trailing cells. Rejoin from
  // the amount column to the end so money() sees the whole number.
  const amountIsLast = Math.max(...Object.values(map)) === map.amount;
  const at = (cells, field) => {
    if (map[field] == null) return "";
    if (field === "amount" && amountIsLast) {
      return cells.slice(map.amount).join("").trim();
    }
    return (cells[map[field]] || "").trim();
  };

  const lines = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells.join("").trim()) continue; // blank row

    const code = at(cells, "code");
    const amountRaw = at(cells, "amount");
    const rowNo = r + 1; // 1-based, as a spreadsheet shows it

    // A "Total" line at the foot is not a budget line.
    if (/^(sub-?\s*total|total|grand)/i.test(code)) continue;

    if (!code && !amountRaw) continue;
    if (!code) {
      warnings.push(`Row ${rowNo}: no cost code — skipped.`);
      continue;
    }
    const amount = money(amountRaw);
    if (amount == null || amount <= 0) {
      warnings.push(`Row ${rowNo}: amount "${amountRaw}" is not a positive number — skipped.`);
      continue;
    }

    const description = at(cells, "description");
    lines.push({
      code: code.toUpperCase(),
      name: at(cells, "name") || description || code,
      description,
      category: at(cells, "category") || "Materials",
      account: at(cells, "account"),
      amount,
      rowNo,
    });
  }
  return { lines, warnings };
}

export async function parseBudgetWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  // The first sheet that has a usable header wins; skip an Instructions tab.
  for (const ws of wb.worksheets) {
    if (/instruction/i.test(ws.name || "")) continue;
    const rows = [];
    ws.eachRow((row) => {
      const cells = [];
      for (let c = 1; c <= 12; c++) cells.push(cellText(row.getCell(c)).trim());
      rows.push(cells);
    });
    const parsed = rowsToLines(rows);
    if (parsed.lines.length) return parsed;
  }
  return { lines: [], warnings: ["No budget lines found in the workbook."] };
}

export function parseBudgetCsv(text) {
  const rows = String(text)
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((line) => {
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
  return rowsToLines(rows);
}
