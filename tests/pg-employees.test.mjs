/**
 * Departments and employees — the HR master record on Postgres.
 *
 * Covers what the port CHANGED rather than carried: one employee record where
 * Mongo kept three copies in step by hand, an org chart that cannot contain a
 * cycle, dates that must be in order, an update that can actually clear a
 * field, and a holiday calendar that counts working days in SQL.
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

/**
 * Drizzle wraps driver errors, so a message raised by a trigger ends up on
 * `.cause` while `.message` is only "Failed query: ...". Assert against both.
 */
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

const depts = await import("@/app/db/repositories/departments");
const staff = await import("@/app/db/repositories/employees");

suite("employees repository", () => {
  let admin, client, db;
  let companyA, otherCompany;

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
    await admin`TRUNCATE companies, entry_counters CASCADE`;

    companyA = randomUUID();
    otherCompany = randomUUID();
    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)}),
      (${otherCompany}, 'Elsewhere', ${"e-" + otherCompany.slice(0, 8)})`;
  });

  const hire = (over = {}) =>
    asTenant(over.companyId ?? companyA, (tx) =>
      staff.createEmployee(tx, {
        companyId: over.companyId ?? companyA,
        firstName: "Jane",
        lastName: "Wanjiru",
        hireDate: "2026-01-15",
        basicSalary: 80000,
        allowanceHousing: 20000,
        actor: { id: "u1", name: "HR" },
        ...over,
      }),
    );

  describe("departments", () => {
    it("numbers itself, and refuses two of the same name", async () => {
      const a = await asTenant(companyA, (tx) =>
        depts.createDepartment(tx, { companyId: companyA, name: "Finance" }));
      expect(a.code).toBe("DEPT-00001");

      const b = await asTenant(companyA, (tx) =>
        depts.createDepartment(tx, { companyId: companyA, name: "Technical" }));
      expect(b.code).toBe("DEPT-00002");

      // Two departments called Finance is a data-entry slip, not a structure.
      await expect(
        asTenant(companyA, (tx) =>
          depts.createDepartment(tx, { companyId: companyA, name: "Finance" })),
      ).rejects.toThrow();
    });

    it("will not let a department report to its own descendant", async () => {
      const parent = await asTenant(companyA, (tx) =>
        depts.createDepartment(tx, { companyId: companyA, name: "Operations" }));
      const child = await asTenant(companyA, (tx) =>
        depts.createDepartment(tx, {
          companyId: companyA, name: "Warehouse", parentDepartmentId: parent.id,
        }));

      // Operations under Warehouse closes the loop, and any recursive walk of
      // the org chart then never terminates.
      await expectRejection(
        asTenant(companyA, (tx) =>
          depts.updateDepartment(tx, { id: parent.id, parentDepartmentId: child.id })),
        /sub-department/i,
      );
    });

    it("counts its staff and their cost without a query per row", async () => {
      const d = await asTenant(companyA, (tx) =>
        depts.createDepartment(tx, { companyId: companyA, name: "Finance" }));
      await hire({ departmentId: d.id, basicSalary: 100000, allowanceHousing: 0 });
      await hire({
        firstName: "Peter", lastName: "Otieno", departmentId: d.id,
        basicSalary: 50000, allowanceHousing: 10000,
      });

      const { rows } = await asTenant(companyA, (tx) => depts.listDepartments(tx));
      expect(rows).toHaveLength(1);
      expect(rows[0].employeeCount).toBe(2);
      expect(rows[0].payrollCost).toBe(160000);
    });

    it("says how many people a deactivation strands", async () => {
      const d = await asTenant(companyA, (tx) =>
        depts.createDepartment(tx, { companyId: companyA, name: "Finance" }));
      await hire({ departmentId: d.id });

      const { staffAffected } = await asTenant(companyA, (tx) =>
        depts.setDepartmentActive(tx, d.id, false));
      // Hidden from every picker while somebody is still filed under it.
      expect(staffAffected).toBe(1);
    });

    it("refuses to delete a department that still has staff", async () => {
      const d = await asTenant(companyA, (tx) =>
        depts.createDepartment(tx, { companyId: companyA, name: "Finance" }));
      await hire({ departmentId: d.id });

      await expect(
        asTenant(companyA, (tx) => depts.deleteDepartment(tx, d.id)),
      ).rejects.toThrow(/still has 1 employee/i);
    });
  });

  describe("hiring", () => {
    it("creates the party and the employee as one record", async () => {
      const e = await hire({ email: "jane@acme.co", phone: "0722000000" });
      expect(e.employeeNumber).toBe("EMP-00001");

      const full = await asTenant(companyA, (tx) => staff.getEmployee(tx, e.id));
      expect(full.fullName).toBe("Jane Wanjiru");
      // Identity lives on the party and comes back joined, not copied.
      expect(full.email).toBe("jane@acme.co");
      expect(full.phone).toBe("0722000000");
      // gross_salary is generated, not something the application adds up.
      expect(full.grossSalary).toBe(100000);
      expect(full.status).toBe("probation");
    });

    it("names the person on the party row, and keeps it there", async () => {
      const e = await hire();
      const partyBefore = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT name, employee_number, is_employee FROM parties WHERE id = ${e.partyId}::uuid`));
      expect(partyBefore[0].name).toBe("Jane Wanjiru");
      expect(partyBefore[0].employee_number).toBe("EMP-00001");
      expect(partyBefore[0].is_employee).toBe(true);

      // A rename in HR reaches the ledger's copy without anyone remembering.
      // The Mongo path does this in eighty lines of hand-written sync, in one
      // of the four actions that can change a name.
      await asTenant(companyA, (tx) =>
        staff.updateEmployee(tx, {
          id: e.id, companyId: companyA, firstName: "Jane", lastName: "Mwangi",
        }));

      const partyAfter = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT name FROM parties WHERE id = ${e.partyId}::uuid`));
      expect(partyAfter[0].name).toBe("Jane Mwangi");
    });

    it("carries a department RENAME to the party too", async () => {
      const d = await asTenant(companyA, (tx) =>
        depts.createDepartment(tx, { companyId: companyA, name: "Finance" }));
      const e = await hire({ departmentId: d.id });

      await asTenant(companyA, (tx) =>
        depts.updateDepartment(tx, { id: d.id, name: "Finance & Admin" }));

      const party = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT department FROM parties WHERE id = ${e.partyId}::uuid`));
      // In Mongo the department is a string copied at hire time, so everybody
      // hired before a rename stays filed under the old name forever.
      expect(party[0].department).toBe("Finance & Admin");
    });

    it("refuses a second employee on the same employee number", async () => {
      await hire({ employeeNumber: "EMP-A" });
      await expect(
        hire({ firstName: "Peter", lastName: "Otieno", employeeNumber: "EMP-A" }),
      ).rejects.toThrow();
    });

    it("records the hire as an employment event", async () => {
      const e = await hire();
      const events = await asTenant(companyA, (tx) =>
        staff.listEmploymentEvents(tx, e.id));
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe("hire");
      expect(events[0].effectiveDate).toBe("2026-01-15");
    });
  });

  describe("editing", () => {
    it("can actually CLEAR a field", async () => {
      const e = await hire({ designation: "Accountant", jobGrade: "G3" });

      // The source reads `formData.get("designation") || previous`, so a blank
      // submit restores the old value and the field can never be emptied.
      const updated = await asTenant(companyA, (tx) =>
        staff.updateEmployee(tx, {
          id: e.id, companyId: companyA, designation: "",
        }));
      expect(updated.designation).toBeNull();
      // A key that was not sent is left alone.
      expect(updated.jobGrade).toBe("G3");
    });

    it("records a promotion, which the source did not", async () => {
      const finance = await asTenant(companyA, (tx) =>
        depts.createDepartment(tx, { companyId: companyA, name: "Finance" }));
      const ops = await asTenant(companyA, (tx) =>
        depts.createDepartment(tx, { companyId: companyA, name: "Operations" }));
      const e = await hire({ departmentId: finance.id, designation: "Accountant" });

      await asTenant(companyA, (tx) =>
        staff.updateEmployee(tx, {
          id: e.id, companyId: companyA,
          departmentId: ops.id, designation: "Head of Operations",
        }));

      const events = await asTenant(companyA, (tx) =>
        staff.listEmploymentEvents(tx, e.id));
      const types = events.map((x) => x.eventType);
      expect(types).toContain("department_change");
      expect(types).toContain("designation_change");
      const move = events.find((x) => x.eventType === "department_change");
      expect(move.previousValue).toBe("Finance");
      expect(move.newValue).toBe("Operations");
    });

    it("will not let somebody report to their own report", async () => {
      const boss = await hire({ firstName: "Ann", lastName: "Kamau" });
      const report = await asTenant(companyA, (tx) =>
        staff.createEmployee(tx, {
          companyId: companyA, firstName: "Ben", lastName: "Ochieng",
          hireDate: "2026-02-01", managerId: boss.id,
        }));

      await expectRejection(
        asTenant(companyA, (tx) =>
          staff.updateEmployee(tx, {
            id: boss.id, companyId: companyA, managerId: report.id,
          })),
        /reports to them/i,
      );
    });
  });

  describe("compensation", () => {
    it("writes the change and its history in one go", async () => {
      const e = await hire({ basicSalary: 80000, allowanceHousing: 20000 });

      await asTenant(companyA, (tx) =>
        staff.updateCompensation(tx, {
          id: e.id, companyId: companyA,
          basicSalary: 95000, allowanceHousing: 25000,
          effectiveDate: "2026-07-01", reason: "Annual review",
          actor: { id: "u1", name: "CFO" },
        }));

      const history = await asTenant(companyA, (tx) =>
        staff.listSalaryChanges(tx, e.id));
      expect(history).toHaveLength(1);
      expect(history[0].previousGross).toBe(100000);
      expect(history[0].newGross).toBe(120000);
      // Derived, so a record cannot disagree with its own before and after.
      expect(history[0].basicChange).toBe(15000);
      expect(history[0].grossChange).toBe(20000);
    });

    it("refuses a negative salary", async () => {
      const e = await hire();
      await expect(
        asTenant(companyA, (tx) =>
          tx.execute(sql`UPDATE employees SET basic_salary = -1 WHERE id = ${e.id}::uuid`)),
      ).rejects.toThrow();
    });
  });

  describe("the lifecycle", () => {
    it("confirms off probation once, and only from probation", async () => {
      const e = await hire();
      const confirmed = await asTenant(companyA, (tx) =>
        staff.confirmEmployee(tx, { id: e.id, companyId: companyA, confirmationDate: "2026-04-15" }));
      expect(confirmed.status).toBe("active");

      await expect(
        asTenant(companyA, (tx) =>
          staff.confirmEmployee(tx, { id: e.id, companyId: companyA })),
      ).rejects.toThrow(/not on probation/i);
    });

    it("terminates with a reason of its own, and deactivates the party", async () => {
      const e = await hire();
      const done = await asTenant(companyA, (tx) =>
        staff.terminateEmployee(tx, {
          id: e.id, companyId: companyA,
          terminationDate: "2026-06-30", reason: "Resigned",
        }));

      expect(done.status).toBe("terminated");
      // Its own column — the source prepends "TERMINATED: …" to free-text
      // notes, where nothing can query it.
      expect(done.terminationReason).toBe("Resigned");

      const party = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT is_active FROM parties WHERE id = ${e.partyId}::uuid`));
      expect(party[0].is_active).toBe(false);
    });

    it("refuses a termination date before the hire date", async () => {
      const e = await hire();  // hired 2026-01-15
      await expect(
        asTenant(companyA, (tx) =>
          staff.terminateEmployee(tx, {
            id: e.id, companyId: companyA, terminationDate: "2025-12-01",
          })),
      ).rejects.toThrow(/before the hire date/i);
    });

    it("will not let the status say terminated with no date on it", async () => {
      const e = await hire();
      await expect(
        asTenant(companyA, (tx) =>
          tx.execute(sql`UPDATE employees SET status = 'terminated' WHERE id = ${e.id}::uuid`)),
      ).rejects.toThrow();
    });

    it("does not reopen an ended employment through a status change", async () => {
      const e = await hire();
      await asTenant(companyA, (tx) =>
        staff.terminateEmployee(tx, { id: e.id, companyId: companyA }));

      await expect(
        asTenant(companyA, (tx) =>
          staff.setEmployeeStatus(tx, { id: e.id, companyId: companyA, status: "active" })),
      ).rejects.toThrow(/has ended/i);
    });
  });

  describe("the staff list", () => {
    it("hides people who have left unless asked", async () => {
      const a = await hire();
      await hire({ firstName: "Peter", lastName: "Otieno" });
      await asTenant(companyA, (tx) =>
        staff.terminateEmployee(tx, { id: a.id, companyId: companyA }));

      const def = await asTenant(companyA, (tx) => staff.listEmployees(tx));
      expect(def.total).toBe(1);

      const all = await asTenant(companyA, (tx) =>
        staff.listEmployees(tx, { includeTerminated: true }));
      expect(all.total).toBe(2);
    });

    it("finds somebody by their WHOLE name", async () => {
      await hire();               // Jane Wanjiru
      await hire({ firstName: "Peter", lastName: "Otieno" });

      // Mongo builds one regex per field, so "jane wanjiru" matches neither
      // firstName nor lastName and the search comes back empty.
      const found = await asTenant(companyA, (tx) =>
        staff.listEmployees(tx, { search: "jane wanjiru" }));
      expect(found.total).toBe(1);
      expect(found.rows[0].fullName).toBe("Jane Wanjiru");
    });

    it("adds up the headcount and the monthly wage bill in one pass", async () => {
      const a = await hire({ basicSalary: 100000, allowanceHousing: 0 });
      await hire({ firstName: "Peter", lastName: "Otieno", basicSalary: 60000, allowanceHousing: 0 });
      await asTenant(companyA, (tx) =>
        staff.confirmEmployee(tx, { id: a.id, companyId: companyA }));

      const stats = await asTenant(companyA, (tx) => staff.getHeadcountStats(tx));
      expect(stats.headcount).toBe(2);
      expect(stats.active).toBe(1);
      expect(stats.probation).toBe(1);
      expect(stats.monthlyPayroll).toBe(160000);
    });
  });

  describe("tenant isolation", () => {
    it("shows one company nothing of another's, with no filter in the call", async () => {
      await hire();
      await asTenant(otherCompany, (tx) =>
        staff.createEmployee(tx, {
          companyId: otherCompany, firstName: "Stranger", lastName: "Person",
          hireDate: "2026-01-01",
        }));

      // No companyId anywhere in the call — row-level security is what makes
      // this true, which is the point of asserting it.
      const mine = await asTenant(companyA, (tx) => staff.listEmployees(tx));
      expect(mine.total).toBe(1);
      expect(mine.rows[0].fullName).toBe("Jane Wanjiru");

      const theirs = await asTenant(otherCompany, (tx) => staff.listEmployees(tx));
      expect(theirs.total).toBe(1);
      expect(theirs.rows[0].fullName).toBe("Stranger Person");
    });

    it("returns nothing at all when the scope is not set", async () => {
      await hire();
      const unscoped = await db.transaction((tx) => staff.listEmployees(tx));
      expect(unscoped.total).toBe(0);
    });

    it("cannot put another tenant's employee in a department", async () => {
      const theirDept = await asTenant(otherCompany, (tx) =>
        depts.createDepartment(tx, { companyId: otherCompany, name: "Theirs" }));

      await expect(hire({ departmentId: theirDept.id })).rejects.toThrow();
    });
  });

  describe("the holiday calendar", () => {
    beforeEach(async () => {
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO public_holidays (company_id, name, day, month, is_recurring)
          VALUES (${companyA}::uuid, 'Christmas', 25, 12, true),
                 (${companyA}::uuid, 'Boxing Day', 26, 12, true)`));
    });

    it("counts working days as weekdays that are not holidays", async () => {
      // December 2025 has 23 weekdays. Christmas (Thu) and Boxing Day (Fri)
      // both fall on one, so 21 remain.
      const [{ n }] = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT working_days(${companyA}::uuid, '2025-12-01', '2025-12-31') AS n`));
      expect(Number(n)).toBe(21);
    });

    it("does not invent 29 February in a year that has no such day", async () => {
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO public_holidays (company_id, name, day, month, is_recurring)
          VALUES (${companyA}::uuid, 'Leap Day', 29, 2, true)`));

      const leap = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT * FROM holiday_dates(${companyA}::uuid, '2024-02-01', '2024-02-29')`));
      expect(leap).toHaveLength(1);

      // make_date would raise on 2025-02-29 and take the whole leave
      // calculation down with it.
      const notLeap = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT * FROM holiday_dates(${companyA}::uuid, '2025-02-01', '2025-02-28')`));
      expect(notLeap).toHaveLength(0);
    });

    it("refuses a one-off holiday with no year, which would never happen", async () => {
      await expect(
        asTenant(companyA, (tx) =>
          tx.execute(sql`
            INSERT INTO public_holidays (company_id, name, day, month, is_recurring)
            VALUES (${companyA}::uuid, 'Election Day', 9, 8, false)`)),
      ).rejects.toThrow();
    });

    it("refuses the same recurring holiday twice", async () => {
      await expect(
        asTenant(companyA, (tx) =>
          tx.execute(sql`
            INSERT INTO public_holidays (company_id, name, day, month, is_recurring)
            VALUES (${companyA}::uuid, 'Christmas again', 25, 12, true)`)),
      ).rejects.toThrow();
    });
  });
});
