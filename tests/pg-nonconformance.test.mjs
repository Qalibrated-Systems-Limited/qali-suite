/**
 * Nonconformance: what was decided about the goods, and what it posted.
 *
 * The centre of this suite is the thing closeNCR does not do. It moves stock
 * out of HOLD according to the disposition and posts nothing — "journal-entry
 * posting for return/scrap is intentionally out of scope here" — so scrapped
 * goods leave the shelf and keep their value on the balance sheet.
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
const grnRepo = await import("@/app/db/repositories/goodsReceipts");
const ncrRepo = await import("@/app/db/repositories/nonconformance");

suite("nonconformance", () => {
  let admin, client, db;
  let companyA, supplier, widget;
  let inventoryAcct, grniAcct, writeOffAcct;

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });

  const accounts = () => ({
    inventoryAccountId: inventoryAcct,
    grniAccountId: grniAcct,
    writeOffAccountId: writeOffAcct,
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
    writeOffAcct = randomUUID();

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
          (${writeOffAcct}::uuid,  ${companyA}::uuid, '5900', 'Stock Write-offs', 'expense', true, NULL)`);
      await tx.execute(sql`
        INSERT INTO fiscal_periods
          (company_id, year, month, period_name, period_code, start_date, end_date, status)
        VALUES (${companyA}::uuid, 2026, 8, 'August 2026', '2026-08',
                '2026-08-01', '2026-08-31', 'open')`);
    });
  });

  /**
   * A delivery of two pallets of the SAME product at different prices, the
   * second held for a disposition. This is the shape that defeats matching by
   * product id.
   */
  async function deliveryWithHeldPallet(tx) {
    const grn = await grnRepo.createGoodsReceipt(tx, {
      companyId: companyA,
      sourceType: "unscheduled",
      supplierId: supplier,
      supplierName: "Steel Supplies Ltd",
      receivedDate: "2026-08-10",
      receivedById: "storekeeper",
      createdById: "storekeeper",
      lines: [
        {
          productId: widget, productName: "Rebar 12mm", description: "Pallet A",
          expectedQuantity: "20.0000", receivedQuantity: "20.0000", unitCost: "50.0000",
        },
        {
          productId: widget, productName: "Rebar 12mm", description: "Pallet B (rusted)",
          expectedQuantity: "20.0000", receivedQuantity: "20.0000", unitCost: "80.0000",
          physicalCondition: "defective",
        },
      ],
    });
    await grnRepo.submitGoodsReceipt(tx, grn.id, "storekeeper");

    const lines = await tx.execute(sql`
      SELECT id, line_number FROM goods_receipt_lines
       WHERE goods_receipt_id = ${grn.id}::uuid ORDER BY line_number`);

    await grnRepo.recordLineDecisions(tx, grn.id, [
      { goodsReceiptLineId: lines[0].id, acceptedQuantity: "20.0000", lineStatus: "accepted" },
      { goodsReceiptLineId: lines[1].id, acceptedQuantity: "0.0000", lineStatus: "hold" },
    ]);
    await grnRepo.signAcceptance(tx, grn.id, "sales", "sam-sales", "Sam");
    await grnRepo.signAcceptance(tx, grn.id, "finance", "fay-finance", "Fay");
    await grnRepo.finaliseAcceptance(tx, grn.id, {
      inventoryAccountId: inventoryAcct,
      grniAccountId: grniAcct,
      finalisedById: "fay-finance",
    });
    return { grn, lines };
  }

  async function raiseAndAuthorise(tx, grnId, disposition) {
    const ncr = await ncrRepo.createFromGoodsReceipt(tx, grnId, {
      createdById: "storekeeper", createdByName: "Sam Stores",
    });
    await ncrRepo.proposeDisposition(tx, ncr.id, disposition, "Surface rust throughout", "mary", "Mary");
    await ncrRepo.authorizeDisposition(tx, ncr.id, "md", "Managing Director");
    return ncr;
  }

  const entryLines = (tx, entryId) => tx.execute(sql`
    SELECT a.account_code, jl.debit::text AS debit, jl.credit::text AS credit
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
     WHERE jl.entry_id = ${entryId}::uuid ORDER BY jl.line_number`);

  const product = (tx) => tx.execute(sql`
    SELECT quantity_on_hand::text AS on_hand, quantity_on_hold::text AS on_hold,
           quantity_available::text AS available, cost_price::text AS cost_price
      FROM products WHERE id = ${widget}::uuid`);

  describe("raising it from a receipt", () => {
    it("names the receipt lines rather than matching them by product", async () => {
      const { grn, lines } = await asTenant(companyA, (tx) => deliveryWithHeldPallet(tx));
      const ncr = await asTenant(companyA, (tx) =>
        ncrRepo.createFromGoodsReceipt(tx, grn.id, { createdById: "storekeeper" }));

      const detail = await asTenant(companyA, (tx) =>
        ncrRepo.getNonconformanceDetail(tx, ncr.id));

      // Only the held pallet, and it is identified by id — both lines carry
      // the same product, which is what defeats a Map keyed on product id.
      expect(detail.lines).toHaveLength(1);
      expect(detail.lines[0].goods_receipt_line_id).toBe(lines[1].id);
      expect(detail.lines[0].unit_cost).toBe("80.0000");
      // 20 units at the SECOND pallet's cost, not the first's.
      expect(detail.state.affected_value).toBe("1600.0000");
    });

    it("refuses a proposal from the person who raised it", async () => {
      const { grn } = await asTenant(companyA, (tx) => deliveryWithHeldPallet(tx));
      const ncr = await asTenant(companyA, (tx) =>
        ncrRepo.createFromGoodsReceipt(tx, grn.id, { createdById: "storekeeper" }));

      const err = await asTenant(companyA, (tx) =>
        ncrRepo.proposeDisposition(tx, ncr.id, "scrap", "Rusted", "storekeeper"))
        .catch((e) => e);
      expect(userMessage(err)).toMatch(/cannot propose a disposition for a nonconformance you raised/i);
    });

    it("refuses authorisation from the proposer", async () => {
      const { grn } = await asTenant(companyA, (tx) => deliveryWithHeldPallet(tx));
      const ncr = await asTenant(companyA, (tx) =>
        ncrRepo.createFromGoodsReceipt(tx, grn.id, { createdById: "storekeeper" }));
      await asTenant(companyA, (tx) =>
        ncrRepo.proposeDisposition(tx, ncr.id, "scrap", "Rusted", "mary"));

      const err = await asTenant(companyA, (tx) =>
        ncrRepo.authorizeDisposition(tx, ncr.id, "mary")).catch((e) => e);
      expect(userMessage(err)).toMatch(/ask another authority/i);
    });

    it("will not carry out a disposition nobody authorised", async () => {
      const { grn } = await asTenant(companyA, (tx) => deliveryWithHeldPallet(tx));
      const ncr = await asTenant(companyA, (tx) =>
        ncrRepo.createFromGoodsReceipt(tx, grn.id, { createdById: "storekeeper" }));
      await asTenant(companyA, (tx) =>
        ncrRepo.proposeDisposition(tx, ncr.id, "scrap", "Rusted", "mary"));

      await expect(
        asTenant(companyA, (tx) =>
          ncrRepo.executeDisposition(tx, ncr.id, { ...accounts(), executedById: "md" })),
      ).rejects.toThrow(/must be authorised first/i);
    });
  });

  describe("scrap", () => {
    it("posts the write-off against GR/IR and takes the stock out", async () => {
      const { grn } = await asTenant(companyA, (tx) => deliveryWithHeldPallet(tx));
      const ncr = await asTenant(companyA, (tx) => raiseAndAuthorise(tx, grn.id, "scrap"));

      const { entry } = await asTenant(companyA, (tx) =>
        ncrRepo.executeDisposition(tx, ncr.id, { ...accounts(), executedById: "md" }));

      // The entry Mongo never makes. 20 x 80 = 1600.
      const lines = await asTenant(companyA, (tx) => entryLines(tx, entry.id));
      expect(lines).toEqual([
        { account_code: "5900", debit: "1600.0000", credit: "0.0000" },
        { account_code: "2150", debit: "0.0000", credit: "1600.0000" },
      ]);

      // Pallet A (20 accepted) stays; pallet B is gone and nothing is held.
      const [p] = await asTenant(companyA, (tx) => product(tx));
      expect(p.on_hand).toBe("20.0000");
      expect(p.on_hold).toBe("0.0000");
      expect(p.available).toBe("20.0000");
    });

    it("records the scrapped goods as accepted, so GR/IR can still net", async () => {
      const { grn, lines } = await asTenant(companyA, (tx) => deliveryWithHeldPallet(tx));
      const ncr = await asTenant(companyA, (tx) => raiseAndAuthorise(tx, grn.id, "scrap"));
      await asTenant(companyA, (tx) =>
        ncrRepo.executeDisposition(tx, ncr.id, { ...accounts(), executedById: "md" }));

      const [line] = await asTenant(companyA, (tx) => tx.execute(sql`
        SELECT line_status, accepted_quantity::text AS accepted
          FROM goods_receipt_lines WHERE id = ${lines[1].id}::uuid`));
      // Scrapped goods were still BOUGHT — the supplier will invoice for them.
      expect(line.line_status).toBe("accepted");
      expect(line.accepted).toBe("20.0000");
    });
  });

  describe("return to supplier", () => {
    it("posts nothing, because the goods were never ours", async () => {
      const { grn, lines } = await asTenant(companyA, (tx) => deliveryWithHeldPallet(tx));
      const ncr = await asTenant(companyA, (tx) =>
        raiseAndAuthorise(tx, grn.id, "return_to_supplier"));

      const { entry } = await asTenant(companyA, (tx) =>
        ncrRepo.executeDisposition(tx, ncr.id, { ...accounts(), executedById: "md" }));
      expect(entry).toBeNull();

      const [p] = await asTenant(companyA, (tx) => product(tx));
      expect(p.on_hand).toBe("20.0000");
      expect(p.on_hold).toBe("0.0000");

      const [line] = await asTenant(companyA, (tx) => tx.execute(sql`
        SELECT line_status, accepted_quantity::text AS accepted
          FROM goods_receipt_lines WHERE id = ${lines[1].id}::uuid`));
      expect(line.line_status).toBe("rejected");
      expect(line.accepted).toBe("0.0000");
    });
  });

  describe("keeping the goods", () => {
    it("accept_as_is admits them and posts what acceptance would have", async () => {
      const { grn } = await asTenant(companyA, (tx) => deliveryWithHeldPallet(tx));
      const ncr = await asTenant(companyA, (tx) =>
        raiseAndAuthorise(tx, grn.id, "accept_as_is"));

      const { entry } = await asTenant(companyA, (tx) =>
        ncrRepo.executeDisposition(tx, ncr.id, { ...accounts(), executedById: "md" }));

      const lines = await asTenant(companyA, (tx) => entryLines(tx, entry.id));
      expect(lines).toEqual([
        { account_code: "1200", debit: "1600.0000", credit: "0.0000" },
        { account_code: "2150", debit: "0.0000", credit: "1600.0000" },
      ]);

      const [p] = await asTenant(companyA, (tx) => product(tx));
      expect(p.on_hand).toBe("40.0000");
      expect(p.on_hold).toBe("0.0000");
      expect(p.available).toBe("40.0000");
      // 20 @ 50 blended with 20 @ 80.
      expect(p.cost_price).toBe("65.0000");
    });

    it("repair releases the goods rather than holding them forever", async () => {
      const { grn } = await asTenant(companyA, (tx) => deliveryWithHeldPallet(tx));
      const ncr = await asTenant(companyA, (tx) => raiseAndAuthorise(tx, grn.id, "repair"));
      await asTenant(companyA, (tx) =>
        ncrRepo.executeDisposition(tx, ncr.id, { ...accounts(), executedById: "md" }));

      // Mongo maps 'repair' to a no-op "until the repair workflow completes",
      // and that workflow does not exist — so the stock stays held.
      const [p] = await asTenant(companyA, (tx) => product(tx));
      expect(p.on_hold).toBe("0.0000");
      expect(p.available).toBe("40.0000");
    });
  });

  describe("a decision is taken once", () => {
    it("will not reopen a closed nonconformance", async () => {
      const { grn } = await asTenant(companyA, (tx) => deliveryWithHeldPallet(tx));
      const ncr = await asTenant(companyA, (tx) => raiseAndAuthorise(tx, grn.id, "scrap"));
      await asTenant(companyA, (tx) =>
        ncrRepo.executeDisposition(tx, ncr.id, { ...accounts(), executedById: "md" }));

      const err = await asTenant(companyA, (tx) =>
        ncrRepo.cancelNonconformance(tx, ncr.id, "mistake", "md")).catch((e) => e);
      expect(userMessage(err)).toMatch(/cannot become cancelled|cannot be reopened/i);
    });

    it("will not push a resolved receipt line back into hold", async () => {
      const { grn, lines } = await asTenant(companyA, (tx) => deliveryWithHeldPallet(tx));
      const ncr = await asTenant(companyA, (tx) => raiseAndAuthorise(tx, grn.id, "scrap"));
      await asTenant(companyA, (tx) =>
        ncrRepo.executeDisposition(tx, ncr.id, { ...accounts(), executedById: "md" }));

      const err = await asTenant(companyA, (tx) => tx.execute(sql`
        UPDATE goods_receipt_lines SET line_status = 'hold' WHERE id = ${lines[1].id}::uuid`))
        .catch((e) => e);
      expect(userMessage(err)).toMatch(/cannot be changed once the receipt leaves draft/i);
    });
  });
});
