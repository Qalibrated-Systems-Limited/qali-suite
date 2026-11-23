/**
 * The help desk does what a help desk does: SLA policies per company, the
 * clock paused while waiting on the customer, merging duplicates, the
 * requester's rating, a knowledge base, and resolved tickets closing
 * themselves.
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

const repo = await import("@/app/db/repositories/helpdesk");
const alerts = await import("@/app/db/alerts");

suite("help desk essentials", () => {
  let admin, client, db, co;
  const me = { id: null, name: "Desk" };
  const inCo = (fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${co}, true)`);
      return fn(tx);
    });
  const raise = (extra = {}) =>
    inCo((tx) => repo.createTicket(tx, { companyId: co, title: "Printer jams", createdByName: "Ann", ...extra }));

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
    await admin`TRUNCATE companies, users, entry_counters CASCADE`;
    co = randomUUID();
    await admin`INSERT INTO companies (id, name, slug) VALUES (${co}, 'Co', ${"co-" + co.slice(0, 8)})`;
  });

  it("new tickets take the company's SLA policy, else the default", async () => {
    const before = await raise({ priority: "high" });
    const hrs = (t) => (new Date(t.resolutionDueAt) - new Date(t.createdAt)) / 3600_000;
    expect(Math.round(hrs(before))).toBe(8);
    await inCo((tx) => repo.setSlaPolicy(tx, co, "high", 1, 3, "Desk"));
    const after = await raise({ priority: "high" });
    expect(Math.round(hrs(after))).toBe(3);
    const policies = await inCo((tx) => repo.listSlaPolicies(tx));
    expect(policies.find((p) => p.priority === "high")).toMatchObject({ custom: true, resolutionHours: 3 });
  });

  it("pending stops the clock and moves the deadline by the time waited", async () => {
    const t = await raise({ priority: "medium" });
    const paused = await inCo((tx) => repo.setTicketStatus(tx, t.id, "pending", me));
    expect(paused.slaPausedAt).toBeTruthy();
    // Pretend it waited two hours on the customer.
    await admin`UPDATE helpdesk_tickets SET sla_paused_at = now() - interval '2 hours' WHERE id = ${t.id}`;
    const resumed = await inCo((tx) => repo.setTicketStatus(tx, t.id, "in_progress", me));
    expect(resumed.slaPausedAt).toBeNull();
    const shift = (new Date(resumed.resolutionDueAt) - new Date(t.resolutionDueAt)) / 3600_000;
    expect(shift).toBeGreaterThan(1.9);
    expect(shift).toBeLessThan(2.1);
  });

  it("merges a duplicate into the ticket that carries the work", async () => {
    const a = await raise();
    const b = await raise({ title: "Printer jams again" });
    const r = await inCo((tx) => repo.mergeTicket(tx, b.id, a.id, me));
    expect(r.row).toMatchObject({ status: "closed", mergedIntoId: a.id, closureReason: `Merged into ${a.ticketNumber}` });
    await expect(inCo((tx) => repo.mergeTicket(tx, a.id, a.id, me))).rejects.toThrow(/itself/);
    const thread = await inCo((tx) => repo.getTicketThread(tx, a.id));
    expect(thread.comments.map((c) => c.content).join(" ")).toMatch(b.ticketNumber);
  });

  it("is rated 1 to 5, and only once resolved", async () => {
    const t = await raise();
    await expect(inCo((tx) => repo.rateTicket(tx, t.id, 5, ""))).rejects.toThrow(/resolved/);
    await inCo((tx) => repo.setTicketStatus(tx, t.id, "resolved", me));
    const r = await inCo((tx) => repo.rateTicket(tx, t.id, 4, "Quick"));
    expect(r).toMatchObject({ satisfactionRating: 4, satisfactionComment: "Quick" });
    await expect(admin`UPDATE helpdesk_tickets SET satisfaction_rating = 9 WHERE id = ${t.id}`).rejects.toThrow(/rating_valid/);
  });

  it("a person sees the tickets they raised or hold", async () => {
    await admin`INSERT INTO users (id, name, email, role, home_company_id) VALUES ('u-ann', 'Ann', 'ann@x.co', 'Employee', ${co})`;
    await raise({ createdById: "u-ann" });
    await raise({ title: "Someone else's" });
    const mine = await inCo((tx) => repo.listTicketsFor(tx, "u-ann"));
    expect(mine.map((t) => t.title)).toEqual(["Printer jams"]);
  });

  it("keeps a knowledge base, published and found by search", async () => {
    await inCo((tx) => repo.saveArticle(tx, { companyId: co, title: "Clearing a paper jam", body: "Open tray 2…", actor: me }));
    await inCo((tx) => repo.saveArticle(tx, { companyId: co, title: "Draft", body: "x", status: "draft", actor: me }));
    expect((await inCo((tx) => repo.listArticles(tx, "jam"))).map((a) => a.articleNumber)).toEqual(["KB-00001"]);
    expect(await inCo((tx) => repo.listArticles(tx, ""))).toHaveLength(1);
    expect(await inCo((tx) => repo.listArticles(tx, "", true))).toHaveLength(2);
  });

  it("closes tickets left resolved for 7 days, and records why", async () => {
    const old = await raise();
    const fresh = await raise({ title: "Fresh" });
    for (const t of [old, fresh]) await inCo((tx) => repo.setTicketStatus(tx, t.id, "resolved", me));
    await admin`UPDATE helpdesk_tickets SET resolved_at = now() - interval '8 days' WHERE id = ${old.id}`;
    const r = await alerts.closeStaleResolvedTickets(7);
    expect(r.closed).toBe(1);
    const [o] = await admin`SELECT status, closure_reason FROM helpdesk_tickets WHERE id = ${old.id}`;
    expect(o.status).toBe("closed");
    expect(o.closure_reason).toMatch(/automatically/);
    const [f] = await admin`SELECT status FROM helpdesk_tickets WHERE id = ${fresh.id}`;
    expect(f.status).toBe("resolved");
  });
});
