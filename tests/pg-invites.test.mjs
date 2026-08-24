/**
 * Invitations (0044).
 *
 * The two paths differ in kind: ISSUING is a tenant operation under RLS, and
 * ACCEPTING runs privileged because the person holding the link has no company
 * yet. Both are covered, along with the two races the source lost.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID, createHash, randomBytes } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));

const invitesRepo = await import("@/app/db/repositories/invites");
const inviteAdmin = await import("@/app/db/inviteAdmin");

function token() {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: createHash("sha256").update(raw).digest("hex") };
}

suite("invitations", () => {
  let admin, client, db;
  let companyA, companyB;

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
    await admin`TRUNCATE companies, users CASCADE`;
    companyA = randomUUID();
    companyB = randomUUID();
    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Alpha', ${"a-" + companyA.slice(0, 8)}),
      (${companyB}, 'Beta',  ${"b-" + companyB.slice(0, 8)})`;
  });

  const base = (over = {}) => ({
    companyId: companyA,
    email: "newhire@example.com",
    role: "Employee",
    token: token().hash,
    expiresAt: new Date(Date.now() + 7 * 864e5),
    invitedById: "admin-1",
    invitedByName: "An Admin",
    ...over,
  });

  describe("issuing", () => {
    it("stores the hash, lowercased email, and an expiry", async () => {
      const row = await asTenant(companyA, (tx) => invitesRepo.createInvite(tx, base({ email: "NewHire@Example.com" })));
      expect(row.email).toBe("newhire@example.com");
      expect(row.status).toBe("pending");
      expect(new Date(row.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("allows only ONE open invitation per address per company", async () => {
      await asTenant(companyA, (tx) => invitesRepo.createInvite(tx, base()));
      // The source checked in the action and two admins could both insert.
      // Asserted on the CONSTRAINT NAME, not the message: drizzle wraps the
      // driver error and puts the PostgresError on `cause`, so the wrapper's
      // message is only "Failed query: insert into ...".
      const err = await asTenant(companyA, (tx) =>
        invitesRepo.createInvite(tx, base({ email: "NEWHIRE@example.com" })),
      ).catch((e) => e);
      expect(err?.cause?.constraint_name).toBe("invites_one_open_per_email_uq");
    });

    it("lets a DIFFERENT company invite the same person", async () => {
      await asTenant(companyA, (tx) => invitesRepo.createInvite(tx, base()));
      // An invitation is one company's act; two may ask independently.
      const other = await asTenant(companyB, (tx) =>
        invitesRepo.createInvite(tx, base({ companyId: companyB })));
      expect(other.companyId).toBe(companyB);
    });

    it("shows a company only its own invitations", async () => {
      await asTenant(companyA, (tx) => invitesRepo.createInvite(tx, base()));
      await asTenant(companyB, (tx) =>
        invitesRepo.createInvite(tx, base({ companyId: companyB, email: "b@example.com" })));

      const mine = await asTenant(companyA, (tx) => invitesRepo.listInvites(tx, {}));
      expect(mine).toHaveLength(1);
      expect(mine[0].email).toBe("newhire@example.com");
    });
  });

  describe("accepting", () => {
    it("finds an open invitation by its token hash", async () => {
      const t = token();
      await asTenant(companyA, (tx) => invitesRepo.createInvite(tx, base({ token: t.hash })));

      // Privileged: no app.company_id is set here, and that is the point.
      const found = await inviteAdmin.findAcceptableInvite(t.hash);
      expect(found?.email).toBe("newhire@example.com");
      expect(found?.companyId).toBe(companyA);
    });

    it("refuses an expired invitation even before the sweep marks it", async () => {
      const t = token();
      await asTenant(companyA, (tx) =>
        invitesRepo.createInvite(tx, base({ token: t.hash, expiresAt: new Date(Date.now() - 1000) })));

      // Still 'pending' in the column; the date is the rule.
      const [row] = await admin`SELECT status FROM invites WHERE token = ${t.hash}`;
      expect(row.status).toBe("pending");
      expect(await inviteAdmin.findAcceptableInvite(t.hash)).toBeNull();
    });

    it("can be accepted once, not twice", async () => {
      const t = token();
      await asTenant(companyA, (tx) => invitesRepo.createInvite(tx, base({ token: t.hash })));
      const invite = await inviteAdmin.findAcceptableInvite(t.hash);

      expect(await inviteAdmin.acceptInvite(invite.id, "user-1")).toBe(true);
      // A second click matches nothing rather than accepting again.
      expect(await inviteAdmin.acceptInvite(invite.id, "user-2")).toBe(false);

      const [row] = await admin`SELECT status, accepted_by_id FROM invites WHERE id = ${invite.id}`;
      expect(row.status).toBe("accepted");
      expect(row.accepted_by_id).toBe("user-1");
    });

    it("is unfindable once accepted", async () => {
      const t = token();
      await asTenant(companyA, (tx) => invitesRepo.createInvite(tx, base({ token: t.hash })));
      const invite = await inviteAdmin.findAcceptableInvite(t.hash);
      await inviteAdmin.acceptInvite(invite.id, "user-1");
      expect(await inviteAdmin.findAcceptableInvite(t.hash)).toBeNull();
    });

    it("finds the soonest to expire when two companies have invited someone", async () => {
      const soon = token(), later = token();
      await asTenant(companyA, (tx) =>
        invitesRepo.createInvite(tx, base({ token: soon.hash, expiresAt: new Date(Date.now() + 864e5) })));
      await asTenant(companyB, (tx) =>
        invitesRepo.createInvite(tx, base({ companyId: companyB, token: later.hash, expiresAt: new Date(Date.now() + 6 * 864e5) })));

      const found = await inviteAdmin.findOpenInviteForEmail("newhire@example.com");
      // The one about to lapse, not an arbitrary one.
      expect(found.companyId).toBe(companyA);
    });
  });

  describe("cancelling and expiring", () => {
    it("cancels an open invitation and refuses to cancel it twice", async () => {
      const row = await asTenant(companyA, (tx) => invitesRepo.createInvite(tx, base()));
      const cancelled = await asTenant(companyA, (tx) => invitesRepo.cancelInvite(tx, row.id));
      expect(cancelled.status).toBe("cancelled");
      await expect(
        asTenant(companyA, (tx) => invitesRepo.cancelInvite(tx, row.id)),
      ).rejects.toThrow(/no longer open/i);
    });

    it("frees the address once cancelled, so a fresh invitation can be sent", async () => {
      const row = await asTenant(companyA, (tx) => invitesRepo.createInvite(tx, base()));
      await asTenant(companyA, (tx) => invitesRepo.cancelInvite(tx, row.id));
      // The unique index is partial — it only binds the OPEN ones.
      const again = await asTenant(companyA, (tx) => invitesRepo.createInvite(tx, base()));
      expect(again.status).toBe("pending");
    });

    it("marks the overdue ones expired", async () => {
      await asTenant(companyA, (tx) =>
        invitesRepo.createInvite(tx, base({ expiresAt: new Date(Date.now() - 1000) })));
      await asTenant(companyA, (tx) =>
        invitesRepo.createInvite(tx, base({ email: "fresh@example.com" })));

      const n = await asTenant(companyA, (tx) => invitesRepo.expireOverdueInvites(tx));
      expect(n).toBe(1);
      const open = await asTenant(companyA, (tx) => invitesRepo.listInvites(tx, { status: "pending" }));
      expect(open.map((i) => i.email)).toEqual(["fresh@example.com"]);
    });
  });
});
