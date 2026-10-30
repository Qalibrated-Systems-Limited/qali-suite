/**
 * Technical report sign-off: the submitter names the supervisor and the
 * approving manager, and only they sign their step.
 *
 * Before this the review chose nobody: any member of the sign-off group could
 * sign "Supervisor sign-off" and then the same person "Manager approval".
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

const repo = await import("@/app/db/repositories/workflowReports");

const SIGNOFF = ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Manager"];

suite("report sign-off", () => {
  let admin, client, db, companyA, projectId;
  const people = {};

  const inA = (fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyA}, true)`);
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
    await admin`TRUNCATE companies, users, entry_counters CASCADE`;
    companyA = randomUUID();
    await admin`INSERT INTO companies (id, name, slug) VALUES (${companyA}, 'A', ${"a-" + companyA.slice(0, 8)})`;
    for (const [key, role] of [["author", "Accountant"], ["sup", "Manager"], ["mgr", "Finance Manager"], ["other", "Manager"], ["clerk", "Employee"]]) {
      const id = `u-${key}-${randomUUID().slice(0, 6)}`;
      await admin`INSERT INTO users (id, name, email, role, home_company_id)
                  VALUES (${id}, ${key}, ${key + id + "@x.co"}, ${role}, ${companyA})`;
      await admin`INSERT INTO user_company_access (user_id, company_id, role, status, granted_via)
                  VALUES (${id}, ${companyA}, ${role}, 'active', 'manual')`;
      people[key] = { id, name: key };
    }
    projectId = randomUUID();
    await admin`INSERT INTO projects (id, company_id, project_number, name) VALUES (${projectId}, ${companyA}, 'PRJ-1', 'Bridge')`;
  });

  const draft = () =>
    inA((tx) =>
      repo.createReport(tx, {
        companyId: companyA, projectId, type: "WB02", title: "Weekly check", summary: "Weekly check done",
        createdById: people.author.id, createdByName: "author",
      }));
  const submit = (r, reviewer = people.sup, approver = people.mgr, actor = people.author) =>
    inA((tx) => repo.submitReport(tx, r.id, actor, { progress: null, revenue: null, cost: null }, { reviewer, approver }));

  it("lists only the sign-off group as people who can be named", async () => {
    const list = await inA((tx) => repo.listSignoffUsers(tx, SIGNOFF));
    const names = list.map((u) => u.name).sort();
    expect(names).toEqual(["mgr", "other", "sup"]);
  });

  it("records who is named, and only the named supervisor signs", async () => {
    const r = await draft();
    const submitted = await submit(r);
    expect(submitted.assignedReviewerName).toBe("sup");
    expect(submitted.assignedApproverName).toBe("mgr");
    expect(submitted.submittedById).toBe(people.author.id);

    await expect(inA((tx) => repo.reviewReport(tx, r.id, people.other))).rejects.toThrow(/waiting for sup's sign-off/);
    const reviewed = await inA((tx) => repo.reviewReport(tx, r.id, people.sup));
    expect(reviewed.status).toBe("reviewed");

    await expect(inA((tx) => repo.approveReport(tx, r.id, people.other))).rejects.toThrow(/waiting for mgr's approval/);
    const approved = await inA((tx) => repo.approveReport(tx, r.id, people.mgr));
    expect(approved.status).toBe("approved");
  });

  it("refuses one person in two places", async () => {
    const r = await draft();
    await expect(submit(r, people.author, people.mgr)).rejects.toThrow(/cannot be the supervisor of a report you submit/);
    await expect(submit(r, people.sup, people.author)).rejects.toThrow(/cannot approve a report you submit/);
    await expect(submit(r, people.sup, people.sup)).rejects.toThrow(/must be different people/);
    // And the database holds the last one from any path.
    await expect(
      inA((tx) => tx.execute(sql`
        UPDATE workflow_reports SET assigned_reviewer_id = ${people.sup.id}, assigned_approver_id = ${people.sup.id}
         WHERE id = ${r.id}::uuid`)),
    ).rejects.toThrow();
  });

  it("hands a waiting step to someone else, keeping the separation", async () => {
    const r = await draft();
    await submit(r);
    await expect(inA((tx) => repo.reassignSignoff(tx, r.id, people.mgr))).rejects.toThrow(/must be different people/);
    const { row, step } = await inA((tx) => repo.reassignSignoff(tx, r.id, people.other));
    expect(step).toBe("supervisor");
    expect(row.assignedReviewerName).toBe("other");
    await expect(inA((tx) => repo.reviewReport(tx, r.id, people.sup))).rejects.toThrow(/waiting for other's/);
    await inA((tx) => repo.reviewReport(tx, r.id, people.other));

    await expect(inA((tx) => repo.reassignSignoff(tx, r.id, people.other))).rejects.toThrow(/who signed cannot also approve/);
  });

  it("clears the names when a report is reopened", async () => {
    const r = await draft();
    await submit(r);
    const back = await inA((tx) => repo.reopenReport(tx, r.id, people.sup));
    expect(back.status).toBe("draft");
    expect(back.assignedReviewerId).toBeNull();
    expect(back.assignedApproverId).toBeNull();
  });

  it("leaves a report submitted before names were given open to the group", async () => {
    const r = await draft();
    await inA((tx) => tx.execute(sql`
      UPDATE workflow_reports SET status = 'submitted', submitted_by_name = 'author', submitted_at = now()
       WHERE id = ${r.id}::uuid`));
    const reviewed = await inA((tx) => repo.reviewReport(tx, r.id, people.other));
    expect(reviewed.status).toBe("reviewed");
  });
});
