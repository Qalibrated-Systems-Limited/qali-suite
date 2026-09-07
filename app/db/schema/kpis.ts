import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { employees } from "./hr";
import {
  kpiCategoryEnum,
  kpiSourceEnum,
  kpiUnitEnum,
  kpiPeriodicityEnum,
  kpiTargetDirectionEnum,
  kpiSnapshotSourceEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * The number somebody is accountable for — 0097.
 *
 * A KPI is a metric with a target, an owner and a period. The actuals live
 * next door in `kpi_snapshots`, one row per (kpi, period), and each freezes
 * the target that was in force when it was recorded — so moving the target
 * today does not rewrite last quarter's judgement of whether the number was
 * hit. That separation is the Mongo model's, and it is right.
 *
 * ── THE OWNER IS AN EMPLOYEE AGAIN ────────────────────────────────────────
 *
 * The Mongo schema had `owner.partyId / profileId / userId`, all ObjectId. By
 * the time employees moved to Postgres those ids were uuids, which do not fit
 * an ObjectId field — so `buildOwnerSubdoc` was reduced to storing a NAME and
 * a typed-in employee number, with a comment saying storing an id that cannot
 * resolve is worse than storing none. It was, and it was still a dead link:
 * rename an employee and every KPI they own keeps the old name for ever.
 *
 * Here `owner_employee_id` is a real foreign key into `employees`, ON DELETE
 * SET NULL. The name and number stay alongside it as a snapshot, because a
 * free-typed owner ("the Nairobi depot") is still allowed and the list view
 * should not join for a label — but when the id is present it is the truth.
 */
export const kpis = pgTable(
  "kpis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    name: text("name").notNull(),
    description: text("description").notNull().default(""),

    category: kpiCategoryEnum("category").notNull(),
    source: kpiSourceEnum("source").notNull().default("manual"),
    unit: kpiUnitEnum("unit").notNull().default("currency"),
    periodicity: kpiPeriodicityEnum("periodicity").notNull().default("monthly"),

    target: money("target").notNull(),
    targetDirection: kpiTargetDirectionEnum("target_direction")
      .notNull()
      .default("higher_is_better"),

    /**
     * Ratios, not percentages: 0.95 is 95% of target. NULL on either means
     * "use the 95 / 80 default bands", which is what `customThresholds`
     * nulls meant in Mongo.
     */
    onTargetThreshold: numeric("on_target_threshold", {
      precision: 9,
      scale: 4,
      mode: "string",
    }),
    nearTargetThreshold: numeric("near_target_threshold", {
      precision: 9,
      scale: 4,
      mode: "string",
    }),

    /** Overrides for "on track" / "at risk" / "behind". NULL is the default. */
    statusLabelOnTarget: text("status_label_on_target"),
    statusLabelNearTarget: text("status_label_near_target"),
    statusLabelOffTarget: text("status_label_off_target"),

    ownerEmployeeId: uuid("owner_employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    ownerName: text("owner_name"),
    ownerEmployeeNumber: text("owner_employee_number"),

    isActive: boolean("is_active").notNull().default(true),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name").notNull().default("System"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * The seeder deduped on `name` in JS — read the existing names, then
     * insert the ones that were missing. Two people pressing "Use starter
     * templates" at the same moment both read an empty list and both insert,
     * and the company ends up with two Monthly Revenues that diverge from
     * their first snapshot onwards. The index is expressed in the DDL over
     * lower(btrim(name)); drizzle-kit cannot render an expression index, so
     * it is declared here only as the plain column pair it is closest to.
     */
    index("kpis_company_name_idx").on(t.companyId, t.name),
    index("kpis_board_idx").on(t.companyId, t.isActive, t.category, t.name),

    check("kpis_name_not_blank", sql`length(btrim(${t.name})) > 0`),

    /**
     * Thresholds are a pair only in the sense that they must AGREE. Either
     * may be null on its own — one band overridden and the other left at the
     * default is a coherent thing to ask for — but when both are set the
     * stricter one has to be on the right side of the looser, and which side
     * that is depends on the direction. The Mongo action checked this in
     * `parseKpiFormData` and nothing else did, so `updateKpiTarget`, the
     * seeder and any future writer were free to produce a KPI whose "at risk"
     * band was harder to reach than its "on track" one.
     */
    check(
      "kpis_thresholds_agree_with_direction",
      sql`${t.onTargetThreshold} IS NULL OR ${t.nearTargetThreshold} IS NULL OR (
        CASE WHEN ${t.targetDirection} = 'lower_is_better'
             THEN ${t.onTargetThreshold} <= ${t.nearTargetThreshold}
             ELSE ${t.onTargetThreshold} >= ${t.nearTargetThreshold}
        END)`,
    ),
    check(
      "kpis_thresholds_positive",
      sql`(${t.onTargetThreshold} IS NULL OR ${t.onTargetThreshold} > 0)
          AND (${t.nearTargetThreshold} IS NULL OR ${t.nearTargetThreshold} > 0)`,
    ),
  ],
);

/**
 * One actual, for one KPI, for one period.
 *
 * ── THE PERIOD SHAPE IS THE DATABASE'S RULE NOW ───────────────────────────
 *
 * Mongo's convention — quarterly snapshots sit on the end-of-quarter month,
 * yearly ones on December — was enforced by `normalisePeriod()` in the action
 * layer and by nothing else. Any writer that did not call it could store a
 * quarterly snapshot on month 5 with quarter 4, and the unique index would
 * happily accept a second one for the same quarter on month 6. The checks
 * below make the convention structural: monthly carries no quarter, quarterly
 * sits on 3/6/9/12 with the matching quarter, yearly on December in Q4.
 *
 * `target_at_time` is the frozen target. It is NOT a copy for convenience —
 * it is the reason a snapshot means anything a year later.
 */
export const kpiSnapshots = pgTable(
  "kpi_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    kpiId: uuid("kpi_id")
      .notNull()
      .references(() => kpis.id, { onDelete: "cascade" }),

    periodicity: kpiPeriodicityEnum("periodicity").notNull().default("monthly"),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    periodQuarter: integer("period_quarter"),

    actualValue: money("actual_value").notNull(),
    targetAtTime: money("target_at_time").notNull(),

    source: kpiSnapshotSourceEnum("source").notNull(),
    notes: text("notes").notNull().default(""),

    recordedById: text("recorded_by_id"),
    recordedByName: text("recorded_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** One snapshot per KPI per period — the upsert target. */
    uniqueIndex("kpi_snapshots_period_uq").on(
      t.companyId,
      t.kpiId,
      t.periodYear,
      t.periodMonth,
    ),
    /** The series read: this KPI, newest period first. */
    index("kpi_snapshots_series_idx").on(
      t.companyId,
      t.kpiId,
      t.periodYear.desc(),
      t.periodMonth.desc(),
    ),

    check(
      "kpi_snapshots_month_in_range",
      sql`${t.periodMonth} BETWEEN 1 AND 12`,
    ),
    check(
      "kpi_snapshots_year_in_range",
      sql`${t.periodYear} BETWEEN 2000 AND 2100`,
    ),
    check(
      "kpi_snapshots_period_shape",
      sql`CASE ${t.periodicity}
            WHEN 'monthly'   THEN ${t.periodQuarter} IS NULL
            WHEN 'quarterly' THEN ${t.periodMonth} IN (3, 6, 9, 12)
                              AND ${t.periodQuarter} = ${t.periodMonth} / 3
            WHEN 'yearly'    THEN ${t.periodMonth} = 12 AND ${t.periodQuarter} = 4
          END`,
    ),
  ],
);
