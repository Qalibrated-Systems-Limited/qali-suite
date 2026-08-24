/**
 * Stock requests, end to end through the server actions.
 *
 * §9.9 is the thing being checked here. Mongo maintains five values by hand in
 * `recalculateFulfillment()` — an item's totalFulfilled, remaining and status,
 * and the request's status and totalValue — through a method every caller has
 * to remember. All five are generated columns or triggers now, so these tests
 * mostly assert that nobody has to remember anything.
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
const requests = await import("@/app/db/actions/request-actions");
const { withTenant } = await import("@/app/db/client");
const fulfilment = await import("@/app/db/repositories/fulfilment");

const objectId = () =>
  Array.from({ length: 24 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

suite("stock request actions (end to end)", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let userId;
  let customerId;
  let widgetId;
  let gadgetId;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  function form({ items = [], ...fields }) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null) fd.set(k, String(v));
    }
    items.forEach((item, i) => {
      for (const [k, v] of Object.entries(item)) {
        fd.set(`items[${i}].${k}`, String(v ?? ""));
      }
    });
    return fd;
  }

  const validForm = (over = {}) =>
    form({
      requestType: "sale",
      customerId,
      priority: "normal",
      items: [{ productId: widgetId, requestedQuantity: 10, unitPrice: 250 }],
      ...over,
    });

  beforeEach(async () => {
    await admin`TRUNCATE companies, _migration_id_map, entry_counters CASCADE`;

    companyUuid = randomUUID();
    mongoCompanyId = objectId();
    userId = objectId();
    customerId = randomUUID();
    widgetId = randomUUID();
    gadgetId = randomUUID();

    await admin`INSERT INTO companies (id, name, slug)
                VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
                VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`INSERT INTO parties (id, company_id, primary_type, is_customer, name)
               VALUES (${customerId}, ${companyUuid}, 'customer', true, 'Acme Ltd')`;
      await tx`
        INSERT INTO products (id, company_id, sku, name, cost_price, selling_price, quantity_on_hand) VALUES
          (${widgetId}, ${companyUuid}, 'WID-1', 'Widget', 40, 250, 100),
          (${gadgetId}, ${companyUuid}, 'GAD-1', 'Gadget', 10, 99, 50)
      `;
    });

    getTenantContext.mockResolvedValue({
      user: { id: userId, name: "Ada Manager", role: "Admin" },
      companyId: mongoCompanyId,
      companyCode: "PILOT",
    });
  });

  describe("create", () => {
    it("creates a pending request and derives its total value", async () => {
      const result = await requests.createStockRequest(null, validForm());
      expect(result.success, result.error).toBe(true);
      expect(result.requestNumber).toMatch(/^(SR|REQ)-/);

      const detail = await requests.getRequestById(result.requestId);
      expect(detail.status).toBe("pending");
      expect(detail.requester.name).toBe("Ada Manager");
      // Nothing in the action computes this: a trigger does, from the items.
      expect(detail.totalValue).toBe("2500.0000");
      expect(detail.items).toHaveLength(1);
      // The stock level when the request was raised — the basis of the
      // decision, and immutable after (0022).
      expect(detail.items[0].currentStock).toBe("100.0000");
    });

    it("leaves approved quantity unset until somebody approves", async () => {
      const result = await requests.createStockRequest(null, validForm());
      const detail = await requests.getRequestById(result.requestId);

      // Mongo writes 0 here and every reader resolves it back to the requested
      // quantity via `||`. NULL says "not approved yet" without needing a
      // convention to read it (§9B.3).
      expect(detail.items[0].approvedQuantity).toBeNull();
      expect(detail.items[0].remainingToFulfil).toBe("10.0000");
      expect(detail.items[0].fulfilmentStatus).toBe("pending");
    });

    it("requires a customer for a customer-facing request", async () => {
      const result = await requests.createStockRequest(
        null,
        validForm({ customerId: "" }),
      );
      expect(result.success).toBe(false);
      expect(result.fieldErrors.customerId).toBeDefined();
    });

    it("needs no customer for an internal request", async () => {
      const result = await requests.createStockRequest(
        null,
        validForm({ requestType: "internal", customerId: "" }),
      );
      expect(result.success, result.error).toBe(true);

      const detail = await requests.getRequestById(result.requestId);
      expect(detail.customer.id).toBeNull();
    });

    it("returns field errors rather than a constraint violation", async () => {
      const result = await requests.createStockRequest(
        null,
        form({ requestType: "sale", customerId, items: [] }),
      );
      expect(result.success).toBe(false);
      expect(result.fieldErrors.items).toBeDefined();
    });
  });

  describe("approval", () => {
    async function pending(over = {}) {
      const r = await requests.createStockRequest(null, validForm(over));
      expect(r.success, r.error).toBe(true);
      return r.requestId;
    }

    it("approves in full when a quantity is left blank", async () => {
      const id = await pending();
      const result = await requests.approveStockRequest(id, null, new FormData());
      expect(result.success, result.error).toBe(true);

      const detail = await requests.getRequestById(id);
      expect(detail.status).toBe("approved");
      expect(detail.items[0].approvedQuantity).toBe("10.0000");
      expect(detail.approver.name).toBe("Ada Manager");
    });

    it("approves less than was asked for", async () => {
      const id = await pending();
      const before = await requests.getRequestById(id);

      const fd = new FormData();
      fd.set(`approved_${before.items[0].id}`, "4");
      const result = await requests.approveStockRequest(id, null, fd);
      expect(result.success, result.error).toBe(true);

      const detail = await requests.getRequestById(id);
      expect(detail.items[0].approvedQuantity).toBe("4.0000");
      // Derived from the approved quantity, not from what was asked.
      expect(detail.items[0].remainingToFulfil).toBe("4.0000");
      // And the request's value follows the approval.
      expect(detail.totalValue).toBe("1000.0000");
    });

    it("refuses to approve more than was requested", async () => {
      const id = await pending();
      const before = await requests.getRequestById(id);

      const fd = new FormData();
      fd.set(`approved_${before.items[0].id}`, "50");
      const result = await requests.approveStockRequest(id, null, fd);
      // The approval answers the request; it does not replace it.
      expect(result.success).toBe(false);

      const detail = await requests.getRequestById(id);
      expect(detail.status).toBe("pending");
    });

    it("rejects with a reason, and refuses one without", async () => {
      const id = await pending();
      expect((await requests.rejectStockRequest(id, null, new FormData())).success).toBe(false);

      const fd = new FormData();
      fd.set("reason", "Out of budget");
      const result = await requests.rejectStockRequest(id, null, fd);
      expect(result.success, result.error).toBe(true);

      const detail = await requests.getRequestById(id);
      expect(detail.status).toBe("rejected");
      expect(detail.rejectionReason).toBe("Out of budget");
    });

    it("refuses a role that cannot approve", async () => {
      const id = await pending();
      getTenantContext.mockResolvedValue({
        user: { id: objectId(), name: "Sales", role: "Sales Manager" },
        companyId: mongoCompanyId,
        companyCode: "PILOT",
      });
      const result = await requests.approveStockRequest(id, null, new FormData());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/permission/i);
    });
  });

  describe("cancel", () => {
    it("cancels a request nothing has been issued against", async () => {
      const r = await requests.createStockRequest(null, validForm());
      const fd = new FormData();
      fd.set("reason", "Customer withdrew");
      const result = await requests.cancelStockRequest(r.requestId, null, fd);
      expect(result.success, result.error).toBe(true);

      const detail = await requests.getRequestById(r.requestId);
      expect(detail.status).toBe("cancelled");
      expect(detail.cancellationReason).toBe("Customer withdrew");
    });

    it("refuses once stock has been issued", async () => {
      const r = await requests.createStockRequest(null, validForm());
      await requests.approveStockRequest(r.requestId, null, new FormData());

      const detail = await requests.getRequestById(r.requestId);
      await withTenant(companyUuid, (tx) =>
        fulfilment.recordFulfilment(tx, {
          companyId: companyUuid,
          itemId: detail.items[0].id,
          quantity: "3.0000",
          fulfilledById: userId,
          fulfilledByName: "Ada Manager",
        }),
      );

      const fd = new FormData();
      fd.set("reason", "Changed mind");
      const result = await requests.cancelStockRequest(r.requestId, null, fd);
      // Once stock has moved the question is a return, not a cancellation.
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already been issued/i);
    });
  });

  describe("fulfilment moves the derived values", () => {
    it("updates item and request state with nothing recalculated by hand", async () => {
      const r = await requests.createStockRequest(null, validForm());
      await requests.approveStockRequest(r.requestId, null, new FormData());
      const before = await requests.getRequestById(r.requestId);

      await withTenant(companyUuid, (tx) =>
        fulfilment.recordFulfilment(tx, {
          companyId: companyUuid,
          itemId: before.items[0].id,
          quantity: "4.0000",
          fulfilledById: userId,
          fulfilledByName: "Ada Manager",
        }),
      );

      const partial = await requests.getRequestById(r.requestId);
      // Four of the five values §9.9 lists, all without a helper being called.
      expect(partial.items[0].totalFulfilled).toBe("4.0000");
      expect(partial.items[0].remainingToFulfil).toBe("6.0000");
      expect(partial.items[0].fulfilmentStatus).toBe("partial");
      expect(partial.status).toBe("partially_fulfilled");

      await withTenant(companyUuid, (tx) =>
        fulfilment.recordFulfilment(tx, {
          companyId: companyUuid,
          itemId: before.items[0].id,
          quantity: "6.0000",
          fulfilledById: userId,
          fulfilledByName: "Ada Manager",
        }),
      );

      const done = await requests.getRequestById(r.requestId);
      expect(done.items[0].remainingToFulfil).toBe("0.0000");
      expect(done.items[0].fulfilmentStatus).toBe("complete");
      expect(done.status).toBe("fulfilled");
    });

    it("refuses to issue more than was approved", async () => {
      const r = await requests.createStockRequest(null, validForm());
      const fd = new FormData();
      const before = await requests.getRequestById(r.requestId);
      fd.set(`approved_${before.items[0].id}`, "5");
      await requests.approveStockRequest(r.requestId, null, fd);

      await expect(
        withTenant(companyUuid, (tx) =>
          fulfilment.recordFulfilment(tx, {
            companyId: companyUuid,
            itemId: before.items[0].id,
            quantity: "6.0000",
            fulfilledById: userId,
            fulfilledByName: "Ada Manager",
          }),
        ),
      ).rejects.toThrow(/more than approved/i);
    });
  });

  describe("list and stats", () => {
    it("sums the fulfilment totals in SQL, not by adding strings", async () => {
      const r = await requests.createStockRequest(
        null,
        validForm({
          items: [
            { productId: widgetId, requestedQuantity: 10, unitPrice: 250 },
            { productId: gadgetId, requestedQuantity: 5, unitPrice: 99 },
          ],
        }),
      );
      await requests.approveStockRequest(r.requestId, null, new FormData());

      const { requests: rows } = await requests.getRequestsPaginated({});
      const [row] = rows;
      // The page reduced these in JavaScript over numeric(19,4) STRINGS, so
      // `0 + "10.0000"` gave "010.0000" and the next line appended to it.
      expect(row.totalRequested).toBe("15.0000");
      expect(row.totalFulfilled).toBe("0.0000");
      expect(row.totalRemaining).toBe("15.0000");
      expect(row.itemCount).toBe(2);
      expect(row.progress).toBe(0);
    });

    it("filters, searches and paginates", async () => {
      const a = await requests.createStockRequest(null, validForm());
      await requests.createStockRequest(null, validForm({ priority: "urgent" }));
      await requests.approveStockRequest(a.requestId, null, new FormData());

      const approved = await requests.getRequestsPaginated({ status: "approved" });
      expect(approved.requests).toHaveLength(1);

      const urgent = await requests.getRequestsPaginated({ priority: "urgent" });
      expect(urgent.requests).toHaveLength(1);

      const byRequester = await requests.getRequestsPaginated({ query: "Ada" });
      expect(byRequester.total).toBe(2);

      const paged = await requests.getRequestsPaginated({ perPage: 1 });
      expect(paged.requests).toHaveLength(1);
      expect(paged.totalPages).toBe(2);
    });

    it("counts urgent and overdue from the data, not from a stored flag", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const today = new Date().toISOString().slice(0, 10);

      await requests.createStockRequest(
        null,
        validForm({ priority: "urgent", requiredByDate: yesterday.toISOString().slice(0, 10) }),
      );
      // Due TODAY has not run out of time yet.
      await requests.createStockRequest(null, validForm({ requiredByDate: today }));

      const stats = await requests.getRequestStats();
      expect(stats.total).toBe(2);
      expect(stats.pending).toBe(2);
      expect(stats.urgentCount).toBe(1);
      expect(stats.overdueCount).toBe(1);
    });

    it("shows another tenant nothing", async () => {
      await requests.createStockRequest(null, validForm());
      const otherMongo = objectId();
      const otherUuid = randomUUID();
      await admin`INSERT INTO companies (id, name, slug)
                  VALUES (${otherUuid}, 'Other', ${"o-" + otherUuid.slice(0, 8)})`;
      await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
                  VALUES ('companies', ${otherMongo}, ${otherUuid})`;
      getTenantContext.mockResolvedValue({
        user: { id: objectId(), name: "Other", role: "Admin" },
        companyId: otherMongo,
        companyCode: "OTHER",
      });

      const r = await requests.getRequestsPaginated({});
      expect(r.requests).toEqual([]);
      expect(r.total).toBe(0);
    });
  });

  describe("form data", () => {
    it("offers customers and products from the store the form writes to", async () => {
      const { customers, products } = await requests.getRequestFormData();
      expect(customers.map((c) => c._id)).toContain(customerId);
      const widget = products.find((p) => p._id === widgetId);
      expect(widget.SKU).toBe("WID-1");
      expect(widget.inventory.quantityAvailable).toBe("100.0000");
    });
  });

  describe("fulfil", () => {
    async function approved(over = {}) {
      const r = await requests.createStockRequest(null, validForm(over));
      await requests.approveStockRequest(r.requestId, null, new FormData());
      return requests.getRequestById(r.requestId);
    }

    function issueForm(items) {
      const fd = new FormData();
      for (const [id, q] of Object.entries(items)) fd.set(`item_${id}`, String(q));
      return fd;
    }

    it("records provenance BEFORE the level moves", async () => {
      const detail = await approved();
      const result = await requests.fulfillRequest(
        detail._id,
        null,
        issueForm({ [detail.items[0].id]: 10 }),
      );
      expect(result.success, result.error).toBe(true);

      const [movement] = await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        return tx`
          SELECT previous_stock::text AS prev, new_stock::text AS next,
                 quantity::text AS qty, direction::text
            FROM stock_movements
        `;
      });
      // Issuing first would have written this as "90 -> 80" — the §9.7 defect,
      // found at four other call sites and avoided here by ordering.
      expect(movement.prev).toBe("100.0000");
      expect(movement.next).toBe("90.0000");
      expect(movement.direction).toBe("out");

      const [product] = await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        return tx`SELECT quantity_on_hand::text AS q FROM products WHERE id = ${widgetId}`;
      });
      expect(product.q).toBe("90.0000");
    });

    it("moves every derived value without recalculating one", async () => {
      const detail = await approved();
      await requests.fulfillRequest(
        detail._id,
        null,
        issueForm({ [detail.items[0].id]: 4 }),
      );

      const partial = await requests.getRequestById(detail._id);
      expect(partial.items[0].totalFulfilled).toBe("4.0000");
      expect(partial.items[0].remainingToFulfil).toBe("6.0000");
      expect(partial.status).toBe("partially_fulfilled");

      await requests.fulfillRequest(
        detail._id,
        null,
        issueForm({ [detail.items[0].id]: 6 }),
      );
      const done = await requests.getRequestById(detail._id);
      expect(done.status).toBe("fulfilled");
    });

    it("raises a checkout for a loan, and none for a sale", async () => {
      const sale = await approved();
      await requests.fulfillRequest(sale._id, null, issueForm({ [sale.items[0].id]: 1 }));

      const demo = await approved({ requestType: "demo" });
      await requests.fulfillRequest(demo._id, null, issueForm({ [demo.items[0].id]: 2 }));

      const checkouts = await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        return tx`
          SELECT request_type::text, quantity::text AS q, request_number_at_checkout
            FROM item_checkouts
        `;
      });
      // Sold stock is gone; a demo has to come back, which is what the
      // outstanding-checkouts queue is for.
      expect(checkouts).toHaveLength(1);
      expect(checkouts[0].request_type).toBe("demo");
      expect(checkouts[0].q).toBe("2.0000");
    });

    it("refuses to issue against a request nobody has approved", async () => {
      const r = await requests.createStockRequest(null, validForm());
      const detail = await requests.getRequestById(r.requestId);
      const result = await requests.fulfillRequest(
        r.requestId,
        null,
        issueForm({ [detail.items[0].id]: 1 }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/must be approved/i);
    });

    it("refuses to issue more than was approved", async () => {
      // Approved for FIVE of the ten requested, in the one approval a request
      // gets — approveStockRequest requires `pending`, so a second call is a
      // no-op rather than a revision.
      const r = await requests.createStockRequest(null, validForm());
      const pending = await requests.getRequestById(r.requestId);
      const fd = new FormData();
      fd.set(`approved_${pending.items[0].id}`, "5");
      const approval = await requests.approveStockRequest(r.requestId, null, fd);
      expect(approval.success, approval.error).toBe(true);

      const detail = await requests.getRequestById(r.requestId);
      expect(detail.items[0].approvedQuantity).toBe("5.0000");

      const result = await requests.fulfillRequest(
        detail._id,
        null,
        issueForm({ [detail.items[0].id]: 6 }),
      );
      expect(result.success).toBe(false);

      // And nothing moved: the whole issue is one transaction.
      const [product] = await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
        return tx`SELECT quantity_on_hand::text AS q FROM products WHERE id = ${widgetId}`;
      });
      expect(product.q).toBe("100.0000");
    });

    it("says so when every line was left blank", async () => {
      const detail = await approved();
      const result = await requests.fulfillRequest(detail._id, null, new FormData());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Nothing to issue/i);
    });
  });
});
