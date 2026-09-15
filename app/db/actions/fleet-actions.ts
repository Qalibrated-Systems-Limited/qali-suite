"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { FLEET_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/fleet";
import * as usersRepo from "../repositories/users";

/**
 * Fleet actions — 0110. Zod validates, `withAuthorizedTenant` scopes and gates,
 * the repository does the SQL. Reads open to any member; writes need
 * FLEET_WRITE_ROLES. Every mutation returns {success,message} or {error}.
 */

const WRITE = FLEET_WRITE_ROLES as unknown as string[];

function actorFrom(user: { id?: string | null; name?: string | null }) {
  return { id: user?.id ?? null, name: user?.name || "Unknown User" };
}
function s(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v : "";
}
function serialize<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = { ...row, _id: String(row.id) };
  for (const k of Object.keys(out)) {
    if (out[k] instanceof Date) out[k] = (out[k] as Date).toISOString();
  }
  return out;
}
function bump() {
  revalidatePath("/dashboard/fleet");
}

// ── reads ────────────────────────────────────────────────────────────────────
export async function getFleetData() {
  return withAuthorizedTenant([], async (tx) => {
    const [vehicles, trips, maintenance, stats, users] = await Promise.all([
      repo.listVehicles(tx),
      repo.listTrips(tx),
      repo.listMaintenance(tx),
      repo.getFleetStats(tx),
      usersRepo.listCompanyUsers(tx),
    ]);
    return {
      vehicles: vehicles.map(serialize),
      trips: trips.map(serialize),
      maintenance: maintenance.map(serialize),
      stats,
      users: users
        .filter((u) => u.status !== "Inactive" && u.status !== "inactive")
        .map((u) => ({ id: u.id, name: u.name })),
    };
  });
}

// ── vehicle ─────────────────────────────────────────────────────────────────
const vehicleSchema = z.object({
  regNo: z.string().trim().min(1, "A registration is required").max(20),
  make: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
  vehicleClass: z.string().trim().max(40).optional(),
  driverUserId: z.string().trim().optional(),
  driverName: z.string().trim().max(120).optional(),
  insuranceExpiry: z.string().trim().optional(),
  nextServiceDate: z.string().trim().optional(),
  mileageKm: z.coerce.number().int().min(0).optional(),
  status: z.enum(["active", "service_due", "grounded", "retired"]).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function createVehicle(prevState: unknown, formData: FormData) {
  const parsed = vehicleSchema.safeParse({
    regNo: s(formData.get("regNo")),
    make: s(formData.get("make")),
    model: s(formData.get("model")),
    vehicleClass: s(formData.get("vehicleClass")),
    driverUserId: s(formData.get("driverUserId")),
    driverName: s(formData.get("driverName")),
    insuranceExpiry: s(formData.get("insuranceExpiry")),
    nextServiceDate: s(formData.get("nextServiceDate")),
    mileageKm: s(formData.get("mileageKm")) || 0,
    status: s(formData.get("status")) || undefined,
  });
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

export async function updateVehicle(id: string, patch: Record<string, unknown>) {
  try {
    const row = await withAuthorizedTenant(WRITE, (tx, { user }) =>
      repo.updateVehicle(tx, id, patch, actorFrom(user)),
    );
    if (!row) return { error: "Vehicle not found." };
    bump();
    return { success: true, message: `${row.regNo} updated` };
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
  distanceKm: z.coerce.number().min(0).optional(),
  fuelCost: z.coerce.number().min(0).optional(),
  driverName: z.string().trim().max(120).optional(),
});

export async function logTrip(prevState: unknown, formData: FormData) {
  const parsed = tripSchema.safeParse({
    vehicleId: s(formData.get("vehicleId")),
    tripDate: s(formData.get("tripDate")),
    purpose: s(formData.get("purpose")),
    fromLocation: s(formData.get("fromLocation")),
    toLocation: s(formData.get("toLocation")),
    distanceKm: s(formData.get("distanceKm")) || 0,
    fuelCost: s(formData.get("fuelCost")) || 0,
    driverName: s(formData.get("driverName")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createTrip(tx, {
        companyId,
        ...parsed.data,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: "Trip logged" };
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
const maintSchema = z.object({
  vehicleId: z.string().trim().min(1, "Choose a vehicle"),
  serviceDate: z.string().trim().min(1, "A date is required"),
  service: z.string().trim().max(200).optional(),
  garage: z.string().trim().max(120).optional(),
  cost: z.coerce.number().min(0).optional(),
  status: z.enum(["scheduled", "in_progress", "done"]).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function logMaintenance(prevState: unknown, formData: FormData) {
  const parsed = maintSchema.safeParse({
    vehicleId: s(formData.get("vehicleId")),
    serviceDate: s(formData.get("serviceDate")),
    service: s(formData.get("service")),
    garage: s(formData.get("garage")),
    cost: s(formData.get("cost")) || 0,
    status: s(formData.get("status")) || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form" };
  try {
    await withAuthorizedTenant(WRITE, (tx, { user, companyId }) =>
      repo.createMaintenance(tx, {
        companyId,
        ...parsed.data,
        createdById: actorFrom(user).id,
        createdByName: actorFrom(user).name,
      }),
    );
    bump();
    return { success: true, message: "Maintenance recorded" };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function setMaintenanceStatus(id: string, status: string) {
  if (!["scheduled", "in_progress", "done"].includes(status)) return { error: "Unknown status." };
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
