/**
 * Integration tests for the bills repository against a real PostgreSQL.
 *
 * Skipped unless DATABASE_URL is set. See tests/pg-accounting-core.test.mjs for
 * how to start a throwaway server.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as billRepo from "@/app/db/repositories/bills";
import * as paymentRepo from "@/app/db/repositories/payments";
import * as productRepo from "@/app/db/repositories/products";
import * as partyRepo from "@/app/db/repositories/parties";

const DATABASE_URL = process.env.DATABASE_URL;
/**
 * The privileged connection: CREATE ROLE, GRANT, TRUNCATE. The app's own
 * DATABASE_URL connects as app_user, which has none of those by design — see
 * migration 0023. Falls back to DATABASE_URL for a single-role local setup.
 */
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Drizzle wraps driver errors, so the Postgres message ends up on `.cause`
 * while `.message` is only "Failed query: ...". Assert against both.
 */
async function expectRejection(promise, pattern) {
  let caught;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the operation to be rejected").toBeDefined();
  expect(`${caught.message} ${caught.cause ?? ""}`).toMatch(pattern);
}

suite("postgres bills", () => {
  let client;
  let admin;
  let db;
  let companyA;
  let supplier;
  let accounts;
  let diesel;

  async function asTenant(companyId, fn) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  }

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
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE entry_counters`;

    companyA = randomUUID();
    accounts = {
      ap: randomUUID(),
      fuel: randomUUID(),
      inventory: randomUUID(),
      vatInput: randomUUID(),
      whtPayable: randomUUID(),
      grni: randomUUID(),
      bank: randomUUID(),
      obe: randomUUID(),
    };

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})
    `;

    await asTenant(companyA, async (tx) => {
      const rows = [
        [accounts.ap, "2100", "Accounts Payable", "liability"],
        [accounts.fuel, "5200", "Fuel", "expense"],
        [accounts.inventory, "1300", "Inventory", "asset"],
        [accounts.vatInput, "1400", "VAT Input", "asset"],
        [accounts.whtPayable, "2200", "WHT Payable", "liability"],
        [accounts.grni, "2150", "GR/IR Clearing", "liability"],
        [accounts.bank, "1000", "Bank", "asset"],
        // 0061 — createOpeningBalanceBill posts Dr OBE / Cr AP now.
        [accounts.obe, "3500", "Opening Balance Equity", "equity"],
      ];
      for (const [id, code, name, type] of rows) {
        await tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type)
          VALUES (${id}, ${companyA}, ${code}, ${name}, ${type})
        `);
      }

      supplier = (
        await partyRepo.createParty(tx, {
          companyId: companyA,
          name: "Vivo Energy",
          primaryType: "supplier",
          email: "ap@vivo.co.ke",
        })
      ).id;

      diesel = (
        await productRepo.createProduct(tx, {
          companyId: companyA,
          sku: "DSL-1",
          name: "Diesel",
          costPrice: "100.0000",
          quantityOnHand: "0",
        })
      ).id;
    });
  });

  /** An expense bill: 100 × 150.50, 16% VAT, optionally 5% WHT. */
  async function makeBill(overrides = {}) {
    return asTenant(companyA, (tx) =>
      billRepo.createBill(tx, {
        companyId: companyA,
        supplierId: supplier,
        billDate: "2026-08-01",
        dueDate: "2026-08-31",
        lines: [
          {
            description: "Diesel delivery",
            accountId: accounts.fuel,
            quantity: "100",
            unitPrice: "150.50",
            vatRate: "16",
          },
        ],
        ...overrides,
      }),
    );
  }

  describe("amounts are derived from the lines (§9.3)", () => {
    it("computes subtotal, VAT, total and balance from the lines alone", async () => {
      const bill = await makeBill();
      expect(bill.subtotal).toBe("15050.0000");
      expect(bill.vatAmount).toBe("2408.0000");
      expect(bill.whtAmount).toBe("0.0000");
      expect(bill.total).toBe("17458.0000");
      expect(bill.netPayable).toBe("17458.0000");
      expect(bill.balance).toBe("17458.0000");
      expect(bill.paymentStatus).toBe("unpaid");
    });

    it("withholds tax on the net of VAT", async () => {
      const bill = await makeBill({ whtApplicable: true, whtRate: "5" });
      expect(bill.whtAmount).toBe("752.5000");
      // Gross owed is still 17458; the supplier is paid 16705.50 and 752.50
      // goes to KRA.
      expect(bill.total).toBe("17458.0000");
      expect(bill.netPayable).toBe("16705.5000");
    });

    it("re-derives the header when a line is added", async () => {
      const bill = await makeBill();
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO bill_lines
            (company_id, bill_id, line_number, description, account_id,
             account_code_at_bill, account_name_at_bill, account_type,
             quantity, unit_price, vat_rate)
          VALUES (${companyA}, ${bill.id}, 2, 'Delivery charge', ${accounts.fuel},
                  '5200', 'Fuel', 'expense', 1, 1000, 16)
        `),
      );

      const after = await asTenant(companyA, (tx) => billRepo.getBill(tx, bill.id));
      expect(after.subtotal).toBe("16050.0000");
      expect(after.vatAmount).toBe("2568.0000");
      expect(after.total).toBe("18618.0000");
    });

    it("re-derives withholding when the WHT terms change", async () => {
      const bill = await makeBill();
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          UPDATE bills SET wht_applicable = true, wht_rate = 5 WHERE id = ${bill.id}
        `),
      );
      const after = await asTenant(companyA, (tx) => billRepo.getBill(tx, bill.id));
      expect(after.whtAmount).toBe("752.5000");
      expect(after.netPayable).toBe("16705.5000");
    });

    it("leaves an opening-balance bill's amount alone", async () => {
      const bill = await asTenant(companyA, (tx) =>
        billRepo.createOpeningBalanceBill(tx, {
          companyId: companyA,
          supplierId: supplier,
          billDate: "2026-01-01",
          dueDate: "2026-01-31",
          amount: "42000.0000",
          apAccountId: accounts.ap,
          openingEquityAccountId: accounts.obe,
        }),
      // Returns { bill, entry } since 0061 — createOpeningBalanceBill posts
      // Dr Opening Balance Equity / Cr AP now, which it never did before. No
      // accounts are passed here, so only the row is under test.
      ).then((r) => r.bill);
      const fetched = await asTenant(companyA, (tx) => billRepo.getBill(tx, bill.id));
      expect(fetched.subtotal).toBe("42000.0000");
      expect(fetched.netPayable).toBe("42000.0000");
      expect(fetched.lines).toHaveLength(0);
    });
  });

  describe("overpayment (§9.2)", () => {
    async function payBill(bill, amount) {
      return asTenant(companyA, async (tx) => {
        const payment = await paymentRepo.createPayment(tx, {
          companyId: companyA,
          paymentType: "made",
          paymentDate: "2026-08-05",
          paymentMethod: "bank_transfer",
          amount,
          partyId: supplier,
          accountId: accounts.bank,
        });
        return paymentRepo.allocateToBill(tx, {
          companyId: companyA,
          paymentId: payment.id,
          billId: bill.id,
          amount,
        });
      });
    }

    it("refuses a single cent over — bill.js:1302 allowed exactly this", async () => {
      const bill = await makeBill();
      await expectRejection(payBill(bill, "17458.0100"), /bills_not_overpaid/i);
    });

    it("accepts the exact balance and reports paid without clamping", async () => {
      const bill = await makeBill();
      await payBill(bill, "17458.0000");

      const after = await asTenant(companyA, (tx) => billRepo.getBill(tx, bill.id));
      expect(after.amountPaid).toBe("17458.0000");
      expect(after.balance).toBe("0.0000");
      expect(after.paymentStatus).toBe("paid");
    });

    it("reports partial while any amount remains, however small", async () => {
      const bill = await makeBill();
      await payBill(bill, "17457.9999");

      const after = await asTenant(companyA, (tx) => billRepo.getBill(tx, bill.id));
      // Mongo's `Math.abs(balance) < 0.01` would have called this settled.
      expect(after.balance).toBe("0.0001");
      expect(after.paymentStatus).toBe("partial");
    });

    it("maintains amount_paid from the allocations, not by hand", async () => {
      const bill = await makeBill();
      await payBill(bill, "5000.0000");
      let after = await asTenant(companyA, (tx) => billRepo.getBill(tx, bill.id));
      expect(after.amountPaid).toBe("5000.0000");

      // Removing the allocation takes the payment back off the bill.
      await asTenant(companyA, (tx) =>
        tx.execute(sql`DELETE FROM payment_allocations WHERE document_id = ${bill.id}`),
      );
      after = await asTenant(companyA, (tx) => billRepo.getBill(tx, bill.id));
      expect(after.amountPaid).toBe("0.0000");
      expect(after.paymentStatus).toBe("unpaid");
    });

    it("refuses an allocation naming a bill that does not exist", async () => {
      await expectRejection(
        asTenant(companyA, async (tx) => {
          const payment = await paymentRepo.createPayment(tx, {
            companyId: companyA,
            paymentType: "made",
            paymentDate: "2026-08-05",
            paymentMethod: "cash",
            amount: "10",
            partyId: supplier,
            accountId: accounts.bank,
          });
          await tx.execute(sql`
            INSERT INTO payment_allocations
              (company_id, payment_id, document_type, document_id,
               document_number_at_allocation, original_amount, balance_before, amount_allocated)
            VALUES (${companyA}, ${payment.id}, 'bill', ${randomUUID()}, 'GHOST', '1', '1', '1')
          `);
        }),
        /does not exist/i,
      );
    });
  });

  describe("snapshots (§9.4)", () => {
    it("keeps the supplier name as at bill time", async () => {
      const bill = await makeBill();
      expect(bill.supplierNameAtBill).toBe("Vivo Energy");

      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE parties SET name = 'Vivo Energy Kenya PLC' WHERE id = ${supplier}`),
      );

      const after = await asTenant(companyA, (tx) => billRepo.getBill(tx, bill.id));
      expect(after.supplierNameAtBill).toBe("Vivo Energy");
    });

    it("refuses to rewrite the supplier snapshot", async () => {
      const bill = await makeBill();
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`UPDATE bills SET supplier_name_at_bill = 'Someone Else' WHERE id = ${bill.id}`),
        ),
        /immutable/i,
      );
    });

    it("keeps the account a line was charged to, through a rename", async () => {
      const bill = await makeBill();
      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE accounts SET account_name = 'Fuel & Lubricants' WHERE id = ${accounts.fuel}`),
      );

      const after = await asTenant(companyA, (tx) => billRepo.getBill(tx, bill.id));
      expect(after.lines[0].accountName).toBe("Fuel");
    });

    it("refuses to rewrite a line's account snapshot", async () => {
      const bill = await makeBill();
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`UPDATE bill_lines SET account_name_at_bill = 'Anything' WHERE bill_id = ${bill.id}`),
        ),
        /immutable/i,
      );
    });
  });

  describe("line-count invariants", () => {
    it("refuses a non-opening bill with no lines, at COMMIT", async () => {
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`
            INSERT INTO bills (company_id, bill_number, bill_date, due_date,
                               supplier_id, supplier_name_at_bill)
            VALUES (${companyA}, 'BILL-EMPTY', '2026-08-01', '2026-08-31',
                    ${supplier}, 'Vivo Energy')
          `),
        ),
        /at least one line/i,
      );
    });

    it("refuses more than 50 lines", async () => {
      const bill = await makeBill();
      await expectRejection(
        asTenant(companyA, async (tx) => {
          for (let n = 2; n <= 51; n++) {
            await tx.execute(sql`
              INSERT INTO bill_lines
                (company_id, bill_id, line_number, description, account_id,
                 account_code_at_bill, account_name_at_bill, account_type,
                 quantity, unit_price)
              VALUES (${companyA}, ${bill.id}, ${n}, 'Filler', ${accounts.fuel},
                      '5200', 'Fuel', 'expense', 1, 1)
            `);
          }
        }),
        /more than 50 lines/i,
      );
    });

    it("refuses a line charged to a revenue account", async () => {
      const revenue = randomUUID();
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type)
          VALUES (${revenue}, ${companyA}, '4000', 'Sales', 'revenue')
        `),
      );
      await expect(
        makeBill({ lines: [{ description: "Wrong", accountId: revenue, quantity: "1", unitPrice: "1" }] }),
      ).rejects.toThrow(/expense or asset/i);
    });
  });

  describe("approval posting", () => {
    async function submitAndApprove(bill, opts = {}) {
      return asTenant(companyA, async (tx) => {
        await billRepo.submitBill(tx, bill.id, randomUUID());
        return billRepo.approveBill(tx, bill.id, {
          apAccountId: accounts.ap,
          vatInputAccountId: accounts.vatInput,
          whtPayableAccountId: accounts.whtPayable,
          inventoryAccountId: accounts.inventory,
          grniAccountId: accounts.grni,
          approvedById: randomUUID(),
          ...opts,
        });
      });
    }

    it("posts a balanced purchase entry with VAT and WHT", async () => {
      const bill = await makeBill({ whtApplicable: true, whtRate: "5" });
      const { entry } = await submitAndApprove(bill);

      const lines = await asTenant(companyA, (tx) =>
        tx.execute(sql`
          SELECT account_id, debit, credit FROM journal_lines
           WHERE entry_id = ${entry.id} ORDER BY line_number
        `),
      );

      const debits = lines.filter((l) => l.debit !== "0.0000");
      const credits = lines.filter((l) => l.credit !== "0.0000");
      // DR Fuel 15050, DR VAT Input 2408 | CR WHT 752.50, CR AP 16705.50
      expect(debits.map((l) => l.debit)).toEqual(["15050.0000", "2408.0000"]);
      expect(credits.map((l) => l.credit)).toEqual(["752.5000", "16705.5000"]);

      const [{ status }] = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT status FROM journal_entries WHERE id = ${entry.id}`),
      );
      expect(status).toBe("posted");
    });

    it("admits stock and re-costs the product on a weighted average", async () => {
      // 50 units already on hand at 100.
      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE products SET quantity_on_hand = 50 WHERE id = ${diesel}`),
      );

      const bill = await makeBill({
        lines: [
          {
            description: "Diesel stock",
            accountId: accounts.inventory,
            productId: diesel,
            quantity: "50",
            unitPrice: "140.0000",
          },
        ],
      });
      await submitAndApprove(bill);

      const product = await asTenant(companyA, (tx) =>
        productRepo.getProduct(tx, diesel),
      );
      expect(product.quantityOnHand).toBe("100.0000");
      // (50×100 + 50×140) / 100 = 120
      expect(product.costPrice).toBe("120.0000");

      const movements = await asTenant(companyA, (tx) =>
        tx.execute(sql`
          SELECT movement_type, direction, quantity, previous_stock, new_stock
            FROM stock_movements
        `),
      );
      expect(movements).toHaveLength(1);
      expect(movements[0].movement_type).toBe("purchase");
      expect(movements[0].direction).toBe("in");
      // The movement must describe the transition that actually happened.
      // Recording it after the receipt would say "100 -> 150".
      expect(movements[0].previous_stock).toBe("50.0000");
      expect(movements[0].new_stock).toBe("100.0000");
    });

    it("posts to GR/IR and moves no stock under three-way match", async () => {
      const bill = await makeBill({
        lines: [
          {
            description: "Diesel stock",
            accountId: accounts.inventory,
            productId: diesel,
            quantity: "50",
            unitPrice: "140.0000",
          },
        ],
      });
      const { bill: approved, entry } = await submitAndApprove(bill, {
        requireGRN: true,
      });

      expect(approved.usedGrni).toBe(true);
      expect(approved.inventoryMoved).toBe(false);

      const [debit] = await asTenant(companyA, (tx) =>
        tx.execute(sql`
          SELECT account_id FROM journal_lines
           WHERE entry_id = ${entry.id} AND debit <> 0
        `),
      );
      expect(debit.account_id).toBe(accounts.grni);

      const product = await asTenant(companyA, (tx) =>
        productRepo.getProduct(tx, diesel),
      );
      expect(product.quantityOnHand).toBe("0.0000");
    });

    it("refuses three-way match with no GR/IR account rather than falling back", async () => {
      const bill = await makeBill({
        lines: [
          {
            description: "Diesel stock",
            accountId: accounts.inventory,
            productId: diesel,
            quantity: "50",
            unitPrice: "140.0000",
          },
        ],
      });
      await expect(
        submitAndApprove(bill, { requireGRN: true, grniAccountId: null }),
      ).rejects.toThrow(/GR\/IR/i);
    });

    it("refuses to approve a bill that was never submitted", async () => {
      const bill = await makeBill();
      await expect(
        asTenant(companyA, (tx) =>
          billRepo.approveBill(tx, bill.id, {
            apAccountId: accounts.ap,
            vatInputAccountId: accounts.vatInput,
            approvedById: randomUUID(),
          }),
        ),
      ).rejects.toThrow(/not in submitted status/i);
    });

    it("rolls the whole approval back if any part of it fails", async () => {
      const bill = await makeBill({
        lines: [
          {
            description: "Diesel stock",
            accountId: accounts.inventory,
            productId: diesel,
            quantity: "50",
            unitPrice: "140.0000",
            vatRate: "16",
          },
        ],
      });

      // No VAT Input account supplied, but the bill carries VAT.
      await expect(
        submitAndApprove(bill, { vatInputAccountId: null }),
      ).rejects.toThrow(/VAT Input/i);

      const after = await asTenant(companyA, (tx) => billRepo.getBill(tx, bill.id));
      expect(after.status).toBe("draft"); // the submit rolled back too
      const product = await asTenant(companyA, (tx) =>
        productRepo.getProduct(tx, diesel),
      );
      expect(product.quantityOnHand).toBe("0.0000");
    });
  });

  describe("cancellation", () => {
    it("reverses the entry and takes the stock back", async () => {
      const bill = await makeBill({
        lines: [
          {
            description: "Diesel stock",
            accountId: accounts.inventory,
            productId: diesel,
            quantity: "50",
            unitPrice: "140.0000",
          },
        ],
      });

      await asTenant(companyA, async (tx) => {
        await billRepo.submitBill(tx, bill.id, randomUUID());
        await billRepo.approveBill(tx, bill.id, {
          apAccountId: accounts.ap,
          inventoryAccountId: accounts.inventory,
          approvedById: randomUUID(),
        });
      });

      await asTenant(companyA, (tx) =>
        billRepo.cancelBill(tx, bill.id, randomUUID(), "Duplicate"),
      );

      const after = await asTenant(companyA, (tx) => billRepo.getBill(tx, bill.id));
      expect(after.status).toBe("cancelled");

      const product = await asTenant(companyA, (tx) =>
        productRepo.getProduct(tx, diesel),
      );
      expect(product.quantityOnHand).toBe("0.0000");

      const [{ status }] = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT status FROM journal_entries WHERE id = ${after.journalEntryId}`),
      );
      expect(status).toBe("reversed");
    });

    it("refuses to cancel a bill that has been paid", async () => {
      const bill = await makeBill();
      await asTenant(companyA, async (tx) => {
        const payment = await paymentRepo.createPayment(tx, {
          companyId: companyA,
          paymentType: "made",
          paymentDate: "2026-08-05",
          paymentMethod: "cash",
          amount: "100.0000",
          partyId: supplier,
          accountId: accounts.bank,
        });
        await paymentRepo.allocateToBill(tx, {
          companyId: companyA,
          paymentId: payment.id,
          billId: bill.id,
          amount: "100.0000",
        });
      });

      await expect(
        asTenant(companyA, (tx) =>
          billRepo.cancelBill(tx, bill.id, randomUUID(), "Changed my mind"),
        ),
      ).rejects.toThrow(/has been paid against it/i);
    });
  });

  describe("aging and isolation", () => {
    it("ages an approved unpaid bill from its due date", async () => {
      const bill = await makeBill({ billDate: "2026-01-01", dueDate: "2026-01-31" });
      await asTenant(companyA, async (tx) => {
        await billRepo.submitBill(tx, bill.id, randomUUID());
        await billRepo.approveBill(tx, bill.id, {
          apAccountId: accounts.ap,
          vatInputAccountId: accounts.vatInput,
          approvedById: randomUUID(),
        });
      });

      const rows = await asTenant(companyA, (tx) => billRepo.getBillAging(tx));
      expect(rows).toHaveLength(1);
      expect(rows[0].bill_number).toBe(bill.billNumber);
      expect(rows[0].aging_bucket).toBe("90+");
      expect(rows[0].balance).toBe("17458.0000");
    });

    it("leaves a draft bill out of the aging", async () => {
      await makeBill({ billDate: "2026-01-01", dueDate: "2026-01-31" });
      const rows = await asTenant(companyA, (tx) => billRepo.getBillAging(tx));
      expect(rows).toHaveLength(0);
    });

    it("hides another tenant's bills", async () => {
      await makeBill();
      const companyB = randomUUID();
      await admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})
      `;
      const seen = await asTenant(companyB, (tx) => billRepo.listBills(tx));
      expect(seen).toHaveLength(0);
    });
  });
});
