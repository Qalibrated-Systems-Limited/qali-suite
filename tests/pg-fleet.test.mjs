/**
 * Fleet repository against a real PostgreSQL — 0110.
 *
 * Pins: a vehicle's reg is unique per company; a vehicle with history is
 * retired, not deleted; trips and services keep the vehicle's odometer and
 * next service current, so the derived alerts clear; a fleet cost becomes a
 * draft expense that posts like any other; tenants are isolated.
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

const repo = await import("@/app/db/repositories/fleet");
const expensesRepo = await import("@/app/db/repositories/expenses");

const DAY = 86_400_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 10);

suite("the fleet", () => {
  let admin, client, db, companyA, companyB;
  const actor = { id: null, name: "Ops" };

  const asTenant = (id, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${id}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);
  const inB = (fn) => asTenant(companyB, fn);

  const vehicle = (over = {}) =>
    inA((tx) =>
      repo.createVehicle(tx, {
        companyId: companyA,
        regNo: over.regNo ?? "KDA 123A",
        make: "Toyota",
        insuranceExpiry: over.insuranceExpiry ?? iso(90 * DAY),
        nextServiceDate: over.nextServiceDate ?? iso(90 * DAY),
        status: over.status ?? "active",
        createdByName: "Seed",
        ...over,
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
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyA = randomUUID();
    companyB = randomUUID();
    await admin`INSERT INTO companies (id, name, slug) VALUES (${companyA}, 'A', ${"a-" + companyA.slice(0, 8)})`;
    await admin`INSERT INTO companies (id, name, slug) VALUES (${companyB}, 'B', ${"b-" + companyB.slice(0, 8)})`;
  });

  it("normalises reg and enforces uniqueness per company", async () => {
    const v = await vehicle({ regNo: "kda 123a" });
    expect(v.regNo).toBe("KDA 123A");
    await expect(vehicle({ regNo: "KDA 123A" })).rejects.toThrow();
    // Same reg is fine in another company.
    const b = await inB((tx) =>
      repo.createVehicle(tx, { companyId: companyB, regNo: "KDA 123A", createdByName: "Seed" }),
    );
    expect(b.regNo).toBe("KDA 123A");
  });

  it("derives service-due and insurance-expiring counts", async () => {
    await vehicle({ regNo: "V1", insuranceExpiry: iso(10 * DAY), nextServiceDate: iso(90 * DAY) }); // insurance soon
    await vehicle({ regNo: "V2", insuranceExpiry: iso(200 * DAY), nextServiceDate: iso(-1 * DAY) }); // service overdue
    await vehicle({ regNo: "V3", status: "grounded", insuranceExpiry: iso(200 * DAY), nextServiceDate: iso(200 * DAY) });
    const stats = await inA((tx) => repo.getFleetStats(tx));
    expect(stats.fleetSize).toBe(3);
    expect(stats.insuranceExpiring).toBe(1);
    expect(stats.serviceDue).toBe(1);
    expect(stats.grounded).toBe(1);
    expect(stats.active).toBe(2);
  });

  it("keeps a vehicle with history: it is retired, not deleted", async () => {
    const v = await vehicle();
    await inA((tx) => repo.createTrip(tx, { companyId: companyA, vehicleId: v.id, tripDate: iso(0), distanceKm: 45, createdByName: "Seed" }));
    await expect(inA((tx) => repo.deleteVehicle(tx, v.id))).rejects.toThrow(/Retire it instead/);

    // And the database refuses it from any path, not just this one.
    await expect(inA((tx) => tx.execute(sql`DELETE FROM fleet_vehicles WHERE id = ${v.id}::uuid`))).rejects.toThrow();
    expect(await inA((tx) => repo.listTrips(tx))).toHaveLength(1);

    const retired = await inA((tx) => repo.updateVehicle(tx, v.id, { status: "retired" }, actor));
    expect(retired.status).toBe("retired");
    await expect(
      inA((tx) => repo.createTrip(tx, { companyId: companyA, vehicleId: v.id, tripDate: iso(0), createdByName: "Seed" })),
    ).rejects.toThrow(/retired/);
  });

  it("deletes a vehicle that has no history", async () => {
    const v = await vehicle();
    expect(await inA((tx) => repo.deleteVehicle(tx, v.id))).toBe(true);
  });

  describe("the odometer", () => {
    it("moves forward with a trip's closing reading, and the distance is the difference", async () => {
      const v = await vehicle({ mileageKm: 10_000 });
      const trip = await inA((tx) =>
        repo.createTrip(tx, {
          companyId: companyA, vehicleId: v.id, tripDate: iso(0),
          odometerStart: 10_000, odometerEnd: 10_245, distanceKm: 999, createdByName: "Seed",
        }));
      expect(Number(trip.distanceKm)).toBe(245);
      const after = await inA((tx) => repo.getVehicleById(tx, v.id));
      expect(after.mileageKm).toBe(10_245);
    });

    it("refuses a closing reading below the opening one", async () => {
      const v = await vehicle({ mileageKm: 10_000 });
      await expect(
        inA((tx) => repo.createTrip(tx, {
          companyId: companyA, vehicleId: v.id, tripDate: iso(0),
          odometerStart: 10_200, odometerEnd: 10_100, createdByName: "Seed",
        })),
      ).rejects.toThrow(/below the opening one/);
    });

    it("never goes back on an edit", async () => {
      const v = await vehicle({ mileageKm: 10_000 });
      await expect(
        inA((tx) => repo.updateVehicle(tx, v.id, { mileageKm: 9_000 }, actor)),
      ).rejects.toThrow(/cannot go back/);
      const edited = await inA((tx) => repo.updateVehicle(tx, v.id, { mileageKm: 12_000, driverName: "Otieno" }, actor));
      expect(edited.mileageKm).toBe(12_000);
      expect(edited.driverName).toBe("Otieno");
    });
  });

  describe("service", () => {
    it("is due by km as well as by date", async () => {
      await vehicle({ regNo: "KM1", mileageKm: 50_500, nextServiceKm: 50_000, nextServiceDate: iso(90 * DAY) });
      const stats = await inA((tx) => repo.getFleetStats(tx));
      expect(stats.serviceDue).toBe(1);
    });

    it("clears when the service is completed, and sets the next one", async () => {
      const v = await vehicle({ status: "service_due", mileageKm: 40_000, nextServiceDate: iso(-5 * DAY) });
      expect((await inA((tx) => repo.getFleetStats(tx))).serviceDue).toBe(1);

      const m = await inA((tx) => repo.createMaintenance(tx, {
        companyId: companyA, vehicleId: v.id, serviceDate: iso(0), service: "Full service", createdByName: "Seed",
      }));
      expect(m.status).toBe("scheduled");
      await expect(inA((tx) => repo.setMaintenanceStatus(tx, m.id, "done", actor))).rejects.toThrow(/Complete the service/);

      const done = await inA((tx) => repo.completeMaintenance(tx, m.id, {
        odometerKm: 40_150, nextServiceDate: iso(180 * DAY), nextServiceKm: 50_150,
      }, actor));
      expect(done.status).toBe("done");
      expect(done.completedAt).toBeTruthy();

      const after = await inA((tx) => repo.getVehicleById(tx, v.id));
      expect(after.status).toBe("active");
      expect(after.mileageKm).toBe(40_150);
      expect(after.nextServiceKm).toBe(50_150);
      expect(after.nextServiceDate).toBe(iso(180 * DAY));
      expect((await inA((tx) => repo.getFleetStats(tx))).serviceDue).toBe(0);
    });

    it("refuses a next service at or below this one's reading", async () => {
      const v = await vehicle();
      const m = await inA((tx) => repo.createMaintenance(tx, {
        companyId: companyA, vehicleId: v.id, serviceDate: iso(0), createdByName: "Seed",
      }));
      await expect(
        inA((tx) => repo.completeMaintenance(tx, m.id, { odometerKm: 5_000, nextServiceKm: 4_000 }, actor)),
      ).rejects.toThrow(/higher reading/);
    });
  });

  describe("costs into Expenses", () => {
    let fuelAccount;

    beforeEach(async () => {
      fuelAccount = randomUUID();
      await inA(async (tx) => {
        await tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type, can_post)
          VALUES (${fuelAccount}, ${companyA}, '6500', 'Transport & Fuel', 'expense', true),
                 (${randomUUID()}, ${companyA}, '2170', 'Accrued Expenses', 'liability', true)`);
        await tx.execute(sql`
          UPDATE accounts SET system_account = 'accrued_expenses' WHERE account_code = '2170'`);
      });
    });

    const fuelTrip = (v) =>
      inA((tx) => repo.createTrip(tx, {
        companyId: companyA, vehicleId: v.id, tripDate: iso(0), purpose: "Site visit",
        fuelLitres: 40, fuelCost: 7_200, fuelStation: "Rubis Westlands",
        expenseAccountId: fuelAccount, createdByName: "Seed",
      }));

    it("raises a draft expense that is not yet in the books", async () => {
      const v = await vehicle();
      const trip = await fuelTrip(v);
      expect(trip.expenseId).toBeTruthy();
      const exp = await inA((tx) => expensesRepo.getExpense(tx, trip.expenseId));
      expect(exp.status).toBe("draft");
      expect(exp.journalEntryId).toBeNull();
      expect(Number(exp.amount)).toBe(7_200);
      expect(exp.payeeNameAtExpense).toBe("Rubis Westlands");
      expect(exp.category).toBe("transport");

      const stats = await inA((tx) => repo.getFleetStats(tx));
      expect(stats.draftsAwaitingFinance).toBe(1);
      expect(stats.fuelThisMonth).toBe(7_200);
    });

    it("posts like any expense once finance posts it", async () => {
      const v = await vehicle();
      const trip = await fuelTrip(v);
      const { expense, entry } = await inA((tx) => expensesRepo.postExpense(tx, trip.expenseId, null));
      expect(expense.status).toBe("posted");
      const [sums] = await inA((tx) => tx.execute(sql`
        SELECT SUM(debit)::numeric AS dr, SUM(credit)::numeric AS cr
          FROM journal_lines WHERE entry_id = ${entry.id}::uuid`));
      expect(Number(sums.dr)).toBe(7_200);
      expect(Number(sums.cr)).toBe(7_200);
      await expect(inA((tx) => expensesRepo.postExpense(tx, trip.expenseId, null))).rejects.toThrow(/already posted/);
    });

    it("takes its draft with it when the trip is deleted, and refuses once it is posted", async () => {
      const v = await vehicle();
      const draftTrip = await fuelTrip(v);
      await inA((tx) => repo.deleteTrip(tx, draftTrip.id));
      expect(await inA((tx) => expensesRepo.getExpense(tx, draftTrip.expenseId))).toBeFalsy();

      const postedTrip = await fuelTrip(v);
      await inA((tx) => expensesRepo.postExpense(tx, postedTrip.expenseId, null));
      await expect(inA((tx) => repo.deleteTrip(tx, postedTrip.id))).rejects.toThrow(/Void that expense first/);
    });

    it("tags the expense to the vehicle's fixed asset", async () => {
      const assetId = randomUUID();
      await inA((tx) => tx.execute(sql`
        INSERT INTO assets (id, company_id, asset_number, name, category, acquisition_date,
                            acquisition_cost, depreciation_start_date)
        VALUES (${assetId}, ${companyA}, 'AST-00003', 'Toyota Hilux', 'vehicle', '2025-01-10',
                4500000, '2025-01-10')`));
      const v = await vehicle({ assetId });
      const trip = await fuelTrip(v);
      const exp = await inA((tx) => expensesRepo.getExpense(tx, trip.expenseId));
      expect(exp.assetId).toBe(assetId);
      expect(exp.assetNumberAtExpense).toBe("AST-00003");
    });

    it("reports cost per km per vehicle", async () => {
      const v = await vehicle({ mileageKm: 1_000 });
      await inA((tx) => repo.createTrip(tx, {
        companyId: companyA, vehicleId: v.id, tripDate: iso(0),
        odometerStart: 1_000, odometerEnd: 1_400, fuelCost: 6_000, createdByName: "Seed",
      }));
      await inA((tx) => repo.createMaintenance(tx, {
        companyId: companyA, vehicleId: v.id, serviceDate: iso(0), cost: 2_000, createdByName: "Seed",
      }));
      const [row] = await inA((tx) => repo.listVehicles(tx));
      expect(row.totalDistanceKm).toBe(400);
      expect(row.totalCost).toBe(8_000);
      expect(row.costPerKm).toBe(20);
    });
  });

  it("isolates tenants", async () => {
    await vehicle();
    expect(await inB((tx) => repo.listVehicles(tx))).toHaveLength(0);
  });
});
