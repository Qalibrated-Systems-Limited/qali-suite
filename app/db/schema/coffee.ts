import {
  pgTable,
  uuid,
  text,
  date,
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
import { products } from "./products";
import { parties } from "./parties";
import { journalEntries } from "./journal";
import { stockMovements } from "./stockMovements";
import {
  coffeeTypeEnum,
  coffeeSeasonTypeEnum,
  farmerIntakeStatusEnum,
  farmerPaymentStatusEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });
const qty = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Coffee cooperative intake (0058).
 *
 * THE LEDGER GAP THIS CLOSES. `connectors/coffee-coop.js` posts
 * DR Inventory / CR Farmer Payable through the Mongo model, and every ledger
 * screen reads Postgres. It is reachable — registered in the connector
 * registry and called by `app/api/v1/coffee-coop/intake` — so every farmer
 * delivery has been recorded into a ledger nothing reads.
 *
 * Unlike the weighbridge, none of this existed in Postgres: the season, the
 * intake and the price schedule are all new here.
 */
export const coffeeSeasons = pgTable(
  "coffee_seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    seasonType: coffeeSeasonTypeEnum("season_type").notNull().default("main"),
    year: integer("year").notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    isActive: boolean("is_active").notNull().default(false),
    targetVolumeKg: qty("target_volume_kg").notNull().default("0"),
    /** What an intake defaults to when the payload names no product. */
    defaultProductId: uuid("default_product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("coffee_seasons_company_name_uq").on(t.companyId, t.name),
    /**
     * One active season at a time. The Mongo model has an `isActive` boolean
     * and nothing stopping two — and the connector resolves an intake's price
     * from "the active season", so two would make the price depend on which
     * document the query happened to return.
     */
    uniqueIndex("coffee_seasons_one_active")
      .on(t.companyId)
      .where(sql`${t.isActive} = true`),
    index("coffee_seasons_company_year_idx").on(t.companyId, t.year),
    check(
      "coffee_seasons_dates_ordered",
      sql`${t.startDate} IS NULL OR ${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`,
    ),
  ],
);

/** The price per kilo, by grade and coffee type, for a season. */
export const coffeePriceSchedule = pgTable(
  "coffee_price_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => coffeeSeasons.id, { onDelete: "cascade" }),
    grade: text("grade").notNull(),
    coffeeType: coffeeTypeEnum("coffee_type").notNull().default("parchment"),
    unitPrice: money("unit_price").notNull(),
    currency: text("currency").notNull().default("KES"),
  },
  (t) => [
    /** One price per grade per type per season, so a lookup has one answer. */
    uniqueIndex("coffee_price_schedule_uq").on(
      t.seasonId,
      t.grade,
      t.coffeeType,
    ),
    check("coffee_price_schedule_price_positive", sql`${t.unitPrice} > 0`),
  ],
);

/**
 * One farmer's delivery.
 *
 * `net_weight` and `total_amount` are GENERATED. The Mongo model documents
 * them — "grossWeight - deductionWeight" and "netWeight × unitPrice" — and
 * then stores both as independent numbers the connector computes in
 * JavaScript, so a correction to the gross weight or the deduction leaves
 * them behind.
 */
export const farmerIntakeEntries = pgTable(
  "farmer_intake_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entryNumber: text("entry_number").notNull(),
    /** The station's own reference — the idempotency key. */
    externalRef: text("external_ref"),

    seasonId: uuid("season_id").references(() => coffeeSeasons.id, {
      onDelete: "restrict",
    }),
    seasonNameAtIntake: text("season_name_at_intake"),

    /** The member number the station quotes. */
    farmerCode: text("farmer_code").notNull(),
    farmerName: text("farmer_name"),
    farmerPhone: text("farmer_phone"),
    /**
     * The farmer as a financial identity, where one exists. Nullable: a
     * cooperative takes deliveries from members who have never been set up as
     * a party, and refusing the delivery over bookkeeping would be wrong.
     */
    farmerPartyId: uuid("farmer_party_id").references(() => parties.id, {
      onDelete: "set null",
    }),

    coffeeType: coffeeTypeEnum("coffee_type").notNull().default("parchment"),
    grade: text("grade").notNull(),

    grossWeight: qty("gross_weight").notNull(),
    /** Tare, moisture and anything else knocked off before payment. */
    deductionWeight: qty("deduction_weight").notNull().default("0"),
    netWeight: qty("net_weight").generatedAlwaysAs(
      sql`gross_weight - deduction_weight`,
    ),
    moisture: numeric("moisture", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),

    unitPrice: money("unit_price").notNull(),
    currency: text("currency").notNull().default("KES"),
    totalAmount: money("total_amount").generatedAlwaysAs(
      sql`round((gross_weight - deduction_weight) * unit_price, 4)`,
    ),

    paymentMethod: text("payment_method"),
    paymentStatus: farmerPaymentStatusEnum("payment_status")
      .notNull()
      .default("unpaid"),
    amountPaid: money("amount_paid").notNull().default("0"),
    paymentRef: text("payment_ref"),
    paidAt: timestamp("paid_at", { withTimezone: true }),

    productId: uuid("product_id").references(() => products.id, {
      onDelete: "restrict",
    }),
    productNameAtIntake: text("product_name_at_intake"),

    stockMovementId: uuid("stock_movement_id").references(
      () => stockMovements.id,
      { onDelete: "set null" },
    ),
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),

    status: farmerIntakeStatusEnum("status").notNull().default("recorded"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    /** Non-blocking notes raised at intake, surfaced to the station. */
    warnings: text("warnings").array(),

    collectedById: text("collected_by_id"),
    collectedByName: text("collected_by_name"),
    integrationKeyId: uuid("integration_key_id"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("farmer_intake_entries_number_uq").on(
      t.companyId,
      t.entryNumber,
    ),
    /**
     * The station's reference is an idempotency key, so it is unique where it
     * is present. Mongo indexes it without uniqueness — the same fault the
     * weighbridge had, and the same consequence: a retried call records the
     * delivery, the stock and the liability twice.
     */
    uniqueIndex("farmer_intake_entries_external_ref_uq")
      .on(t.companyId, t.externalRef)
      .where(sql`${t.externalRef} IS NOT NULL`),
    index("farmer_intake_entries_farmer_idx").on(
      t.companyId,
      t.farmerCode,
      t.createdAt.desc(),
    ),
    index("farmer_intake_entries_season_idx").on(t.companyId, t.seasonId),
    index("farmer_intake_entries_unpaid_idx")
      .on(t.companyId, t.paymentStatus)
      .where(sql`${t.paymentStatus} <> 'paid'`),

    check("farmer_intake_weights_non_negative",
      sql`${t.grossWeight} >= 0 AND ${t.deductionWeight} >= 0`),
    /** A deduction cannot exceed what arrived. */
    check("farmer_intake_deduction_within_gross",
      sql`${t.deductionWeight} <= ${t.grossWeight}`),
    check("farmer_intake_price_not_negative", sql`${t.unitPrice} >= 0`),
    check("farmer_intake_moisture_is_a_percentage",
      sql`${t.moisture} >= 0 AND ${t.moisture} <= 100`),
    check("farmer_intake_amount_paid_not_negative", sql`${t.amountPaid} >= 0`),
    check(
      "farmer_intake_voided_has_a_reason",
      sql`${t.status} <> 'voided' OR ${t.voidReason} IS NOT NULL`,
    ),
  ],
);
