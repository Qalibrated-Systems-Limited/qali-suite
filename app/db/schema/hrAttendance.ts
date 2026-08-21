import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  date,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";

/**
 * Attendance (0047).
 *
 * One policy per company — the primary key says so, where the source had a
 * companyId + isActive index and a getActive() that took whichever row came
 * first. Hours worked and overtime are generated from the record's own shift,
 * rather than computed in three places with three different ideas of a
 * standard day.
 */

export const attendanceConfig = pgTable("attendance_config", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),

  /** IANA zone. Shift times and the day a clock-in belongs to are read here. */
  timezone: text("timezone").notNull().default("Africa/Nairobi"),

  shiftStart: text("shift_start").notNull().default("08:00"),
  shiftEnd: text("shift_end").notNull().default("17:00"),
  standardHours: numeric("standard_hours", { precision: 5, scale: 2 })
    .notNull()
    .default("8"),
  lateGraceMinutes: integer("late_grace_minutes").notNull().default(15),
  overtimeRateMultiplier: numeric("overtime_rate_multiplier", {
    precision: 5,
    scale: 2,
  })
    .notNull()
    .default("1.5"),

  allowedMethods: text("allowed_methods").array().notNull(),

  ipWhitelistEnabled: boolean("ip_whitelist_enabled").notNull().default(false),
  ipWhitelist: text("ip_whitelist").array().notNull(),
  ipWhitelistDescription: text("ip_whitelist_description")
    .notNull()
    .default("Office network"),

  geofenceEnabled: boolean("geofence_enabled").notNull().default(false),
  geofenceLat: numeric("geofence_lat", { precision: 9, scale: 6 }),
  geofenceLng: numeric("geofence_lng", { precision: 9, scale: 6 }),
  geofenceRadiusMetres: integer("geofence_radius_metres").notNull().default(200),
  geofenceLabel: text("geofence_label").notNull().default("Office"),

  createdById: text("created_by_id"),
  createdByName: text("created_by_name"),
  lastModifiedById: text("last_modified_by_id"),
  lastModifiedByName: text("last_modified_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull(),

    /** The LOCAL calendar date this record belongs to. */
    workDate: date("work_date").notNull(),

    shift: text("shift").notNull().default("morning"),
    /** The shift in force when the record was written, kept so it still reads. */
    shiftStart: text("shift_start").notNull().default("08:00"),
    standardHours: numeric("standard_hours", { precision: 5, scale: 2 })
      .notNull()
      .default("8"),

    checkIn: timestamp("check_in", { withTimezone: true }),
    checkOut: timestamp("check_out", { withTimezone: true }),

    /** GENERATED. Null while the day is still open — which is not zero hours. */
    hoursWorked: numeric("hours_worked", { precision: 6, scale: 2 }),
    /** GENERATED: hours beyond this record's own standard day. */
    overtimeHours: numeric("overtime_hours", { precision: 6, scale: 2 }),

    status: text("status").notNull().default("absent"),
    method: text("method").notNull().default("web"),

    ipAddress: text("ip_address"),
    locationLat: numeric("location_lat", { precision: 9, scale: 6 }),
    locationLng: numeric("location_lng", { precision: 9, scale: 6 }),
    locationAccuracy: numeric("location_accuracy", { precision: 9, scale: 2 }),

    notes: text("notes"),
    markedAbsentAt: timestamp("marked_absent_at", { withTimezone: true }),

    autoClosedOut: boolean("auto_closed_out").notNull().default(false),
    autoClosedAt: timestamp("auto_closed_at", { withTimezone: true }),

    overriddenById: text("overridden_by_id"),
    overriddenByName: text("overridden_by_name"),
    overriddenAt: timestamp("overridden_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("attendance_employee_day_uq").on(t.employeeId, t.workDate),
    index("attendance_company_date_idx").on(t.companyId, t.workDate),
    index("attendance_employee_date_idx").on(t.employeeId, t.workDate),
  ],
);
