/**
 * Integration tests for the command palette's search against a real PostgreSQL.
 *
 * The thing under test is one UNION of up-to-nine branches whose shape depends
 * on the reader's role, so most of what can go wrong here is structural rather
 * than arithmetic: a branch that names its columns differently from its
 * neighbours, a section that leaks across a tenant, an ordering that puts the
 * document you typed the number of below four near-misses.
 *
 * Skipped unless DATABASE_URL is set. See tests/pg-accounting-core.test.mjs for
 * how to start a throwaway server.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as search from "@/app/db/repositories/globalSearch";
import * as claimsRepo from "@/app/db/repositories/claims";
import * as partyRepo from "@/app/db/repositories/parties";
import * as productRepo from "@/app/db/repositories/products";
import * as projectRepo from "@/app/db/repositories/projects";
import * as fulfilRepo from "@/app/db/repositories/fulfilment";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const ALL = [
  "product",
  "invoice",
  "quote",
  "bill",
  "customer",
  "supplier",
  "claim",
  "stockRequest",
  "project",
];

suite("postgres global search", () => {
  let client;
  let admin;
  let db;
  let companyA;
  let customer;
  let supplier;
  let employeeParty;
  let accounts;
  let widget;
  /** Fresh per test, alongside the `users` truncate in beforeEach. */
  let employeeUserId;

  async function asTenant(companyId, fn) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  }

  const find = (hits, kind) => hits.filter((h) => h.kind === kind);

  /** The whole palette, for a reader who may see everything. */
  const searchAll = (term, opts = {}) =>
    asTenant(companyA, (tx) =>
      search.globalSearch(tx, term, { kinds: ALL, ...opts }),
    );

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });

  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    // `users` is listed EXPLICITLY. A cascade from `companies` does not reach
    // it — `users.home_company_id` is ON DELETE SET NULL — so a fixed user id
    // survives into the next test and its second INSERT violates users_pkey.
    // Same list pg-projects and pg-user-admin carry, and one statement rather
    // than two because the per-table cost is paid once (805dcc810).
    await admin`TRUNCATE companies, users, entry_counters CASCADE`;

    companyA = randomUUID();
    employeeUserId = "user-" + randomUUID().slice(0, 8);
    accounts = { ar: randomUUID(), revenue: randomUUID(), travel: randomUUID() };

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})
    `;

    // `employee_claims.employee_user_id` is a real FK to `users`, so the person
    // the claim belongs to has to exist before it can.
    await admin`INSERT INTO users (id, home_company_id, name, email, role)
      VALUES (${employeeUserId}, ${companyA}, 'Asha Wanjiru',
              ${employeeUserId + "@x.test"}, 'Employee')`;

    await asTenant(companyA, async (tx) => {
      for (const [id, code, name, type] of [
        [accounts.ar, "1200", "Accounts Receivable", "asset"],
        [accounts.revenue, "4000", "Sales", "revenue"],
        [accounts.travel, "5100", "Travel", "expense"],
      ]) {
        await tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type)
          VALUES (${id}, ${companyA}, ${code}, ${name}, ${type})
        `);
      }

      customer = (
        await partyRepo.createParty(tx, {
          companyId: companyA,
          name: "Nakuru Millers",
          primaryType: "customer",
          email: "orders@nakurumillers.co.ke",
        })
      ).id;
      supplier = (
        await partyRepo.createParty(tx, {
          companyId: companyA,
          // Deliberately close to, but not the same as, the name snapshotted
          // onto the bill below — the supplier section searches the PARTY, the
          // bill section searches the snapshot, and they are different columns.
          name: "Nakuru Fuels Ltd",
          primaryType: "supplier",
          email: "ar@nakurufuels.co.ke",
        })
      ).id;
      employeeParty = (
        await partyRepo.createParty(tx, {
          companyId: companyA,
          name: "Asha Wanjiru",
          primaryType: "employee",
        })
      ).id;

      widget = (
        await productRepo.createProduct(tx, {
          companyId: companyA,
          sku: "NAK-100",
          name: "Nakuru Grade A Maize",
          costPrice: "40.0000",
          sellingPrice: "250.0000",
          quantityOnHand: "77",
        })
      ).id;
    });
  });

  /** One row in every section, all of them matching "nakuru". */
  async function seedEverything() {
    const invoiceId = randomUUID();
    const quoteId = randomUUID();
    const billId = randomUUID();

    await admin`
      INSERT INTO invoices (id, company_id, invoice_number, invoice_date,
                            customer_id, total, status)
      VALUES (${invoiceId}, ${companyA}, 'INV-NAK-1', CURRENT_DATE,
              ${customer}, 5000, 'completed')`;

    await admin`
      INSERT INTO quotes (id, company_id, quote_number, quote_date,
                          customer_id, customer_name, total, status)
      VALUES (${quoteId}, ${companyA}, 'QT-NAK-1', CURRENT_DATE,
              ${customer}, 'Nakuru Millers', 4000, 'sent')`;

    // `bills_have_lines` is INITIALLY DEFERRED, so the header and its line have
    // to commit in ONE transaction — and `total` is generated from the
    // subtotal, so the fixture does not set it.
    await admin.begin(async (tx) => {
      await tx`
        INSERT INTO bills (id, company_id, bill_number, bill_date, due_date,
                           supplier_id, supplier_name_at_bill, subtotal, status)
        VALUES (${billId}, ${companyA}, 'BILL-NAK-1', CURRENT_DATE, CURRENT_DATE,
                ${supplier}, 'Nakuru Fuels', 3000, 'draft')`;
      await tx`
        INSERT INTO bill_lines (company_id, bill_id, line_number, account_id,
                                account_type, account_code_at_bill,
                                account_name_at_bill, description, quantity,
                                unit_price)
        VALUES (${companyA}, ${billId}, 1, ${accounts.travel}, 'expense',
                '5100', 'Travel', 'Fuel', 1, 3000)`;
    });

    const project = await asTenant(companyA, (tx) =>
      projectRepo.createProject(tx, {
        companyId: companyA,
        name: "Nakuru Depot Rebuild",
        // `projects_client_pair` wants both columns or neither — a client name
        // without the party it names is exactly what that CHECK exists to stop.
        clientPartyId: customer,
        clientName: "Nakuru Millers",
        createdByName: "Seed",
      }),
    );

    const request = await asTenant(companyA, (tx) =>
      fulfilRepo.createStockRequest(tx, {
        companyId: companyA,
        requestType: "sale",
        customerId: customer,
        requesterName: "Nakuru Storeman",
        requesterDepartment: "Technical",
        items: [{ productId: widget, requestedQuantity: "10" }],
      }),
    );

    const claim = await asTenant(companyA, (tx) =>
      claimsRepo.createAdvanceRequest(tx, {
        companyId: companyA,
        partyId: employeeParty,
        employeeUserId,
        claimDate: new Date().toISOString().slice(0, 10),
        advanceType: "travel",
        requestedAmount: "50000.0000",
        purpose: "Site visit to Nakuru",
        description: "Travel advance for Nakuru",
        createdById: null,
        createdByName: "Asha Wanjiru",
      }),
    );

    return { invoiceId, quoteId, billId, project, request, claim };
  }

  describe("every section", () => {
    it("finds one row in each of the nine", async () => {
      await seedEverything();
      const hits = await searchAll("nakuru");

      for (const kind of ALL) {
        expect(find(hits, kind), `no ${kind} matched "nakuru"`).toHaveLength(1);
      }
    });

    it("fills the columns the palette renders, in every section", async () => {
      await seedEverything();
      const hits = await searchAll("nakuru");

      // The bug this pins: a UNION takes its column NAMES from whichever
      // branch is first, so aliasing only one branch leaves the rest reading
      // undefined. Every hit must carry an id and a title whatever it is.
      for (const h of hits) {
        expect(h.id, `${h.kind} has no id`).toMatch(/^[0-9a-f-]{36}$/);
        expect(h.title, `${h.kind} has no title`).toBeTruthy();
      }

      const [product] = find(hits, "product");
      expect(product.title).toBe("Nakuru Grade A Maize");
      expect(product.subtitle).toBe("NAK-100");
      expect(product.meta).toBe("77.0000"); // quantity, as the palette's "Qty:"

      const [invoice] = find(hits, "invoice");
      expect(invoice.title).toBe("INV-NAK-1");
      expect(invoice.subtitle).toBe("Nakuru Millers");
      expect(invoice.status).toBe("completed");
      expect(Number(invoice.amount)).toBe(5000);

      const [bill] = find(hits, "bill");
      expect(bill.title).toBe("BILL-NAK-1");
      // The snapshot on the bill, not the supplier's name today.
      expect(bill.subtitle).toBe("Nakuru Fuels");

      const [claim] = find(hits, "claim");
      expect(claim.subtitle).toBe("Asha Wanjiru");
      expect(claim.meta).toBe("advance_request");

      const [request] = find(hits, "stockRequest");
      expect(request.subtitle).toBe("Nakuru Storeman");
      expect(request.meta).toBe("Technical");

      const [project] = find(hits, "project");
      expect(project.subtitle).toBe("Nakuru Depot Rebuild");
      expect(project.meta).toBe("Nakuru Millers");
    });

    it("names its columns correctly when the first branch is gated off", async () => {
      await seedEverything();
      // No products, so the invoice branch leads the UNION. If only the first
      // branch aliased, this is where it breaks — and it would break for
      // exactly the roles that cannot see inventory.
      const hits = await asTenant(companyA, (tx) =>
        search.globalSearch(tx, "nakuru", { kinds: ["invoice", "project"] }),
      );
      expect(hits).toHaveLength(2);
      for (const h of hits) {
        expect(h.title).toBeTruthy();
        expect(h.id).toMatch(/^[0-9a-f-]{36}$/);
      }
    });
  });

  describe("what the reader may see", () => {
    it("runs only the sections asked for", async () => {
      await seedEverything();
      const hits = await asTenant(companyA, (tx) =>
        search.globalSearch(tx, "nakuru", { kinds: ["product", "stockRequest"] }),
      );
      expect(new Set(hits.map((h) => h.kind))).toEqual(
        new Set(["product", "stockRequest"]),
      );
    });

    it("returns nothing at all when every section is gated off", async () => {
      await seedEverything();
      // A UNION of no branches is a syntax error, not an empty result — this
      // is the guard against building one.
      const hits = await asTenant(companyA, (tx) =>
        search.globalSearch(tx, "nakuru", { kinds: [] }),
      );
      expect(hits).toEqual([]);
    });

    it("scopes claims to one person when asked", async () => {
      await seedEverything();

      const mine = await asTenant(companyA, (tx) =>
        search.globalSearch(tx, "nakuru", {
          kinds: ["claim"],
          ownClaimsUserId: employeeUserId,
        }),
      );
      expect(mine).toHaveLength(1);

      // Somebody else's palette must not surface it. This is the leak the
      // Mongo search had: every claim matched for every employee.
      const theirs = await asTenant(companyA, (tx) =>
        search.globalSearch(tx, "nakuru", {
          kinds: ["claim"],
          ownClaimsUserId: "user-someone-else",
        }),
      );
      expect(theirs).toHaveLength(0);

      // A reviewer passes null and sees it.
      const reviewer = await asTenant(companyA, (tx) =>
        search.globalSearch(tx, "nakuru", {
          kinds: ["claim"],
          ownClaimsUserId: null,
        }),
      );
      expect(reviewer).toHaveLength(1);
    });
  });

  describe("ordering and matching", () => {
    it("puts a document-number match above a name-only match", async () => {
      // Four invoices for a customer whose NAME contains the term, and one
      // whose NUMBER starts with it. Mongo sorted by createdAt alone, so the
      // one you typed the number of could fall outside the top four.
      const nameOnly = (
        await asTenant(companyA, (tx) =>
          partyRepo.createParty(tx, {
            companyId: companyA,
            name: "ABC Holdings",
            primaryType: "customer",
          }),
        )
      ).id;

      for (let i = 0; i < 4; i++) {
        await admin`
          INSERT INTO invoices (id, company_id, invoice_number, invoice_date,
                                customer_id, total, status)
          VALUES (${randomUUID()}, ${companyA}, ${"INV-900" + i}, CURRENT_DATE,
                  ${nameOnly}, 100, 'draft')`;
      }
      await admin`
        INSERT INTO invoices (id, company_id, invoice_number, invoice_date,
                              customer_id, total, status)
        VALUES (${randomUUID()}, ${companyA}, 'ABC-0001', CURRENT_DATE,
                ${customer}, 100, 'draft')`;

      const hits = await asTenant(companyA, (tx) =>
        search.globalSearch(tx, "abc", { kinds: ["invoice"], limit: 4 }),
      );
      expect(hits).toHaveLength(4);
      expect(hits[0].title).toBe("ABC-0001");
    });

    it("caps each section independently", async () => {
      for (let i = 0; i < 6; i++) {
        await asTenant(companyA, (tx) =>
          productRepo.createProduct(tx, {
            companyId: companyA,
            sku: `BULK-${i}`,
            name: `Bulk item ${i}`,
            costPrice: "1.0000",
            quantityOnHand: "1",
          }),
        );
      }
      const hits = await asTenant(companyA, (tx) =>
        search.globalSearch(tx, "bulk", { kinds: ALL, limit: 4 }),
      );
      expect(find(hits, "product")).toHaveLength(4);
    });

    it("treats the search term as a literal, not a pattern", async () => {
      await seedEverything();

      // Unescaped, "%" matches every row in every section — nine sections'
      // worth of rows for a keystroke that should match nothing. This is the
      // fault swept out of all 47 hand-built ILIKE patterns.
      const wildcard = await searchAll("%%");
      expect(wildcard).toEqual([]);

      // "_" is the single-character wildcard, and is the worse of the two
      // because a wrong result looks like a right one.
      const underscore = await searchAll("Nak_ru");
      expect(underscore).toEqual([]);

      const literal = await searchAll("Nakuru");
      expect(literal.length).toBeGreaterThan(0);
    });

    it("refuses a term too short to be a search", async () => {
      await seedEverything();
      expect(await searchAll("n")).toEqual([]);
      expect(await searchAll("  ")).toEqual([]);
    });
  });

  it("hides another tenant's rows from every section", async () => {
    await seedEverything();
    const companyB = randomUUID();
    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})
    `;

    const seen = await asTenant(companyB, (tx) =>
      search.globalSearch(tx, "nakuru", { kinds: ALL }),
    );
    expect(seen).toEqual([]);
  });
});
