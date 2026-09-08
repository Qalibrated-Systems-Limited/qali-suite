/**
 * Reading a bank statement file.
 *
 * No database: this is the pure half of the bank feed, which is exactly why it
 * was worth lifting out of a 1,904-line service that needed a Mongo connection
 * to test a date parser.
 *
 * Two of these pin fixes rather than behaviour — the format that was accepted
 * and ignored, and the diagnostics that were hung off an array.
 */
import { describe, it, expect } from "vitest";

const {
  parseCSV,
  parseCSVLine,
  parseDate,
  parseNumber,
  deriveBalances,
  generateLineHash,
  generateContentHash,
  calculateMatchConfidence,
  getMatchReason,
} = await import("@/lib/bank-feed-parsing");

describe("reading a bank statement", () => {
  // ═══════════════════════════════════════════════════════════════════════════
  describe("the declared date format is USED, which it was not", () => {
    it("reads an ambiguous date the way the user said it would be", () => {
      // THE BUG. `parseDate(str, format)` took the format and then tried a
      // fixed list in a fixed order, and every DD/MM entry came first — so a
      // US export reading 03/04/2026 was imported as 3 April, not 4 March.
      // Not an error; a wrong date on a bank line.
      expect(parseDate("03/04/2026", "MM/DD/YYYY")).toBe("2026-03-04");
      expect(parseDate("03/04/2026", "DD/MM/YYYY")).toBe("2026-04-03");
    });

    it("still falls back when the declared format does not match", () => {
      // A mis-set format must be recoverable, just never able to override a
      // string the declared format CAN read.
      expect(parseDate("2026-04-03", "DD/MM/YYYY")).toBe("2026-04-03");
    });

    it("handles the separators banks actually use", () => {
      expect(parseDate("03.04.2026", "DD.MM.YYYY")).toBe("2026-04-03");
      expect(parseDate("03-04-2026", "DD-MM-YYYY")).toBe("2026-04-03");
      expect(parseDate("2026/04/03", "YYYY/MM/DD")).toBe("2026-04-03");
      expect(parseDate("03/04/26", "DD/MM/YY")).toBe("2026-04-03");
    });

    it("returns a STRING, not a Date, so no timezone can move it", () => {
      // `new Date(2026, 3, 3)` is midnight LOCAL. Sent to a `date` column
      // through a +03:00 offset it lands on the 2nd.
      const got = parseDate("03/04/2026", "DD/MM/YYYY");
      expect(typeof got).toBe("string");
      expect(got).toBe("2026-04-03");
    });

    it("refuses a month that does not exist rather than rolling it over", () => {
      // `new Date(2026, 12, 1)` is January 2027 and reports no error at all,
      // which is how a 13th month becomes next year's January silently.
      expect(parseDate("13/13/2026", "MM/DD/YYYY")).toBeNull();
      expect(parseDate("32/01/2026", "DD/MM/YYYY")).toBeNull();
    });

    it("is null for nothing, rather than today", () => {
      expect(parseDate("", "DD/MM/YYYY")).toBeNull();
      expect(parseDate(null, "DD/MM/YYYY")).toBeNull();
      expect(parseDate("not a date", "DD/MM/YYYY")).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("money as a bank writes it", () => {
    it("strips currency, spaces and thousands separators", () => {
      expect(parseNumber("KES 1,234.56")).toBe(1234.56);
      expect(parseNumber("  204,021.00 ")).toBe(204021);
      expect(parseNumber("$1,000")).toBe(1000);
    });

    it("reads brackets as negative, which is how statements print them", () => {
      expect(parseNumber("(1,500.00)")).toBe(-1500);
    });

    it("is zero for blanks and rubbish rather than NaN", () => {
      expect(parseNumber("")).toBe(0);
      expect(parseNumber(null)).toBe(0);
      expect(parseNumber("—")).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("splitting a row", () => {
    it("keeps a comma inside quotes", () => {
      expect(parseCSVLine('01/04/2026,"ACME LTD, NAIROBI",1000')).toEqual([
        "01/04/2026",
        "ACME LTD, NAIROBI",
        "1000",
      ]);
    });

    it("trims each field", () => {
      expect(parseCSVLine(" a , b ,c ")).toEqual(["a", "b", "c"]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("parsing a file", () => {
    const mapping = {
      date: "Date",
      description: "Narrative",
      reference: "Ref",
      debit: "Money Out",
      credit: "Money In",
      balance: "Balance",
    };

    const csv = [
      "Date,Narrative,Ref,Money Out,Money In,Balance",
      "01/04/2026,OPENING,,0,0,10000.00",
      "02/04/2026,ACME LTD INV-00007,REF1,,5000.00,15000.00",
      '03/04/2026,"KPLC, PREPAID",REF2,"-2,000.00",,13000.00',
    ].join("\n");

    it("reads the rows that move money", () => {
      const { lines } = parseCSV(csv, mapping, "DD/MM/YYYY");
      expect(lines).toHaveLength(2);
      expect(lines[0].credit).toBe(5000);
      expect(lines[0].debit).toBe(0);
      expect(lines[0].description).toBe("ACME LTD INV-00007");
      expect(lines[0].date).toBe("2026-04-02");
    });

    it("takes the ABSOLUTE value from a two-column layout", () => {
      // Some banks write a withdrawal as -204,021.00 in a column already
      // called "Money Out". Taking that at face value makes the debit
      // negative and every total after it wrong.
      const { lines } = parseCSV(csv, mapping, "DD/MM/YYYY");
      const kplc = lines.find((l) => l.description.startsWith("KPLC"));
      expect(kplc.debit).toBe(2000);
      expect(kplc.credit).toBe(0);
    });

    it("drops the zero-amount header row banks put first", () => {
      const { lines, diagnostics } = parseCSV(csv, mapping, "DD/MM/YYYY");
      expect(lines.every((l) => l.debit > 0 || l.credit > 0)).toBe(true);
      expect(diagnostics.droppedZeroAmount).toBe(1);
    });

    it("reads a single signed amount column", () => {
      const single = [
        "Date,Narrative,Amount",
        "02/04/2026,IN,5000.00",
        "03/04/2026,OUT,-2000.00",
      ].join("\n");
      const { lines } = parseCSV(
        single,
        { date: "Date", description: "Narrative", amount: "Amount" },
        "DD/MM/YYYY",
      );
      expect(lines[0].credit).toBe(5000);
      expect(lines[1].debit).toBe(2000);
      expect(lines[1].credit).toBe(0);
    });

    it("drops a row claiming money in BOTH directions", () => {
      // No statement produces one, and `bank_feed_lines_one_direction` would
      // refuse it — so it is a mapping mistake, reported rather than stored.
      const both = [
        "Date,Narrative,Money Out,Money In",
        "02/04/2026,CONFUSED,100,200",
      ].join("\n");
      const { lines, diagnostics } = parseCSV(
        both,
        { date: "Date", description: "Narrative", debit: "Money Out", credit: "Money In" },
        "DD/MM/YYYY",
      );
      expect(lines).toHaveLength(0);
      expect(diagnostics.droppedZeroAmount).toBe(1);
    });

    it("RETURNS the diagnostics rather than hanging them off an array", () => {
      // The Mongo version did `parsedLines.diagnostics = {...}` on the array
      // it returned. That survives a `return` and does NOT survive `.map()`,
      // `.filter()` or serialisation — so the specific "your date format is
      // wrong" message was one array operation from becoming the generic one.
      const wrongFormat = [
        "Date,Narrative,Money In",
        "2026-04-02,ACME,5000",
        "2026-04-03,KPLC,2000",
      ].join("\n");
      const result = parseCSV(
        wrongFormat,
        { date: "Date", description: "Narrative", credit: "Money In" },
        "DD/MM/YYYY",
      );
      // These parse via fallback, so nothing is dropped — the point is that
      // the diagnostics are a real property of a real object.
      expect(result).toHaveProperty("lines");
      expect(result).toHaveProperty("diagnostics");
      expect(result.diagnostics.totalDataRows).toBe(2);
      expect(JSON.parse(JSON.stringify(result)).diagnostics).toBeTruthy();
    });

    it("counts every unreadable date, so the caller can say why", () => {
      const bad = [
        "Date,Narrative,Money In",
        "rubbish,ACME,5000",
        "also rubbish,KPLC,2000",
      ].join("\n");
      const { lines, diagnostics } = parseCSV(
        bad,
        { date: "Date", description: "Narrative", credit: "Money In" },
        "DD/MM/YYYY",
      );
      expect(lines).toHaveLength(0);
      expect(diagnostics.droppedDateInvalid).toBe(2);
      expect(diagnostics.totalDataRows).toBe(2);
    });

    it("refuses a file with no data rows", () => {
      expect(() => parseCSV("Date,Narrative\n", {}, "DD/MM/YYYY")).toThrow(
        /header row and one data row/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the balances a statement implies", () => {
    it("backs the opening balance out of the first line's running balance", () => {
      const lines = [
        { date: "2026-04-02", credit: 5000, debit: 0, balance: 15000, rowNumber: 1 },
        { date: "2026-04-03", credit: 0, debit: 2000, balance: 13000, rowNumber: 2 },
      ];
      expect(deriveBalances(lines)).toEqual({
        openingBalance: 10000,
        closingBalance: 13000,
        balanceSource: "from_file",
      });
    });

    it("sorts by date first, because banks export out of order", () => {
      const lines = [
        { date: "2026-04-03", credit: 0, debit: 2000, balance: 13000, rowNumber: 1 },
        { date: "2026-04-02", credit: 5000, debit: 0, balance: 15000, rowNumber: 2 },
      ];
      const got = deriveBalances(lines);
      expect(got.openingBalance).toBe(10000);
      expect(got.closingBalance).toBe(13000);
    });

    it("says so when the file carried no balance column", () => {
      expect(deriveBalances([{ date: "2026-04-02", credit: 1, debit: 0 }])).toEqual({
        openingBalance: null,
        closingBalance: null,
        balanceSource: "unavailable",
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("hashes", () => {
    it("is the same transaction however the date arrives", () => {
      const a = generateLineHash("acct", "2026-04-02", "ACME", 0, 5000);
      const b = generateLineHash("acct", new Date("2026-04-02T00:00:00Z"), "ACME", 0, 5000);
      expect(a).toBe(b);
    });

    it("differs when any part of the transaction differs", () => {
      const base = generateLineHash("acct", "2026-04-02", "ACME", 0, 5000);
      expect(generateLineHash("acct", "2026-04-03", "ACME", 0, 5000)).not.toBe(base);
      expect(generateLineHash("acct", "2026-04-02", "OTHER", 0, 5000)).not.toBe(base);
      expect(generateLineHash("acct", "2026-04-02", "ACME", 0, 5001)).not.toBe(base);
      expect(generateLineHash("other", "2026-04-02", "ACME", 0, 5000)).not.toBe(base);
    });

    it("is stable for identical file content", () => {
      expect(generateContentHash("a,b\n1,2")).toBe(generateContentHash("a,b\n1,2"));
      expect(generateContentHash("a,b\n1,2")).not.toBe(generateContentHash("a,b\n1,3"));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("scoring a match", () => {
    const line = {
      description: "RTGS ACME LTD INV-00007",
      reference: "REF1",
      creditAmount: 5000,
      debitAmount: 0,
    };

    it("scores amount 40, document number 35 and party words 10 each", () => {
      // "Acme Ltd" is two scoring words, so 20 of the 25 party points — 95,
      // not 100. The cap only bites at three words or more.
      expect(
        calculateMatchConfidence(line, {
          type: "invoice",
          dueAmount: 5000,
          documentNumber: "INV-00007",
          partyName: "Acme Ltd",
        }),
      ).toBe(95);
    });

    it("caps the party contribution at 25 however many words match", () => {
      expect(
        calculateMatchConfidence(
          {
            description: "RTGS ACME LTD NAIROBI KENYA INV-00007",
            reference: "REF1",
            creditAmount: 5000,
            debitAmount: 0,
          },
          {
            type: "invoice",
            dueAmount: 5000,
            documentNumber: "INV-00007",
            partyName: "Acme Ltd Nairobi Kenya",
          },
        ),
      ).toBe(100);
    });

    it("gives partial credit for an amount within five per cent", () => {
      const score = calculateMatchConfidence(line, {
        type: "invoice",
        dueAmount: 5100,
        documentNumber: "INV-99999",
        partyName: "Nobody Else",
      });
      expect(score).toBe(25);
    });

    it("scores nothing when nothing lines up", () => {
      expect(
        calculateMatchConfidence(line, {
          type: "invoice",
          dueAmount: 999,
          documentNumber: "INV-99999",
          partyName: "Nobody Else",
        }),
      ).toBe(0);
    });

    it("ignores short party words, which match everything", () => {
      const score = calculateMatchConfidence(
        { description: "PAYMENT TO", reference: "", creditAmount: 1, debitAmount: 0 },
        { type: "invoice", dueAmount: 999, documentNumber: "X", partyName: "To Be Ltd" },
      );
      expect(score).toBe(0);
    });

    it("says why it matched", () => {
      expect(
        getMatchReason(line, {
          type: "invoice",
          dueAmount: 5000,
          documentNumber: "INV-00007",
          partyName: "Acme Ltd",
        }),
      ).toBe("reference_match, amount_match, party_match");
    });

    it("says partial_match rather than an empty string", () => {
      expect(
        getMatchReason(line, {
          type: "invoice",
          dueAmount: 1,
          documentNumber: "ZZZ",
          partyName: "Nobody",
        }),
      ).toBe("partial_match");
    });
  });
});
