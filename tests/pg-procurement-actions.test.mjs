/**
 * Procurement, driven the way the screens drive it.
 *
 * The repository suites prove the schema and the postings. This one proves the
 * layer above them — the actions the components actually call, with the forms'
 * own payloads — because that is the layer the quotes port skipped, and the
 * one where a mismatch shows as a blank page rather than a failure.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn) => fn() }));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));

const { getTenantContext } = await import("@/lib/utils/tenant-utils");
const poActions = await import("@/app/db/actions/purchase-order-actions");
const grnActions = await import("@/app/db/actions/grn-actions");
const ncrActions = await import("@/app/db/actions/ncr-actions");

/** POForm's payload: flat named fields, `lines[0].description` style. */
function orderForm({ supplierId, lines, ...rest }) {
  const fd = new FormData();
  fd.set("supplierId", supplierId);
  fd.set("poDate", "2026-08-01");
  fd.set("validUntil", "2026-09-30");
  for (const [k, v] of Object.entries(rest)) fd.set(k, String(v));
  lines.forEach((l, i) => {
    for (const [k, v] of Object.entries(l)) {
      fd.set(`lines[${i}].${k}`, String(v));
    }
  });
  return fd;
}

/** GRNForm's payload: one JSON blob under `payload`, with `receivedQty` keys. */
function receiptForm(body) {
  const fd = new FormData();
  fd.set("payload", JSON.stringify(body));
  return fd;
}

suite("procurement actions (end to end)", () => {
  let admin;
  let companyUuid, mongoCompanyId, supplierId, widgetId, inventoryAcct;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  function asRole(role) {
    getTenantContext.mockResolvedValue({
      user: { id: `${role}-${randomUUID().slice(0, 8)}`, name: `A ${role}`, role },
      companyId: mongoCompanyId,
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE _migration_id_map, entry_counters`;

    companyUuid = randomUUID();
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);
    supplierId = randomUUID();
    widgetId = randomUUID();
    inventoryAcct = randomUUID();

    await admin`INSERT INTO companies (id, name, slug)
                VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
                VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`INSERT INTO parties (id, company_id, primary_type, is_supplier, name,
                                    email, phone, tax_pin, address_line1, city)
               VALUES (${supplierId}, ${companyUuid}, 'supplier', true, 'Steel Supplies Ltd',
                       'sales@steel.co.ke', '+254700111222', 'P051234567A', 'Enterprise Rd', 'Nairobi')`;
      await tx`INSERT INTO products (id, company_id, sku, name, cost_price, selling_price, quantity_on_hand)
               VALUES (${widgetId}, ${companyUuid}, 'RB-12', 'Rebar 12mm', 0, 150, 0)`;
      await tx`INSERT INTO accounts (id, company_id, account_code, account_name, account_type, can_post, system_account) VALUES
               (${inventoryAcct}, ${companyUuid}, '1200', 'Inventory', 'asset', true, 'inventory'),
               (${randomUUID()}, ${companyUuid}, '2150', 'GR/IR Clearing', 'liability', true, 'grni'),
               (${randomUUID()}, ${companyUuid}, '2000', 'Accounts Payable', 'liability', true, 'accounts_payable'),
               (${randomUUID()}, ${companyUuid}, '5300', 'Inventory Adjustments', 'expense', true, 'inventory_adjustments')`;
      await tx`INSERT INTO fiscal_periods
                 (company_id, year, month, period_name, period_code, start_date, end_date, status)
               VALUES (${companyUuid}, 2026, 8, 'August 2026', '2026-08',
                       '2026-08-01', '2026-08-31', 'open')`;
    });

    asRole("Procurement Officer");
  });

  const baseLine = {
    productId: "",
    accountId: "",
    description: "Rebar 12mm",
    quantity: 100,
    unit: "pcs",
    unitPrice: 50,
    vatRate: 16,
  };

  async function createOrder(overrides = {}) {
    const res = await poActions.createPurchaseOrderPg(
      null,
      orderForm({
        supplierId,
        lines: [{ ...baseLine, productId: widgetId, accountId: inventoryAcct }],
        ...overrides,
      }),
    );
    expect(res.success).toBe(true);
    return res;
  }

  describe("raising an order from the form", () => {
    it("parses the form's flat field names and lets the database own the money", async () => {
      const res = await createOrder();
      expect(res.poNumber).toMatch(/^PO/);

      const [row] = await admin`SELECT subtotal, vat_total, total, status
                                  FROM purchase_orders WHERE id = ${res.purchaseOrderId}`;
      expect(row.subtotal).toBe("5000.0000");
      expect(row.vat_total).toBe("800.0000");
      expect(row.total).toBe("5800.0000");
      expect(row.status).toBe("draft");
    });

    it("snapshots the supplier from the party row, which the form never posts", async () => {
      const res = await createOrder();
      const [row] = await admin`SELECT supplier_name, supplier_email, supplier_tax_pin,
                                       supplier_address
                                  FROM purchase_orders WHERE id = ${res.purchaseOrderId}`;
      // The form posts a hidden supplierId and nothing else about them.
      expect(row.supplier_name).toBe("Steel Supplies Ltd");
      expect(row.supplier_email).toBe("sales@steel.co.ke");
      expect(row.supplier_tax_pin).toBe("P051234567A");
      expect(row.supplier_address).toBe("Enterprise Rd, Nairobi");
    });

    it("refuses a Storekeeper", async () => {
      asRole("Storekeeper");
      const res = await poActions.createPurchaseOrderPg(
        null,
        orderForm({ supplierId, lines: [{ ...baseLine, productId: widgetId }] }),
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/permission/i);
    });
  });

  describe("the display shape the screens read", () => {
    it("gives the detail page every field it dereferences", async () => {
      const { purchaseOrderId } = await createOrder();
      const po = await poActions.getPurchaseOrderForDisplayPg(purchaseOrderId);

      expect(po._id).toBe(purchaseOrderId);
      expect(po.supplier.name).toBe("Steel Supplies Ltd");
      expect(po.amounts.total).toBe(5800);
      expect(po.lines[0].vat.rate).toBe(16);
      expect(po.lines[0].product.sku).toBe("RB-12");
      expect(po.linkedBills).toEqual([]);
      // Nothing received: the three questions the old counter conflated.
      expect(po.lines[0].receivedQuantity).toBe(0);
      expect(po.lines[0].billedQuantity).toBe(0);
      expect(po.lines[0].unbilledQuantity).toBe(100);
    });

    it("reports receipt progress and expiry as a status the badge understands", async () => {
      const { purchaseOrderId } = await createOrder({ validUntil: "2026-08-02" });
      await poActions.sendPurchaseOrderPg(purchaseOrderId);

      const po = await poActions.getPurchaseOrderForDisplayPg(purchaseOrderId);
      // 'expired' is derived; `workflowStatus` is what a person set.
      expect(po.status).toBe("expired");
      expect(po.workflowStatus).toBe("sent");
    });

    it("counts derived receipt states in the stat cards", async () => {
      await createOrder();
      const stats = await poActions.getPurchaseOrderStatsForDisplayPg();
      expect(stats.total).toBe(1);
      expect(stats.draft).toBe(1);
      expect(stats.partial).toBe(0);
      expect(stats.received).toBe(0);
      expect(stats.totalValue).toBe(5800);
    });
  });

  describe("receiving, from the receipt form's own payload", () => {
    async function openOrderWithLine() {
      const { purchaseOrderId } = await createOrder();
      await poActions.sendPurchaseOrderPg(purchaseOrderId);
      const [line] = await admin`SELECT id FROM purchase_order_lines
                                  WHERE purchase_order_id = ${purchaseOrderId}`;
      return { purchaseOrderId, lineId: line.id };
    }

    function receiptBody({ purchaseOrderId, lineId, receivedQty, expectedQty = 100, extra = {} }) {
      return {
        sourceType: "purchase_order",
        purchaseOrderId,
        supplierPartyId: supplierId,
        supplierName: "Steel Supplies Ltd",
        receivedDate: "2026-08-10",
        notes: "",
        lines: [{
          purchaseOrderLineId: lineId,
          productId: widgetId,
          description: "Rebar 12mm",
          sku: "RB-12",
          expectedQty,
          receivedQty,
          unitCost: 50,
          unit: "pcs",
          packagingCondition: "good",
          physicalCondition: "good",
          inspectionNotes: "",
          storageLocation: "",
          ...extra,
        }],
      };
    }

    it("links the receipt line to the order line the form carried", async () => {
      const { purchaseOrderId, lineId } = await openOrderWithLine();
      asRole("Storekeeper");

      const res = await grnActions.createGoodsReceiptPg(
        null,
        receiptForm(receiptBody({ purchaseOrderId, lineId, receivedQty: 40 })),
      );
      expect(res.success).toBe(true);

      const [row] = await admin`SELECT purchase_order_line_id, received_quantity, unit_cost
                                  FROM goods_receipt_lines
                                 WHERE goods_receipt_id = ${res.goodsReceiptId}`;
      // Without this the tolerance cannot be measured and the order reads as
      // never delivered.
      expect(row.purchase_order_line_id).toBe(lineId);
      expect(row.received_quantity).toBe("40.0000");
      expect(row.unit_cost).toBe("50.0000");
    });

    it("refuses a Procurement Officer — they raised the order", async () => {
      const { purchaseOrderId, lineId } = await openOrderWithLine();
      const res = await grnActions.createGoodsReceiptPg(
        null,
        receiptForm(receiptBody({ purchaseOrderId, lineId, receivedQty: 40 })),
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/permission/i);
    });

    it("surfaces the tolerance trigger's sentence, not a constraint name", async () => {
      const { purchaseOrderId, lineId } = await openOrderWithLine();
      asRole("Storekeeper");
      await grnActions.createGoodsReceiptPg(
        null,
        receiptForm(receiptBody({ purchaseOrderId, lineId, receivedQty: 100 })),
      );

      const res = await grnActions.createGoodsReceiptPg(
        null,
        receiptForm(receiptBody({ purchaseOrderId, lineId, receivedQty: 5 })),
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/would bring the total to 105/i);
    });

    it("raises a nonconformance when what arrived is not what was expected", async () => {
      const { purchaseOrderId, lineId } = await openOrderWithLine();
      asRole("Storekeeper");
      const created = await grnActions.createGoodsReceiptPg(
        null,
        receiptForm(receiptBody({ purchaseOrderId, lineId, receivedQty: 40 })),
      );

      const res = await grnActions.submitGoodsReceiptPg(created.goodsReceiptId);
      expect(res.success).toBe(true);
      // SOP §10.6 — on the register the moment it is seen.
      expect(res.message).toMatch(/NCR/);

      const listed = await ncrActions.listNonconformancesForDisplayPg({
        goodsReceiptId: created.goodsReceiptId,
      });
      expect(listed).toHaveLength(1);
      expect(listed[0].source.grnId).toBe(created.goodsReceiptId);
    });

    it("does not raise a second nonconformance on re-submission", async () => {
      const { purchaseOrderId, lineId } = await openOrderWithLine();
      asRole("Storekeeper");
      const created = await grnActions.createGoodsReceiptPg(
        null,
        receiptForm(receiptBody({ purchaseOrderId, lineId, receivedQty: 40 })),
      );
      await grnActions.submitGoodsReceiptPg(created.goodsReceiptId);
      // Already submitted, so this fails — the point is that it does not add
      // a second report, which a `grn.ncrId` back-pointer could not prevent.
      await grnActions.submitGoodsReceiptPg(created.goodsReceiptId);

      const listed = await ncrActions.listNonconformancesForDisplayPg({
        goodsReceiptId: created.goodsReceiptId,
      });
      expect(listed).toHaveLength(1);
    });

    it("posts the clearing entry when the second signature lands", async () => {
      const { purchaseOrderId, lineId } = await openOrderWithLine();
      asRole("Storekeeper");
      const created = await grnActions.createGoodsReceiptPg(
        null,
        receiptForm(receiptBody({ purchaseOrderId, lineId, receivedQty: 100 })),
      );
      await grnActions.submitGoodsReceiptPg(created.goodsReceiptId);

      const lines = await admin`SELECT id FROM goods_receipt_lines
                                 WHERE goods_receipt_id = ${created.goodsReceiptId}`;
      asRole("Finance Manager");
      const decisions = new FormData();
      decisions.set("data", JSON.stringify([
        { goodsReceiptLineId: lines[0].id, acceptedQuantity: 100, lineStatus: "accepted" },
      ]));
      await grnActions.recordLineDecisionsPg(created.goodsReceiptId, null, decisions);

      asRole("Sales Manager");
      const first = await grnActions.acceptGoodsReceiptPg(created.goodsReceiptId, "sales");
      expect(first.success).toBe(true);
      // One signature is not acceptance.
      expect(first.journalEntryId).toBeNull();
      expect(first.message).toMatch(/waiting on the other side/i);

      asRole("Finance Manager");
      const second = await grnActions.acceptGoodsReceiptPg(created.goodsReceiptId, "finance");
      expect(second.success).toBe(true);
      expect(second.journalEntryId).toBeTruthy();

      const je = await admin`SELECT a.system_account, jl.debit::text AS debit, jl.credit::text AS credit
                               FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
                              WHERE jl.entry_id = ${second.journalEntryId}
                              ORDER BY jl.line_number`;
      expect(je).toEqual([
        { system_account: "inventory", debit: "5000.0000", credit: "0.0000" },
        { system_account: "grni", debit: "0.0000", credit: "5000.0000" },
      ]);

      // And the order now reads as fully received, derived.
      const po = await poActions.getPurchaseOrderForDisplayPg(purchaseOrderId);
      expect(po.status).toBe("received");
      expect(po.workflowStatus).toBe("sent");
      expect(po.receivedAt).toBe("2026-08-10");
    });
  });

  describe("billing measures against bills, not receipts", () => {
    it("bills an order that nothing has been received against", async () => {
      const { purchaseOrderId } = await createOrder();
      await poActions.sendPurchaseOrderPg(purchaseOrderId);

      const available = await poActions.getAvailablePurchaseOrderLinesPg(purchaseOrderId);
      expect(available).toHaveLength(1);
      expect(available[0].available_quantity).toBe("100.0000");

      asRole("Accountant");
      const fd = new FormData();
      fd.set("billDate", "2026-08-20");
      fd.set("dueDate", "2026-09-20");
      fd.set("lines[0][lineId]", available[0].id);
      fd.set("lines[0][quantity]", "100");

      const res = await poActions.convertPurchaseOrderToBillPg(purchaseOrderId, null, fd);
      expect(res.success).toBe(true);
      expect(res.billNumber).toMatch(/^BILL/);

      const po = await poActions.getPurchaseOrderForDisplayPg(purchaseOrderId);
      // Billed in full, received nothing — which is the distinction the Mongo
      // counter could not express.
      expect(po.lines[0].billedQuantity).toBe(100);
      expect(po.lines[0].receivedQuantity).toBe(0);
      expect(po.linkedBills).toHaveLength(1);
    });
  });

  describe("closing an order that can no longer be cancelled", () => {
    it("refuses the cancellation and accepts the closure", async () => {
      const { purchaseOrderId } = await createOrder();
      await poActions.sendPurchaseOrderPg(purchaseOrderId);
      const [line] = await admin`SELECT id FROM purchase_order_lines
                                  WHERE purchase_order_id = ${purchaseOrderId}`;

      asRole("Storekeeper");
      await grnActions.createGoodsReceiptPg(null, receiptForm({
        sourceType: "purchase_order",
        purchaseOrderId,
        supplierPartyId: supplierId,
        supplierName: "Steel Supplies Ltd",
        receivedDate: "2026-08-10",
        lines: [{
          purchaseOrderLineId: line.id, productId: widgetId,
          description: "Rebar 12mm", sku: "RB-12",
          expectedQty: 100, receivedQty: 40, unitCost: 50, unit: "pcs",
          packagingCondition: "good", physicalCondition: "good",
        }],
      }));

      asRole("Procurement Officer");
      const cancelData = new FormData();
      cancelData.set("reason", "changed our mind");
      const cancelled = await poActions.cancelPurchaseOrderPg(
        purchaseOrderId, null, cancelData,
      );
      expect(cancelled.success).toBe(false);
      expect(cancelled.error).toMatch(/Close it short instead/i);

      const closeData = new FormData();
      closeData.set("reason", "Supplier cannot deliver the balance");
      const closed = await poActions.closePurchaseOrderPg(purchaseOrderId, null, closeData);
      expect(closed.success).toBe(true);

      const po = await poActions.getPurchaseOrderForDisplayPg(purchaseOrderId);
      expect(po.status).toBe("closed");
      expect(po.closureReason).toBe("Supplier cannot deliver the balance");
    });
  });
});
