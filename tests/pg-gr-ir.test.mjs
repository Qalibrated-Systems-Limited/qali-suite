/**
 * GR/IR reconciliation — 0119, and the first coverage the goods receipt
 * posting path has had.
 *
 * WHAT IS BEING PROVED. GR/IR is the account that holds the value of goods
 * between the delivery and the invoice:
 *
 *     accept()   DR Inventory  CR GR/IR
 *     approve()  DR GR/IR      CR Accounts Payable
 *
 * So the reconciliation screen makes a claim the ledger can check — that the
 * positions it lists add up to the balance of the account. These tests drive a
 * real receipt through acceptance and then assert BOTH: the position the
 * screen shows, and the account balance it reconciles against. Either alone
 * can be right while the pair disagree, and a reconciliation that does not
 * reconcile is the one bug this screen absolutely must not have.
 *
 * The signs are asserted too, because the whole point of the view is that
 * nobody downstream has to interpret one:
 *
 *     accepted > billed  ->  awaiting_invoice, positive
 *     accepted < billed  ->  awaiting_receipt, negative
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
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));

const { getTenantContext } = await import("@/lib/utils/tenant-utils");
const grn = await import("@/app/db/actions/grn-actions");
const grIr = await import("@/app/db/actions/gr-ir-actions");

suite("GR/IR reconciliation", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let supplierId;
  let productId;
  let poId;
  let poLineId;

  const asRole = (role) =>
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: `${role} User`, role },
      companyId: mongoCompanyId,
    });

  /** The GR/IR account, straight from the ledger. */
  const ledgerBalance = async () => {
    const [row] = await admin`
      SELECT COALESCE(balance, 0)::float8 AS balance
        FROM account_balances
       WHERE company_id = ${companyUuid} AND system_account = 'grni'`;
    return Number(row?.balance ?? 0);
  };

  /**
   * A receipt of `quantity` against the order line, taken all the way through
   * acceptance — which is the step that posts.
   */
  const receive = async (quantity) => {
    const grnId = randomUUID();
    await admin`
      INSERT INTO goods_receipts
        (id, company_id, grn_number, source_type, purchase_order_id,
         supplier_id, supplier_name, received_date, status)
      VALUES (${grnId}, ${companyUuid}, ${"GRN-" + grnId.slice(0, 6)},
              'purchase_order', ${poId}, ${supplierId}, 'Acme Supplies',
              CURRENT_DATE, 'draft')`;
    await admin`
      INSERT INTO goods_receipt_lines
        (company_id, goods_receipt_id, line_number, purchase_order_line_id,
         product_id, product_name, description, received_quantity,
         expected_quantity, unit_cost)
      VALUES (${companyUuid}, ${grnId}, 1, ${poLineId}, ${productId},
              'Widget', 'Widget', ${quantity}, ${quantity}, 250)`;

    asRole("Storekeeper");
    const submitted = await grn.submitGoodsReceiptPg(grnId);
    expect(submitted.success).toBe(true);

    // The SOP's two signatures. The second one posts.
    asRole("Sales Manager");
    const sales = await grn.acceptGoodsReceiptPg(grnId, "sales");
    expect(sales.success).toBe(true);

    asRole("Finance Manager");
    const finance = await grn.acceptGoodsReceiptPg(grnId, "finance");
    expect(finance.success).toBe(true);

    return grnId;
  };

  /** A bill for `quantity`, linked to the order line through document_flow. */
  const bill = async (quantity) => {
    const billId = randomUUID();
    const billLineId = randomUUID();

    /*
      ONE TRANSACTION, because the schema requires one. A deferred constraint
      refuses a bill with no lines — "Bill BILL-xxxx must have at least one
      line" — and `admin` autocommits each statement, so inserting the header
      on its own trips it before the line exists. That check is right and the
      fixture was wrong: a bill and its lines are one document.
    */
    await admin.begin(async (tx) => {
      await tx`
        INSERT INTO bills
          (id, company_id, bill_number, supplier_id, supplier_name_at_bill,
           bill_date, due_date, status, purchase_order_id, used_grni,
           inventory_moved, subtotal)
        VALUES (${billId}, ${companyUuid}, ${"BILL-" + billId.slice(0, 6)},
                ${supplierId}, 'Acme Supplies', CURRENT_DATE, CURRENT_DATE,
                'approved', ${poId}, true, false, ${quantity * 250})`;
      // `total`, `amount` and `line_total` are GENERATED — 0015 derives them
      // from the line arithmetic so a bill cannot carry a total that disagrees
      // with its lines. The fixture supplies what a person enters, and nothing
      // the schema computes.
      await tx`
        INSERT INTO bill_lines
          (id, company_id, bill_id, line_number, description, quantity,
           unit_price, account_id, account_code_at_bill, account_name_at_bill,
           account_type, purchase_order_id, purchase_order_line_number)
        VALUES (${billLineId}, ${companyUuid}, ${billId}, 1, 'Widget',
                ${quantity}, 250,
                (SELECT id FROM accounts
                  WHERE company_id = ${companyUuid} AND system_account = 'inventory'),
                '1300', 'Inventory', 'asset', ${poId}, 1)`;
      // `purchase_order_line_billed` reaches bill lines through document_flow,
      // which is what approveBill writes. The fixture writes the same link.
      await tx`
        INSERT INTO document_flow
          (company_id, predecessor_type, predecessor_id, successor_type,
           successor_id, quantity)
        VALUES (${companyUuid}, 'purchase_order_line', ${poLineId}, 'bill_line',
                ${billLineId}, ${quantity})`;
    });
    return billId;
  };

  const position = async () => {
    const [row] = await admin`
      SELECT direction, uninvoiced_value::float8 AS uninvoiced,
             received_value::float8 AS received, billed_value::float8 AS billed,
             ordered_value::float8 AS ordered, age_bucket
        FROM gr_ir_position
       WHERE purchase_order_line_id = ${poLineId}`;
    return row ?? null;
  };

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyUuid = randomUUID();
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);
    supplierId = randomUUID();
    productId = randomUUID();
    poId = randomUUID();
    poLineId = randomUUID();

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;
    await admin`INSERT INTO company_settings (company_id) VALUES (${companyUuid})`;

    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`
        INSERT INTO accounts
          (id, company_id, account_code, account_name, account_type, system_account)
        VALUES
          (${randomUUID()}, ${companyUuid}, '1300', 'Inventory', 'asset', 'inventory'),
          (${randomUUID()}, ${companyUuid}, '2175', 'GR/IR Clearing', 'liability', 'grni'),
          (${randomUUID()}, ${companyUuid}, '2100', 'Accounts Payable', 'liability', 'accounts_payable')`;
    });

    await admin`
      INSERT INTO parties (id, company_id, primary_type, is_supplier, name)
      VALUES (${supplierId}, ${companyUuid}, 'supplier', true, 'Acme Supplies')`;
    await admin`
      INSERT INTO products (id, company_id, sku, name, unit, cost_price,
                            selling_price, quantity_on_hand, costing_method)
      VALUES (${productId}, ${companyUuid}, 'WID-1', 'Widget', 'pcs', 250, 500, 0, 'average')`;

    // 400 widgets at 250 = 100,000 ordered.
    // DRAFT FIRST, then confirmed. A trigger refuses a line on an order that
    // has left draft — "Purchase order lines cannot be changed once the order
    // leaves draft" — which is the real rule and not a fixture inconvenience.
    await admin`
      INSERT INTO purchase_orders
        (id, company_id, po_number, supplier_id, supplier_name, po_date, status)
      VALUES (${poId}, ${companyUuid}, 'PO-1042', ${supplierId}, 'Acme Supplies',
              CURRENT_DATE, 'draft')`;
    await admin`
      INSERT INTO purchase_order_lines
        (id, company_id, purchase_order_id, line_number, description, quantity, unit_price)
      VALUES (${poLineId}, ${companyUuid}, ${poId}, 1, 'Widget', 400, 250)`;
    await admin`
      UPDATE purchase_orders SET status = 'confirmed' WHERE id = ${poId}`;
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("goods in, invoice not yet", () => {
    it("opens a position the ledger agrees with", async () => {
      await receive(400);

      const p = await position();
      expect(p.direction).toBe("awaiting_invoice");
      expect(p.received).toBe(100_000);
      expect(p.billed).toBe(0);
      expect(p.uninvoiced).toBe(100_000);

      // THE CLAIM THE SCREEN MAKES. Acceptance credited GR/IR, and the
      // position is the same number read from the other side.
      expect(await ledgerBalance()).toBe(100_000);
    });

    it("summarises it as a magnitude, not a sign", async () => {
      await receive(400);
      asRole("Finance Manager");

      const s = await grIr.getGrIrSummaryPg();
      expect(s.awaitingInvoice).toBe(100_000);
      expect(s.awaitingReceipt).toBe(0);
      expect(s.exceptions).toBe(1);
      // Nothing the order lines cannot account for.
      expect(s.unattributed).toBe(0);
      expect(s.ledgerBalance).toBe(s.netPositions);
    });

    it("reads a short delivery as still awaiting the rest of the invoice", async () => {
      // 320 of 400 received. The order is short; GR/IR holds only what came.
      await receive(320);

      const p = await position();
      expect(p.ordered).toBe(100_000);
      expect(p.received).toBe(80_000);
      expect(p.direction).toBe("awaiting_invoice");
      expect(await ledgerBalance()).toBe(80_000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("invoice in, goods not yet", () => {
    it("opens the position in the other direction", async () => {
      // Billed for 400, received 320 — your ABC Ltd / XYZ Ltd example, from
      // the invoice side.
      await receive(320);
      await bill(400);

      const p = await position();
      expect(p.received).toBe(80_000);
      expect(p.billed).toBe(100_000);
      expect(p.direction).toBe("awaiting_receipt");
      expect(p.uninvoiced).toBe(-20_000);
    });

    it("reports it as a positive figure under its own heading", async () => {
      await receive(320);
      await bill(400);
      asRole("Accountant");

      const s = await grIr.getGrIrSummaryPg();
      // NOT -20,000. The direction carries the meaning; the number is what
      // the reader sees, and a reader should never subtract to understand a
      // dashboard.
      expect(s.awaitingReceipt).toBe(20_000);
      expect(s.awaitingInvoice).toBe(0);

      const [row] = await grIr.listGrIrPositionsPg({ limit: 10 });
      expect(row.direction).toBe("awaiting_receipt");
      expect(row.outstanding).toBe(20_000);
      expect(row.uninvoicedValue).toBe(-20_000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("matched", () => {
    it("drops out of the exceptions once both documents agree", async () => {
      await receive(400);
      await bill(400);

      const p = await position();
      expect(p.direction).toBe("matched");
      expect(p.uninvoiced).toBe(0);

      asRole("Procurement Officer");
      const s = await grIr.getGrIrSummaryPg();
      expect(s.exceptions).toBe(0);
      expect(s.matched).toBe(100_000);
      expect(s.awaitingInvoice).toBe(0);
      expect(s.awaitingReceipt).toBe(0);

      // A matched line is not an exception and must not be listed as one.
      const rows = await grIr.listGrIrPositionsPg({ limit: 10 });
      expect(rows).toHaveLength(0);
    });

    it("leaves an order nobody has acted on out of GR/IR entirely", async () => {
      // Ordered, never received, never billed. An open ORDER, not an open
      // position: it has posted nothing and belongs on the PO screen.
      expect(await position()).toBeNull();

      asRole("Accountant");
      const s = await grIr.getGrIrSummaryPg();
      expect(s.exceptions).toBe(0);
      expect(s.ledgerBalance).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("ageing", () => {
    it("buckets a position by how long it has been waiting", async () => {
      await receive(400);
      // Backdate the receipt: the position has been open since the goods came.
      await admin`
        UPDATE goods_receipts
           SET received_date = CURRENT_DATE - 95
         WHERE company_id = ${companyUuid}`;

      const p = await position();
      expect(p.age_bucket).toBe("90+");

      asRole("CFO");
      const ageing = await grIr.getGrIrAgeingPg();
      const old = ageing.find(
        (r) => r.direction === "awaiting_invoice" && r.ageBucket === "90+",
      );
      expect(old.amount).toBe(100_000);
      expect(old.count).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the supplier on a receipt (0122)", () => {
    /**
     * `supplier_id` always had a real composite foreign key. What it did not
     * have was anything requiring it to be filled: the form only ever set the
     * NAME, and `supplierPartyId` reached the payload as a side effect of
     * choosing a PO or a bill. So an unscheduled receipt posted its acceptance
     * entry with no party at all.
     */
    const insertGrn = (over = {}) => {
      const cols = {
        id: randomUUID(),
        company_id: companyUuid,
        grn_number: "GRN-" + randomUUID().slice(0, 6),
        source_type: "purchase_order",
        purchase_order_id: poId,
        supplier_id: supplierId,
        supplier_name: "Acme Supplies",
        ...over,
      };
      return admin`
        INSERT INTO goods_receipts
          (id, company_id, grn_number, source_type, purchase_order_id,
           supplier_id, supplier_name, received_date, status)
        VALUES (${cols.id}, ${cols.company_id}, ${cols.grn_number},
                ${cols.source_type}, ${cols.purchase_order_id},
                ${cols.supplier_id}, ${cols.supplier_name},
                CURRENT_DATE, 'draft')`;
    };

    it("refuses a receipt that names nobody", async () => {
      await expect(insertGrn({ supplier_name: null })).rejects.toThrow(
        /supplier_name_present/,
      );
    });

    it("treats a blank name as naming nobody", async () => {
      await expect(insertGrn({ supplier_name: "   " })).rejects.toThrow(
        /supplier_name_present/,
      );
    });

    it("refuses a PO-backed receipt that lost the supplier link", async () => {
      // A purchase order carries a supplier already — purchase_orders.supplier_id
      // is NOT NULL — so a receipt derived from one has no excuse to drop it.
      await expect(insertGrn({ supplier_id: null })).rejects.toThrow(
        /supplier_linked_unless_unscheduled/,
      );
    });

    it("lets an unscheduled receipt stand on the name alone", async () => {
      // Goods do arrive from somebody not yet on file, and refusing the
      // receipt would leave the storekeeper holding stock they cannot book in.
      await insertGrn({
        source_type: "unscheduled",
        purchase_order_id: null,
        supplier_id: null,
        supplier_name: "Walk-in Supplier",
      });
      const [row] = await admin`
        SELECT supplier_name FROM goods_receipts
         WHERE source_type = 'unscheduled' AND company_id = ${companyUuid}`;
      expect(row.supplier_name).toBe("Walk-in Supplier");
    });

    it("still will not let an unscheduled receipt be anonymous", async () => {
      await expect(
        insertGrn({
          source_type: "unscheduled",
          purchase_order_id: null,
          supplier_id: null,
          supplier_name: null,
        }),
      ).rejects.toThrow(/supplier_name_present/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what the screen cannot attribute", () => {
    it("reports a posting with no order line rather than hiding it", async () => {
      // An unscheduled receipt — a walk-in delivery with no PO. It credits
      // GR/IR and has no order line to appear under, so the positions cannot
      // explain the balance. The screen prints the difference instead of
      // presenting a subtotal as though it were the account.
      const grnId = randomUUID();
      await admin`
        INSERT INTO goods_receipts
          (id, company_id, grn_number, source_type, supplier_name,
           received_date, status)
        VALUES (${grnId}, ${companyUuid}, 'GRN-WALKIN', 'unscheduled',
                -- 0122: every receipt names who the goods came from. An
                -- unscheduled one may stand on the name alone — the supplier
                -- is not on file yet — but it may not be anonymous.
                'Walk-in Supplier', CURRENT_DATE, 'draft')`;
      await admin`
        INSERT INTO goods_receipt_lines
          (company_id, goods_receipt_id, line_number, product_id, product_name,
           description, received_quantity, expected_quantity, unit_cost)
        VALUES (${companyUuid}, ${grnId}, 1, ${productId}, 'Widget', 'Widget',
                40, 40, 250)`;

      asRole("Storekeeper");
      await grn.submitGoodsReceiptPg(grnId);
      asRole("Sales Manager");
      await grn.acceptGoodsReceiptPg(grnId, "sales");
      asRole("Finance Manager");
      await grn.acceptGoodsReceiptPg(grnId, "finance");

      const s = await grIr.getGrIrSummaryPg();
      expect(s.ledgerBalance).toBe(10_000);
      expect(s.netPositions).toBe(0);
      expect(s.unattributed).toBe(10_000);
    });
  });
});
