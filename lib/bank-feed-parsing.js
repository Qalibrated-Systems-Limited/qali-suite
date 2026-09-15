import crypto from "crypto";

/**
 * Reading a bank statement file — the pure half of the bank feed.
 *
 * Lifted out of `app/mongodb/services/bankFeedService.js` (0100) with no
 * database in it, because none of this needs one: it turns a CSV into rows and
 * hashes them. Kept in `lib/` rather than the repository so it can be tested
 * without a Postgres connection, which is what its 30-odd edge cases deserve.
 *
 * TWO THINGS ARE FIXED HERE, and both were silent.
 *
 * `parseDate` TOOK A FORMAT AND IGNORED IT. The caller passes the format the
 * user chose in the wizard, and the function then tried a fixed list in a
 * fixed order regardless. Every list entry that matches `\d{2}/\d{2}/\d{4}`
 * was read as DD/MM/YYYY, so a US export reading 03/04/2026 was imported as
 * 3 April rather than 4 March. Not an error — a wrong date, on a bank line,
 * that then reconciles against the wrong month.
 *
 * DATES ARE STRINGS, not JS Dates. `new Date(2026, 3, 4)` is midnight LOCAL,
 * and `transaction_date` is a `date` column; sending a timestamp through a
 * +03:00 offset moves the first three hours of a day into the day before. The
 * KPI port had the same seam. Everything here returns `YYYY-MM-DD`.
 */

/** sha256 of the whole file — one upload of one statement. */
export function generateContentHash(csvContent) {
  return crypto.createHash("sha256").update(csvContent).digest("hex");
}

/**
 * One import of one transaction, however many times the file is re-uploaded.
 *
 * ── A STATEMENT REPEATS ITSELF, AND THAT IS NOT A DUPLICATE ────────────────
 *
 * This hashed `account|date|description|debit|credit` and nothing else, and
 * `bank_feed_lines_hash_uq` turns a collision into `ON CONFLICT DO NOTHING`.
 * So when ONE file contained the same transaction twice — two M-Pesa receipts
 * of 500 to the same paybill on the same day, two identical bank charges, a
 * customer paying one invoice in two equal instalments — the second line was
 * dropped on import and never reached the ledger.
 *
 * It was invisible. `deriveBalances` takes opening and closing from the FILE's
 * running-balance column, never from the rows that were inserted, so the
 * statement showed a closing balance the imported lines could not add up to
 * and nothing compared the two. The only signal was "Skipped 1 duplicate
 * transactions" in the import message, which on a 400-line statement reads as
 * the re-upload overlap this feature exists to absorb.
 *
 * ── WHAT SEPARATES THEM ────────────────────────────────────────────────────
 *
 * `reference` and `balance` first, because on a real statement they already
 * differ: the two M-Pesa receipts above carry distinct transaction codes, and
 * a running balance moves by definition. Both were parsed and both were thrown
 * away here.
 *
 * `occurrence` is the backstop for a file that has neither — the ordinal of
 * this row among the rows in the SAME file with an identical tuple. It is
 * assigned by `assignLineHashes` from the file's own order, so re-uploading
 * the same file reproduces the same ordinals and de-duplicates exactly as
 * before, while two genuine repeats get two hashes.
 *
 * Do not call this directly on a file — `assignLineHashes` is what knows the
 * ordinals. It is exported alone for the single-row case and for its tests.
 */
export function generateLineHash(
  bankAccountId,
  date,
  description,
  debit,
  credit,
  reference = "",
  balance = null,
  occurrence = 0,
) {
  const dateStr =
    date instanceof Date ? date.toISOString().slice(0, 10) : String(date ?? "");
  // `null` and `undefined` must hash alike: a statement with no balance column
  // yields undefined, one whose cell is empty yields null, and the same
  // transaction must not change identity between two readings of one file.
  const balanceStr =
    balance == null || !Number.isFinite(Number(balance)) ? "" : String(Number(balance));
  const data = [
    bankAccountId,
    dateStr,
    description,
    debit,
    credit,
    reference ?? "",
    balanceStr,
    occurrence,
  ].join("|");
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * The hashes for a whole file, with repeats separated.
 *
 * THE ORDINAL IS PER FILE AND PER TUPLE. Rows that already differ in
 * reference or balance never share a key, so they never reach an ordinal above
 * zero — which matters, because the ordinal is the one part of the identity
 * that depends on what else is in the file. Keeping it at zero wherever the
 * content is distinct means a statement re-uploaded with extra days appended
 * still recognises every line it shares with the first upload.
 *
 * Returns a new array; the input is not mutated.
 */
export function assignLineHashes(bankAccountId, lines) {
  const seen = new Map();

  return (lines ?? []).map((l) => {
    const key = [
      l.date,
      l.description,
      l.debit || 0,
      l.credit || 0,
      l.reference ?? "",
      l.balance == null ? "" : l.balance,
    ].join("|");

    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    return {
      ...l,
      occurrence,
      lineHash: generateLineHash(
        bankAccountId,
        l.date,
        l.description,
        l.debit || 0,
        l.credit || 0,
        l.reference ?? "",
        l.balance ?? null,
        occurrence,
      ),
    };
  });
}

/** A CSV row, honouring quoted values. */
export function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

const pad = (n) => String(n).padStart(2, "0");
const asDate = (y, m, d) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;

/**
 * The formats, keyed by what the wizard calls them.
 *
 * Each is tried FIRST when the user named it, so an ambiguous string is read
 * the way they said it would be. The rest are then tried as a fallback, which
 * is what makes a mis-set format recoverable rather than fatal — but never at
 * the cost of overriding a stated one.
 */
const FORMATS = {
  "DD/MM/YYYY": { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, y: 3, m: 2, d: 1 },
  "MM/DD/YYYY": { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, y: 3, m: 1, d: 2 },
  "DD-MM-YYYY": { re: /^(\d{2})-(\d{2})-(\d{4})$/, y: 3, m: 2, d: 1 },
  "MM-DD-YYYY": { re: /^(\d{2})-(\d{2})-(\d{4})$/, y: 3, m: 1, d: 2 },
  "DD.MM.YYYY": { re: /^(\d{2})\.(\d{2})\.(\d{4})$/, y: 3, m: 2, d: 1 },
  "YYYY-MM-DD": { re: /^(\d{4})-(\d{2})-(\d{2})$/, y: 1, m: 2, d: 3 },
  "YYYY/MM/DD": { re: /^(\d{4})\/(\d{2})\/(\d{2})$/, y: 1, m: 2, d: 3 },
  "DD/MM/YY": { re: /^(\d{2})\/(\d{2})\/(\d{2})$/, y: 3, m: 2, d: 1, short: true },
  "MM/DD/YY": { re: /^(\d{2})\/(\d{2})\/(\d{2})$/, y: 3, m: 1, d: 2, short: true },
  "DD.MM.YY": { re: /^(\d{2})\.(\d{2})\.(\d{2})$/, y: 3, m: 2, d: 1, short: true },
};

/** Every format except the one already tried, in the old fixed order. */
const FALLBACK_ORDER = [
  "DD/MM/YYYY",
  "DD-MM-YYYY",
  "DD.MM.YYYY",
  "YYYY-MM-DD",
  "YYYY/MM/DD",
  "DD/MM/YY",
  "DD.MM.YY",
];

function applyFormat(dateStr, key) {
  const f = FORMATS[key];
  if (!f) return null;
  const m = dateStr.match(f.re);
  if (!m) return null;
  const year = f.short ? 2000 + parseInt(m[f.y], 10) : parseInt(m[f.y], 10);
  return asDate(year, parseInt(m[f.m], 10), parseInt(m[f.d], 10));
}

/**
 * A date string as `YYYY-MM-DD`, or null.
 *
 * The DECLARED format wins. That is the fix — see the note at the top.
 */
export function parseDate(dateStr, format = "DD/MM/YYYY") {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;

  const declared = applyFormat(s, format);
  if (declared) return declared;

  for (const key of FALLBACK_ORDER) {
    if (key === format) continue;
    const got = applyFormat(s, key);
    if (got) return got;
  }

  // Anything else the platform can read — "12 Jan 2026" and friends. Read as
  // UTC components so the answer does not depend on where the server is.
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  return asDate(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    parsed.getUTCDate(),
  );
}

/** A number out of a bank's formatting — currency symbols, commas, brackets. */
export function parseNumber(str) {
  if (str === 0) return 0;
  if (!str) return 0;

  let s = String(str).trim();

  // Brackets are how a statement writes a negative.
  const isNegative = s.startsWith("(") && s.endsWith(")");
  if (isNegative) s = s.slice(1, -1);

  s = s.replace(/[KES$£€\s,]/gi, "");

  const num = parseFloat(s);
  if (Number.isNaN(num)) return 0;
  return isNegative ? -num : num;
}

/**
 * A CSV and a column mapping in, rows out.
 *
 * Returns `{ lines, diagnostics }` rather than an array with properties hung
 * off it. The Mongo version did `parsedLines.diagnostics = {...}` on an array,
 * which survives a `return` and does NOT survive `.map()`, `.filter()` or
 * `JSON.stringify` — so the diagnostics silently vanished the moment anything
 * touched the list, which is precisely when a "no valid transactions" message
 * needs them.
 */
export function parseCSV(csvContent, columnMapping, dateFormat = "DD/MM/YYYY") {
  const rows = String(csvContent ?? "")
    .split("\n")
    .filter((l) => l.trim());
  if (rows.length < 2) {
    throw new Error("CSV must have at least a header row and one data row");
  }

  const headers = parseCSVLine(rows[0]);
  const headerIndexes = {};
  for (const [field, columnName] of Object.entries(columnMapping ?? {})) {
    if (!columnName) continue;
    const index = headers.findIndex(
      (h) => h.toLowerCase().trim() === String(columnName).toLowerCase().trim(),
    );
    if (index !== -1) headerIndexes[field] = index;
  }

  const lines = [];
  let droppedDateInvalid = 0;
  let droppedZeroAmount = 0;

  for (let i = 1; i < rows.length; i++) {
    const values = parseCSVLine(rows[i]);
    if (values.length === 0 || values.every((v) => !v.trim())) continue;

    const at = (field) =>
      headerIndexes[field] === undefined ? undefined : values[headerIndexes[field]];

    const line = {
      date: parseDate(at("date"), dateFormat),
      description: at("description") || "",
      reference: at("reference") || "",
      balance: headerIndexes.balance === undefined ? null : parseNumber(at("balance")),
      raw: values,
    };

    if (headerIndexes.amount !== undefined) {
      // One signed column: positive is money in.
      const amount = parseNumber(at("amount"));
      if (amount >= 0) {
        line.credit = amount;
        line.debit = 0;
      } else {
        line.debit = Math.abs(amount);
        line.credit = 0;
      }
    } else {
      /*
       * Two columns, and ABSOLUTE values from both: some banks write a
       * withdrawal as -204,021.00 in a column already labelled "Money Out",
       * and taking that at face value would make the debit negative.
       */
      line.debit = Math.abs(parseNumber(at("debit"))) || 0;
      line.credit = Math.abs(parseNumber(at("credit"))) || 0;
    }

    if (!line.date) {
      droppedDateInvalid++;
      continue;
    }

    /*
     * A row that moves nothing is a header artefact — "BALANCE B/FWD" — and
     * `bank_feed_lines_one_direction` would refuse it anyway. A row that
     * claims BOTH directions is a mapping mistake, and is dropped for the
     * same reason rather than being stored as a contradiction.
     */
    if (line.debit === 0 && line.credit === 0) {
      droppedZeroAmount++;
      continue;
    }
    if (line.debit > 0 && line.credit > 0) {
      droppedZeroAmount++;
      continue;
    }

    lines.push(line);
  }

  return {
    lines,
    diagnostics: {
      totalDataRows: rows.length - 1,
      droppedDateInvalid,
      droppedZeroAmount,
    },
  };
}

/**
 * The opening and closing balance a statement implies, when the bank gave a
 * running-balance column.
 *
 *   opening = the first line's running balance, less that line's own effect
 *   closing = the last line's running balance
 *
 * Sorted by date then row number, because banks do export lines out of order
 * and taking the file's first row would then read a mid-month balance as the
 * opening one.
 */
export function deriveBalances(lines) {
  const withBalance = lines
    .filter((l) => l.balance != null && Number.isFinite(l.balance))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.rowNumber ?? 0) - (b.rowNumber ?? 0);
    });

  if (withBalance.length === 0) {
    return { openingBalance: null, closingBalance: null, balanceSource: "unavailable" };
  }

  const first = withBalance[0];
  const last = withBalance[withBalance.length - 1];
  const firstNet = (first.credit || 0) - (first.debit || 0);
  const round = (n) => Math.round(n * 100) / 100;

  return {
    openingBalance: round(first.balance - firstNet),
    closingBalance: round(last.balance),
    balanceSource: "from_file",
  };
}

/**
 * How likely this line is that document, 0-100.
 *
 * Amount 40, document number in the text 35, party words 25. Unchanged from
 * the Mongo scoring, so a company's suggestions do not silently re-rank on
 * the day this ports — but taking `dueAmount` and `documentNumber` as plain
 * fields rather than reaching into two different document shapes.
 */
export function calculateMatchConfidence(line, doc) {
  const amount = doc.type === "invoice" ? line.creditAmount : line.debitAmount;
  const docAmount = Number(doc.dueAmount ?? 0);
  let confidence = 0;

  if (docAmount > 0) {
    if (Math.abs(amount - docAmount) < 1) confidence += 40;
    else if (Math.abs(amount - docAmount) < docAmount * 0.05) confidence += 25;
  }

  const text = `${line.description ?? ""} ${line.reference ?? ""}`.toLowerCase();

  if (doc.documentNumber && text.includes(String(doc.documentNumber).toLowerCase())) {
    confidence += 35;
  }

  if (doc.partyName) {
    const words = String(doc.partyName).toLowerCase().split(/\s+/);
    const matched = words.filter((w) => w.length > 2 && text.includes(w));
    if (matched.length > 0) confidence += Math.min(25, matched.length * 10);
  }

  return Math.min(100, confidence);
}

/** Why the matcher thinks so, for the tooltip. */
export function getMatchReason(line, doc) {
  const reasons = [];
  const text = `${line.description ?? ""} ${line.reference ?? ""}`.toLowerCase();

  if (doc.documentNumber && text.includes(String(doc.documentNumber).toLowerCase())) {
    reasons.push("reference_match");
  }

  const amount = Number(line.creditAmount) > 0 ? line.creditAmount : line.debitAmount;
  if (Math.abs(amount - Number(doc.dueAmount ?? 0)) < 1) reasons.push("amount_match");

  if (doc.partyName) {
    const firstWord = String(doc.partyName).toLowerCase().split(" ")[0];
    if (firstWord && text.includes(firstWord)) reasons.push("party_match");
  }

  return reasons.join(", ") || "partial_match";
}

/** Above this a match is taken automatically; below it, only suggested. */
export const AUTO_ALLOCATE_THRESHOLD = 95;
/** Below this it is not worth showing. */
export const SUGGEST_THRESHOLD = 30;
