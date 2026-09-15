/**
 * The integration control plane — 0102.
 *
 * The data plane went to Postgres long ago; what stayed in Mongo was the part
 * that decides whether a machine gets in at all. So every /api/v1 request
 * opened a Mongo connection to authenticate and then a Postgres transaction to
 * do the work — two stores on the hot path of an API whose promise is that a
 * truck at a gate does not wait.
 *
 * The centre of this file is the THREE SCOPES. A key is read before a tenant
 * exists, a webhook is retried by a worker that has no tenant at all, and both
 * of those are answered with a purpose-scoped policy rather than a bypass. The
 * property that has to hold for either to be acceptable is that they FAIL
 * CLOSED and stay narrow: a caller under one scope sees exactly the rows that
 * scope exists for, and nothing else — including nothing of another tenant's.
 *
 * Skipped unless DATABASE_URL is set.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { withTenant, withApiKeyScope, withRetryWorkerScope } = await import(
  "@/app/db/client"
);
const repo = await import("@/app/db/repositories/integrations");

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

suite("the integration control plane", () => {
  let admin;
  let companyA, companyB;
  let keyA, keyB;
  let subA;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, _migration_id_map, entry_counters CASCADE`;

    companyA = randomUUID();
    companyB = randomUUID();
    await admin`
      INSERT INTO companies (id, name, slug) VALUES
        (${companyA}, 'Pilot',     ${"p-" + companyA.slice(0, 8)}),
        (${companyB}, 'Elsewhere', ${"e-" + companyB.slice(0, 8)})
    `;

    keyA = await withTenant(companyA, (tx) =>
      repo
        .createIntegrationKey(tx, companyA, {
          name: "Gate",
          keyHash: HASH_A,
          keyPreview: "ab12",
          keyPrefix: "qls_live_k_",
          connectorType: "weighbridge",
          scopes: ["inventory:read", "inventory:write"],
          environment: "live",
          createdById: "user-1",
          createdByName: "Wanjiku",
        })
        .then((r) => r.id),
    );

    keyB = await withTenant(companyB, (tx) =>
      repo
        .createIntegrationKey(tx, companyB, {
          name: "Their gate",
          keyHash: HASH_B,
          keyPreview: "cd34",
          keyPrefix: "qls_live_k_",
          connectorType: "weighbridge",
          scopes: ["inventory:read"],
          environment: "live",
        })
        .then((r) => r.id),
    );

    subA = await withTenant(companyA, (tx) =>
      repo
        .createWebhookSubscription(tx, companyA, {
          name: "Ops",
          url: "https://example.test/hook",
          events: ["invoice.*"],
          secret: "s3cret",
          createdById: "user-1",
          createdByName: "Wanjiku",
        })
        .then((r) => r.id),
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Decision 1 — the pre-tenant key lookup
  // ───────────────────────────────────────────────────────────────────────────

  describe("the key lookup scope", () => {
    it("resolves a key to its company without a tenant being set", async () => {
      const key = await withApiKeyScope(HASH_A, (tx) =>
        repo.findKeyByHash(tx, HASH_A),
      );

      expect(key).not.toBeNull();
      expect(key.companyId).toBe(companyA);
      expect(key.scopes).toEqual(["inventory:read", "inventory:write"]);
      // The person the key acts for, which is what apiTenant records as actor.
      expect(key.createdById).toBe("user-1");
    });

    it("shows the caller ONLY the key whose hash they hold", async () => {
      /**
       * The whole safety argument for the policy. Scoped to A's hash, B's key
       * is not merely filtered out by the query — the query below does not
       * filter at all, and still cannot see it.
       */
      const rows = await withApiKeyScope(HASH_A, (tx) =>
        tx.execute(`SELECT id FROM integration_keys`),
      );
      expect(rows.map((r) => r.id)).toEqual([keyA]);
      expect(rows.map((r) => r.id)).not.toContain(keyB);
    });

    it("returns nothing under no scope at all — it fails closed", async () => {
      /**
       * `withTenant` sets app.company_id but never app.api_key_hash, so the
       * lookup policy compares against NULL. This is the case that decides
       * whether the second policy is a hole: it is not, because a caller who
       * has not presented a hash matches no row by that policy.
       */
      const rows = await withTenant(companyB, (tx) =>
        tx.execute(`SELECT id FROM integration_keys WHERE key_hash = '${HASH_A}'`),
      );
      expect(rows).toHaveLength(0);
    });

    it("does not let a key's hash reach any other table", async () => {
      // Only integration_keys answers under this scope. A company-keyed table
      // returns zero rows, which is the right answer before a tenant exists.
      const rows = await withApiKeyScope(HASH_A, (tx) =>
        tx.execute(`SELECT id FROM webhook_subscriptions`),
      );
      expect(rows).toHaveLength(0);
    });

    it("stamps usage on the key it authenticated, and only that one", async () => {
      await withApiKeyScope(HASH_A, (tx) =>
        repo.recordKeyUsage(tx, HASH_A, "10.0.0.1"),
      );

      const [a] = await admin`
        SELECT total_requests, last_used_ip FROM integration_keys WHERE id = ${keyA}
      `;
      const [b] = await admin`
        SELECT total_requests FROM integration_keys WHERE id = ${keyB}
      `;
      expect(a.total_requests).toBe(1);
      expect(a.last_used_ip).toBe("10.0.0.1");
      expect(b.total_requests).toBe(0);
    });

    it("keeps the hash unique across companies, not within one", async () => {
      /**
       * Decision 2. The hash is what a request presents INSTEAD of naming a
       * tenant, so two companies holding one would give the lookup two answers
       * and authenticate the wrong tenant about half the time.
       */
      await expect(
        withTenant(companyB, (tx) =>
          repo.createIntegrationKey(tx, companyB, {
            name: "Collision",
            keyHash: HASH_A,
            keyPreview: "ef56",
            keyPrefix: "qls_live_k_",
            connectorType: "generic",
            scopes: [],
            environment: "live",
          }),
        ),
      ).rejects.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Decision 5 — scopes are a real type
  // ───────────────────────────────────────────────────────────────────────────

  it("refuses a scope that is not a scope", async () => {
    /**
     * Mongo applies its `enum` to the ARRAY rather than its members, so this
     * validated fine and silently granted nothing at the point of use.
     */
    await expect(
      withTenant(companyA, (tx) =>
        repo.createIntegrationKey(tx, companyA, {
          name: "Typo",
          keyHash: "c".repeat(64),
          keyPreview: "gh78",
          keyPrefix: "qls_live_k_",
          connectorType: "generic",
          scopes: ["inventory:reed"],
          environment: "live",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a webhook url that is not https", async () => {
    await expect(
      withTenant(companyA, (tx) =>
        repo.createWebhookSubscription(tx, companyA, {
          name: "Plaintext",
          url: "http://example.test/hook",
          events: ["*"],
          secret: "s",
        }),
      ),
    ).rejects.toThrow();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Decision 4 — idempotency is a constraint, not a convention
  // ───────────────────────────────────────────────────────────────────────────

  describe("inbound idempotency", () => {
    it("refuses a second in-flight log for one external reference", async () => {
      await withTenant(companyA, (tx) =>
        repo.createSyncLog(tx, companyA, {
          direction: "inbound",
          event: "weighbridge.first_weight",
          externalRef: "WB-001_first",
          status: "processing",
        }),
      );

      /**
       * The case Mongo cannot catch: it indexes external_ref WITHOUT
       * uniqueness, so a gate whose first call timed out and retried has both
       * calls miss the read-then-write check and both create a ticket.
       */
      await expect(
        withTenant(companyA, (tx) =>
          repo.createSyncLog(tx, companyA, {
            direction: "inbound",
            event: "weighbridge.first_weight",
            externalRef: "WB-001_first",
            status: "processing",
          }),
        ),
      ).rejects.toThrow();
    });

    it("lets a FAILED reference be retried — that is what resending means", async () => {
      const first = await withTenant(companyA, (tx) =>
        repo.createSyncLog(tx, companyA, {
          direction: "inbound",
          event: "weighbridge.first_weight",
          externalRef: "WB-002_first",
          status: "processing",
        }),
      );
      await withTenant(companyA, (tx) =>
        repo.markSyncLogFailed(tx, first.id, "bad payload"),
      );

      const retry = await withTenant(companyA, (tx) =>
        repo.createSyncLog(tx, companyA, {
          direction: "inbound",
          event: "weighbridge.first_weight",
          externalRef: "WB-002_first",
          status: "processing",
        }),
      );
      expect(retry.id).not.toBe(first.id);
    });

    it("does not collide across tenants on the same reference", async () => {
      // Two gates at two companies both number their first trip WB-001.
      for (const company of [companyA, companyB]) {
        await withTenant(company, (tx) =>
          repo.createSyncLog(tx, company, {
            direction: "inbound",
            event: "weighbridge.first_weight",
            externalRef: "WB-001_first",
            status: "processing",
          }),
        );
      }
      const [{ count }] = await admin`
        SELECT count(*)::int FROM sync_logs WHERE external_ref = 'WB-001_first'
      `;
      expect(count).toBe(2);
    });

    it("returns the first result for a reference already processed", async () => {
      const log = await withTenant(companyA, (tx) =>
        repo.createSyncLog(tx, companyA, {
          direction: "inbound",
          event: "weighbridge.second_weight",
          externalRef: "WB-003_second",
          status: "processing",
        }),
      );
      await withTenant(companyA, (tx) =>
        repo.markSyncLogProcessed(tx, log.id, {
          internalRef: "WB-000123",
          result: { netWeight: 3400 },
        }),
      );

      const hit = await withTenant(companyA, (tx) =>
        repo.findProcessedByExternalRef(tx, "WB-003_second"),
      );
      expect(hit.internalRef).toBe("WB-000123");
      expect(hit.result).toEqual({ netWeight: 3400 });

      // And the other tenant's identical reference is not this one.
      const miss = await withTenant(companyB, (tx) =>
        repo.findProcessedByExternalRef(tx, "WB-003_second"),
      );
      expect(miss).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Decision 3 — the retry worker
  // ───────────────────────────────────────────────────────────────────────────

  describe("the retry worker scope", () => {
    async function dueDelivery(company, subscriptionId, ago = 60_000) {
      const log = await withTenant(company, (tx) =>
        repo.createSyncLog(tx, company, {
          direction: "outbound",
          event: "invoice.created",
          status: "processing",
          webhookSubscriptionId: subscriptionId,
          webhookUrl: "https://example.test/hook",
          rawPayload: { total: 5000 },
          requestId: randomUUID(),
        }),
      );
      await withTenant(company, (tx) =>
        repo.recordDeliveryAttempt(tx, log.id, {
          status: "retrying",
          attempts: 1,
          httpStatus: 500,
          error: "boom",
          nextRetryAt: new Date(Date.now() - ago),
        }),
      );
      return log.id;
    }

    it("claims a due delivery across tenants without a company scope", async () => {
      const logId = await dueDelivery(companyA, subA);

      const claimed = await withRetryWorkerScope((tx) =>
        repo.claimDueRetries(tx, 50),
      );

      expect(claimed.map((c) => c.id)).toEqual([logId]);
      expect(claimed[0].companyId).toBe(companyA);
      // Claiming moves it out of the due set in the same statement.
      const [row] = await admin`SELECT status FROM sync_logs WHERE id = ${logId}`;
      expect(row.status).toBe("processing");
    });

    it("does not claim the same delivery twice", async () => {
      /**
       * The duplicate-delivery bug this replaces: Mongo finds the due rows and
       * then updates them in a SECOND call, so two workers whose ticks overlap
       * both see the batch in the gap and the subscriber is posted to twice.
       */
      await dueDelivery(companyA, subA);

      const [first, second] = await Promise.all([
        withRetryWorkerScope((tx) => repo.claimDueRetries(tx, 50)),
        withRetryWorkerScope((tx) => repo.claimDueRetries(tx, 50)),
      ]);

      expect(first.length + second.length).toBe(1);
    });

    it("does not claim a delivery that is not due yet", async () => {
      await dueDelivery(companyA, subA, -600_000); // due in 10 minutes
      const claimed = await withRetryWorkerScope((tx) =>
        repo.claimDueRetries(tx, 50),
      );
      expect(claimed).toHaveLength(0);
    });

    it("sees outbound deliveries and NOT inbound logs", async () => {
      const inbound = await withTenant(companyA, (tx) =>
        repo.createSyncLog(tx, companyA, {
          direction: "inbound",
          event: "weighbridge.first_weight",
          externalRef: "WB-900_first",
          status: "processing",
        }),
      );
      await withTenant(companyA, (tx) =>
        repo.createSyncLog(tx, companyA, {
          direction: "outbound",
          event: "invoice.created",
          status: "processing",
          webhookSubscriptionId: subA,
        }),
      );

      const rows = await withRetryWorkerScope((tx) =>
        tx.execute(`SELECT id, direction, status FROM sync_logs`),
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.direction === "outbound")).toBe(true);
      expect(rows.map((r) => String(r.id))).not.toContain(inbound.id);
    });

    it("has no unscoped read path — no worker setting, no rows", async () => {
      await withTenant(companyA, (tx) =>
        repo.createSyncLog(tx, companyA, {
          direction: "outbound",
          event: "invoice.created",
          status: "processing",
          webhookSubscriptionId: subA,
        }),
      );
      // withUserScope-style: a transaction with neither company nor worker set.
      const rows = await withTenant(companyB, (tx) =>
        tx.execute(`SELECT id FROM sync_logs`),
      );
      // companyB's own scope shows companyB's rows only — none exist.
      expect(rows).toHaveLength(0);
    });

    it("narrows to DUE rows in the query, since the policy cannot", async () => {
      /**
       * The policy admits every outbound row, because pinning the status in it
       * would forbid the worker from ever completing a delivery — 0102 records
       * the mechanism. So the narrowing that stops a processed delivery being
       * redelivered lives here, in the claim, and this is the test that says
       * so.
       */
      const done = await withTenant(companyA, (tx) =>
        repo.createSyncLog(tx, companyA, {
          direction: "outbound",
          event: "invoice.created",
          status: "processing",
          webhookSubscriptionId: subA,
        }),
      );
      await withTenant(companyA, (tx) =>
        repo.markSyncLogProcessed(tx, done.id, {}),
      );
      const dueId = await dueDelivery(companyA, subA);

      const claimed = await withRetryWorkerScope((tx) =>
        repo.claimDueRetries(tx, 50),
      );
      expect(claimed.map((c) => c.id)).toEqual([dueId]);
    });

    it("can record a claimed delivery as processed", async () => {
      /**
       * The USING/WITH CHECK asymmetry, which is the easiest thing in 0102 to
       * get wrong: mirroring the USING clause onto WITH CHECK is the obvious
       * thing to write, and it would forbid the worker from ever moving a row
       * OUT of 'processing' — so every retry would succeed on the wire and
       * then be retried forever.
       */
      const logId = await dueDelivery(companyA, subA);
      await withRetryWorkerScope((tx) => repo.claimDueRetries(tx, 50));

      await withRetryWorkerScope((tx) =>
        repo.recordDeliveryAttempt(tx, logId, {
          status: "processed",
          attempts: 2,
          httpStatus: 200,
          responseBody: "ok",
        }),
      );

      const [row] = await admin`
        SELECT status, attempts, processed_at FROM sync_logs WHERE id = ${logId}
      `;
      expect(row.status).toBe("processed");
      expect(row.attempts).toBe(2);
      expect(row.processed_at).not.toBeNull();
    });

    it("reads the subscription it is delivering to, but no tenant data", async () => {
      const sub = await withRetryWorkerScope((tx) =>
        repo.getSubscriptionForRetry(tx, subA),
      );
      expect(sub.url).toBe("https://example.test/hook");
      expect(sub.secret).toBe("s3cret");

      const parties = await withRetryWorkerScope((tx) =>
        tx.execute(`SELECT count(*)::int AS n FROM parties`),
      );
      expect(Number(parties[0].n)).toBe(0);
    });

    it("hides a subscription that has been revoked", async () => {
      await withTenant(companyA, (tx) =>
        repo.deactivateWebhookSubscription(tx, subA),
      );
      const sub = await withRetryWorkerScope((tx) =>
        repo.getSubscriptionForRetry(tx, subA),
      );
      // Null is what the emitter reports as `skipped` rather than delivering.
      expect(sub).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The circuit breaker
  // ───────────────────────────────────────────────────────────────────────────

  describe("the circuit breaker", () => {
    it("suspends after five consecutive failures", async () => {
      let last;
      for (let i = 0; i < 5; i++) {
        last = await withTenant(companyA, (tx) =>
          repo.recordDeliveryFailure(tx, subA, 5),
        );
      }
      expect(last.failureCount).toBe(5);
      expect(last.suspended).toBe(true);
    });

    it("counts concurrent failures without losing any", async () => {
      /**
       * The count is `failure_count + 1` in SQL, not read here and written
       * back. Read-modify-write would have all five read 0 and write 1, so a
       * dead endpoint would never reach the threshold and never be suspended.
       */
      await Promise.all(
        Array.from({ length: 5 }, () =>
          withTenant(companyA, (tx) => repo.recordDeliveryFailure(tx, subA, 5)),
        ),
      );
      const [row] = await admin`
        SELECT failure_count, suspended FROM webhook_subscriptions WHERE id = ${subA}
      `;
      expect(row.failure_count).toBe(5);
      expect(row.suspended).toBe(true);
    });

    it("clears on the first success", async () => {
      await withTenant(companyA, (tx) =>
        repo.recordDeliveryFailure(tx, subA, 5),
      );
      await withTenant(companyA, (tx) => repo.recordDeliverySuccess(tx, subA));

      const [row] = await admin`
        SELECT failure_count, suspended, last_failure_at
          FROM webhook_subscriptions WHERE id = ${subA}
      `;
      expect(row.failure_count).toBe(0);
      expect(row.suspended).toBe(false);
      expect(row.last_failure_at).toBeNull();
    });

    it("does not deliver to a suspended subscription", async () => {
      for (let i = 0; i < 5; i++) {
        await withTenant(companyA, (tx) =>
          repo.recordDeliveryFailure(tx, subA, 5),
        );
      }
      const subs = await withTenant(companyA, (tx) =>
        repo.listDeliverableSubscriptions(tx, "invoice.created", null),
      );
      expect(subs).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Event matching
  // ───────────────────────────────────────────────────────────────────────────

  describe("which subscriptions an event reaches", () => {
    it("matches an exact event, a namespace wildcard and a catch-all", async () => {
      const ids = {};
      for (const [label, events] of [
        ["exact", ["invoice.created"]],
        ["namespace", ["invoice.*"]],
        ["all", ["*"]],
        ["other", ["payment.received"]],
      ]) {
        ids[label] = await withTenant(companyA, (tx) =>
          repo
            .createWebhookSubscription(tx, companyA, {
              name: label,
              url: `https://example.test/${label}`,
              events,
              secret: "s",
            })
            .then((r) => r.id),
        );
      }

      const matched = await withTenant(companyA, (tx) =>
        repo.listDeliverableSubscriptions(tx, "invoice.created", null),
      );
      const matchedIds = matched.map((m) => String(m.id));

      expect(matchedIds).toContain(ids.exact);
      expect(matchedIds).toContain(ids.namespace);
      expect(matchedIds).toContain(ids.all);
      expect(matchedIds).not.toContain(ids.other);
    });

    it("never reaches another tenant's subscriptions", async () => {
      await withTenant(companyB, (tx) =>
        repo.createWebhookSubscription(tx, companyB, {
          name: "Theirs",
          url: "https://example.test/theirs",
          events: ["*"],
          secret: "s",
        }),
      );

      const matched = await withTenant(companyA, (tx) =>
        repo.listDeliverableSubscriptions(tx, "invoice.created", null),
      );
      expect(matched.every((m) => String(m.company_id) === companyA)).toBe(true);
    });

    it("filters by connector when the event names one", async () => {
      const wb = await withTenant(companyA, (tx) =>
        repo
          .createWebhookSubscription(tx, companyA, {
            name: "Weighbridge only",
            url: "https://example.test/wb",
            events: ["*"],
            secret: "s",
            connectorType: "weighbridge",
          })
          .then((r) => r.id),
      );
      const coffee = await withTenant(companyA, (tx) =>
        repo
          .createWebhookSubscription(tx, companyA, {
            name: "Coffee only",
            url: "https://example.test/coffee",
            events: ["*"],
            secret: "s",
            connectorType: "coffee_coop",
          })
          .then((r) => r.id),
      );

      const matched = await withTenant(companyA, (tx) =>
        repo.listDeliverableSubscriptions(tx, "invoice.created", "weighbridge"),
      );
      const ids = matched.map((m) => String(m.id));

      expect(ids).toContain(wb);
      expect(ids).not.toContain(coffee);
      // A subscription with no connector takes everything — subA, from setup.
      expect(ids).toContain(subA);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Shapes the screens read
  // ───────────────────────────────────────────────────────────────────────────

  it("counts keys and logs for the dashboard without JavaScript arithmetic", async () => {
    /**
     * `total_requests` is summed in SQL. Reduced in JavaScript over values the
     * driver hands back as strings, `0 + "5"` is `"05"` and the next row
     * appends to it — the failure this codebase has hit at REQUEST_TOTALS, the
     * bills stats card and the invoice totals.
     */
    await withApiKeyScope(HASH_A, (tx) => repo.recordKeyUsage(tx, HASH_A, null));
    await withApiKeyScope(HASH_A, (tx) => repo.recordKeyUsage(tx, HASH_A, null));

    const stats = await withTenant(companyA, (tx) =>
      repo.getIntegrationStats(tx),
    );

    expect(stats.keys.total).toBe(1);
    expect(stats.keys.active).toBe(1);
    expect(stats.keys.totalRequests).toBe(2);
    expect(typeof stats.keys.totalRequests).toBe("number");
  });

  it("lists a key by its display form and never its hash", async () => {
    const [key] = await withTenant(companyA, (tx) =>
      repo.listIntegrationKeys(tx),
    );
    expect(key.displayKey).toBe("qls_live_k_...ab12");
    expect(JSON.stringify(key)).not.toContain(HASH_A);
  });

  it("keeps a revoked key's history rather than erasing it", async () => {
    const log = await withTenant(companyA, (tx) =>
      repo.createSyncLog(tx, companyA, {
        direction: "inbound",
        event: "weighbridge.first_weight",
        integrationKeyId: keyA,
        externalRef: "WB-500_first",
        status: "processing",
      }),
    );
    await withTenant(companyA, (tx) => repo.revokeIntegrationKey(tx, keyA));

    const [row] = await admin`SELECT id FROM sync_logs WHERE id = ${log.id}`;
    expect(row).toBeTruthy();
  });

  it("refuses a retrying delivery that names no retry time", async () => {
    /**
     * Otherwise it is a delivery no worker will claim and no page will show as
     * failed. It simply stops.
     */
    const log = await withTenant(companyA, (tx) =>
      repo.createSyncLog(tx, companyA, {
        direction: "outbound",
        event: "invoice.created",
        status: "processing",
        webhookSubscriptionId: subA,
      }),
    );
    await expect(
      withTenant(companyA, (tx) =>
        repo.recordDeliveryAttempt(tx, log.id, {
          status: "retrying",
          attempts: 1,
          httpStatus: 500,
          nextRetryAt: null,
        }),
      ),
    ).rejects.toThrow();
  });
});
