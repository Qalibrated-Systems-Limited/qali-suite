-- ============================================================================
-- FLEET KEEPS ITS RECORDS AND ITS COSTS
--
-- 0110 replaced a dummy page with real tables, but the records could not be
-- kept current:
--
--   * Nothing ever changed a vehicle after it was added, and completing a
--     service touched nothing on it — so "service due" and "insurance
--     expiring" could never clear.
--   * Trips carried a distance and no odometer, so mileage never moved.
--   * Deleting a vehicle CASCADED: its whole trip and service history went
--     with it.
--   * Fuel and repair costs were double precision and reached no books.
--
-- So: odometer readings on trips and services, the next service by date or by
-- km, a link to the vehicle's fixed asset, money in numeric(19,4), and history
-- that a vehicle cannot be deleted out from under (it is retired instead).
-- A trip's fuel or a service's cost can raise a DRAFT expense, which finance
-- posts from Expenses; `expense_id` is that link.
--
-- SAFE TO APPLY because: every new column is nullable or defaulted; the type
-- changes widen double precision to an exact numeric of more than enough
-- precision; the FK swap only refuses deletes that used to destroy history.
-- ============================================================================

ALTER TABLE "fleet_vehicles"
  ADD COLUMN "asset_id" uuid REFERENCES "assets"("id") ON DELETE SET NULL,
  ADD COLUMN "next_service_km" integer;--> statement-breakpoint
ALTER TABLE "fleet_vehicles"
  ADD CONSTRAINT "fleet_vehicles_next_service_km_positive"
  CHECK ("next_service_km" IS NULL OR "next_service_km" >= 0),
  ADD CONSTRAINT "fleet_vehicles_mileage_not_negative" CHECK ("mileage_km" >= 0);--> statement-breakpoint
CREATE INDEX "fleet_vehicles_asset_idx" ON "fleet_vehicles" ("asset_id");--> statement-breakpoint

ALTER TABLE "fleet_trips"
  ALTER COLUMN "fuel_cost" TYPE numeric(19,4) USING round("fuel_cost"::numeric, 4),
  ALTER COLUMN "distance_km" TYPE numeric(12,1) USING round("distance_km"::numeric, 1),
  ADD COLUMN "odometer_start" integer,
  ADD COLUMN "odometer_end" integer,
  ADD COLUMN "fuel_litres" numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "fuel_station" text NOT NULL DEFAULT '',
  ADD COLUMN "driver_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "expense_id" uuid REFERENCES "expenses"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "fleet_trips"
  ADD CONSTRAINT "fleet_trips_odometer_forward"
  CHECK ("odometer_start" IS NULL OR "odometer_end" IS NULL OR "odometer_end" >= "odometer_start"),
  ADD CONSTRAINT "fleet_trips_amounts_not_negative"
  CHECK ("distance_km" >= 0 AND "fuel_cost" >= 0 AND "fuel_litres" >= 0);--> statement-breakpoint

ALTER TABLE "fleet_maintenance"
  ALTER COLUMN "cost" TYPE numeric(19,4) USING round("cost"::numeric, 4),
  ADD COLUMN "odometer_km" integer,
  ADD COLUMN "next_service_date" date,
  ADD COLUMN "next_service_km" integer,
  ADD COLUMN "completed_at" timestamp with time zone,
  ADD COLUMN "expense_id" uuid REFERENCES "expenses"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Records already marked done had no completion time; their last update is
-- the best evidence of when.
UPDATE "fleet_maintenance" SET "completed_at" = "updated_at" WHERE "status" = 'done';--> statement-breakpoint

ALTER TABLE "fleet_maintenance"
  ADD CONSTRAINT "fleet_maintenance_cost_not_negative" CHECK ("cost" >= 0),
  /* Done means done at some moment; anything else has not been. */
  ADD CONSTRAINT "fleet_maintenance_done_is_dated"
  CHECK (("status" = 'done') = ("completed_at" IS NOT NULL));--> statement-breakpoint

-- History outlives a vehicle's working life: retire it, do not delete it.
ALTER TABLE "fleet_trips" DROP CONSTRAINT "fleet_trips_vehicle_id_fleet_vehicles_id_fk";--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_vehicle_id_fleet_vehicles_id_fk"
  FOREIGN KEY ("vehicle_id") REFERENCES "fleet_vehicles"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "fleet_maintenance" DROP CONSTRAINT "fleet_maintenance_vehicle_id_fleet_vehicles_id_fk";--> statement-breakpoint
ALTER TABLE "fleet_maintenance" ADD CONSTRAINT "fleet_maintenance_vehicle_id_fleet_vehicles_id_fk"
  FOREIGN KEY ("vehicle_id") REFERENCES "fleet_vehicles"("id") ON DELETE RESTRICT;--> statement-breakpoint

CREATE INDEX "fleet_trips_expense_idx" ON "fleet_trips" ("expense_id") WHERE "expense_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "fleet_maintenance_expense_idx" ON "fleet_maintenance" ("expense_id") WHERE "expense_id" IS NOT NULL;
