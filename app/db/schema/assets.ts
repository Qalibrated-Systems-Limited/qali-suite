import {
  pgTable,
  uuid,
  text,
  date,
  integer,
  numeric,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { accounts } from "./accounts";
import { parties } from "./parties";
import { journalEntries } from "./journal";
import {
  assetCategoryEnum,
  assetStatusEnum,
  depreciationMethodEnum,
  depreciationConventionEnum,
  depreciationPeriodStatusEnum,
  disposalMethodEnum,
  kraClassEnum,
  usageUnitEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Fixed assets (0056) — the register, and the three entries it raises.
 *
 * THE LEDGER GAP THIS CLOSES. `asset-actions.js` posts three journal entries
 * through the Mongo model while every ledger screen reads Postgres:
 *
 *   postDepreciation   DR Depreciation Expense       CR Accumulated Depreciation
 *   impairAsset        DR Impairment Loss            CR Accumulated Depreciation
 *   disposeAsset       DR Bank (proceeds)            CR Fixed Asset (cost)
 *                      DR Accumulated Depreciation   CR Gain on disposal
 *                      DR Loss on disposal
 *
 * ACQUISITION IS NOT ONE OF THEM, and the plan's table says it is. `createAsset`
 * posts nothing — it tags the bill line with `capitalizedAssetId` and stops,
 * because the BILL already posted DR Fixed Asset / CR Accounts Payable when it
 * was approved. There is nothing left to raise. The third entry is impairment.
 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    assetNumber: text("asset_number").notNull(),

    name: text("name").notNull(),
    description: text("description"),
    category: assetCategoryEnum("category").notNull(),
    status: assetStatusEnum("status").notNull().default("active"),

    serialNumber: text("serial_number"),
    model: text("model"),
    manufacturer: text("manufacturer"),
    /** Vehicles: "KCB 123X". */
    registrationNumber: text("registration_number"),

    location: text("location"),
    department: text("department"),
    assignedToPartyId: uuid("assigned_to_party_id").references(
      () => parties.id,
      { onDelete: "set null" },
    ),

    acquisitionDate: date("acquisition_date").notNull(),
    acquisitionCost: money("acquisition_cost").notNull(),
    currency: text("currency").notNull().default("KES"),

    /**
     * Where this asset came from. `bill` is the ordinary path: a bill line
     * charged to a fixed-asset account is capitalised into a register entry,
     * and `bill_lines.capitalized_asset_id` points back here.
     */
    sourceType: text("source_type").notNull().default("manual"),
    sourceId: uuid("source_id"),
    sourceReference: text("source_reference"),

    // ── Depreciation setup ───────────────────────────────────────────────────
    depreciationMethod: depreciationMethodEnum("depreciation_method")
      .notNull()
      .default("straight_line"),
    usefulLifeMonths: integer("useful_life_months").notNull().default(60),
    salvageValue: money("salvage_value").notNull().default("0"),
    /** Reducing balance only: an ANNUAL rate, 0-1. Divided by 12 per period. */
    depreciationRate: numeric("depreciation_rate", { precision: 9, scale: 6 })
      .notNull()
      .default("0"),
    depreciationStartDate: date("depreciation_start_date").notNull(),
    depreciationConvention: depreciationConventionEnum(
      "depreciation_convention",
    )
      .notNull()
      .default("full_month"),

    kraClass: kraClassEnum("kra_class").notNull().default("none"),

    // ── GL mapping. Null falls back to the company default. ──────────────────
    assetAccountId: uuid("asset_account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    accumulatedDepreciationAccountId: uuid(
      "accumulated_depreciation_account_id",
    ).references(() => accounts.id, { onDelete: "restrict" }),
    depreciationExpenseAccountId: uuid(
      "depreciation_expense_account_id",
    ).references(() => accounts.id, { onDelete: "restrict" }),

    // ── Disposal ─────────────────────────────────────────────────────────────
    disposedAt: timestamp("disposed_at", { withTimezone: true }),
    disposedById: text("disposed_by_id"),
    disposedByName: text("disposed_by_name"),
    disposalMethod: disposalMethodEnum("disposal_method"),
    disposalAmount: money("disposal_amount").notNull().default("0"),
    disposalNotes: text("disposal_notes"),

    // ── Usage (odometer / hours-meter) ───────────────────────────────────────
    usageUnit: usageUnitEnum("usage_unit").notNull().default("km"),

    photoUrl: text("photo_url"),

    insuranceProvider: text("insurance_provider"),
    insurancePolicyNumber: text("insurance_policy_number"),
    insuranceExpiryDate: date("insurance_expiry_date"),
    insurancePremium: money("insurance_premium"),
    inspectionLastDate: date("inspection_last_date"),
    inspectionNextDueDate: date("inspection_next_due_date"),

    notes: text("notes"),
    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
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
    uniqueIndex("assets_number_unique").on(t.companyId, t.assetNumber),
    index("assets_list_idx").on(t.companyId, t.status, t.category),
    index("assets_category_idx").on(t.companyId, t.category),
    index("assets_assigned_idx")
      .on(t.companyId, t.assignedToPartyId)
      .where(sql`${t.assignedToPartyId} IS NOT NULL`),
    index("assets_source_idx")
      .on(t.companyId, t.sourceType, t.sourceId)
      .where(sql`${t.sourceId} IS NOT NULL`),

    check("assets_cost_not_negative", sql`${t.acquisitionCost} >= 0`),
    check(
      "assets_salvage_within_cost",
      sql`${t.salvageValue} >= 0 AND ${t.salvageValue} <= ${t.acquisitionCost}`,
    ),
    check(
      "assets_rate_is_a_fraction",
      sql`${t.depreciationRate} >= 0 AND ${t.depreciationRate} <= 1`,
    ),
    check(
      "assets_useful_life_in_range",
      sql`${t.usefulLifeMonths} >= 0 AND ${t.usefulLifeMonths} <= 1200`,
    ),
    /**
     * A depreciating asset needs a life to spread over, and a reducing-balance
     * one needs a rate. Land has neither, which is what `none` is for.
     */
    check(
      "assets_depreciating_has_a_life",
      sql`${t.depreciationMethod} = 'none' OR ${t.usefulLifeMonths} > 0`,
    ),
    check(
      "assets_reducing_balance_has_a_rate",
      sql`${t.depreciationMethod} <> 'reducing_balance' OR ${t.depreciationRate} > 0`,
    ),
    check(
      "assets_disposal_is_complete",
      sql`${t.status} <> 'disposed'
          OR (${t.disposedAt} IS NOT NULL AND ${t.disposalMethod} IS NOT NULL)`,
    ),
    check("assets_disposal_amount_not_negative", sql`${t.disposalAmount} >= 0`),
    check(
      "assets_depreciation_starts_after_acquisition",
      sql`${t.depreciationStartDate} >= ${t.acquisitionDate}`,
    ),
  ],
);

/**
 * One row per month of the asset's life.
 *
 * Generated once, when the asset is created, and rewritten only by an
 * impairment — which revises the remaining months over the same horizon
 * (IFRS revised carrying amount). A posted row is a fact and is never touched
 * again; `asset_depreciation_posted_is_immutable` enforces that.
 *
 * `accumulated_depreciation` and `book_value` are stored on the ROW because
 * they are what the schedule PROJECTS. They are not the asset's actual
 * position — see `asset_state` for that, and the note on it for why the
 * difference matters.
 */
export const assetDepreciationSchedule = pgTable(
  "asset_depreciation_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),

    /** "2026-03" — year and month kept beside it so ordering is numeric. */
    period: text("period").notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),

    depreciationAmount: money("depreciation_amount").notNull(),
    /** What the schedule projects the running total to be after this month. */
    accumulatedDepreciation: money("accumulated_depreciation").notNull(),
    bookValue: money("book_value").notNull(),

    status: depreciationPeriodStatusEnum("status").notNull().default("pending"),
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),
    postedAt: timestamp("posted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * One row per asset per month, and therefore one POSTING per asset per
     * month. In Mongo the guard is `schedule.find(s => s.period === period &&
     * s.status === "pending")` — a read, then a write, which two concurrent
     * runs of the month-end job both pass.
     */
    uniqueIndex("asset_depreciation_period_unique").on(t.assetId, t.period),
    index("asset_depreciation_pending_idx")
      .on(t.companyId, t.period, t.status)
      .where(sql`${t.status} = 'pending'`),
    index("asset_depreciation_asset_idx").on(t.assetId, t.year, t.month),
    index("asset_depreciation_entry_idx")
      .on(t.companyId, t.journalEntryId)
      .where(sql`${t.journalEntryId} IS NOT NULL`),

    check("asset_depreciation_amount_not_negative", sql`${t.depreciationAmount} >= 0`),
    check("asset_depreciation_month_valid", sql`${t.month} BETWEEN 1 AND 12`),
    check(
      "asset_depreciation_period_matches",
      sql`${t.period} = ${t.year}::text || '-' || lpad(${t.month}::text, 2, '0')`,
    ),
    /** A posted row names the entry that posted it, and nothing else does. */
    check(
      "asset_depreciation_posted_has_an_entry",
      sql`(${t.status} = 'posted') = (${t.journalEntryId} IS NOT NULL)`,
    ),
    check(
      "asset_depreciation_posted_has_a_time",
      sql`(${t.status} = 'posted') = (${t.postedAt} IS NOT NULL)`,
    ),
  ],
);

/** Location, department and custodian changes. Append-only. */
export const assetTransfers = pgTable(
  "asset_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    transferredAt: timestamp("transferred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    fromLocation: text("from_location"),
    toLocation: text("to_location"),
    fromDepartment: text("from_department"),
    toDepartment: text("to_department"),
    fromAssignedToName: text("from_assigned_to_name"),
    toAssignedToName: text("to_assigned_to_name"),
    reason: text("reason"),
    transferredById: text("transferred_by_id"),
    transferredByName: text("transferred_by_name"),
  },
  (t) => [
    index("asset_transfers_asset_idx").on(t.assetId, t.transferredAt),
    index("asset_transfers_company_idx").on(t.companyId, t.transferredAt),
  ],
);

/** Partial write-downs. Each one raises DR Impairment Loss / CR Accum. Dep. */
export const assetImpairments = pgTable(
  "asset_impairments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    impairedAt: timestamp("impaired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    amount: money("amount").notNull(),
    reason: text("reason").notNull(),
    journalEntryId: uuid("journal_entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "restrict" }),
    impairedById: text("impaired_by_id"),
    impairedByName: text("impaired_by_name"),
  },
  (t) => [
    index("asset_impairments_asset_idx").on(t.assetId, t.impairedAt),
    uniqueIndex("asset_impairments_entry_unique").on(t.journalEntryId),
    check("asset_impairments_amount_positive", sql`${t.amount} > 0`),
  ],
);

/** Odometer and hours-meter readings, for cost-per-km and cost-per-hour. */
export const assetUsageReadings = pgTable(
  "asset_usage_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reading: numeric("reading", { precision: 19, scale: 4 }).notNull(),
    unit: usageUnitEnum("unit").notNull().default("km"),
    source: text("source").notNull().default("manual"),
    /** `bill` or `expense`; both are Mongo ids for now where expenses are. */
    sourceKind: text("source_kind"),
    sourceRefId: text("source_ref_id"),
    notes: text("notes"),
    recordedById: text("recorded_by_id"),
    recordedByName: text("recorded_by_name"),
  },
  (t) => [
    index("asset_usage_asset_idx").on(t.assetId, t.recordedAt),
    check("asset_usage_reading_not_negative", sql`${t.reading} >= 0`),
  ],
);

export const assetDocuments = pgTable(
  "asset_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("asset_documents_asset_idx").on(t.companyId, t.assetId)],
);

/**
 * Which entry an asset raised, and what for.
 *
 * `journalEntryIds` was an unconstrained array in Mongo. Disposal in
 * particular must happen once: a second run would credit the asset cost twice.
 */
export const assetJournalEntries = pgTable(
  "asset_journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    journalEntryId: uuid("journal_entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "restrict" }),
    /** depreciation | impairment | disposal */
    purpose: text("purpose").notNull(),
    /** Set for depreciation, so a period can be traced to its entry. */
    period: text("period"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("asset_journal_entries_unique").on(t.assetId, t.journalEntryId),
    /** An asset is disposed of once. */
    uniqueIndex("asset_journal_entries_disposal_once")
      .on(t.assetId)
      .where(sql`${t.purpose} = 'disposal'`),
    index("asset_journal_entries_entry_idx").on(t.companyId, t.journalEntryId),
  ],
);
