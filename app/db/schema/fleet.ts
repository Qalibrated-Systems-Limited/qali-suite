/**
 * Fleet — 0110.
 *
 * Vehicles, the trips they run and the maintenance they need — replacing the
 * dummy Fleet page with three real, company-scoped, RLS'd tables on the same
 * pattern as Help Desk and Tasks.
 *
 *   fleet_vehicles     — the registry. reg_no is the natural key (unique per
 *                        company); insurance/service dates drive the alerts the
 *                        dashboard shows. driver_user_id → users (optional).
 *   fleet_trips        — a trip log, each linked to its vehicle.
 *   fleet_maintenance  — service/repair records, each linked to its vehicle.
 *
 * "Service due" and "insurance expiring" are DERIVED from the dates, not stored,
 * so the counts can never drift from the facts.
 */
import {
  pgTable,
  uuid,
  text,
  date,
  integer,
  doublePrecision,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { users } from "./users";

const audit = {
  createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("System"),
  lastModifiedById: text("last_modified_by_id").references(() => users.id, { onDelete: "set null" }),
  lastModifiedByName: text("last_modified_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const fleetVehicles = pgTable(
  "fleet_vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    regNo: text("reg_no").notNull(),
    make: text("make").notNull().default(""),
    model: text("model").notNull().default(""),
    vehicleClass: text("vehicle_class").notNull().default(""),
    driverUserId: text("driver_user_id").references(() => users.id, { onDelete: "set null" }),
    driverName: text("driver_name").notNull().default(""),
    insuranceExpiry: date("insurance_expiry"),
    nextServiceDate: date("next_service_date"),
    mileageKm: integer("mileage_km").notNull().default(0),
    status: text("status").notNull().default("active"),
    notes: text("notes").notNull().default(""),
    ...audit,
  },
  (t) => [
    uniqueIndex("fleet_vehicles_company_reg_idx").on(t.companyId, t.regNo),
    index("fleet_vehicles_status_idx").on(t.companyId, t.status),
    index("fleet_vehicles_insurance_idx").on(t.companyId, t.insuranceExpiry),
    index("fleet_vehicles_service_idx").on(t.companyId, t.nextServiceDate),
    check("fleet_vehicles_reg_not_blank", sql`length(btrim(${t.regNo})) > 0`),
    check(
      "fleet_vehicles_status_valid",
      sql`${t.status} IN ('active','service_due','grounded','retired')`,
    ),
  ],
);

export const fleetTrips = pgTable(
  "fleet_trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id").notNull().references(() => fleetVehicles.id, { onDelete: "cascade" }),
    tripDate: date("trip_date").notNull(),
    purpose: text("purpose").notNull().default(""),
    fromLocation: text("from_location").notNull().default(""),
    toLocation: text("to_location").notNull().default(""),
    distanceKm: doublePrecision("distance_km").notNull().default(0),
    fuelCost: doublePrecision("fuel_cost").notNull().default(0),
    driverName: text("driver_name").notNull().default(""),
    ...audit,
  },
  (t) => [
    index("fleet_trips_vehicle_idx").on(t.vehicleId, t.tripDate),
    index("fleet_trips_company_date_idx").on(t.companyId, t.tripDate),
  ],
);

export const fleetMaintenance = pgTable(
  "fleet_maintenance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id").notNull().references(() => fleetVehicles.id, { onDelete: "cascade" }),
    serviceDate: date("service_date").notNull(),
    service: text("service").notNull().default(""),
    garage: text("garage").notNull().default(""),
    cost: doublePrecision("cost").notNull().default(0),
    status: text("status").notNull().default("scheduled"),
    notes: text("notes").notNull().default(""),
    ...audit,
  },
  (t) => [
    index("fleet_maintenance_vehicle_idx").on(t.vehicleId, t.serviceDate),
    index("fleet_maintenance_company_idx").on(t.companyId, t.status),
    check(
      "fleet_maintenance_status_valid",
      sql`${t.status} IN ('scheduled','in_progress','done')`,
    ),
  ],
);
