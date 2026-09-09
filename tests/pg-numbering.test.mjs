/**
 * Document numbering — `document_prefix` and `next_entry_number`.
 *
 * THIS FILE EXISTS BECAUSE OF A REGRESSION NOBODY SAW FOR FIVE MIGRATIONS.
 *
 * `document_prefix(company, kind)` has been redefined once per module that
 * added a numbered document — 0035, 0050, 0051, 0052, 0056, 0098 — each one a
 * `CREATE OR REPLACE` of the whole body. 0098 was written from the 0050-era
 * copy, so it added `sales_order` and silently dropped `asset`, `ncr` and
 * `claim`, which 0051/0052/0056 had added in between.
 *
 * Two of the three kept working BY ACCIDENT: the fallback is
 * `ELSE upper(p_kind)`, and `upper('ncr')` is 'NCR', `upper('claim')` is
 * 'CLAIM'. Only `asset` was visibly wrong ('ASSET' where 'AST' was documented),
 * and that surfaced as one failing assertion in tests/pg-assets.test.mjs that
 * read like a fixture problem.
 *
 * The half no test covered is the LOOKUP: `company_settings.asset_prefix`,
 * `.ncr_prefix` and `.claim_prefix` are settable columns that were being read
 * and discarded. A company that set "FA" got "ASSET".
 *
 * So this asserts every kind BOTH ways — configured and default — and it is
 * driven by a table, so adding a kind means adding a row here. The next
 * redefinition that drops a branch fails on this file rather than in four
 * migrations' time.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Every kind the function knows, the settings column it reads, and the default
 * it must fall back to.
 *
 * `defaultsToUpper` marks the two whose default happens to equal
 * `upper(kind)`. They are the reason the regression hid, so the lookup
 * assertion below is the one that actually protects them.
 */
const KINDS = [
  { kind: "invoice",     column: "invoice_prefix",     fallback: "INV",   since: "0035" },
  { kind: "bill",        column: "bill_prefix",        fallback: "BILL",  since: "0035" },
  { kind: "quote",       column: "quote_prefix",       fallback: "QT",    since: "0035" },
  { kind: "po",          column: "po_prefix",          fallback: "PO",    since: "0035" },
  { kind: "grn",         column: "grn_prefix",         fallback: "GRN",   since: "0050" },
  { kind: "ncr",         column: "ncr_prefix",         fallback: "NCR",   since: "0051", defaultsToUpper: true },
  { kind: "claim",       column: "claim_prefix",       fallback: "CLAIM", since: "0052", defaultsToUpper: true },
  { kind: "asset",       column: "asset_prefix",       fallback: "AST",   since: "0056" },
  { kind: "sales_order", column: "sales_order_prefix", fallback: "SO",    since: "0098" },
];

suite("document numbering", () => {
  let admin;
  let companyId;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, entry_counters CASCADE`;
    companyId = randomUUID();
    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyId}, 'Numbering Co', ${"n-" + companyId.slice(0, 8)})
    `;
  });

  const prefixFor = async (kind) => {
    const [{ p }] = await admin`SELECT document_prefix(${companyId}::uuid, ${kind}) AS p`;
    return p;
  };

  describe("defaults, with no company_settings row", () => {
    for (const { kind, fallback, since } of KINDS) {
      it(`${kind} → ${fallback} (added ${since})`, async () => {
        expect(await prefixFor(kind)).toBe(fallback);
      });
    }
  });

  describe("the company's configured prefix is read", () => {
    /**
     * THE ASSERTION THAT WOULD HAVE CAUGHT 0098.
     *
     * A kind missing from the lookup CASE returns NULL and falls through to
     * the defaults, so `ncr` and `claim` still produced the right string. Only
     * setting a DIFFERENT prefix and demanding it back distinguishes "read
     * from settings" from "happened to match upper(kind)".
     */
    for (const { kind, column, since } of KINDS) {
      it(`${kind} reads ${column} (added ${since})`, async () => {
        const custom = `Z${kind.slice(0, 2).toUpperCase()}`;
        await admin`
          INSERT INTO company_settings (company_id) VALUES (${companyId})
          ON CONFLICT (company_id) DO NOTHING
        `;
        await admin.unsafe(
          `UPDATE company_settings SET ${column} = $1 WHERE company_id = $2`,
          [custom, companyId],
        );

        expect(await prefixFor(kind)).toBe(custom);
      });
    }
  });

  it("falls back to upper(kind) only for a kind nobody registered", async () => {
    // The last resort still works, and is deliberately NOT what any real kind
    // depends on.
    expect(await prefixFor("not_a_real_kind")).toBe("NOT_A_REAL_KIND");
  });

  it("blank settings fall back rather than numbering documents '-00001'", async () => {
    await admin`
      INSERT INTO company_settings (company_id) VALUES (${companyId})
      ON CONFLICT (company_id) DO NOTHING
    `;
    await admin`UPDATE company_settings SET asset_prefix = '   ' WHERE company_id = ${companyId}`;
    // btrim(v_prefix) = '' is why: an empty string is a configured value, and
    // a document numbered "-00001" is not a document number.
    expect(await prefixFor("asset")).toBe("AST");
  });

  describe("next_entry_number", () => {
    it("starts at 1 per (company, prefix) and increments", async () => {
      const n = async (kind) => {
        const [{ v }] = await admin`
          SELECT next_entry_number(
            ${companyId}::uuid, document_prefix(${companyId}::uuid, ${kind})
          ) AS v`;
        return v;
      };

      expect(await n("asset")).toBe("AST-00001");
      expect(await n("asset")).toBe("AST-00002");
      // A different kind has its own counter, not a shared one.
      expect(await n("claim")).toBe("CLAIM-00001");
    });

    it("counts separately for each tenant", async () => {
      const other = randomUUID();
      await admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${other}, 'Other', ${"o-" + other.slice(0, 8)})
      `;
      const n = async (company) => {
        const [{ v }] = await admin`
          SELECT next_entry_number(
            ${company}::uuid, document_prefix(${company}::uuid, 'asset')
          ) AS v`;
        return v;
      };

      expect(await n(companyId)).toBe("AST-00001");
      expect(await n(other)).toBe("AST-00001");
      expect(await n(companyId)).toBe("AST-00002");
    });
  });
});
