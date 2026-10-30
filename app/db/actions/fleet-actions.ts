"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { FLEET_WRITE_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import * as repo from "../repositories/fleet";
import * as usersRepo from "../repositories/users";

/**
 * Fleet actions. Zod validates, `withAuthorizedTenant` scopes and gates, the
 * repository does the SQL. Reads open to any member; writes need
 * FLEET_WRITE_ROLES. Every mutation returns {success,message} or {error}.
 *
 * A cost recorded here becomes a DRAFT expense — nothing reaches the books
 * until finance posts it from Expenses — so a fleet writer needs no finance
 * role to record what a trip or a service cost.
 */

const WRITE = FLEET_WRITE_ROLES as unknown as string[];

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return { id: user?.id ?? null, name: user?.name || "Unknown User" };
}
function s(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v : "";
}
/** An optional number: blank is "not given", not zero. */
const optNum = (v: FormDataEntryValue | null) => {
  const t = s(v).trim();
  return t === "" ? undefined : t;
};
/** Raw SQL rows come back snake_case; the board reads camelCase. */
function camel(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v instanceof Date ? v.toISOString() : v;
  }
  out._id = String(row.id);
  return out;
}
function bump() {
  revalidatePath("/dashboard/fleet");
  revalidatePath("/dashboard/expenses");
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function getFleetData() {
  return withAuthorizedTenant([], async (tx, { user }) => {
    const [vehicles, trips, maintenance, stats, users, expenseAccounts, assets] =
      await Promise.all([
        repo.listVehicles(tx),
        repo.listTrips(tx),
        repo.listMaintenance(tx),
        repo.getFleetStats(tx),
        usersRepo.listCompanyUsers(tx),
        repo.listExpenseAccounts(tx),
        repo.listVehicleAssets(tx),
      ]);
    return {
      vehicles: vehicles.map((v) => ({ ...v, _id: v.id })),
      trips: trips.map(camel),
      maintenance: maintenance.map(camel),
      stats,
      users: users
        .filter((u) => u.status !== "Inactive" && u.status !== "inactive")
        .map((u) => ({ id: u.id, name: u.name })),
      expenseAccounts,
      assets,
      canManage: roleAllowed(user.role, WRITE),
    };
  });
}

// ── vehicle ─────────────────────────────────────────────────────────────────

const STATUSES = ["active", "service_due", "grounded", "retired"] as const;

const vehicleSchema = z.object({
  regNo: z.string().trim().min(1, "A registration is required").max(20),
  make: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
  vehicleClass: z.string().trim().max(40).optional(),
  driverUserId: z.string().trim().optional(),
  driverName: z.string().trim().max(120).optional(),
  insuranceExpiry: z.string().trim().optional(),
  nextServiceDate: z.string().trim().optional(),
  nextServiceKm: z.coerce.number().int().min(0).optional(),
  mileageKm: z.coerce.number().int().min(0, "Mileage cannot be negative").optional(),
  status: z.enum(STATUSES).optional(),
  assetId: z.string().trim().optional(),
  notes: z.string().trim().max(1000).optional(),
});

function vehicleFields(formData: FormData) {
  return {
    regNo: s(formData.get("regNo")),
    make: s(formData.get("make")),
    model: s(formData.get("model")),
    vehicleClass: s(formData.get("vehicleClass")),
    driverUserId: s(formData.get("driverUserId")),
    driverName: s(formData.get("driverName")),
    insuranceExpiry: s(formData.get("insuranceExpiry")),
    nextServiceDate: s(formData.get("nextServiceDate")),
    nextServiceKm: optNum(formData.get("nextServiceKm")),
    mileageKm: optNum(formData.get("mileageKm")),
    status: s(formData.get("status")) || undefined,
    assetId: s(formData.get("assetId")),
    notes: s(formData.get("notes")),
  };
}

export async function createVehicle(_prevState: unknown, formData: FormData) {
  const parsed = vehicleSchema.safeParse(vehicleFields(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createVehicle(tx, {
        companyId,
        ...d,
        driverUserId: d.driverUserId || null,
        insuranceExpiry: d.insuranceExpiry || null,
        nextServiceDate: d.nextServiceDate || null,
        nextServiceKm: d.nextServiceKm ?? null,
        assetId: d.assetId || null,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: `${row.regNo} added` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function updateVehicle(id: string, formData: FormData) {
  const parsed = vehicleSchema.safeParse(vehicleFields(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.updateVehicle(
        tx,
        id,
        {
          ...d,
          driverUserId: d.driverUserId || null,
          insuranceExpiry: d.insuranceExpiry || null,
          nextServiceDate: d.nextServiceDate || null,
          nextServiceKm: d.nextServiceKm ?? null,
          assetId: d.assetId || null,
        },
        actorFrom(user),
      ),
    );
    if (!row) return { error: "Vehicle not found." };
    bump();
    return { success: true, message: `${row.regNo} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function setVehicleStatus(id: string, status: string) {
  if (!(STATUSES as readonly string[]).includes(status)) return { error: "Unknown status." };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.updateVehicle(tx, id, { status }, actorFrom(user)),
    );
    if (!row) return { error: "Vehicle not found." };
    bump();
    return { success: true, message: status === "retired" ? `${row.regNo} retired` : `${row.regNo} updated` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteVehicle(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteVehicle(tx, id));
    if (!ok) return { error: "Vehicle not found." };
    bump();
    return { success: true, message: "Vehicle removed" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── trip ──────────────────────────────────────────────────────────────────────

const tripSchema = z.object({
  vehicleId: z.string().trim().min(1, "Choose a vehicle"),
  tripDate: z.string().trim().min(1, "A date is required"),
  purpose: z.string().trim().max(200).optional(),
  fromLocation: z.string().trim().max(120).optional(),
  toLocation: z.string().trim().max(120).optional(),
  odometerStart: z.coerce.number().int().min(0).optional(),
  odometerEnd: z.coerce.number().int().min(0).optional(),
  distanceKm: z.coerce.number().min(0).optional(),
  fuelLitres: z.coerce.number().min(0).optional(),
  fuelCost: z.coerce.number().min(0).optional(),
  fuelStation: z.string().trim().max(120).optional(),
  driverUserId: z.string().trim().optional(),
  driverName: z.string().trim().max(120).optional(),
  expenseAccountId: z.string().trim().optional(),
});

export async function logTrip(_prevState: unknown, formData: FormData) {
  const parsed = tripSchema.safeParse({
    vehicleId: s(formData.get("vehicleId")),
    tripDate: s(formData.get("tripDate")),
    purpose: s(formData.get("purpose")),
    fromLocation: s(formData.get("fromLocation")),
    toLocation: s(formData.get("toLocation")),
    odometerStart: optNum(formData.get("odometerStart")),
    odometerEnd: optNum(formData.get("odometerEnd")),
    distanceKm: optNum(formData.get("distanceKm")),
    fuelLitres: optNum(formData.get("fuelLitres")),
    fuelCost: optNum(formData.get("fuelCost")),
    fuelStation: s(formData.get("fuelStation")),
    driverUserId: s(formData.get("driverUserId")),
    driverName: s(formData.get("driverName")),
    expenseAccountId: s(formData.get("expenseAccountId")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;
  try {
    const trip = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createTrip(tx, {
        companyId,
        ...d,
        driverUserId: d.driverUserId || null,
        expenseAccountId: d.expenseAccountId || null,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return {
      success: true,
      message: trip.expenseId ? "Trip logged. The fuel is a draft expense for finance to post." : "Trip logged",
    };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteTrip(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteTrip(tx, id));
    if (!ok) return { error: "Trip not found." };
    bump();
    return { success: true, message: "Trip deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ── maintenance ─────────────────────────────────────────────────────────────

const completionSchema = z.object({
  odometerKm: z.coerce.number().int().min(0).optional(),
  nextServiceDate: z.string().trim().optional(),
  nextServiceKm: z.coerce.number().int().min(0).optional(),
});

const maintSchema = completionSchema.extend({
  vehicleId: z.string().trim().min(1, "Choose a vehicle"),
  serviceDate: z.string().trim().min(1, "A date is required"),
  service: z.string().trim().max(200).optional(),
  garage: z.string().trim().max(120).optional(),
  cost: z.coerce.number().min(0).optional(),
  status: z.enum(["scheduled", "in_progress", "done"]).optional(),
  notes: z.string().trim().max(1000).optional(),
  expenseAccountId: z.string().trim().optional(),
});

function completionFields(formData: FormData) {
  return {
    odometerKm: optNum(formData.get("odometerKm")),
    nextServiceDate: s(formData.get("nextServiceDate")),
    nextServiceKm: optNum(formData.get("nextServiceKm")),
  };
}

export async function logMaintenance(_prevState: unknown, formData: FormData) {
  const parsed = maintSchema.safeParse({
    vehicleId: s(formData.get("vehicleId")),
    serviceDate: s(formData.get("serviceDate")),
    service: s(formData.get("service")),
    garage: s(formData.get("garage")),
    cost: optNum(formData.get("cost")),
    status: s(formData.get("status")) || undefined,
    notes: s(formData.get("notes")),
    expenseAccountId: s(formData.get("expenseAccountId")),
    ...completionFields(formData),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createMaintenance(tx, {
        companyId,
        ...d,
        nextServiceDate: d.nextServiceDate || null,
        expenseAccountId: d.expenseAccountId || null,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return {
      success: true,
      message: row?.expenseId
        ? "Maintenance recorded. The cost is a draft expense for finance to post."
        : "Maintenance recorded",
    };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function setMaintenanceStatus(id: string, status: string) {
  if (!["scheduled", "in_progress"].includes(status)) return { error: "Unknown status." };
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.setMaintenanceStatus(tx, id, status, actorFrom(user)),
    );
    if (!row) return { error: "Record not found." };
    bump();
    return { success: true, message: "Updated" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function completeMaintenance(id: string, formData: FormData) {
  const parsed = completionSchema.safeParse(completionFields(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  const d = parsed.data;
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.completeMaintenance(tx, id, { ...d, nextServiceDate: d.nextServiceDate || null }, actorFrom(user)),
    );
    if (!row) return { error: "Record not found." };
    bump();
    return { success: true, message: "Service completed and the vehicle updated" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteMaintenance(id: string) {
  try {
    const ok = await withAuthorizedTenant(WRITE, (tx) => repo.deleteMaintenance(tx, id));
    if (!ok) return { error: "Record not found." };
    bump();
    return { success: true, message: "Record deleted" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}
