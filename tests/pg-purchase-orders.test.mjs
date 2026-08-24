/**
 * Procurement: the order, the receipt, and GR/IR.
 *
 * Covers what the port CHANGED rather than what it carried across.
 *
 *   - received and billed are two derived answers, not one stored counter
 *   - expiry and receipt progress are read, never written
 *   - over-receipt is refused unless the order allowed for it
 *   - acceptance posts DR Inventory / CR GR/IR, and the bill clears it —
 *     the loop §9G says has been open since bills went to Postgres in 0015
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
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { userMessage } = await import("@/app/db/errors");
const poRepo = await import("@/app/db/repositories/purchaseOrders");
const grnRepo = await import("@/app/db/repositories/goodsReceipts");
const billsRepo = await import("@/app/db/repositories/bills");

suite("procurement: purchase orders and goods receipts", () => {
  let admin, client, db;
  let companyA, supplier, widget, inventoryAcct, grniAcct, apAcct, expenseAcct;

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });

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

    companyA = randomUUID();
    supplier = randomUUID();
    widget = randomUUID();
    inventoryAcct = randomUUID();
    grniAcct = randomUUID();
    apAcct = randomUUID();
    expenseAcct = randomUUID();

    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_supplier, name)
        VALUES (${supplier}::uuid, ${companyA}::uuid, 'supplier', true, 'Steel Supplies Ltd')`);
      await tx.execute(sql`
        INSERT INTO products (id, company_id, sku, name, cost_price, selling_price, quantity_on_hand)
        VALUES (${widget}::uuid, ${companyA}::uuid, 'RB-12', 'Rebar 12mm', 0, 150, 0)`);
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, can_post, system_account)
        VALUES
          (${inventoryAcct}::uuid, ${companyA}::uuid, '1200', 'Inventory', 'asset', true, 'inventory'),
          (${grniAcct}::uuid,      ${companyA}::uuid, '2150', 'GR/IR Clearing', 'liability', true, 'grni'),
          (${apAcct}::uuid,        ${companyA}::uuid, '2000', 'Accounts Payable', 'liability', true, 'accounts_payable'),
          (${expenseAcct}::uuid,   ${companyA}::uuid, '5000', 'Purchases', 'expense', true, NULL)`);
      await tx.execute(sql`
        INSERT INTO fiscal_periods
          (company_id, year, month, period_name, period_code, start_date, end_date, status)
        VALUES (${companyA}::uuid, 2026, 8, 'August 2026', '2026-08',
                '2026-08-01', '2026-08-31', 'open')`);
    });
  });

  function orderInput(overrides = {}) {
    return {
      companyId: companyA,
      supplierId: supplier,
      supplierName: "Steel Supplies Ltd",
      poDate: "2026-08-01",
      validUntil: "2026-09-30",
      lines: [
        {
          productId: widget,
          productName: "Rebar 12mm",
          description: "Rebar 12mm",
          accountId: inventoryAcct,
          quantity: "100.0000",
          unitPrice: "50.0000",
          vatRate: "16.0000",
        },
      ],
      createdById: "buyer",
      createdByName: "Bea Buyer",
      ...overrides,
    };
  }

  const openOrder = async (tx, overrides) => {
    const po = await poRepo.createPurchaseOrder(tx, orderInput(overrides));
    await poRepo.sendPurchaseOrder(tx, po.id, "buyer", "Bea Buyer");
    return po;
  };

  describe("creating an order", () => {
    it("numbers from the tenant's prefix and derives every total", async () => {
      const po = await asTenant(companyA, (tx) =>
        poRepo.createPurchaseOrder(tx, orderInput()));

      expect(po.poNumber).toMatch(/^PO/);
      expect(po.subtotal).toBe("5000.0000");
      expect(po.vatTotal).toBe("800.0000");
      expect(po.total).toBe("5800.0000");
      expect(po.status).toBe("draft");
    });

    it("derives withholding from the subtotal and moves it with the lines", async () => {
      const po = await asTenant(companyA, (tx) =>
        poRepo.createPurchaseOrder(tx, orderInput({ whtApplicable: true, whtRate: "5.0000" })));
      expect(po.whtAmount).toBe("250.0000");
      expect(po.netPayable).toBe("5550.0000");

      const updated = await asTenant(companyA, (tx) =>
        poRepo.updatePurchaseOrder(tx, po.id, {
          lines: [{ ...orderInput().lines[0], quantity: "200.0000" }],
        }));
      expect(updated.subtotal).toBe("10000.0000");
      expect(updated.whtAmount).toBe("500.0000");
    });

    it("refuses to edit an order that has been sent", async () => {
      const po = await asTenant(companyA, (tx) => openOrder(tx));
      await expect(
        asTenant(companyA, (tx) =>
          poRepo.updatePurchaseOrder(tx, po.id, { notes: "sneaky" })),
      ).rejects.toThrow(/Only a draft purchase order can be edited/i);
    });
  });

  describe("expiry is read, not written", () => {
    it("reports an order past its validity as expired without touching its status", async () => {
      const po = await asTenant(companyA, (tx) =>
        openOrder(tx, { validUntil: "2026-08-02" }));

      const detail = await asTenant(companyA, (tx) =>
        poRepo.getPurchaseOrderDetail(tx, po.id));

      expect(detail.state.is_expired).toBe(true);
      // The status is still what a person set. The Mongo pre-save hook would
      // have rewritten it to 'expired' on any save.
      expect(detail.status).toBe("sent");
    });

    it("reopening is just moving the date", async () => {
      const po = await asTenant(companyA, (tx) =>
        openOrder(tx, { validUntil: "2026-08-02" }));

      await asTenant(companyA, (tx) =>
        poRepo.reopenPurchaseOrder(tx, po.id, "2027-01-31", "buyer"));

      const detail = await asTenant(companyA, (tx) =>
        poRepo.getPurchaseOrderDetail(tx, po.id));
      expect(detail.status).toBe("draft");
      expect(detail.state.is_expired).toBe(false);
    });
  });

  describe("receiving", () => {
    async function receive(tx, po, receivedQuantity, unitCost = "50.0000") {
      const [line] = await tx.execute(sql`
        SELECT id FROM purchase_order_lines WHERE purchase_order_id = ${po.id}::uuid`);
      return grnRepo.createGoodsReceipt(tx, {
        companyId: companyA,
        sourceType: "purchase_order",
        purchaseOrderId: po.id,
        supplierId: supplier,
        supplierName: "Steel Supplies Ltd",
        receivedDate: "2026-08-10",
        receivedById: "storekeeper",
        createdById: "storekeeper",
        lines: [{
          purchaseOrderLineId: line.id,
          productId: widget,
          productName: "Rebar 12mm",
          description: "Rebar 12mm",
          expectedQuantity: "100.0000",
          receivedQuantity,
          unitCost,
        }],
      });
    }

    it("refuses more than the order allows, and names the running total", async () => {
      const po = await asTenant(companyA, (tx) => openOrder(tx));
      await asTenant(companyA, (tx) => receive(tx, po, "100.0000"));

      // The trigger's sentence reaches the user through userMessage. Drizzle's
      // own message is the statement and its parameters — see app/db/errors.ts.
      const err = await asTenant(companyA, (tx) => receive(tx, po, "1.0000"))
        .catch((e) => e);
      expect(userMessage(err)).toMatch(/would bring the total to 101/i);
      expect(userMessage(err)).toMatch(/tolerance/i);
    });

    it("allows the over-receipt once the buyer grants a tolerance on the order", async () => {
      const po = await asTenant(companyA, (tx) =>
        openOrder(tx, { receiptTolerancePercentage: "10.0000" }));
      await asTenant(companyA, (tx) => receive(tx, po, "100.0000"));

      const second = await asTenant(companyA, (tx) => receive(tx, po, "8.0000"));
      expect(second.grnNumber).toMatch(/^GRN/);
    });

    it("holds submitted stock out of availability until both sides sign", async () => {
      const po = await asTenant(companyA, (tx) => openOrder(tx));
      const grn = await asTenant(companyA, (tx) => receive(tx, po, "40.0000"));
      await asTenant(companyA, (tx) => grnRepo.submitGoodsReceipt(tx, grn.id, "storekeeper"));

      const [product] = await asTenant(companyA, (tx) => tx.execute(sql`
        SELECT quantity_on_hand::text AS on_hand,
               quantity_on_hold::text AS on_hold,
               quantity_available::text AS available
          FROM products WHERE id = ${widget}::uuid`));

      expect(product.on_hand).toBe("40.0000");
      expect(product.on_hold).toBe("40.0000");
      expect(product.available).toBe("0.0000");
    });

    it("refuses to finalise before both signatures are in", async () => {
      const po = await asTenant(companyA, (tx) => openOrder(tx));
      const grn = await asTenant(companyA, (tx) => receive(tx, po, "40.0000"));
      await asTenant(companyA, (tx) => grnRepo.submitGoodsReceipt(tx, grn.id, "storekeeper"));
      await asTenant(companyA, (tx) =>
        grnRepo.signAcceptance(tx, grn.id, "sales", "sam-sales", "Sam"));

      await expect(
        asTenant(companyA, (tx) =>
          grnRepo.finaliseAcceptance(tx, grn.id, {
            inventoryAccountId: inventoryAcct,
            grniAccountId: grniAcct,
            finalisedById: "sam-sales",
          })),
      ).rejects.toThrow(/Finance has not signed/i);
    });
  });

  describe("the GR/IR loop", () => {
    async function receiveAndAccept(tx, po, { received, accepted, unitCost = "50.0000" }) {
      const [line] = await tx.execute(sql`
        SELECT id FROM purchase_order_lines WHERE purchase_order_id = ${po.id}::uuid`);
      const grn = await grnRepo.createGoodsReceipt(tx, {
        companyId: companyA,
        sourceType: "purchase_order",
        purchaseOrderId: po.id,
        supplierId: supplier,
        supplierName: "Steel Supplies Ltd",
        receivedDate: "2026-08-10",
        receivedById: "storekeeper",
        createdById: "storekeeper",
        lines: [{
          purchaseOrderLineId: line.id,
          productId: widget,
          productName: "Rebar 12mm",
          description: "Rebar 12mm",
          expectedQuantity: "100.0000",
          receivedQuantity: received,
          unitCost,
        }],
      });
      await grnRepo.submitGoodsReceipt(tx, grn.id, "storekeeper");
      const lines = await tx.execute(sql`
        SELECT id FROM goods_receipt_lines WHERE goods_receipt_id = ${grn.id}::uuid`);
      await grnRepo.recordLineDecisions(tx, grn.id, [{
        goodsReceiptLineId: lines[0].id,
        acceptedQuantity: accepted,
        lineStatus: Number(accepted) > 0 ? "accepted" : "rejected",
        rejectReason: Number(accepted) < Number(received) ? "Surface rust" : null,
      }]);
      await grnRepo.signAcceptance(tx, grn.id, "sales", "sam-sales", "Sam");
      await grnRepo.signAcceptance(tx, grn.id, "finance", "fay-finance", "Fay");
      const result = await grnRepo.finaliseAcceptance(tx, grn.id, {
        inventoryAccountId: inventoryAcct,
        grniAccountId: grniAcct,
        finalisedById: "fay-finance",
      });
      return { grn, ...result };
    }

    it("posts DR Inventory / CR GR/IR for what was accepted, and records the entry on the receipt", async () => {
      const po = await asTenant(companyA, (tx) => openOrder(tx));
      const { entry, goodsReceipt } = await asTenant(companyA, (tx) =>
        receiveAndAccept(tx, po, { received: "40.0000", accepted: "35.0000" }));

      expect(goodsReceipt.journalEntryId).toBe(entry.id);
      expect(entry.status).toBe("posted");

      const lines = await asTenant(companyA, (tx) => tx.execute(sql`
        SELECT a.system_account, jl.debit::text AS debit, jl.credit::text AS credit
          FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
         WHERE jl.entry_id = ${entry.id}::uuid
         ORDER BY jl.line_number`));

      // 35 accepted x 50 = 1750. The five rejected units are not bought.
      expect(lines).toEqual([
        { system_account: "inventory", debit: "1750.0000", credit: "0.0000" },
        { system_account: "grni", debit: "0.0000", credit: "1750.0000" },
      ]);
    });

    it("admits the accepted stock, removes the rejected, and re-costs from zero", async () => {
      const po = await asTenant(companyA, (tx) => openOrder(tx));
      await asTenant(companyA, (tx) =>
        receiveAndAccept(tx, po, { received: "40.0000", accepted: "35.0000" }));

      const [product] = await asTenant(companyA, (tx) => tx.execute(sql`
        SELECT quantity_on_hand::text AS on_hand, quantity_on_hold::text AS on_hold,
               quantity_available::text AS available, cost_price::text AS cost_price
          FROM products WHERE id = ${widget}::uuid`));

      expect(product.on_hand).toBe("35.0000");
      expect(product.on_hold).toBe("0.0000");
      expect(product.available).toBe("35.0000");
      // Was 0 at creation — a warehouse role never sets it. The receipt is
      // where a real cost basis comes from.
      expect(product.cost_price).toBe("50.0000");
    });

    it("shows the position open until the bill arrives, then closed", async () => {
      const po = await asTenant(companyA, (tx) => openOrder(tx));
      await asTenant(companyA, (tx) =>
        receiveAndAccept(tx, po, { received: "35.0000", accepted: "35.0000" }));

      const open = await asTenant(companyA, (tx) => grnRepo.getGrIrOpenItems(tx));
      expect(open).toHaveLength(1);
      expect(open[0].uninvoiced_quantity).toBe("35.0000");
      expect(open[0].uninvoiced_value).toBe("1750.0000");

      const available = await asTenant(companyA, (tx) =>
        poRepo.getAvailableLines(tx, po.id));
      await asTenant(companyA, (tx) =>
        poRepo.convertToBill(tx, po.id, [
          { purchaseOrderLineId: available[0].id, quantity: "35.0000" },
        ], {
          billDate: "2026-08-20",
          dueDate: "2026-09-20",
          createdById: "fay-finance",
        }));

      const after = await asTenant(companyA, (tx) => grnRepo.getGrIrOpenItems(tx));
      expect(after).toHaveLength(0);
    });

    it("reopens the position when the bill is cancelled — the case a counter got wrong", async () => {
      const po = await asTenant(companyA, (tx) => openOrder(tx));
      await asTenant(companyA, (tx) =>
        receiveAndAccept(tx, po, { received: "35.0000", accepted: "35.0000" }));

      const available = await asTenant(companyA, (tx) =>
        poRepo.getAvailableLines(tx, po.id));
      const bill = await asTenant(companyA, (tx) =>
        poRepo.convertToBill(tx, po.id, [
          { purchaseOrderLineId: available[0].id, quantity: "35.0000" },
        ], { billDate: "2026-08-20", dueDate: "2026-09-20", createdById: "fay" }));

      await asTenant(companyA, (tx) =>
        billsRepo.cancelBill(tx, bill.id, "fay", "Wrong supplier"));

      const after = await asTenant(companyA, (tx) => grnRepo.getGrIrOpenItems(tx));
      expect(after).toHaveLength(1);
      expect(after[0].uninvoiced_value).toBe("1750.0000");
    });
  });

  describe("billed and received are different questions", () => {
    it("billing an order does not claim the goods arrived", async () => {
      const po = await asTenant(companyA, (tx) => openOrder(tx));

      const available = await asTenant(companyA, (tx) =>
        poRepo.getAvailableLines(tx, po.id));
      await asTenant(companyA, (tx) =>
        poRepo.convertToBill(tx, po.id, [
          { purchaseOrderLineId: available[0].id, quantity: "100.0000" },
        ], { billDate: "2026-08-20", dueDate: "2026-09-20", createdById: "fay" }));

      const detail = await asTenant(companyA, (tx) =>
        poRepo.getPurchaseOrderDetail(tx, po.id));

      // Mongo's convertToBill calls recordReceiving() here, which is the
      // conflation §9G describes.
      expect(detail.state.billed_quantity).toBe("100.0000");
      expect(detail.state.received_quantity).toBe("0.0000");
      expect(detail.state.receipt_state).toBe("none");
      expect(detail.state.bill_state).toBe("complete");
    });

    it("refuses to bill more than the order has left, counting only bills", async () => {
      const po = await asTenant(companyA, (tx) => openOrder(tx));
      const available = await asTenant(companyA, (tx) =>
        poRepo.getAvailableLines(tx, po.id));

      await expect(
        asTenant(companyA, (tx) =>
          poRepo.convertToBill(tx, po.id, [
            { purchaseOrderLineId: available[0].id, quantity: "101.0000" },
          ], { billDate: "2026-08-20", dueDate: "2026-09-20", createdById: "fay" })),
      ).rejects.toThrow(/only 100.0000 of the ordered 100.0000 is still unbilled/i);
    });
  });

  describe("cancelling and closing", () => {
    it("refuses to cancel an order that goods have arrived against", async () => {
      const po = await asTenant(companyA, (tx) => openOrder(tx));
      await asTenant(companyA, async (tx) => {
        const [line] = await tx.execute(sql`
          SELECT id FROM purchase_order_lines WHERE purchase_order_id = ${po.id}::uuid`);
        return grnRepo.createGoodsReceipt(tx, {
          companyId: companyA,
          sourceType: "purchase_order",
          purchaseOrderId: po.id,
          receivedDate: "2026-08-10",
          createdById: "storekeeper",
          lines: [{
            purchaseOrderLineId: line.id, productId: widget, productName: "Rebar 12mm",
            description: "Rebar 12mm", expectedQuantity: "100.0000",
            receivedQuantity: "40.0000", unitCost: "50.0000",
          }],
        });
      });

      await expect(
        asTenant(companyA, (tx) => poRepo.cancelPurchaseOrder(tx, po.id, "changed our mind", "buyer")),
      ).rejects.toThrow(/Close it short instead/i);
    });

    it("closes an order short, with a reason", async () => {
      const po = await asTenant(companyA, (tx) => openOrder(tx));
      const closed = await asTenant(companyA, (tx) =>
        poRepo.closePurchaseOrder(tx, po.id, "Supplier cannot deliver the balance", "buyer"));
      expect(closed.status).toBe("closed");
      expect(closed.closureReason).toBe("Supplier cannot deliver the balance");
    });
  });

  describe("tenant isolation", () => {
    it("does not show another tenant's orders", async () => {
      const other = randomUUID();
      await admin`INSERT INTO companies (id, name, slug) VALUES (${other}, 'Elsewhere', ${"e-" + other.slice(0, 8)})`;
      await asTenant(companyA, (tx) => poRepo.createPurchaseOrder(tx, orderInput()));

      const mine = await asTenant(companyA, (tx) => poRepo.listPurchaseOrders(tx));
      const theirs = await asTenant(other, (tx) => poRepo.listPurchaseOrders(tx));
      expect(mine).toHaveLength(1);
      expect(theirs).toHaveLength(0);
    });
  });
});
