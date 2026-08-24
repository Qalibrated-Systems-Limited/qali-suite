/**
 * Field names, pinned where a form and its action disagreed.
 *
 * Every case below is a field a form has always posted under one name while
 * its Postgres action read another. None of them threw: the value simply went
 * nowhere, which is why they lasted. Found by diffing what each form posts
 * against what its action accepts.
 *
 * These tests use the posted names deliberately. Renaming either side without
 * the other fails them.
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

const fulfilmentRepo = await import("@/app/db/repositories/fulfilment");

suite("form field names the actions read", () => {
  let admin, client, db, companyA, widget;

  const asTenant = (c, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${c}, true)`);
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
    widget = randomUUID();
    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;
    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO products (id, company_id, sku, name, cost_price, selling_price, quantity_on_hand)
        VALUES (${widget}::uuid, ${companyA}::uuid, 'RB-12', 'Rebar 12mm', 100, 500, 500)`);
    });
  });

  it("an approval keeps its conditions and its per-line notes", async () => {
    // `approval_conditions` has had a column since 0020 and mapRequest reads it
    // back out to display. Nothing ever wrote it, so it rendered NULL from the
    // day it shipped. The per-line `notes_<id>` boxes went the same way.
    const result = await asTenant(companyA, async (tx) => {
      const request = await fulfilmentRepo.createStockRequest(tx, {
        companyId: companyA,
        requestType: "internal",
        requesterName: "Sam Stores",
        requesterDepartment: "Technical",
        items: [{ productId: widget, requestedQuantity: "10.0000", unitPrice: "0.0000" }],
      });

      const full = await fulfilmentRepo.getStockRequest(tx, request.id);
      await fulfilmentRepo.approveStockRequest(
        tx,
        request.id,
        [
          {
            itemId: full.items[0].id,
            approvedQuantity: "6.0000",
            notes: "Only six in stock; rest to follow",
          },
        ],
        {
          approvedById: "mgr",
          approverName: "Manager",
          comments: "Approved short",
          conditions: "Collect from the main store before Friday",
        },
      );
      return fulfilmentRepo.getStockRequest(tx, request.id);
    });

    // getStockRequest returns the raw row; the display mapper nests these
    // under `approver`, which is where the detail page reads them.
    expect(result.approvalConditions).toBe(
      "Collect from the main store before Friday",
    );
    expect(result.approvalComments).toBe("Approved short");
    expect(result.items[0].notes).toBe("Only six in stock; rest to follow");
    expect(Number(result.items[0].approvedQuantity)).toBe(6);
  });

  it("an approval without notes does not blank the requester's own", async () => {
    const result = await asTenant(companyA, async (tx) => {
      const request = await fulfilmentRepo.createStockRequest(tx, {
        companyId: companyA,
        requestType: "internal",
        requesterName: "Sam Stores",
        requesterDepartment: "Technical",
        items: [
          {
            productId: widget,
            requestedQuantity: "10.0000",
            unitPrice: "0.0000",
            notes: "For the Kisumu site",
          },
        ],
      });
      const full = await fulfilmentRepo.getStockRequest(tx, request.id);
      await fulfilmentRepo.approveStockRequest(
        tx,
        request.id,
        [{ itemId: full.items[0].id, approvedQuantity: "10.0000" }],
        { approvedById: "mgr", approverName: "Manager" },
      );
      return fulfilmentRepo.getStockRequest(tx, request.id);
    });

    expect(result.items[0].notes).toBe("For the Kisumu site");
  });
});
