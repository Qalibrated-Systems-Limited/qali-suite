import { asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { fleetVehicles, fleetTrips, fleetMaintenance } from "../schema";
import { isUuid } from "./sqlHelpers";

/**
 * Fleet repository — 0110. `tx` is already RLS-scoped to the company; no
 * companyId filtering, no session/role logic (that is fleet-actions.ts).
 * "Service due" and "insurance expiring" are derived from the dates in the
 * stats query, never stored.
 */

type Actor = { id?: string | null; name?: string | null };

// ── Vehicles ──────────────────────────────────────────────────────────────────
export function listVehicles(tx: Tx) {
  return tx.select().from(fleetVehicles).orderBy(asc(fleetVehicles.regNo));
}

export async function getVehicleById(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(fleetVehicles).where(eq(fleetVehicles.id, id));
  return row ?? null;
}

export async function createVehicle(
  tx: Tx,
  input: {
    companyId: string;
    regNo: string;
    make?: string | null;
    model?: string | null;
    vehicleClass?: string | null;
    driverUserId?: string | null;
    driverName?: string | null;
    insuranceExpiry?: string | null;
    nextServiceDate?: string | null;
    mileageKm?: number;
    status?: string;
    notes?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const [row] = await tx
    .insert(fleetVehicles)
    .values({
      companyId: input.companyId,
      regNo: input.regNo.trim().toUpperCase(),
      make: input.make?.trim() ?? "",
      model: input.model?.trim() ?? "",
      vehicleClass: input.vehicleClass?.trim() ?? "",
      driverUserId: input.driverUserId || null,
      driverName: input.driverName?.trim() ?? "",
      insuranceExpiry: input.insuranceExpiry || null,
      nextServiceDate: input.nextServiceDate || null,
      mileageKm: input.mileageKm ?? 0,
      status: input.status ?? "active",
      notes: input.notes?.trim() ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedById: input.createdById ?? null,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function updateVehicle(
  tx: Tx,
  id: string,
  patch: Record<string, unknown>,
  actor: Actor,
) {
  if (!isUuid(id)) return null;
  const set: Record<string, unknown> = {
    lastModifiedById: actor?.id ?? null,
    lastModifiedByName: actor?.name || "System",
    updatedAt: new Date(),
  };
  for (const k of [
    "make",
    "model",
    "vehicleClass",
    "driverUserId",
    "driverName",
    "insuranceExpiry",
    "nextServiceDate",
    "mileageKm",
    "status",
    "notes",
  ]) {
    if (patch[k] !== undefined) set[k] = patch[k] === "" ? null : patch[k];
  }
  // Keep the not-null text columns non-null even when cleared.
  for (const k of ["make", "model", "vehicleClass", "driverName", "notes"]) {
    if (set[k] === null) set[k] = "";
  }
  if (set.mileageKm === null) set.mileageKm = 0;
  const [row] = await tx.update(fleetVehicles).set(set).where(eq(fleetVehicles.id, id)).returning();
  return row ?? null;
}

export async function deleteVehicle(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(fleetVehicles).where(eq(fleetVehicles.id, id)).returning({ id: fleetVehicles.id });
  return rows.length > 0;
}

// ── Trips ─────────────────────────────────────────────────────────────────────
export function listTrips(tx: Tx) {
  return tx.select().from(fleetTrips).orderBy(desc(fleetTrips.tripDate));
}

export async function createTrip(
  tx: Tx,
  input: {
    companyId: string;
    vehicleId: string;
    tripDate: string;
    purpose?: string | null;
    fromLocation?: string | null;
    toLocation?: string | null;
    distanceKm?: number;
    fuelCost?: number;
    driverName?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const [row] = await tx
    .insert(fleetTrips)
    .values({
      companyId: input.companyId,
      vehicleId: input.vehicleId,
      tripDate: input.tripDate,
      purpose: input.purpose?.trim() ?? "",
      fromLocation: input.fromLocation?.trim() ?? "",
      toLocation: input.toLocation?.trim() ?? "",
      distanceKm: input.distanceKm ?? 0,
      fuelCost: input.fuelCost ?? 0,
      driverName: input.driverName?.trim() ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function deleteTrip(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(fleetTrips).where(eq(fleetTrips.id, id)).returning({ id: fleetTrips.id });
  return rows.length > 0;
}

// ── Maintenance ───────────────────────────────────────────────────────────────
export function listMaintenance(tx: Tx) {
  return tx.select().from(fleetMaintenance).orderBy(desc(fleetMaintenance.serviceDate));
}

export async function createMaintenance(
  tx: Tx,
  input: {
    companyId: string;
    vehicleId: string;
    serviceDate: string;
    service?: string | null;
    garage?: string | null;
    cost?: number;
    status?: string;
    notes?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const [row] = await tx
    .insert(fleetMaintenance)
    .values({
      companyId: input.companyId,
      vehicleId: input.vehicleId,
      serviceDate: input.serviceDate,
      service: input.service?.trim() ?? "",
      garage: input.garage?.trim() ?? "",
      cost: input.cost ?? 0,
      status: input.status ?? "scheduled",
      notes: input.notes?.trim() ?? "",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

export async function setMaintenanceStatus(tx: Tx, id: string, status: string, actor: Actor) {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .update(fleetMaintenance)
    .set({
      status,
      lastModifiedById: actor?.id ?? null,
      lastModifiedByName: actor?.name || "System",
      updatedAt: new Date(),
    })
    .where(eq(fleetMaintenance.id, id))
    .returning();
  return row ?? null;
}

export async function deleteMaintenance(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const rows = await tx.delete(fleetMaintenance).where(eq(fleetMaintenance.id, id)).returning({ id: fleetMaintenance.id });
  return rows.length > 0;
}

// ── Stats (derived alerts) ──────────────────────────────────────────────────────
export async function getFleetStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*)::int AS fleet_size,
      count(*) FILTER (WHERE status = 'active')::int AS active,
      count(*) FILTER (
        WHERE status <> 'retired'
          AND (status = 'service_due'
               OR (next_service_date IS NOT NULL AND next_service_date <= CURRENT_DATE))
      )::int AS service_due,
      count(*) FILTER (
        WHERE status <> 'retired'
          AND insurance_expiry IS NOT NULL
          AND insurance_expiry <= CURRENT_DATE + interval '30 days'
      )::int AS insurance_expiring,
      count(*) FILTER (WHERE status = 'grounded')::int AS grounded
    FROM fleet_vehicles
  `)) as unknown as Array<{
    fleet_size: number;
    active: number;
    service_due: number;
    insurance_expiring: number;
    grounded: number;
  }>;
  return {
    fleetSize: row?.fleet_size ?? 0,
    active: row?.active ?? 0,
    serviceDue: row?.service_due ?? 0,
    insuranceExpiring: row?.insurance_expiring ?? 0,
    grounded: row?.grounded ?? 0,
  };
}
