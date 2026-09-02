/**
 * Contracts, interim payment certificates and the project type — 0081 and 0082.
 *
 * Most of this file is arithmetic, because a certificate IS arithmetic and a
 * wrong one is a wrong payment. The rest is what the database refuses: an
 * issued certificate edited, two drafts on one contract, two main contracts on
 * one project — each written AT THE TABLE where the point is the database's
 * refusal rather than the repository's care.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as repo from "@/app/db/repositories/projects";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

async function expectRejection(promise, pattern) {
  let caught;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the operation to be rejected").toBeDefined();
  expect(`${caught.message} ${caught.cause ?? ""}`).toMatch(pattern);
}

suite("contracts and certificates", () => {
  let client, admin, db;
  let companyA, projectA, customerA, retentionAcct, arAcct;
  /**
   * `TRUNCATE companies CASCADE` empties `project_types` COMPLETELY — cascade
   * follows the foreign key, not the rows, so the built-ins go with it even
   * though their `company_id` is NULL. Every Postgres suite here opens with
   * that truncate, so the first one to run used to delete the built-in types
   * for every suite after it.
   *
   * `seed_builtin_project_types()` (0083) puts them back, and the fixture is
   * therefore the migration's own rows rather than a second copy of the six
   * that could drift from it.
   */
  const actor = { id: null, name: "Otieno, QS" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  /** 100m, 10% retention capped at 5%, 10m advance recovered at 20%. */
  const contractTerms = (over = {}) => ({
    companyId: companyA,
    projectId: projectA,
    createdByName: "Seed",
    contractSum: "100000000",
    retentionPercent: "10",
    retentionCapPercent: "5",
    advanceAmount: "10000000",
    advanceRecoveryPercent: "20",
    ...over,
  });

  const newContract = (over = {}) =>
    inA((tx) => repo.createContract(tx, contractTerms(over)));

  const newCertificate = (contractId, over = {}) =>
    inA((tx) =>
      repo.createCertificate(tx, {
        companyId: companyA,
        projectId: projectA,
        contractId,
        createdByName: "Seed",
        ...over,
      }),
    );

  /**
   * Certifying carries the two accounts a RELEASE moves money between. The
   * action resolves them from the chart; this fixture builds only what it uses,
   * so it seeds them and passes the same pair.
   */
  const certify = (id) =>
    inA((tx) =>
      repo.certifyCertificate(tx, id, actor, {
        retentionAccountId: retentionAcct,
        arAccountId: arAcct,
      }),
    );

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
    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})`;
    await admin`SELECT seed_builtin_project_types()`;

    customerA = randomUUID();
    retentionAcct = randomUUID();
    arAcct = randomUUID();
    await asTenant(companyA, (tx) =>
      tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name)
        VALUES (${customerA}::uuid, ${companyA}::uuid, 'customer', true, 'KeRRA')`),
    );
    await asTenant(companyA, (tx) =>
      tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account)
        VALUES (${retentionAcct}, ${companyA}, '1125', 'Retention Receivable', 'asset', 'retention_receivable'),
               (${arAcct},        ${companyA}, '1120', 'Accounts Receivable',  'asset', 'accounts_receivable')`),
    );
    projectA = (
      await inA((tx) =>
        repo.createProject(tx, {
          companyId: companyA,
          name: "Otho–Got Kachola Road",
          createdByName: "Seed",
        }),
      )
    ).id;
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the terms", () => {
    it("defaults the original sum to the sum it was let at", async () => {
      const c = await newContract();
      expect(Number(c.originalSum)).toBe(100000000);
      // And a variation moving the current sum does not move the original —
      // which is the entire reason the second column exists.
      await inA((tx) => repo.updateContract(tx, c.id, { contractSum: "112000000" }));
      const after = await inA((tx) => repo.getContractById(tx, c.id));
      expect(Number(after.contractSum)).toBe(112000000);
      expect(Number(after.originalSum)).toBe(100000000);
    });

    it("refuses a second MAIN contract on one project", async () => {
      await newContract();
      await expectRejection(newContract(), /one_receivable|duplicate key/i);
    });

    it("allows subcontracts beside it, because retention runs both ways", async () => {
      await newContract();
      const sub = await newContract({
        direction: "payable",
        counterpartyName: "Bituminous Ltd",
        contractSum: "18000000",
        retentionPercent: "10",
      });
      expect(sub.direction).toBe("payable");
      const all = await inA((tx) => repo.listProjectContracts(tx, projectA));
      expect(all).toHaveLength(2);
    });

    it("refuses an advance nobody recovers", async () => {
      await expectRejection(
        newContract({ advanceAmount: "5000000", advanceRecoveryPercent: "0" }),
        /advance_is_recoverable/i,
      );
    });

    it("refuses a retention percentage outside 0–100", async () => {
      await expectRejection(
        newContract({ retentionPercent: "120" }),
        /retention_in_range/i,
      );
    });

    it("will not delete a contract that has certificates against it", async () => {
      const c = await newContract();
      await newCertificate(c.id, { workDoneToDate: "1000000" });
      await expectRejection(
        inA((tx) => repo.deleteContract(tx, c.id)),
        /certificate/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the arithmetic", () => {
    it("works the first certificate right through", async () => {
      const c = await newContract();
      const cert = await newCertificate(c.id, {
        workDoneToDate: "20000000",
        materialsOnSite: "2000000",
        dayworksToDate: "500000",
      });
      await certify(cert.id);

      const [row] = await inA((tx) => repo.listCertificates(tx, c.id));
      const f = row.figures;

      expect(f.grossValuation).toBe(22500000);
      // 10% of 22.5m = 2.25m, and the cap is 5% of 100m = 5m, so uncapped here.
      expect(f.retentionHeld).toBe(2250000);
      expect(f.retentionCapped).toBe(false);
      // 20% of 22.5m = 4.5m, less than the 10m advanced.
      expect(f.advanceRecovered).toBe(4500000);
      expect(f.netToDate).toBe(22500000 - 2250000 - 4500000);
      expect(f.previouslyCertified).toBe(0);
      expect(f.netThisCertificate).toBe(f.netToDate);
    });

    it("subtracts the previous certificate, not the previous gross", async () => {
      const c = await newContract();
      const one = await newCertificate(c.id, { workDoneToDate: "20000000" });
      await certify(one.id);
      const two = await newCertificate(c.id, { workDoneToDate: "35000000" });
      await certify(two.id);

      const rows = await inA((tx) => repo.listCertificates(tx, c.id));
      const [first, second] = rows;

      expect(second.figures.grossValuation).toBe(35000000);
      expect(second.figures.previouslyCertified).toBe(first.figures.netToDate);
      expect(second.figures.netThisCertificate).toBe(
        second.figures.netToDate - first.figures.netToDate,
      );
      // The two certificates together are the whole net position — which is the
      // property that makes the cumulative form worth having.
      expect(
        first.figures.netThisCertificate + second.figures.netThisCertificate,
      ).toBeCloseTo(second.figures.netToDate, 2);
    });

    it("caps the retention, and says that it did", async () => {
      const c = await newContract();
      // 10% of 80m is 8m; the cap is 5% of 100m = 5m.
      const cert = await newCertificate(c.id, { workDoneToDate: "80000000" });
      await certify(cert.id);

      const [row] = await inA((tx) => repo.listCertificates(tx, c.id));
      expect(row.figures.retentionHeld).toBe(5000000);
      expect(row.figures.retentionCapped).toBe(true);
    });

    it("stops recovering the advance once it is repaid", async () => {
      const c = await newContract();
      // 20% of 90m is 18m, and only 10m was ever advanced.
      const cert = await newCertificate(c.id, { workDoneToDate: "90000000" });
      await certify(cert.id);

      const [row] = await inA((tx) => repo.listCertificates(tx, c.id));
      expect(row.figures.advanceRecovered).toBe(10000000);
      expect(row.figures.advanceOutstanding).toBe(0);
    });

    it("releases retention when the certificate says it was released", async () => {
      const c = await newContract();
      const one = await newCertificate(c.id, { workDoneToDate: "50000000" });
      await certify(one.id);
      const two = await newCertificate(c.id, {
        workDoneToDate: "50000000",
        retentionReleasedToDate: "2500000",
      });
      await certify(two.id);

      const rows = await inA((tx) => repo.listCertificates(tx, c.id));
      // Half the 5m held (10% of 50m, under the cap) comes back on the second.
      expect(rows[0].figures.retentionOutstanding).toBe(5000000);
      expect(rows[1].figures.retentionReleased).toBe(2500000);
      expect(rows[1].figures.retentionOutstanding).toBe(2500000);
      expect(rows[1].figures.netThisCertificate).toBe(2500000);
    });

    it("RELEASES what this certificate releases, and posts it to the ledger", async () => {
      /**
       * The other half of the money cycle. Holding moves receivables into
       * `1125 Retention Receivable`; releasing moves them back, and the client
       * can be asked for them.
       *
       * It posts at CERTIFICATION, not with an invoice — a release is not a
       * supply. The revenue was recognised and the VAT charged when the work
       * was certified; this only makes an existing receivable collectable. A
       * certificate that ONLY releases retention certifies no new work, so
       * there is nothing to invoice and waiting for one would strand it.
       */
      const c = await newContract();
      const one = await newCertificate(c.id, { workDoneToDate: "50000000" });
      await certify(one.id);

      // 10% of 50m is 5m, under the 5m cap.
      const before = await inA((tx) => repo.listCertificates(tx, c.id));
      expect(before[0].figures.retentionOutstanding).toBe(5000000);

      // A release-only certificate: no new work, half the retention back.
      const two = await newCertificate(c.id, {
        workDoneToDate: "50000000",
        retentionReleasedToDate: "2500000",
      });
      await certify(two.id);

      const after = await inA((tx) => repo.listCertificates(tx, c.id));
      expect(after[1].figures.releasedThisCertificate).toBe(2500000);
      expect(after[1].figures.retentionOutstanding).toBe(2500000);
      // No new work, so nothing further is certified as gross...
      expect(after[1].figures.grossThisPeriod).toBe(0);
      // ...but the release is money now due.
      expect(after[1].figures.netThisCertificate).toBe(2500000);

      const [entry] = await admin`
        SELECT e.description, SUM(l.debit)::float8 d, SUM(l.credit)::float8 c
          FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
         WHERE e.description LIKE 'Retention released%'
         GROUP BY e.description`;
      expect(entry).toBeTruthy();
      expect(entry.d).toBe(2500000);
      expect(entry.c).toBe(2500000);
    });

    it("posts nothing when a certificate releases nothing", async () => {
      const c = await newContract();
      const cert = await newCertificate(c.id, { workDoneToDate: "20000000" });
      await certify(cert.id);
      const [row] = await admin`
        SELECT count(*)::int n FROM journal_entries
         WHERE description LIKE 'Retention released%'`;
      expect(row.n).toBe(0);
    });

    it("never releases more retention than was held", async () => {
      const c = await newContract();
      const cert = await newCertificate(c.id, {
        workDoneToDate: "10000000",
        retentionReleasedToDate: "99000000",
      });
      await certify(cert.id);
      const [row] = await inA((tx) => repo.listCertificates(tx, c.id));
      expect(row.figures.retentionReleased).toBe(row.figures.retentionHeld);
      expect(row.figures.retentionOutstanding).toBe(0);
    });

    it("retains nothing where the contract says zero", async () => {
      // A job that holds no retention is a contract with a zero percentage, not
      // a different kind of project — §7.
      const c = await newContract({
        retentionPercent: "0",
        retentionCapPercent: null,
        advanceAmount: "0",
        advanceRecoveryPercent: "0",
      });
      const cert = await newCertificate(c.id, { workDoneToDate: "4000000" });
      await certify(cert.id);
      const [row] = await inA((tx) => repo.listCertificates(tx, c.id));
      expect(row.figures.retentionHeld).toBe(0);
      expect(row.figures.netThisCertificate).toBe(4000000);
    });

    it("A CORRECTION TO ONE CERTIFICATE FLOWS INTO THE NEXT BY ITSELF", async () => {
      // The property the cumulative form exists for. Certificate 1 is a draft
      // that gets corrected downwards; certificate 2's "this period" absorbs it
      // without being touched.
      const c = await newContract();
      const one = await newCertificate(c.id, { workDoneToDate: "20000000" });
      await certify(one.id);
      const two = await newCertificate(c.id, { workDoneToDate: "35000000" });

      const before = await inA((tx) => repo.listCertificates(tx, c.id));
      const beforeThisPeriod = before[1].figures.netThisCertificate;

      // A remeasure finds certificate 1 over-valued, so it is withdrawn.
      await inA((tx) => repo.cancelCertificate(tx, one.id, actor));

      const after = await inA((tx) => repo.listCertificates(tx, c.id));
      // Nothing was written to certificate 2, and its "this period" changed,
      // because the chain now starts from nothing certified.
      expect(after[1].figures.previouslyCertified).toBe(0);
      expect(after[1].figures.netThisCertificate).toBeGreaterThan(beforeThisPeriod);
      expect(after[1].workDoneToDate).toBe(before[1].workDoneToDate);
    });

    it("skips a cancelled certificate in the chain", async () => {
      const c = await newContract();
      const one = await newCertificate(c.id, { workDoneToDate: "20000000" });
      await certify(one.id);
      const two = await newCertificate(c.id, { workDoneToDate: "30000000" });
      await certify(two.id);
      await inA((tx) => repo.cancelCertificate(tx, two.id, actor));
      const three = await newCertificate(c.id, { workDoneToDate: "40000000" });
      await certify(three.id);

      const rows = await inA((tx) => repo.listCertificates(tx, c.id));
      // Three carries on from ONE, because two was withdrawn.
      expect(rows[2].figures.previouslyCertified).toBe(rows[0].figures.netToDate);
    });

    it("does not let a DRAFT advance the chain", async () => {
      const c = await newContract();
      const one = await newCertificate(c.id, { workDoneToDate: "20000000" });
      // Not certified.
      const basis = await inA((tx) => repo.nextCertificateBasis(tx, c.id));
      expect(basis.previouslyCertified).toBe(0);
      expect(basis.sequence).toBe(2);
      expect(one.status).toBe("draft");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what the database refuses", () => {
    it("FREEZES a certificate once it is issued", async () => {
      const c = await newContract();
      const cert = await newCertificate(c.id, { workDoneToDate: "20000000" });
      await certify(cert.id);

      await expectRejection(
        inA((tx) => repo.updateCertificate(tx, cert.id, { workDoneToDate: "99000000" })),
        /has been issued|cannot be changed/i,
      );
      await expectRejection(
        admin`UPDATE project_certificates SET materials_on_site = 1 WHERE id = ${cert.id}`,
        /has been issued|cannot be changed/i,
      );
    });

    it("still lets an issued certificate record the invoice it raised", async () => {
      // Recording the invoice happens AFTER certifying, by definition.
      const c = await newContract();
      const cert = await newCertificate(c.id, { workDoneToDate: "20000000" });
      await certify(cert.id);
      const invoiceId = randomUUID();
      await admin`
        INSERT INTO invoices (id, company_id, invoice_number, invoice_date,
                              customer_id, subtotal, status, project_id)
        VALUES (${invoiceId}, ${companyA}, 'INV-IPC-1', CURRENT_DATE,
                ${customerA}, 100, 'draft', ${projectA})`;

      const updated = await inA((tx) =>
        repo.attachCertificateInvoice(tx, cert.id, invoiceId),
      );
      expect(updated.invoiceId).toBe(invoiceId);
    });

    it("refuses to delete an issued certificate", async () => {
      const c = await newContract();
      const cert = await newCertificate(c.id, { workDoneToDate: "20000000" });
      await certify(cert.id);
      await expectRejection(
        inA((tx) => repo.deleteCertificate(tx, cert.id)),
        /cannot be deleted|Cancel it/i,
      );
    });

    it("allows only one draft on a contract", async () => {
      const c = await newContract();
      await newCertificate(c.id, { workDoneToDate: "1000000" });
      await expectRejection(
        newCertificate(c.id, { workDoneToDate: "2000000" }),
        /one_draft|duplicate key/i,
      );
    });

    it("numbers certificates in sequence within the contract", async () => {
      const c = await newContract();
      const one = await newCertificate(c.id, { workDoneToDate: "1000000" });
      await certify(one.id);
      const two = await newCertificate(c.id, { workDoneToDate: "2000000" });
      expect(one.sequence).toBe(1);
      expect(two.sequence).toBe(2);
      expect(one.certificateNumber).not.toBe(two.certificateNumber);
    });

    it("cannot be certified after being withdrawn", async () => {
      const c = await newContract();
      const cert = await newCertificate(c.id, { workDoneToDate: "1000000" });
      await certify(cert.id);
      await inA((tx) => repo.cancelCertificate(tx, cert.id, actor));
      await expectRejection(certify(cert.id), /cancelled/i);
    });

    it("refuses to WITHDRAW a draft, because nothing was issued", async () => {
      // `project_certificates_draft_is_uncertified` would refuse this anyway —
      // a draft moved to `cancelled` still has a NULL `certified_at`. The
      // repository says which of the two states the user is in rather than
      // letting a raw check violation reach them.
      const c = await newContract();
      const cert = await newCertificate(c.id, { workDoneToDate: "1000000" });
      await expectRejection(
        inA((tx) => repo.cancelCertificate(tx, cert.id, actor)),
        /has not been issued|Delete the draft/i,
      );
    });

    it("does not show another tenant's contracts", async () => {
      const companyB = randomUUID();
      await admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})`;
      await newContract();
      const seen = await asTenant(companyB, (tx) =>
        repo.listProjectContracts(tx, projectA),
      );
      expect(seen).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the contract position", () => {
    it("reports what is certified, held and outstanding", async () => {
      const c = await newContract();
      const one = await newCertificate(c.id, { workDoneToDate: "20000000" });
      await certify(one.id);

      const p = await inA((tx) => repo.getContractPosition(tx, c.id));
      expect(p.grossCertified).toBe(20000000);
      expect(p.percentCertified).toBe(20);
      expect(p.retentionOutstanding).toBe(2000000);
      expect(p.advanceOutstanding).toBe(10000000 - 4000000);
      expect(p.certificateCount).toBe(1);
    });

    it("reports an over-certified contract as it is", async () => {
      // More certified than the sum is a variation the register has not caught
      // up with, and it is worth seeing rather than clamping to 100.
      const c = await newContract();
      const cert = await newCertificate(c.id, { workDoneToDate: "115000000" });
      await certify(cert.id);
      const p = await inA((tx) => repo.getContractPosition(tx, c.id));
      expect(p.percentCertified).toBe(115);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the project type", () => {
    it("ships six built-ins that every tenant can read and none can write", async () => {
      const types = await inA((tx) => repo.listProjectTypes(tx));
      const codes = types.map((t) => t.code);
      expect(codes).toEqual(
        expect.arrayContaining([
          "construction",
          "installation",
          "maintenance",
          "supply",
          "consultancy",
          "internal",
        ]),
      );
      expect(types.every((t) => t.companyId === null)).toBe(true);

      // WITH CHECK is `company_id = current`, so a built-in cannot be edited
      // through the app connection however hard anybody tries.
      const construction = types.find((t) => t.code === "construction");
      await expectRejection(
        inA((tx) =>
          tx.execute(
            sql`UPDATE project_types SET shows_diary = false WHERE id = ${construction.id}::uuid`,
          ),
        ),
        /row-level security|policy/i,
      );
    });

    it("a supply job shows fewer sections than a construction job", async () => {
      const types = await inA((tx) => repo.listProjectTypes(tx));
      const supply = types.find((t) => t.code === "supply");
      const construction = types.find((t) => t.code === "construction");

      expect(construction.showsDiary).toBe(true);
      expect(construction.showsCertificates).toBe(true);
      expect(supply.showsDiary).toBe(false);
      expect(supply.showsCertificates).toBe(false);
    });

    it("carries the flags on the workspace row, and shows EVERYTHING with no type", async () => {
      const types = await inA((tx) => repo.listProjectTypes(tx));
      const supply = types.find((t) => t.code === "supply");

      const untyped = await inA((tx) =>
        repo.createProject(tx, {
          companyId: companyA,
          name: "Untyped job",
          createdByName: "Seed",
        }),
      );
      await inA((tx) => repo.updateProject(tx, projectA, { typeId: supply.id }));

      const rows = await inA((tx) => repo.listProjectsForWorkspace(tx));
      const typed = rows.find((r) => r.id === projectA);
      const bare = rows.find((r) => r.id === untyped.id);

      expect(typed.showsDiary).toBe(false);
      expect(typed.typeName).toBe("Supply");
      // Decision 4: nothing disappeared from anybody's screen when the column
      // arrived.
      expect(bare.showsDiary).toBe(true);
      expect(bare.showsCertificates).toBe(true);
      expect(bare.typeName).toBeNull();
    });

    it("lets a tenant add its own type beside the built-ins", async () => {
      await inA((tx) =>
        tx.execute(sql`
          INSERT INTO project_types (company_id, code, name, shows_diary, shows_certificates)
          VALUES (${companyA}::uuid, 'logistics', 'Logistics', false, false)`),
      );
      const types = await inA((tx) => repo.listProjectTypes(tx));
      const mine = types.find((t) => t.code === "logistics");
      expect(mine.companyId).toBe(companyA);
      // Built-ins first, then the tenant's own.
      expect(types[types.length - 1].code).toBe("logistics");
    });

    it("does not leak one tenant's type to another", async () => {
      const companyB = randomUUID();
      await admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})`;
      await inA((tx) =>
        tx.execute(sql`
          INSERT INTO project_types (company_id, code, name)
          VALUES (${companyA}::uuid, 'logistics', 'Logistics')`),
      );
      const seen = await asTenant(companyB, (tx) => repo.listProjectTypes(tx));
      expect(seen.some((t) => t.code === "logistics")).toBe(false);
      // ...but B still sees the built-ins.
      expect(seen.some((t) => t.code === "construction")).toBe(true);
    });
  });
});
