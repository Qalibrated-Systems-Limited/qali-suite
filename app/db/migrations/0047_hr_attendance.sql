-- ============================================================================
-- 0047 — HR: attendance.
--
-- Third of four. The clock-in record and the policy that governs it.
--
-- ONE POLICY PER COMPANY. attendanceConfig.js has `companyId` and `isActive`,
-- an index on the pair, and a getActive() that does findOne() with no sort —
-- so a company with two active configs gets whichever the index returns, and
-- which one that is can change. The comment says "One active record per
-- company"; the primary key says it here.
--
-- HOURS WORKED AND OVERTIME ARE DERIVED. The source computes them in
-- JavaScript at clock-out, again in the stale-clock-in sweep, and a THIRD time
-- in manualAttendanceEntry — where it uses a hard-coded 8 hours instead of the
-- configured standardHours, so a manual entry for a company on a 9-hour shift
-- records an hour of overtime that was not worked. Generated columns compute
-- them once, from the record's own shift.
--
-- `overtimePay` is not carried over. It is declared on the model with the
-- comment "computed when payroll runs" and NOTHING EVER WRITES IT — a stored
-- zero that four screens display as though it meant something. Overtime pay
-- is an amount on a payslip; it belongs to payroll, which knows the rate.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- THE POLICY
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "attendance_config" (
  /* Not a surrogate key: there is one of these per company, by definition. */
  "company_id" uuid PRIMARY KEY
    REFERENCES "companies"("id") ON DELETE CASCADE,

  /*
   * IANA zone. Shift times and the day a clock-in belongs to are interpreted
   * here, not in UTC — a Nairobi employee clocking in at 08:00 is on time, and
   * in UTC that is 05:00 the same day, but at 01:00 local it would be the
   * PREVIOUS UTC day.
   */
  "timezone" text NOT NULL DEFAULT 'Africa/Nairobi',

  "shift_start" text NOT NULL DEFAULT '08:00',
  "shift_end" text NOT NULL DEFAULT '17:00',
  "standard_hours" numeric(5,2) NOT NULL DEFAULT 8,
  "late_grace_minutes" integer NOT NULL DEFAULT 15,
  "overtime_rate_multiplier" numeric(5,2) NOT NULL DEFAULT 1.5,

  /* Empty means every method is allowed, matching the source's default. */
  "allowed_methods" text[] NOT NULL
    DEFAULT ARRAY['web', 'mobile', 'qr', 'biometric', 'manual'],

  "ip_whitelist_enabled" boolean NOT NULL DEFAULT false,
  "ip_whitelist" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "ip_whitelist_description" text NOT NULL DEFAULT 'Office network',

  "geofence_enabled" boolean NOT NULL DEFAULT false,
  "geofence_lat" numeric(9,6),
  "geofence_lng" numeric(9,6),
  "geofence_radius_metres" integer NOT NULL DEFAULT 200,
  "geofence_label" text NOT NULL DEFAULT 'Office',

  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "attendance_config_shift_start_is_a_time"
    CHECK ("shift_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT "attendance_config_shift_end_is_a_time"
    CHECK ("shift_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT "attendance_config_standard_hours_sane"
    CHECK ("standard_hours" > 0 AND "standard_hours" <= 24),
  CONSTRAINT "attendance_config_grace_not_negative"
    CHECK ("late_grace_minutes" >= 0 AND "late_grace_minutes" <= 720),
  CONSTRAINT "attendance_config_overtime_multiplier_sane"
    CHECK ("overtime_rate_multiplier" >= 1 AND "overtime_rate_multiplier" <= 10),
  CONSTRAINT "attendance_config_radius_sane"
    CHECK ("geofence_radius_metres" > 0 AND "geofence_radius_metres" <= 100000),

  /*
   * A geofence that is switched on without a location refuses every clock-in
   * with "requires your location", and no location the employee sends can ever
   * satisfy it — because there is nothing to compare against.
   */
  CONSTRAINT "attendance_config_geofence_has_a_place" CHECK (
    NOT "geofence_enabled"
    OR ("geofence_lat" IS NOT NULL AND "geofence_lng" IS NOT NULL)
  ),
  CONSTRAINT "attendance_config_geofence_coordinates_valid" CHECK (
    ("geofence_lat" IS NULL OR "geofence_lat" BETWEEN -90 AND 90)
    AND ("geofence_lng" IS NULL OR "geofence_lng" BETWEEN -180 AND 180)
  ),

  /*
   * Likewise an empty whitelist that is switched on. The source treats it as
   * "allow everything" (`if (allowedIPs.length > 0 && ipAddress)`), which
   * means turning the control ON enforces NOTHING — the opposite of what the
   * administrator who ticked the box believes.
   */
  -- cardinality(), not array_length(): array_length of an EMPTY array is
  -- NULL, `NULL >= 1` is NULL, and a CHECK passes on NULL — so the constraint
  -- written the obvious way accepts exactly the case it exists to refuse.
  CONSTRAINT "attendance_config_whitelist_has_addresses" CHECK (
    NOT "ip_whitelist_enabled" OR cardinality("ip_whitelist") >= 1
  ),

  CONSTRAINT "attendance_config_methods_valid" CHECK (
    "allowed_methods" <@ ARRAY['web', 'mobile', 'qr', 'biometric', 'manual']
  ),
  CONSTRAINT "attendance_config_at_least_one_method"
    CHECK (cardinality("allowed_methods") >= 1),
  CONSTRAINT "attendance_config_timezone_is_real"
    CHECK (now() AT TIME ZONE "timezone" IS NOT NULL)
);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- THE RECORD — one per employee per working day.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "attendance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL,

  /* The LOCAL calendar date this record belongs to, in the tenant's zone. */
  "work_date" date NOT NULL,

  "shift" text NOT NULL DEFAULT 'morning',
  /* The shift in force for this record, copied at write time so the record
     can still be read after the policy changes (§9.4). */
  "shift_start" text NOT NULL DEFAULT '08:00',
  "standard_hours" numeric(5,2) NOT NULL DEFAULT 8,

  "check_in" timestamp with time zone,
  "check_out" timestamp with time zone,

  "status" text NOT NULL DEFAULT 'absent',
  "method" text NOT NULL DEFAULT 'web',

  "ip_address" text,
  "location_lat" numeric(9,6),
  "location_lng" numeric(9,6),
  "location_accuracy" numeric(9,2),

  "notes" text,
  "marked_absent_at" timestamp with time zone,

  /* Set by the sweep when somebody forgot to clock out and the record was
     closed at their shift end. */
  "auto_closed_out" boolean NOT NULL DEFAULT false,
  "auto_closed_at" timestamp with time zone,

  "overridden_by_id" text,
  "overridden_by_name" text,
  "overridden_at" timestamp with time zone,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "attendance_employee_fk"
    FOREIGN KEY ("employee_id", "company_id")
    REFERENCES "employees"("id", "company_id") ON DELETE CASCADE,

  /* One record per person per day. */
  CONSTRAINT "attendance_employee_day_uq" UNIQUE ("employee_id", "work_date"),

  CONSTRAINT "attendance_status_valid" CHECK ("status" IN (
    'present', 'absent', 'late', 'half_day', 'on_leave', 'holiday'
  )),
  CONSTRAINT "attendance_method_valid" CHECK ("method" IN (
    'web', 'mobile', 'qr', 'biometric', 'manual'
  )),
  CONSTRAINT "attendance_shift_valid" CHECK ("shift" IN (
    'morning', 'afternoon', 'night', 'custom'
  )),

  /* Leaving before arriving is a data-entry error, and it produces negative
     hours that flow straight into overtime. */
  CONSTRAINT "attendance_leaves_after_arriving"
    CHECK ("check_out" IS NULL OR "check_in" IS NULL OR "check_out" >= "check_in"),
  CONSTRAINT "attendance_cannot_leave_without_arriving"
    CHECK ("check_out" IS NULL OR "check_in" IS NOT NULL),

  /* Somebody marked present clocked in. Without this, a manual entry can
     record a present day with no times on it, and the hours it contributes to
     payroll are zero while the roster says they were here. */
  CONSTRAINT "attendance_present_means_clocked_in" CHECK (
    "status" NOT IN ('present', 'late', 'half_day') OR "check_in" IS NOT NULL
  ),

  CONSTRAINT "attendance_standard_hours_sane"
    CHECK ("standard_hours" > 0 AND "standard_hours" <= 24),
  CONSTRAINT "attendance_shift_start_is_a_time"
    CHECK ("shift_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);--> statement-breakpoint

/*
 * Hours worked and overtime, computed once.
 *
 * Rounded to two decimals to match what the source stores, and NULL until
 * there is a clock-out — a day still in progress has not worked zero hours,
 * and a stored 0 is indistinguishable from one that has finished with none.
 * That distinction is what the "forgot to clock out" sweep looks for.
 */
ALTER TABLE "attendance"
  ADD COLUMN "hours_worked" numeric(6,2)
  GENERATED ALWAYS AS (
    CASE WHEN "check_in" IS NOT NULL AND "check_out" IS NOT NULL
         THEN ROUND(EXTRACT(EPOCH FROM ("check_out" - "check_in"))::numeric / 3600, 2)
    END
  ) STORED;--> statement-breakpoint

ALTER TABLE "attendance"
  ADD COLUMN "overtime_hours" numeric(6,2)
  GENERATED ALWAYS AS (
    CASE WHEN "check_in" IS NOT NULL AND "check_out" IS NOT NULL
         THEN GREATEST(
           0,
           ROUND(EXTRACT(EPOCH FROM ("check_out" - "check_in"))::numeric / 3600, 2)
             - "standard_hours"
         )
    END
  ) STORED;--> statement-breakpoint

CREATE INDEX "attendance_company_date_idx"
  ON "attendance" ("company_id", "work_date" DESC);--> statement-breakpoint
CREATE INDEX "attendance_employee_date_idx"
  ON "attendance" ("employee_id", "work_date" DESC);--> statement-breakpoint
/* The sweep's query: still clocked in, from a day that has ended. */
CREATE INDEX "attendance_open_records_idx"
  ON "attendance" ("company_id", "work_date")
  WHERE "check_in" IS NOT NULL AND "check_out" IS NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_config', 'attendance']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "attendance_config" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "attendance" TO app_user;
