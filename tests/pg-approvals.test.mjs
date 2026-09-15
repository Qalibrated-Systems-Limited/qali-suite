/**
 * The approval engine — 0101.
 *
 * The last cross-cutting Mongo module, and the only one that genuinely WORKED
 * rather than being stranded: a Postgres action raised a MONGO request, the
 * page read Mongo, and approving it applied back into Postgres. Both ends knew
 * where the middle lived.
 *
 * What that cost is the reason this is a deploy blocker rather than a tidy-up:
 * `requestApprovalIfOverThreshold` is AWAITED inside `expense-actions.ts` and
 * `payment-actions.ts`, so on a deployment with no Mongo connection an expense
 * over the threshold did not skip its approval — it THREW. And
 * `expense_payment_value` defaults to 50,000 for every company.
 *
 * The centre of this file is the LEASE: two approvers pressing at the same
 * moment must not both apply the payload, because that is a doubled price
 * change or a supplier paid twice.
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
const approvals = await import("@/app/db/repositories/approvals");
const { APPROVER_MATRIX, canApproveType, approvableTypesFor } = await import(
  "@/lib/business-rules"
);

const failsWith = async (fn, pattern) => {
  const err = await fn().then(
    () => {
      throw new Error("expected a rejection");
    },
    (e) => e,
  );
  expect(userMessage(err)).toMatch(pattern);
};

suite("the approval engine", () => {
  let admin, client, db;
  let companyA, companyB;
  const submitter = { id: "u-submitter", name: "Wanjiku", role: "Storekeeper" };
  const approver = { id: "u-approver", name: "The CFO", role: "CFO" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  const request = (over = {}) =>
    inA((tx) =>
      approvals.submitApproval(tx, {
        companyId: over.companyId ?? companyA,
        type: over.type ?? "price_change",
        targetKind: over.targetKind ?? "Product",
        targetId: over.targetId ?? randomUUID(),
        targetLabel: over.targetLabel ?? "TYRE-185 — Heavy duty tyre",
        payload: over.payload ?? { sellingPrice: "900.0000" },
        context: over.context ?? { floor: 1000, cost: 800 },
        reason: over.reason ?? "Selling price below floor",
        requesterNote: over.requesterNote ?? "Clearing old stock",
        requiredApproverRoles:
          over.requiredApproverRoles ??
          APPROVER_MATRIX[over.type ?? "price_change"],
        submittedById: over.submittedById ?? submitter.id,
        submittedByName: over.submittedByName ?? submitter.name,
        submittedByRole: over.submittedByRole ?? submitter.role,
      }),
    );

  const statusOf = async (id) => {
    const [r] = await admin`SELECT status FROM approval_requests WHERE id = ${id}`;
    return r?.status ?? null;
  };

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, {
      max: 1,
      onnotice: () => {},
    });
    db = drizzle(client);
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyA = randomUUID();
    companyB = randomUUID();
    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)}),
      (${companyB}, 'Rival', ${"r-" + companyB.slice(0, 8)})`;
  }, 300_000);

  // ═══════════════════════════════════════════════════════════════════════════
  describe("raising a request", () => {
    it("numbers it and records who asked", async () => {
      const r = await request();
      expect(r.requestNumber).toBe("APR-00001");
      expect(r.status).toBe("submitted");
      expect(r.submittedBy.name).toBe("Wanjiku");
      expect(r.submittedBy.role).toBe("Storekeeper");
      expect(r.decision).toBeNull();
    });

    it("carries the payload and the context through unchanged", async () => {
      const r = await request();
      expect(r.payload).toEqual({ sellingPrice: "900.0000" });
      expect(r.context).toEqual({ floor: 1000, cost: 800 });
      expect(r.reason).toBe("Selling price below floor");
      expect(r.requesterNote).toBe("Clearing old stock");
    });

    it("takes a uuid target, which the Mongo schema could not", async () => {
      // `targetRef.id` was typed ObjectId, so `submitApproval` threw a
      // CastError on every approval raised against a Postgres row — the
      // model's own comment records that expense payments over fifty thousand
      // shillings threw instead of going for sign-off.
      const productId = randomUUID();
      const r = await request({ targetId: productId });
      expect(r.targetRef.id).toBe(productId);
    });

    it("takes a 24-character ObjectId too, for what is still in Mongo", async () => {
      const r = await request({ targetId: "6a3ba4ae0f569c9f3d9a907f" });
      expect(r.targetRef.id).toBe("6a3ba4ae0f569c9f3d9a907f");
    });

    it("FREEZES the approver list at submission", async () => {
      // Widening the matrix later must not retroactively let somebody decide
      // a request that was already open.
      const r = await request({ type: "stock_adjustment" });
      expect(r.requiredApproverRoles).toEqual(
        APPROVER_MATRIX.stock_adjustment,
      );
    });

    it("refuses a request nobody is allowed to decide", async () => {
      await failsWith(
        () => request({ requiredApproverRoles: [] }),
        /No approver matrix/i,
      );
    });

    it("refuses a blank target", async () => {
      await failsWith(() => request({ targetId: "   " }), /not allowed|target/i);
    });

    it("numbers per company, not globally", async () => {
      await request();
      const theirs = await asTenant(companyB, (tx) =>
        approvals.submitApproval(tx, {
          companyId: companyB,
          type: "price_change",
          targetKind: "Product",
          targetId: randomUUID(),
          requiredApproverRoles: APPROVER_MATRIX.price_change,
          submittedById: submitter.id,
          submittedByName: submitter.name,
        }),
      );
      expect(theirs.requestNumber).toBe("APR-00001");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the lease", () => {
    it("lets exactly one claimer win", async () => {
      const r = await request();

      const first = await inA((tx) => approvals.claim(tx, r._id));
      const second = await inA((tx) => approvals.claim(tx, r._id));

      expect(first).toBeTruthy();
      expect(first.status).toBe("applying");
      expect(second).toBeNull();
    });

    it("holds against TWO CONCURRENT transactions, which is the point", async () => {
      // The guarantee is `UPDATE ... WHERE status = 'submitted'` returning
      // zero rows for the loser — but only because the winner's transaction
      // COMMITS. Both claims are fired before either is awaited.
      const r = await request();
      const [a, b] = await Promise.all([
        inA((tx) => approvals.claim(tx, r._id)),
        inA((tx) => approvals.claim(tx, r._id)),
      ]);
      const winners = [a, b].filter(Boolean);
      expect(winners).toHaveLength(1);
      expect(await statusOf(r._id)).toBe("applying");
    });

    it("hands the lease back so a failed apply can be retried", async () => {
      const r = await request();
      await inA((tx) => approvals.claim(tx, r._id));
      await inA((tx) => approvals.releaseClaim(tx, r._id));

      expect(await statusOf(r._id)).toBe("submitted");
      expect(await inA((tx) => approvals.claim(tx, r._id))).toBeTruthy();
    });

    it("reaps a lease stranded by a crash", async () => {
      // If the process dies between claiming and finalising, the request is
      // stuck in 'applying' — invisible to a queue that lists 'submitted'.
      const r = await request();
      await inA((tx) => approvals.claim(tx, r._id));
      await admin`UPDATE approval_requests
                     SET updated_at = now() - interval '30 minutes'
                   WHERE id = ${r._id}`;

      const reaped = await inA((tx) => approvals.reapStaleLeases(tx, 10));
      expect(reaped).toBe(1);
      expect(await statusOf(r._id)).toBe("submitted");
    });

    it("leaves a lease that is still young alone", async () => {
      const r = await request();
      await inA((tx) => approvals.claim(tx, r._id));
      expect(await inA((tx) => approvals.reapStaleLeases(tx, 10))).toBe(0);
      expect(await statusOf(r._id)).toBe("applying");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("deciding", () => {
    it("records who approved it and what was applied", async () => {
      const r = await request();
      await inA((tx) => approvals.claim(tx, r._id));

      const done = await inA((tx) =>
        approvals.finaliseApproved(
          tx,
          r._id,
          approver,
          { kind: "Product", id: r.targetRef.id },
          "Agreed, clear it",
        ),
      );

      expect(done.status).toBe("approved");
      expect(done.decision.action).toBe("approved");
      expect(done.decision.by.name).toBe("The CFO");
      expect(done.decision.note).toBe("Agreed, clear it");
      expect(done.appliedRef).toEqual({ kind: "Product", id: r.targetRef.id });
      expect(done.appliedAt).toBeTruthy();
    });

    it("refuses to finalise something nobody claimed", async () => {
      const r = await request();
      await failsWith(
        () => inA((tx) => approvals.finaliseApproved(tx, r._id, approver)),
        /no longer being applied/i,
      );
    });

    it("rejects, with the decider on the row", async () => {
      const r = await request();
      const done = await inA((tx) =>
        approvals.decide(tx, r._id, "rejected", approver, "Margin too thin"),
      );
      expect(done.status).toBe("rejected");
      expect(done.decision.action).toBe("rejected");
      expect(done.decision.note).toBe("Margin too thin");
      expect(done.appliedAt).toBeNull();
    });

    it("cancels", async () => {
      const r = await request();
      const done = await inA((tx) =>
        approvals.decide(tx, r._id, "cancelled", submitter, ""),
      );
      expect(done.status).toBe("cancelled");
    });

    it("says WHICH way a re-decision is refused", async () => {
      // "Not found" for a request that is simply already decided sends people
      // looking for a missing row.
      const r = await request();
      await inA((tx) => approvals.decide(tx, r._id, "rejected", approver));
      await failsWith(
        () => inA((tx) => approvals.decide(tx, r._id, "rejected", approver)),
        /Already rejected/i,
      );
    });

    it("tells an approver when somebody else is mid-apply", async () => {
      const r = await request();
      await inA((tx) => approvals.claim(tx, r._id));
      await failsWith(
        () => inA((tx) => approvals.decide(tx, r._id, "rejected", approver)),
        /Another approver is processing/i,
      );
    });

    it("is not found for an id a uuid column cannot hold", async () => {
      expect(
        await inA((tx) => approvals.getApproval(tx, "6a3ba4ae0f569c9f3d9a907f")),
      ).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the decision is a pair, and the database says so", () => {
    it("REFUSES an approved request with no approver on it", async () => {
      // In Mongo `decision` was a free-floating sub-document a status change
      // was not obliged to set — so "approved" with nobody's name against it
      // was a reachable row, in the audit record of who authorised money.
      const r = await request();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              UPDATE approval_requests SET status = 'approved'
               WHERE id = ${r._id}::uuid`),
          ),
        /not allowed|decision/i,
      );
    });

    it("REFUSES a decision that disagrees with the status", async () => {
      const r = await request();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              UPDATE approval_requests
                 SET status = 'approved', decision_action = 'rejected',
                     decided_at = now(), decided_by_name = 'X'
               WHERE id = ${r._id}::uuid`),
          ),
        /not allowed|decision/i,
      );
    });

    it("REFUSES an applied record on anything but an approval", async () => {
      // A rejected request applied nothing — that is what rejecting means.
      const r = await request();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              UPDATE approval_requests
                 SET status = 'rejected', decision_action = 'rejected',
                     decided_at = now(), decided_by_name = 'X',
                     applied_at = now()
               WHERE id = ${r._id}::uuid`),
          ),
        /not allowed|applied/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the queue is authority-shaped", () => {
    it("shows a CFO the types a CFO may decide", async () => {
      await request({ type: "price_change" });
      await request({ type: "stock_adjustment", targetKind: "InventoryAdjustment" });

      const cfoQueue = await inA((tx) =>
        approvals.listQueue(tx, approvableTypesFor("CFO")),
      );
      expect(cfoQueue.map((q) => q.type)).toEqual(["price_change"]);
    });

    it("shows a Store Manager the other one", async () => {
      await request({ type: "price_change" });
      await request({ type: "stock_adjustment", targetKind: "InventoryAdjustment" });

      const queue = await inA((tx) =>
        approvals.listQueue(tx, approvableTypesFor("Store Manager")),
      );
      expect(queue.map((q) => q.type)).toEqual(["stock_adjustment"]);
    });

    it("shows a SuperAdmin everything", async () => {
      await request({ type: "price_change" });
      await request({ type: "stock_adjustment", targetKind: "InventoryAdjustment" });
      const queue = await inA((tx) =>
        approvals.listQueue(tx, approvableTypesFor("SuperAdmin")),
      );
      expect(queue).toHaveLength(2);
    });

    it("shows a role with NO authority nothing, not everything", async () => {
      // The safe direction for a screen about authority: an empty type list
      // returns nothing rather than falling through to an unfiltered query.
      await request();
      expect(approvableTypesFor("Viewer")).toEqual([]);
      expect(await inA((tx) => approvals.listQueue(tx, []))).toEqual([]);
      expect(await inA((tx) => approvals.countQueue(tx, []))).toBe(0);
    });

    it("counts only what is still submitted", async () => {
      const a = await request();
      await request();
      expect(
        await inA((tx) => approvals.countQueue(tx, approvableTypesFor("CFO"))),
      ).toBe(2);

      await inA((tx) => approvals.decide(tx, a._id, "rejected", approver));
      expect(
        await inA((tx) => approvals.countQueue(tx, approvableTypesFor("CFO"))),
      ).toBe(1);
    });

    it("lists what one person raised, whatever became of it", async () => {
      const a = await request();
      await request({ submittedById: "somebody-else", submittedByName: "Other" });
      await inA((tx) => approvals.decide(tx, a._id, "rejected", approver));

      const mine = await inA((tx) =>
        approvals.listSubmittedBy(tx, submitter.id),
      );
      expect(mine).toHaveLength(1);
      expect(mine[0].status).toBe("rejected");
    });

    it("finds the open request holding a document", async () => {
      const productId = randomUUID();
      const r = await request({ targetId: productId });

      const open = await inA((tx) =>
        approvals.findOpenForTarget(tx, "Product", productId),
      );
      expect(open._id).toBe(r._id);

      await inA((tx) => approvals.decide(tx, r._id, "rejected", approver));
      expect(
        await inA((tx) => approvals.findOpenForTarget(tx, "Product", productId)),
      ).toBeNull();
    });

    it("does not leak another company's queue", async () => {
      await request();
      const theirs = await asTenant(companyB, (tx) =>
        approvals.listQueue(tx, approvableTypesFor("SuperAdmin")),
      );
      expect(theirs).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the matrix", () => {
    it("lets SuperAdmin decide anything", () => {
      for (const type of Object.keys(APPROVER_MATRIX)) {
        expect(canApproveType("SuperAdmin", type)).toBe(true);
      }
    });

    it("keeps a Store Manager away from price changes", () => {
      expect(canApproveType("Store Manager", "stock_adjustment")).toBe(true);
      expect(canApproveType("Store Manager", "price_change")).toBe(false);
    });

    it("refuses an unknown role or type rather than defaulting open", () => {
      expect(canApproveType("Nobody", "price_change")).toBe(false);
      expect(canApproveType("CFO", "not_a_type")).toBe(false);
      expect(canApproveType(null, "price_change")).toBe(false);
      expect(canApproveType("CFO", null)).toBe(false);
    });
  });
});
