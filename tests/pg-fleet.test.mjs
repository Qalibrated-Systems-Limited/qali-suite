/**
 * Fleet repository against a real PostgreSQL — 0110.
 *
 * Pins: a vehicle's reg is unique per company; trips and maintenance cascade
 * from their vehicle; "service due" and "insurance expiring" are derived from
 * the dates; tenants are isolated.
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

  it("cascades trips and maintenance from the vehicle", async () => {
    const v = await vehicle();
    await inA((tx) => repo.createTrip(tx, { companyId: companyA, vehicleId: v.id, tripDate: iso(0), distanceKm: 45, fuelCost: 1200, createdByName: "Seed" }));
    await inA((tx) => repo.createMaintenance(tx, { companyId: companyA, vehicleId: v.id, serviceDate: iso(0), service: "Service", cost: 28500, createdByName: "Seed" }));
    expect(await inA((tx) => repo.listTrips(tx))).toHaveLength(1);
    expect(await inA((tx) => repo.listMaintenance(tx))).toHaveLength(1);

    await inA((tx) => repo.deleteVehicle(tx, v.id));
    expect(await inA((tx) => repo.listTrips(tx))).toHaveLength(0);
    expect(await inA((tx) => repo.listMaintenance(tx))).toHaveLength(0);
  });

  it("moves a maintenance record through its statuses", async () => {
    const v = await vehicle();
    const m = await inA((tx) => repo.createMaintenance(tx, { companyId: companyA, vehicleId: v.id, serviceDate: iso(0), createdByName: "Seed" }));
    expect(m.status).toBe("scheduled");
    const done = await inA((tx) => repo.setMaintenanceStatus(tx, m.id, "done", actor));
    expect(done.status).toBe("done");
  });

  it("isolates tenants", async () => {
    await vehicle();
    expect(await inB((tx) => repo.listVehicles(tx))).toHaveLength(0);
  });
});
