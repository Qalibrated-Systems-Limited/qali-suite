/**
 * Item checkouts — the last of the ledger ports to be wired up.
 *
 * `item_checkouts` and three repository functions have existed since the
 * fulfilment port, uncalled, and `returnCheckout` POSTED NOTHING: stock came
 * back into the warehouse while its value stayed on the technician-stock
 * account for ever. The first test here is the one that would have caught it.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const fulfilment = await import("@/app/db/repositories/fulfilment");

suite("item checkouts", () => {
  let admin, client, db;
  let companyId, inventoryAcct, techStockAcct, expenseAcct, product, userId;

  const asTenant = (fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });

  const accountNet = async (accountId) => {
    const [r] = await admin`
      SELECT COALESCE(SUM(debit - credit), 0)::float8 AS net
        FROM journal_lines WHERE account_id = ${accountId}::uuid`;
    return r.net;
  };

  const checkOut = (over = {}) =>
    asTenant((tx) =>
      fulfilment.createCheckout(tx, {
        companyId,
        productId: product,
        quantity: "10.0000",
        checkedOutToName: "Tech Kamau",
        checkedOutById: userId,
        checkedOutByName: "Store Manager",
        purpose: "installation",
        expectedReturnDate: "2026-09-30",
        ...over,
      }),
    );

  // 10 units at a cost of 250 each = 2,500 on the technician.
  const COST = 250;

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
    await admin`TRUNCATE companies, entry_counters CASCADE`;
    companyId = randomUUID();
    inventoryAcct = randomUUID();
    techStockAcct = randomUUID();
    expenseAcct = randomUUID();
    product = randomUUID();
    userId = randomUUID();

    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyId}, 'Acme Ltd', ${"a-" + companyId.slice(0, 8)})`;
    await admin`INSERT INTO users (id, home_company_id, name, email, role)
      VALUES (${userId}, ${companyId}, 'Store', ${userId + "@x.test"}, 'Store Manager')`;

    await asTenant(async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts
          (id, company_id, account_code, account_name, account_type, can_post, system_account)
        VALUES
          (${inventoryAcct}::uuid,  ${companyId}::uuid, '1200', 'Inventory',         'asset',   true, 'inventory'),
          (${techStockAcct}::uuid,  ${companyId}::uuid, '1250', 'Technician Stock',  'asset',   true, 'technician_stock'),
          (${expenseAcct}::uuid,    ${companyId}::uuid, '6300', 'Consumables',       'expense', true, NULL)`);
      await tx.execute(sql`
        INSERT INTO products (id, company_id, sku, name, unit, cost_price, selling_price, quantity_on_hand)
        VALUES (${product}::uuid, ${companyId}::uuid, 'CBL-1', 'Cable drum', 'ea', ${COST}, 400, 100)`);
      await tx.execute(sql`
        INSERT INTO fiscal_periods
          (company_id, year, month, period_name, period_code, start_date, end_date, status)
        SELECT ${companyId}::uuid, y, m,
               to_char(make_date(y, m, 1), 'FMMonth YYYY'),
               to_char(make_date(y, m, 1), 'YYYY-MM'),
               make_date(y, m, 1),
               (make_date(y, m, 1) + interval '1 month - 1 day')::date, 'open'
          FROM generate_series(2025, 2032) AS y, generate_series(1, 12) AS m`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("returning stock", () => {
    it("posts DR Inventory / CR Technician Stock", async () => {
      // THE TEST THAT WOULD HAVE CAUGHT IT. returnCheckout moved the
      // quantities and closed the row and posted nothing, so the value stayed
      // on the technician for ever.
      const co = await checkOut();

      const { entry } = await asTenant((tx) =>
        fulfilment.returnCheckout(tx, co.id, {
          quantity: "10.0000",
          totalCost: (COST * 10).toFixed(4),
          inventoryAccountId: inventoryAcct,
          technicianStockAccountId: techStockAcct,
          returnedById: userId,
        }),
      );

      expect(entry).not.toBeNull();
      expect(await accountNet(inventoryAcct)).toBe(2500);
      expect(await accountNet(techStockAcct)).toBe(-2500);
    });

    it("closes the checkout once everything is accounted for", async () => {
      const co = await checkOut();
      const { checkout } = await asTenant((tx) =>
        fulfilment.returnCheckout(tx, co.id, {
          quantity: "10.0000",
          totalCost: (COST * 10).toFixed(4),
          inventoryAccountId: inventoryAcct,
          technicianStockAccountId: techStockAcct,
        }),
      );
      expect(checkout.status).toBe("returned");
    });

    it("stays open on a partial return, and posts only what came back", async () => {
      const co = await checkOut();
      const { checkout } = await asTenant((tx) =>
        fulfilment.returnCheckout(tx, co.id, {
          quantity: "4.0000",
          totalCost: (COST * 4).toFixed(4),
          inventoryAccountId: inventoryAcct,
          technicianStockAccountId: techStockAcct,
        }),
      );
      expect(checkout.status).toBe("checked_out");
      expect(Number(checkout.quantityReturned)).toBe(4);
      expect(await accountNet(inventoryAcct)).toBe(1000);
    });

    it("records the return but posts NOTHING when the accounts are missing", async () => {
      // Deliberate: refusing the return would leave stock recorded as still
      // out with somebody who has physically handed it back.
      const co = await checkOut();
      const { checkout, entry } = await asTenant((tx) =>
        fulfilment.returnCheckout(tx, co.id, {
          quantity: "10.0000",
          totalCost: (COST * 10).toFixed(4),
          inventoryAccountId: null,
          technicianStockAccountId: null,
        }),
      );
      expect(entry).toBeNull();
      expect(checkout.status).toBe("returned");
    });

    it("cannot return more than went out", async () => {
      const co = await checkOut({ quantity: "5.0000" });
      await expect(
        asTenant((tx) =>
          fulfilment.returnCheckout(tx, co.id, {
            quantity: "6.0000",
            totalCost: (COST * 6).toFixed(4),
            inventoryAccountId: inventoryAcct,
            technicianStockAccountId: techStockAcct,
          }),
        ),
      ).rejects.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("converting to an expense", () => {
    const expense = (co, qty = "10.0000") =>
      asTenant((tx) =>
        fulfilment.expenseCheckout(tx, co.id, {
          quantity: qty,
          totalCost: (COST * Number(qty)).toFixed(4),
          expenseAccountId: expenseAcct,
          expenseAccountCode: "6300",
          expenseAccountName: "Consumables",
          technicianStockAccountId: techStockAcct,
          reason: "Used on the Karen site",
          expensedById: userId,
        }),
      );

    it("posts DR Expense / CR Technician Stock", async () => {
      const co = await checkOut();
      await expense(co);
      expect(await accountNet(expenseAcct)).toBe(2500);
      expect(await accountNet(techStockAcct)).toBe(-2500);
    });

    it("writes the six columns that had never been written", async () => {
      const co = await checkOut();
      const { checkout } = await expense(co);

      expect(checkout.expensed).toBe(true);
      expect(checkout.expensedAt).not.toBeNull();
      expect(checkout.expenseAccountId).toBe(expenseAcct);
      // §9.4 — what the account was called when the cost was booked to it.
      expect(checkout.expenseAccountNameAtExpense).toBe("Consumables");
      expect(checkout.expenseJournalEntryId).not.toBeNull();
      expect(Number(checkout.expenseTotalCost)).toBe(2500);
      expect(checkout.status).toBe("expensed");
    });

    it("needs a reason", async () => {
      const co = await checkOut();
      await expect(
        asTenant((tx) =>
          fulfilment.expenseCheckout(tx, co.id, {
            quantity: "1.0000",
            totalCost: "250.0000",
            expenseAccountId: expenseAcct,
            expenseAccountCode: "6300",
            expenseAccountName: "Consumables",
            technicianStockAccountId: techStockAcct,
            reason: "  ",
          }),
        ),
      ).rejects.toThrow(/Say what/i);
    });

    it("cannot dispose of more than went out, however the two are combined", async () => {
      // The CHECK is on the SUM: returned + expensed + sold <= quantity. Mongo
      // tracks three independent counters with nothing reconciling them.
      const co = await checkOut({ quantity: "10.0000" });
      await asTenant((tx) =>
        fulfilment.returnCheckout(tx, co.id, {
          quantity: "7.0000",
          totalCost: (COST * 7).toFixed(4),
          inventoryAccountId: inventoryAcct,
          technicianStockAccountId: techStockAcct,
        }),
      );
      await expect(expense(co, "4.0000")).rejects.toThrow();
      // 3 is fine.
      const { checkout } = await expense(co, "3.0000");
      expect(checkout.status).toBe("expensed");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("status and escalation", () => {
    it("escalates a checkout that is still out", async () => {
      const co = await checkOut();
      const updated = await asTenant((tx) =>
        fulfilment.escalateCheckout(tx, co.id, {
          escalatedToId: userId,
          escalatedToName: "Ops Lead",
          reason: "Two weeks overdue",
        }),
      );
      expect(updated.isEscalated).toBe(true);
      expect(updated.escalatedToNameAtEscalation).toBe("Ops Lead");
    });

    it("refuses to escalate one that has been returned", async () => {
      const co = await checkOut();
      await asTenant((tx) =>
        fulfilment.returnCheckout(tx, co.id, {
          quantity: "10.0000",
          totalCost: (COST * 10).toFixed(4),
          inventoryAccountId: inventoryAcct,
          technicianStockAccountId: techStockAcct,
        }),
      );
      await expect(
        asTenant((tx) =>
          fulfilment.escalateCheckout(tx, co.id, {
            escalatedToId: userId,
            escalatedToName: "Ops Lead",
          }),
        ),
      ).rejects.toThrow(/still out/i);
    });

    it("marks lost or damaged, and refuses once settled", async () => {
      const co = await checkOut();
      const lost = await asTenant((tx) =>
        fulfilment.setCheckoutStatus(tx, co.id, "lost"),
      );
      expect(lost.status).toBe("lost");

      const other = await checkOut();
      await asTenant((tx) =>
        fulfilment.returnCheckout(tx, other.id, {
          quantity: "10.0000",
          totalCost: (COST * 10).toFixed(4),
          inventoryAccountId: inventoryAcct,
          technicianStockAccountId: techStockAcct,
        }),
      );
      await expect(
        asTenant((tx) => fulfilment.setCheckoutStatus(tx, other.id, "lost")),
      ).rejects.toThrow(/settled/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the list", () => {
    it("derives overdue from the date, not the status", async () => {
      // Nothing runs at midnight to relabel a checkout, so the Mongo count —
      // which reads status: "overdue" — showed only those marked by hand.
      await checkOut({ expectedReturnDate: "2020-01-01" });
      const stats = await asTenant((tx) => fulfilment.getCheckoutStats(tx));
      expect(stats.overdue).toBe(1);
      expect(stats.active).toBe(1);
    });

    it("counts due-soon separately from overdue", async () => {
      await checkOut({ expectedReturnDate: "2020-01-01" }); // overdue
      const stats = await asTenant((tx) => fulfilment.getCheckoutStats(tx));
      // An overdue checkout is not also "due soon" — the tiles must not
      // count the same row twice.
      expect(stats.dueSoon).toBe(0);
    });

    it("returns rows and a page count from one query", async () => {
      await checkOut();
      await checkOut();
      const { checkouts, total, pages } = await asTenant((tx) =>
        fulfilment.searchCheckouts(tx, {}),
      );
      expect(total).toBe(2);
      expect(pages).toBe(1);
      // The document shape the tables read.
      expect(checkouts[0].checkedOutTo.name).toBe("Tech Kamau");
      expect(checkouts[0].productSnapshot.SKU).toBe("CBL-1");
    });

    it("finds a checkout by product, SKU or person", async () => {
      await checkOut();
      for (const term of ["Cable", "CBL-1", "Kamau"]) {
        const { total } = await asTenant((tx) =>
          fulfilment.searchCheckouts(tx, { search: term }),
        );
        expect(total, `searching for ${term}`).toBe(1);
      }
    });
  });
});
