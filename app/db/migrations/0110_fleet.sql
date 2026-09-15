-- ─────────────────────────────────────────────────────────────────────────────
-- 0110 — Fleet.
--
-- Vehicles, trips and maintenance — replacing the dummy Fleet page with three
-- real, company-scoped, RLS'd tables on the same pattern as Tasks (0109).
-- reg_no is the vehicle's natural key (unique per company); trips and
-- maintenance cascade from their vehicle. "service due" / "insurance expiring"
-- are derived from the dates at read time. Touches only these three new tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "fleet_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"reg_no" text NOT NULL,
	"make" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"vehicle_class" text DEFAULT '' NOT NULL,
	"driver_user_id" text,
	"driver_name" text DEFAULT '' NOT NULL,
	"insurance_expiry" date,
	"next_service_date" date,
	"mileage_km" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_vehicles_reg_not_blank" CHECK (length(btrim("reg_no")) > 0),
	CONSTRAINT "fleet_vehicles_status_valid" CHECK ("status" IN ('active','service_due','grounded','retired'))
);
--> statement-breakpoint

CREATE TABLE "fleet_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"trip_date" date NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"from_location" text DEFAULT '' NOT NULL,
	"to_location" text DEFAULT '' NOT NULL,
	"distance_km" double precision DEFAULT 0 NOT NULL,
	"fuel_cost" double precision DEFAULT 0 NOT NULL,
	"driver_name" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "fleet_maintenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"service_date" date NOT NULL,
	"service" text DEFAULT '' NOT NULL,
	"garage" text DEFAULT '' NOT NULL,
	"cost" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_maintenance_status_valid" CHECK ("status" IN ('scheduled','in_progress','done'))
);
--> statement-breakpoint

ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_driver_user_id_users_id_fk" FOREIGN KEY ("driver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "fleet_maintenance" ADD CONSTRAINT "fleet_maintenance_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_maintenance" ADD CONSTRAINT "fleet_maintenance_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_maintenance" ADD CONSTRAINT "fleet_maintenance_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_maintenance" ADD CONSTRAINT "fleet_maintenance_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "fleet_vehicles_company_reg_idx" ON "fleet_vehicles" USING btree ("company_id","reg_no");--> statement-breakpoint
CREATE INDEX "fleet_vehicles_status_idx" ON "fleet_vehicles" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "fleet_vehicles_insurance_idx" ON "fleet_vehicles" USING btree ("company_id","insurance_expiry");--> statement-breakpoint
CREATE INDEX "fleet_vehicles_service_idx" ON "fleet_vehicles" USING btree ("company_id","next_service_date");--> statement-breakpoint
CREATE INDEX "fleet_trips_vehicle_idx" ON "fleet_trips" USING btree ("vehicle_id","trip_date");--> statement-breakpoint
CREATE INDEX "fleet_trips_company_date_idx" ON "fleet_trips" USING btree ("company_id","trip_date");--> statement-breakpoint
CREATE INDEX "fleet_maintenance_vehicle_idx" ON "fleet_maintenance" USING btree ("vehicle_id","service_date");--> statement-breakpoint
CREATE INDEX "fleet_maintenance_company_idx" ON "fleet_maintenance" USING btree ("company_id","status");--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fleet_vehicles','fleet_trips','fleet_maintenance']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
