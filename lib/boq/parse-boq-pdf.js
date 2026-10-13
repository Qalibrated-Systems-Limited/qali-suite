import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Parse a BOQ PDF into the same normalised shape the Excel/CSV parser produces —
 * { bills: [{ code, title, items: [NormItem] }], contingencyPercent, warnings }
 * — so the importer treats all three formats identically.
 *
 * A PDF is not a spreadsheet: there are no cells, only glyphs at (x, y). Item
 * codes sit on a different line from their figures, units carry superscripts
 * that land on their own line, a bill runs across pages that each repeat its
 * header, and every page ends in a "carried forward" subtotal. Exact
 * line-for-line extraction therefore cannot be trusted for a contract.
 *
 * So TWO things are produced, and the importer is told which to trust:
 *   • the GRAND SUMMARY — bill codes, bill totals and the contingency %. This
 *     is a clean three-column table and parses exactly.
 *   • best-effort LINE ITEMS per bill.
 * The caller reconciles: a bill whose detailed lines sum to its Grand-Summary
 * total keeps the detail; one that does not is replaced by a single lump line
 * at the (correct) summary total. `reconcileBills` does this.
 */

const AMOUNT_RE = /^-?[\d,]+\.\d{2}$/;
const toNum = (s) => {
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && /\d/.test(String(s)) ? n : null;
};

const SKIP_RE =
  /carried\s+forward|brought\s+forward|carried\s+to|collection|sub-?\s*total|^total\b|grand\s+summary|grand\s+total|to\s+collection|page\s+\d+\s+of/i;

/** Read every page into physical lines of positioned glyphs. */
async function readLines(buffer) {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const glyphs = content.items
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim() }));

    const byY = new Map();
    for (const g of glyphs) {
      const key = Math.round(g.y / 2) * 2;
      if (!byY.has(key)) byY.set(key, []);
      byY.get(key).push(g);
    }
    const lines = [...byY.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, gs]) => ({ y, gs: gs.sort((a, b) => a.x - b.x) }));
    pages.push(lines);
    await page.cleanup();
  }
  return pages;
}

const lineText = (ln) => ln.gs.map((g) => g.s).join(" ").replace(/\s+/g, " ").trim();

/** The Grand Summary: bill code → total, plus the contingency %. */
function parseSummary(pages) {
  const bills = [];
  let contingencyPercent = null;

  for (const lines of pages) {
    const pageText = lines.map(lineText).join(" ");
    if (!/grand\s+summary/i.test(pageText)) continue;

    for (let i = 0; i < lines.length; i++) {
      const t = lineText(lines[i]);

      if (contingencyPercent == null) {
        const cm = /add\s+([\d.]+)\s*%\s*contig/i.exec(t) || /([\d.]+)\s*%\s*contig/i.exec(t);
        if (cm) contingencyPercent = cm[1];
      }

      const bm = /^Bill\s*No\.?\s*(\d+)\b[:.]?\s*(.*)$/i.exec(t);
      if (!bm) continue;
      if (/carried|total/i.test(t)) continue;

      const n = bm[1];
      // The amount is the last money token on the row.
      const amounts = lines[i].gs.filter((g) => AMOUNT_RE.test(g.s));
      const total = amounts.length ? toNum(amounts[amounts.length - 1].s) : null;
      // Title: text after the number, minus any trailing amount.
      let title = bm[2].replace(/[\d,]+\.\d{2}\s*$/, "").trim();
      if (!title) title = `Bill ${n}`;
      if (total != null) bills.push({ n, code: `Bill ${n}`, title, total });
    }
  }
  // De-dupe by bill number, keep the first seen with a total.
  const seen = new Map();
  for (const b of bills) if (!seen.has(b.n)) seen.set(b.n, b);
  return { summary: [...seen.values()], contingencyPercent };
}

/** Column x-bands from a bill page's header row, or null if none found. */
function columnsFromHeader(lines) {
  for (const ln of lines) {
    const t = lineText(ln).toLowerCase();
    if (/item/.test(t) && /descr/.test(t) && /amount/.test(t)) {
      const col = (re) => {
        const g = ln.gs.find((g) => re.test(g.s.toLowerCase()));
        return g ? g.x : null;
      };
      const desc = col(/descr/);
      const unit = col(/unit/);
      const qty = col(/quant/);
      const rate = col(/rate/);
      const amount = col(/amount/);
      if (desc != null && amount != null) {
        return { desc, unit, qty, rate, amount };
      }
    }
  }
  return null;
}

/** Best-effort line items for one bill (its merged pages' lines). */
function billItems(allLines, cols) {
  // Mid-points between adjacent column anchors become band boundaries.
  const amountLeft = cols.amount - 24;
  const rateLeft = cols.rate != null ? cols.rate - 20 : cols.amount - 70;
  const descLeft = cols.desc - 6;

  const items = [];
  let descBuf = [];
  let pendingCode = null;

  for (const ln of allLines) {
    const t = lineText(ln);
    if (!t || SKIP_RE.test(t)) {
      continue;
    }
    // A leading item code on (or near) this line.
    const first = ln.gs[0];
    const codeM = first && /^\d+(?:\.\d+)+$/.test(first.s) ? first.s : null;
    if (codeM && first.x < descLeft) pendingCode = codeM;

    const amtGlyph = ln.gs.find((g) => g.x >= amountLeft && AMOUNT_RE.test(g.s));
    const descGlyphs = ln.gs.filter((g) => g.x >= descLeft && g.x < rateLeft);
    const descHere = descGlyphs.map((g) => g.s).join(" ").trim();

    if (amtGlyph) {
      // A priced line. Collect rate / qty / unit from their bands.
      const amount = toNum(amtGlyph.s);
      const rateGlyph = ln.gs.find(
        (g) => cols.rate != null && g.x >= rateLeft && g.x < amountLeft && /[\d,]+\.\d{2}/.test(g.s),
      );
      const rate = rateGlyph ? toNum(rateGlyph.s) : null;
      const qtyGlyph = ln.gs.find(
        (g) => cols.qty != null && g.x >= cols.qty - 20 && g.x < rateLeft && /^\d/.test(g.s) && g !== rateGlyph,
      );
      const quantity = qtyGlyph ? toNum(qtyGlyph.s) : null;
      const description = [descBuf.join(" "), descHere].join(" ").replace(/\s+/g, " ").trim();

      items.push({
        itemCode: pendingCode,
        description: description || "(item)",
        amount,
        rate,
        quantity,
      });
      descBuf = [];
      pendingCode = null;
    } else if (descHere && !codeM) {
      descBuf.push(descHere);
    }
  }
  return items;
}

export async function parseBoqPdf(buffer) {
  const pages = await readLines(buffer);
  const { summary, contingencyPercent } = parseSummary(pages);

  // Walk bill pages, merging consecutive pages that belong to one bill.
  const detail = new Map(); // bill number -> { title, lines: [] , cols }
  let current = null;
  for (const lines of pages) {
    const pageText = lines.map(lineText).join(" ");
    if (/grand\s+summary/i.test(pageText)) continue;

    // Does this page announce a bill?
    let announced = null;
    for (const ln of lines) {
      const m = /^Bill\s*No\.?\s*(\d+)\b\s*[:.]?\s*(.*)$/i.exec(lineText(ln));
      if (m && !/carried|grand|total/i.test(lineText(ln))) {
        announced = { n: m[1], title: m[2].trim() };
        break;
      }
    }
    if (announced) {
      if (!detail.has(announced.n)) {
        detail.set(announced.n, { title: announced.title, lines: [], cols: null });
      }
      current = detail.get(announced.n);
    }
    if (!current) continue;

    if (!current.cols) current.cols = columnsFromHeader(lines);
    current.lines.push(...lines);
  }

  // Assemble bills: prefer the summary's ordering/titles, attach detail.
  const bills = [];
  const order = summary.length
    ? summary.map((s) => s.n)
    : [...detail.keys()];
  for (const n of order) {
    const s = summary.find((x) => x.n === n);
    const d = detail.get(n);
    const title = (s && s.title) || (d && d.title) || `Bill ${n}`;
    const items = d && d.cols ? billItems(d.lines, d.cols) : [];
    bills.push({
      code: `Bill ${n}`,
      title,
      summaryTotal: s ? s.total : null,
      items: items.map((it) => normItem(it)),
    });
  }

  return { bills, contingencyPercent, warnings: [] };
}

/** Shape a raw line into the importer's NormItem (strings, DB-ready). */
function normItem(it) {
  const hasRate = it.rate != null && it.rate > 0;
  const quantity = it.quantity != null && it.quantity > 0 ? String(it.quantity) : hasRate ? "1" : null;
  // When only the amount is known, treat the amount as a lump rate on qty 1.
  const rate = hasRate ? String(it.rate) : it.amount != null ? String(it.amount) : null;
  return {
    itemCode: it.itemCode || null,
    description: it.description,
    isHeading: false,
    unit: quantity ? "Item" : null,
    quantity: rate ? quantity || "1" : null,
    rate,
  };
}

/**
 * Keep a bill's detailed lines only when they sum to its Grand-Summary total
 * (to the cent). Otherwise replace them with one lump line at the summary
 * total, so the contract sum is always right. Returns { bills, warnings } in
 * the parser's output shape (bills without the summaryTotal field).
 */
export function reconcileBills(parsed, { tolerance = 1 } = {}) {
  const warnings = [];
  const bills = [];
  for (const b of parsed.bills) {
    const sum = b.items.reduce(
      (a, it) => a + (it.rate ? Number(it.rate) * Number(it.quantity || 1) : 0),
      0,
    );
    const target = b.summaryTotal;
    const reconciles = target != null && Math.abs(sum - target) <= tolerance;

    if (reconciles && b.items.length) {
      bills.push({ code: b.code, title: b.title, items: b.items });
    } else if (target != null) {
      if (b.items.length) {
        warnings.push(
          `${b.code} (${b.title}): parsed lines summed to ${Math.round(sum).toLocaleString()} but the Grand Summary says ${Math.round(target).toLocaleString()} — imported as one lump line at the Grand-Summary total. Re-import this bill from xlsx/csv for line detail.`,
        );
      } else {
        warnings.push(
          `${b.code} (${b.title}): no line items could be read from the PDF — imported as one lump line at the Grand-Summary total.`,
        );
      }
      bills.push({
        code: b.code,
        title: b.title,
        items: [
          {
            itemCode: null,
            description: `${b.title} (lump sum from Grand Summary — detail not imported from PDF)`,
            isHeading: false,
            unit: "Item",
            quantity: "1",
            rate: String(target),
          },
        ],
      });
    } else if (b.items.length) {
      // No summary to check against — keep what we read, but say so.
      warnings.push(
        `${b.code} (${b.title}): no Grand-Summary total to reconcile against; imported the parsed lines unchecked.`,
      );
      bills.push({ code: b.code, title: b.title, items: b.items });
    }
  }
  return { bills, contingencyPercent: parsed.contingencyPercent, warnings };
}
