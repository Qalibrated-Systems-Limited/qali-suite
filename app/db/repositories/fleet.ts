import { eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { fleetVehicles, fleetTrips, fleetMaintenance } from "../schema";
import { isUuid } from "./sqlHelpers";
import { createExpenseDraft, deleteDraftExpense } from "./expenses";

/**
 * Fleet repository. `tx` is already RLS-scoped to the company; no companyId
 * filtering, no session/role logic (that is fleet-actions.ts).
 *
 * THE VEHICLE IS KEPT CURRENT BY WHAT HAPPENS TO IT. A trip's closing
 * odometer moves the vehicle's mileage forward; completing a service moves it
 * too, and sets the next service by date and/or km. "Service due" and
 * "insurance expiring" are derived from those facts in the stats query, so an
 * alert clears when the thing it was about is done.
 *
 * HISTORY OUTLIVES THE VEHICLE. A vehicle with trips or services is retired,
 * not deleted; the foreign keys refuse the delete as well.
 *
 * COSTS GO TO EXPENSES AS DRAFTS. A trip's fuel or a service's cost can raise
 * a draft expense, tagged to the vehicle's fixed asset when it has one. Fleet
 * records what happened; finance posts it from Expenses, and until then
 * nothing is in the books.
 */

type Actor = { id?: string | null; name?: string | null };

const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(4) : "0.0000";
};
const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// ── Vehicles ──────────────────────────────────────────────────────────────────

/** Every vehicle, with what it has cost and how far it has gone. */
export async function listVehicles(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT v.*,
           a.asset_number,
           COALESCE(t.distance, 0)  AS total_distance_km,
           COALESCE(t.fuel, 0)      AS total_fuel_cost,
           COALESCE(t.litres, 0)    AS total_fuel_litres,
           COALESCE(m.cost, 0)      AS total_maintenance_cost,
           COALESCE(t.trips, 0)     AS trip_count,
           COALESCE(m.services, 0)  AS service_count
      FROM fleet_vehicles v
      LEFT JOIN assets a ON a.id = v.asset_id
      LEFT JOIN LATERAL (
        SELECT SUM(distance_km) AS distance, SUM(fuel_cost) AS fuel,
               SUM(fuel_litres) AS litres, COUNT(*) AS trips
          FROM fleet_trips WHERE vehicle_id = v.id
      ) t ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(cost) AS cost, COUNT(*) AS services
          FROM fleet_maintenance WHERE vehicle_id = v.id
      ) m ON TRUE
     ORDER BY v.status = 'retired', v.reg_no
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const distance = Number(r.total_distance_km);
    const cost = Number(r.total_fuel_cost) + Number(r.total_maintenance_cost);
    return {
      id: String(r.id),
      regNo: String(r.reg_no),
      make: String(r.make ?? ""),
      model: String(r.model ?? ""),
      vehicleClass: String(r.vehicle_class ?? ""),
      driverUserId: (r.driver_user_id as string) ?? null,
      driverName: String(r.driver_name ?? ""),
      insuranceExpiry: (r.insurance_expiry as string) ?? null,
      nextServiceDate: (r.next_service_date as string) ?? null,
      nextServiceKm: r.next_service_km != null ? Number(r.next_service_km) : null,
      mileageKm: Number(r.mileage_km ?? 0),
      status: String(r.status),
      notes: String(r.notes ?? ""),
      assetId: (r.asset_id as string) ?? null,
      assetNumber: (r.asset_number as string) ?? null,
      totalDistanceKm: distance,
      totalFuelCost: Number(r.total_fuel_cost),
      totalFuelLitres: Number(r.total_fuel_litres),
      totalMaintenanceCost: Number(r.total_maintenance_cost),
      totalCost: cost,
      costPerKm: distance > 0 ? cost / distance : null,
      tripCount: Number(r.trip_count),
      serviceCount: Number(r.service_count),
    };
  });
}

export async function getVehicleById(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await tx.select().from(fleetVehicles).where(eq(fleetVehicles.id, id));
  return row ?? null;
}

export interface VehicleInput {
  regNo?: string;
  make?: string | null;
  model?: string | null;
  vehicleClass?: string | null;
  driverUserId?: string | null;
  driverName?: string | null;
  insuranceExpiry?: string | null;
  nextServiceDate?: string | null;
  nextServiceKm?: number | null;
  mileageKm?: number;
  status?: string;
  notes?: string | null;
  assetId?: string | null;
}

export async function createVehicle(
  tx: Tx,
  input: VehicleInput & {
    companyId: string;
    regNo: string;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const [row] = await tx
    .insert(fleetVehicles)
    .values({
      companyId: input.companyId,
      regNo: input.regNo.trim().toUpperCase(),
      make: trimmed(input.make),
      model: trimmed(input.model),
      vehicleClass: trimmed(input.vehicleClass),
      driverUserId: input.driverUserId || null,
      driverName: trimmed(input.driverName),
      insuranceExpiry: input.insuranceExpiry || null,
      nextServiceDate: input.nextServiceDate || null,
      nextServiceKm: input.nextServiceKm ?? null,
      mileageKm: input.mileageKm ?? 0,
      status: input.status ?? "active",
      notes: trimmed(input.notes),
      assetId: input.assetId || null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedById: input.createdById ?? null,
      lastModifiedByName: input.createdByName,
    })
    .returning();
  return row;
}

/**
 * Edits a vehicle. The odometer only moves forward: a lower reading is a typo
 * or a clocked vehicle, and either way it would make every later trip's
 * distance wrong.
 */
export async function updateVehicle(tx: Tx, id: string, patch: VehicleInput, actor: Actor) {
  const before = await getVehicleById(tx, id);
  if (!before) return null;

  if (patch.mileageKm != null && patch.mileageKm < before.mileageKm) {
    throw new Error(
      `The odometer cannot go back: ${before.regNo} already reads ${before.mileageKm.toLocaleString()} km.`,
    );
  }

  const set: Record<string, unknown> = {
    lastModifiedById: actor?.id ?? null,
    lastModifiedByName: actor?.name || "System",
    updatedAt: new Date(),
  };
  if (patch.regNo !== undefined) {
    if (!trimmed(patch.regNo)) throw new Error("A registration is required");
    set.regNo = trimmed(patch.regNo).toUpperCase();
  }
  for (const k of ["make", "model", "vehicleClass", "driverName", "notes"] as const) {
    if (patch[k] !== undefined) set[k] = trimmed(patch[k]);
  }
  for (const k of ["driverUserId", "insuranceExpiry", "nextServiceDate", "assetId"] as const) {
    if (patch[k] !== undefined) set[k] = patch[k] || null;
  }
  if (patch.nextServiceKm !== undefined) set.nextServiceKm = patch.nextServiceKm ?? null;
  if (patch.mileageKm != null) set.mileageKm = patch.mileageKm;
  if (patch.status !== undefined) set.status = patch.status;

  const [row] = await tx.update(fleetVehicles).set(set).where(eq(fleetVehicles.id, id)).returning();
  return row ?? null;
}

/** Deletes a vehicle with no history. One with history is retired instead. */
export async function deleteVehicle(tx: Tx, id: string) {
  const vehicle = await getVehicleById(tx, id);
  if (!vehicle) return false;
  const [{ n }] = (await tx.execute(sql`
    SELECT (SELECT COUNT(*) FROM fleet_trips WHERE vehicle_id = ${id}::uuid)
         + (SELECT COUNT(*) FROM fleet_maintenance WHERE vehicle_id = ${id}::uuid) AS n
  `)) as unknown as Array<{ n: string }>;
  if (Number(n) > 0) {
    throw new Error(
      `${vehicle.regNo} has ${n} trip and service record(s). Retire it instead, so its history is kept.`,
    );
  }
  await tx.delete(fleetVehicles).where(eq(fleetVehicles.id, id));
  return true;
}

/** The odometer moves forward only — a reading below the current one is ignored here. */
async function advanceOdometer(tx: Tx, vehicleId: string, reading: number | null | undefined) {
  if (reading == null) return;
  await tx.execute(sql`
    UPDATE fleet_vehicles
       SET mileage_km = GREATEST(mileage_km, ${reading}), updated_at = now()
     WHERE id = ${vehicleId}::uuid
  `);
}

// ── Costs into Expenses ───────────────────────────────────────────────────────

/**
 * A draft expense for a fleet cost, tagged to the vehicle's fixed asset when
 * it has one, so the asset's running costs read the same in both places.
 */
async function raiseDraftExpense(
  tx: Tx,
  input: {
    companyId: string;
    vehicle: typeof fleetVehicles.$inferSelect;
    kind: "fuel" | "maintenance";
    date: string;
    amount: number;
    payeeName: string;
    description: string;
    accountId: string;
    createdById?: string | null;
  },
) {
  let asset: { asset_number: string; name: string } | undefined;
  if (input.vehicle.assetId) {
    [asset] = (await tx.execute(sql`
      SELECT asset_number, name FROM assets WHERE id = ${input.vehicle.assetId}::uuid
    `)) as unknown as Array<{ asset_number: string; name: string }>;
  }
  const expense = await createExpenseDraft(tx, {
    companyId: input.companyId,
    expenseDate: input.date,
    category: input.kind === "fuel" ? "transport" : "maintenance",
    accountId: input.accountId,
    amount: money(input.amount),
    payeeName: input.payeeName || (input.kind === "fuel" ? "Fuel station" : "Garage"),
    description: input.description,
    reference: input.vehicle.regNo,
    assetId: asset ? input.vehicle.assetId : null,
    assetNumber: asset?.asset_number ?? null,
    assetName: asset?.name ?? null,
    createdById: input.createdById ?? null,
  });
  return expense;
}

/**
 * When a fleet record goes, its draft expense goes with it. A POSTED one is in
 * the books, and a fleet screen does not get to take it out: void it in
 * Expenses first.
 */
async function releaseExpense(tx: Tx, expenseId: string | null) {
  if (!expenseId) return;
  const [exp] = (await tx.execute(sql`
    SELECT expense_number, status FROM expenses WHERE id = ${expenseId}::uuid
  `)) as unknown as Array<{ expense_number: string; status: string }>;
  if (!exp) return;
  if (exp.status === "draft") {
    await deleteDraftExpense(tx, expenseId);
    return;
  }
  if (exp.status !== "void") {
    throw new Error(
      `Its cost is in the books as ${exp.expense_number}. Void that expense first, then delete this record.`,
    );
  }
}

const expenseSummary = sql`
  (SELECT json_build_object('id', e.id, 'number', e.expense_number, 'status', e.status)
     FROM expenses e WHERE e.id = r.expense_id)`;

// ── Trips ─────────────────────────────────────────────────────────────────────

export async function listTrips(tx: Tx) {
  return (await tx.execute(sql`
    SELECT r.*, ${expenseSummary} AS expense
      FROM fleet_trips r
     ORDER BY r.trip_date DESC, r.created_at DESC
  `)) as unknown as Array<Record<string, unknown>>;
}

export interface TripInput {
  companyId: string;
  vehicleId: string;
  tripDate: string;
  purpose?: string | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  odometerStart?: number | null;
  odometerEnd?: number | null;
  distanceKm?: number | null;
  fuelLitres?: number | null;
  fuelCost?: number | null;
  fuelStation?: string | null;
  driverUserId?: string | null;
  driverName?: string | null;
  /** Raise a draft expense for the fuel, debiting this account. */
  expenseAccountId?: string | null;
  createdById?: string | null;
  createdByName: string;
}

/**
 * Logs a trip. With both odometer readings the distance is their difference —
 * not whatever was typed — and the closing reading moves the vehicle on.
 */
export async function createTrip(tx: Tx, input: TripInput) {
  const vehicle = await getVehicleById(tx, input.vehicleId);
  if (!vehicle) throw new Error("Vehicle not found");
  if (vehicle.status === "retired") throw new Error(`${vehicle.regNo} is retired.`);

  const start = input.odometerStart ?? null;
  const end = input.odometerEnd ?? null;
  if (start != null && end != null && end < start) {
    throw new Error("The closing odometer reading is below the opening one.");
  }
  if (end != null && end < vehicle.mileageKm && start == null) {
    throw new Error(
      `${vehicle.regNo} already reads ${vehicle.mileageKm.toLocaleString()} km; the closing reading cannot be lower.`,
    );
  }
  const distance = start != null && end != null ? end - start : Number(input.distanceKm ?? 0);
  const fuelCost = Number(input.fuelCost ?? 0);

  let expenseId: string | null = null;
  if (fuelCost > 0 && input.expenseAccountId) {
    const expense = await raiseDraftExpense(tx, {
      companyId: input.companyId,
      vehicle,
      kind: "fuel",
      date: input.tripDate,
      amount: fuelCost,
      payeeName: trimmed(input.fuelStation),
      description: `Fuel — ${vehicle.regNo}${trimmed(input.purpose) ? ` (${trimmed(input.purpose)})` : ""}`,
      accountId: input.expenseAccountId,
      createdById: input.createdById,
    });
    expenseId = expense.id;
  }

  const [row] = await tx
    .insert(fleetTrips)
    .values({
      companyId: input.companyId,
      vehicleId: input.vehicleId,
      tripDate: input.tripDate,
      purpose: trimmed(input.purpose),
      fromLocation: trimmed(input.fromLocation),
      toLocation: trimmed(input.toLocation),
      odometerStart: start,
      odometerEnd: end,
      distanceKm: distance.toFixed(1),
      fuelLitres: Number(input.fuelLitres ?? 0).toFixed(2),
      fuelCost: money(fuelCost),
      fuelStation: trimmed(input.fuelStation),
      driverUserId: input.driverUserId || null,
      driverName: trimmed(input.driverName),
      expenseId,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedByName: input.createdByName,
    })
    .returning();

  await advanceOdometer(tx, input.vehicleId, end);
  return row;
}

export async function deleteTrip(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const [trip] = await tx.select().from(fleetTrips).where(eq(fleetTrips.id, id));
  if (!trip) return false;
  await releaseExpense(tx, trip.expenseId);
  await tx.delete(fleetTrips).where(eq(fleetTrips.id, id));
  return true;
}

// ── Maintenance ───────────────────────────────────────────────────────────────

export async function listMaintenance(tx: Tx) {
  return (await tx.execute(sql`
    SELECT r.*, ${expenseSummary} AS expense
      FROM fleet_maintenance r
     ORDER BY r.service_date DESC, r.created_at DESC
  `)) as unknown as Array<Record<string, unknown>>;
}

export interface CompletionInput {
  odometerKm?: number | null;
  nextServiceDate?: string | null;
  nextServiceKm?: number | null;
}

export async function createMaintenance(
  tx: Tx,
  input: CompletionInput & {
    companyId: string;
    vehicleId: string;
    serviceDate: string;
    service?: string | null;
    garage?: string | null;
    cost?: number | null;
    status?: string;
    notes?: string | null;
    expenseAccountId?: string | null;
    createdById?: string | null;
    createdByName: string;
  },
) {
  const vehicle = await getVehicleById(tx, input.vehicleId);
  if (!vehicle) throw new Error("Vehicle not found");

  const cost = Number(input.cost ?? 0);
  let expenseId: string | null = null;
  if (cost > 0 && input.expenseAccountId) {
    const expense = await raiseDraftExpense(tx, {
      companyId: input.companyId,
      vehicle,
      kind: "maintenance",
      date: input.serviceDate,
      amount: cost,
      payeeName: trimmed(input.garage),
      description: `${trimmed(input.service) || "Service"} — ${vehicle.regNo}`,
      accountId: input.expenseAccountId,
      createdById: input.createdById,
    });
    expenseId = expense.id;
  }

  const status = input.status ?? "scheduled";
  const [row] = await tx
    .insert(fleetMaintenance)
    .values({
      companyId: input.companyId,
      vehicleId: input.vehicleId,
      serviceDate: input.serviceDate,
      service: trimmed(input.service),
      garage: trimmed(input.garage),
      cost: money(cost),
      // Recorded as scheduled; completion below sets done and its effects.
      status: status === "done" ? "scheduled" : status,
      notes: trimmed(input.notes),
      expenseId,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName,
      lastModifiedByName: input.createdByName,
    })
    .returning();

  if (status === "done") {
    return completeMaintenance(tx, row.id, input, { id: input.createdById, name: input.createdByName });
  }
  return row;
}

/** Scheduled ⇄ in progress. Completing goes through `completeMaintenance`. */
export async function setMaintenanceStatus(tx: Tx, id: string, status: string, actor: Actor) {
  if (!isUuid(id)) return null;
  if (status === "done") throw new Error("Complete the service to mark it done.");
  const [row] = await tx
    .update(fleetMaintenance)
    .set({
      status,
      completedAt: null,
      lastModifiedById: actor?.id ?? null,
      lastModifiedByName: actor?.name || "System",
      updatedAt: new Date(),
    })
    .where(eq(fleetMaintenance.id, id))
    .returning();
  return row ?? null;
}

/**
 * Marks a service done and carries what it means onto the vehicle: the
 * odometer at the service, the next service by date and/or km, and a vehicle
 * that was flagged service-due back to active. This is what makes the
 * "service due" alert clear.
 */
export async function completeMaintenance(
  tx: Tx,
  id: string,
  input: CompletionInput,
  actor: Actor,
) {
  if (!isUuid(id)) return null;
  const [record] = await tx.select().from(fleetMaintenance).where(eq(fleetMaintenance.id, id));
  if (!record) return null;
  const vehicle = await getVehicleById(tx, record.vehicleId);
  if (!vehicle) throw new Error("Vehicle not found");

  if (input.odometerKm != null && input.odometerKm < 0) throw new Error("Enter a valid odometer reading.");
  if (input.nextServiceKm != null && input.odometerKm != null && input.nextServiceKm <= input.odometerKm) {
    throw new Error("The next service must be at a higher reading than this one.");
  }
  if (input.nextServiceDate && input.nextServiceDate <= record.serviceDate) {
    throw new Error("The next service date must be after this service.");
  }

  const [row] = await tx
    .update(fleetMaintenance)
    .set({
      status: "done",
      completedAt: new Date(),
      odometerKm: input.odometerKm ?? null,
      nextServiceDate: input.nextServiceDate || null,
      nextServiceKm: input.nextServiceKm ?? null,
      lastModifiedById: actor?.id ?? null,
      lastModifiedByName: actor?.name || "System",
      updatedAt: new Date(),
    })
    .where(eq(fleetMaintenance.id, id))
    .returning();

  await advanceOdometer(tx, record.vehicleId, input.odometerKm);
  await tx.execute(sql`
    UPDATE fleet_vehicles
       SET next_service_date = COALESCE(${input.nextServiceDate || null}::date, next_service_date),
           next_service_km   = COALESCE(${input.nextServiceKm ?? null}::int, next_service_km),
           status = CASE WHEN status = 'service_due' THEN 'active' ELSE status END,
           updated_at = now()
     WHERE id = ${record.vehicleId}::uuid
  `);
  return row;
}

export async function deleteMaintenance(tx: Tx, id: string) {
  if (!isUuid(id)) return false;
  const [record] = await tx.select().from(fleetMaintenance).where(eq(fleetMaintenance.id, id));
  if (!record) return false;
  await releaseExpense(tx, record.expenseId);
  await tx.delete(fleetMaintenance).where(eq(fleetMaintenance.id, id));
  return true;
}

// ── For the forms ─────────────────────────────────────────────────────────────

/** Postable expense accounts, with the chart's fuel and repairs accounts picked out. */
export async function listExpenseAccounts(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT id, account_code, account_name FROM accounts
     WHERE account_type = 'expense' AND can_post AND is_active
     ORDER BY account_code
  `)) as unknown as Array<{ id: string; account_code: string; account_name: string }>;
  const accounts = rows.map((r) => ({ id: r.id, code: r.account_code, name: r.account_name }));
  const find = (code: string, pattern: RegExp) =>
    accounts.find((a) => a.code === code)?.id ?? accounts.find((a) => pattern.test(a.name))?.id ?? null;
  return {
    accounts,
    defaultFuelAccountId: find("6500", /fuel/i),
    defaultRepairsAccountId: find("6510", /vehicle repair|repairs/i),
  };
}

/** Fixed assets a fleet vehicle can be linked to. */
export async function listVehicleAssets(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT id, asset_number, name FROM assets
     WHERE category = 'vehicle' AND status NOT IN ('disposed', 'written_off')
     ORDER BY asset_number
  `)) as unknown as Array<{ id: string; asset_number: string; name: string }>;
  return rows.map((r) => ({ id: r.id, assetNumber: r.asset_number, name: r.name }));
}

// ── Stats (derived alerts) ────────────────────────────────────────────────────

export async function getFleetStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE status <> 'retired')::int AS fleet_size,
      count(*) FILTER (WHERE status = 'active')::int AS active,
      count(*) FILTER (
        WHERE status <> 'retired'
          AND (status = 'service_due'
               OR (next_service_date IS NOT NULL AND next_service_date <= CURRENT_DATE)
               OR (next_service_km IS NOT NULL AND mileage_km >= next_service_km))
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
  const [costs] = (await tx.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(fuel_cost), 0) FROM fleet_trips
        WHERE trip_date >= date_trunc('month', CURRENT_DATE)) AS fuel_this_month,
      (SELECT COALESCE(SUM(cost), 0) FROM fleet_maintenance
        WHERE service_date >= date_trunc('month', CURRENT_DATE)) AS maintenance_this_month,
      (SELECT COUNT(*) FROM expenses e
        WHERE e.status = 'draft'
          AND (e.id IN (SELECT expense_id FROM fleet_trips WHERE expense_id IS NOT NULL)
            OR e.id IN (SELECT expense_id FROM fleet_maintenance WHERE expense_id IS NOT NULL))
      )::int AS drafts_awaiting_finance
  `)) as unknown as Array<Record<string, string | number>>;

  return {
    fleetSize: row?.fleet_size ?? 0,
    active: row?.active ?? 0,
    serviceDue: row?.service_due ?? 0,
    insuranceExpiring: row?.insurance_expiring ?? 0,
    grounded: row?.grounded ?? 0,
    fuelThisMonth: Number(costs?.fuel_this_month ?? 0),
    maintenanceThisMonth: Number(costs?.maintenance_this_month ?? 0),
    draftsAwaitingFinance: Number(costs?.drafts_awaiting_finance ?? 0),
  };
}
