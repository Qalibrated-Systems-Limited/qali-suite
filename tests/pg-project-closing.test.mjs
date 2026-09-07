/**
 * What stops a project being closed.
 *
 * CLOSING IS TERMINAL. `ProjectStatusActions` offers no transition out of
 * `closed`, and a closed project then refuses edits, roster changes, time and
 * variations. It is the one status change nobody can walk back, and until now
 * nothing stood in its way — a job could be closed with retention still held,
 * a certificate certified and never invoiced, and a week of labour sitting
 * unapproved that could then never BE approved.
 *
 * Retention is the reason this exists. It falls due at practical completion
 * and again after the defects period, both AFTER the point somebody wants to
 * close the job, so a closed project is exactly how a contractor forgets to
 * collect the last 5%.
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

const repo = await import("@/app/db/repositories/projects");

suite("what stops a project closing", () => {
  let admin, client, db;
  let companyA, project, worker, retentionAcct, arAcct;
  const actor = { id: null, name: "The CFO" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  const blockers = () => inA((tx) => repo.getProjectClosingBlockers(tx, project));
  const kinds = async () => (await blockers()).map((b) => b.kind);

  /** A contract that holds retention, which is the interesting case. */
  const newContract = (over = {}) =>
    inA((tx) =>
      repo.createContract(tx, {
        companyId: companyA,
        projectId: project,
        contractSum: "10000000",
        retentionPercent: over.retentionPercent ?? "10",
        advanceAmount: "0",
        advanceRecoveryPercent: "0",
        createdByName: "Seed",
        ...over,
      }),
    );

  const newCertificate = (contractId, over = {}) =>
    inA((tx) =>
      repo.createCertificate(tx, {
        companyId: companyA,
        projectId: project,
        contractId,
        createdByName: "Seed",
        ...over,
      }),
    );

  const certify = (id) =>
    inA((tx) =>
      repo.certifyCertificate(tx, id, actor, {
        retentionAccountId: retentionAcct,
        arAccountId: arAcct,
      }),
    );

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
    worker = randomUUID();
    retentionAcct = randomUUID();
    arAcct = randomUUID();

    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;

    await inA((tx) =>
      tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_employee, name)
        VALUES (${worker}, ${companyA}, 'employee', true, 'Jane Site')`),
    );
    await inA((tx) =>
      tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account)
        VALUES (${retentionAcct}, ${companyA}, '1125', 'Retention Receivable', 'asset', 'retention_receivable'),
               (${arAcct},        ${companyA}, '1120', 'Accounts Receivable',  'asset', 'accounts_receivable')`),
    );

    project = (
      await inA((tx) =>
        repo.createProject(tx, {
          companyId: companyA,
          name: "Otho Road",
          createdByName: "Seed",
        }),
      )
    ).id;
  });

  // ───────────────────────────────────────────────────────────────────────────
  it("lets a project with nothing outstanding close", async () => {
    expect(await blockers()).toEqual([]);
  });

  it("holds a project open while retention is still held", async () => {
    // The one this exists for.
    const c = await newContract();
    const cert = await newCertificate(c.id, { workDoneToDate: "5000000" });
    await certify(cert.id);

    // Every blocker is returned, so the uninvoiced one sitting beside this
    // does not hide it.
    const found = await blockers();
    const retention = found.find((b) => b.kind === "retention");
    expect(retention).toBeTruthy();
    // 10% of 5,000,000, and the message says the number rather than "some".
    expect(retention.detail).toContain("500,000");
  });

  it("lets it close once the retention has been released", async () => {
    const c = await newContract();
    const one = await newCertificate(c.id, { workDoneToDate: "5000000" });
    await certify(one.id);

    const two = await newCertificate(c.id, {
      workDoneToDate: "5000000",
      retentionReleasedToDate: "500000",
    });
    await certify(two.id);

    expect(await kinds()).not.toContain("retention");
  });

  it("holds it open on a certificate that was never invoiced", async () => {
    // Certifying and invoicing are two steps on purpose. This is the gap that
    // separation opens: work the employer agreed to pay for and was never
    // asked to pay.
    const c = await newContract({ retentionPercent: "0" });
    const cert = await newCertificate(c.id, { workDoneToDate: "5000000" });
    await certify(cert.id);

    expect(await kinds()).toContain("uninvoiced_certificate");
  });

  it("holds it open on a draft certificate", async () => {
    const c = await newContract({ retentionPercent: "0" });
    await newCertificate(c.id, { workDoneToDate: "1000000" });

    expect(await kinds()).toContain("draft_certificate");
  });

  it("holds it open on time nobody has approved", async () => {
    // After closing it could never BE approved — a closed project refuses the
    // status change — so the labour would be stranded outside the job's cost
    // and outside the ledger for good.
    const a = await inA((tx) =>
      repo.upsertAssignment(tx, {
        companyId: companyA,
        projectId: project,
        partyId: worker,
        partyName: "Jane Site",
        partyType: "employee",
        rateAmount: "1000.0000",
        rateUnit: "day",
        assignedByName: "Seed",
      }),
    );
    const t = await inA((tx) =>
      repo.createTimesheet(tx, {
        companyId: companyA,
        projectId: project,
        assignmentId: a.id,
        workDate: "2026-09-02",
        quantity: 1,
        unit: "day",
        enteredByName: "Seed",
      }),
    );
    await inA((tx) => repo.setTimesheetStatus(tx, t.id, "submitted", actor));

    expect(await kinds()).toContain("unapproved_timesheets");
  });

  it("holds it open on a variation nobody decided", async () => {
    const c = await newContract({ retentionPercent: "0" });
    const v = await inA((tx) =>
      repo.createVariation(tx, {
        companyId: companyA,
        projectId: project,
        contractId: c.id,
        title: "Additional culverts",
        costEffect: 500000,
        issuedDate: "2026-06-01",
        createdByName: "Seed",
      }),
    );
    await inA((tx) => repo.setVariationStatus(tx, v.id, "submitted", actor));

    expect(await kinds()).toContain("undecided_variations");
  });

  it("names every one of them, not just the first", async () => {
    // "You cannot close this" is not an answer anybody can act on.
    const c = await newContract();
    const cert = await newCertificate(c.id, { workDoneToDate: "5000000" });
    await certify(cert.id);
    await newCertificate(c.id, { workDoneToDate: "6000000" });

    const found = await kinds();
    expect(found).toContain("retention");
    expect(found).toContain("uninvoiced_certificate");
    expect(found).toContain("draft_certificate");
  });

  it("says nothing about a cancelled certificate", async () => {
    // Withdrawn is settled. It does not advance the chain and it is not
    // outstanding work.
    const c = await newContract({ retentionPercent: "0" });
    const cert = await newCertificate(c.id, { workDoneToDate: "5000000" });
    await certify(cert.id);
    await inA((tx) => repo.cancelCertificate(tx, cert.id, actor));

    expect(await kinds()).not.toContain("uninvoiced_certificate");
  });
});
