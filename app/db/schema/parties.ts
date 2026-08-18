import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { partyTypeEnum } from "./enums";

/**
 * Customers, suppliers and employees.
 *
 * Ported to close a gap left by the accounting-core slice: journal_entries
 * carried a bare `party_id uuid` referencing nothing, so an entry could name a
 * party that did not exist and AR/AP by party was unenforced. Migration 0005
 * adds the foreign key once this table exists.
 *
 * Two departures from app/models/parties.js:
 *
 * 1. `cachedBalance` / `balanceUpdatedAt` are NOT carried over. The Mongo
 *    comment on that field already says "Cached - NOT source of truth!", and
 *    the accounting core made the same move for Account.currentBalance: a
 *    balance that is stored can disagree with the ledger, and a balance that is
 *    derived cannot. See the party_balances view in migration 0005.
 *
 * 2. The Mongo enum is ["customer", "supplier", "employee", "both"]. "both" is
 *    a membership question wearing a type's clothing — it forces every consumer
 *    to write `type === "customer" || type === "both"`, which is exactly what
 *    the isCustomer/isSupplier virtuals do. Here the roles are independent
 *    booleans, so "customer or both" becomes `is_customer = true`. `party_type`
 *    is kept alongside for the journal_entries FK, which still discriminates on
 *    a single value.
 */
export const parties = pgTable(
  "parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    // Roles, independent rather than a four-valued enum. A party may be both a
    // customer and a supplier; employees are exclusive in practice but the
    // schema does not need to care.
    isCustomer: boolean("is_customer").notNull().default(false),
    isSupplier: boolean("is_supplier").notNull().default(false),
    isEmployee: boolean("is_employee").notNull().default(false),
    /** Primary role, for the journal_entries.party_type discriminator. */
    primaryType: partyTypeEnum("primary_type").notNull(),

    name: text("name").notNull(),
    displayName: text("display_name"),
    email: text("email"),
    phone: text("phone"),
    taxPin: text("tax_pin"),

    // Address, flattened from the embedded object.
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    postalCode: text("postal_code"),
    country: text("country").notNull().default("Kenya"),

    // Employee-specific
    userId: uuid("user_id"),
    employeeNumber: text("employee_number"),
    department: text("department"),
    designation: text("designation"),
    isContractor: boolean("is_contractor").notNull().default(false),

    // Withholding tax (contractors)
    whtApplicable: boolean("wht_applicable").notNull().default(false),
    whtRate: numeric("wht_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),

    defaultCurrency: text("default_currency").notNull().default("KES"),

    // Credit terms (customers)
    creditLimit: numeric("credit_limit", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),

    // Payment details (suppliers)
    bankName: text("bank_name"),
    bankAccountNumber: text("bank_account_number"),
    bankBranch: text("bank_branch"),
    bankSwiftCode: text("bank_swift_code"),

    isActive: boolean("is_active").notNull().default(true),

    createdById: text("created_by_id"),
    lastModifiedById: text("last_modified_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("parties_company_name_idx").on(t.companyId, t.name),
    index("parties_company_type_active_idx").on(
      t.companyId,
      t.primaryType,
      t.isActive,
    ),
    index("parties_company_email_idx")
      .on(t.companyId, t.email)
      .where(sql`${t.email} IS NOT NULL`),
    index("parties_company_taxpin_idx")
      .on(t.companyId, t.taxPin)
      .where(sql`${t.taxPin} IS NOT NULL`),
    index("parties_company_user_idx")
      .on(t.companyId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    // Mirrors the partial unique index on the Mongo schema: employee numbers
    // are unique per company, but only when actually set. The Mongo version
    // guards with `$type: "string", $gt: ""` — an empty string is not a
    // duplicate of another empty string.
    uniqueIndex("parties_company_employee_number_uq")
      .on(t.companyId, t.employeeNumber)
      .where(sql`${t.employeeNumber} IS NOT NULL AND ${t.employeeNumber} <> ''`),
    check("parties_wht_rate_range", sql`${t.whtRate} BETWEEN 0 AND 20`),
    check("parties_credit_limit_non_negative", sql`${t.creditLimit} >= 0`),
    check("parties_payment_terms_non_negative", sql`${t.paymentTermsDays} >= 0`),
    // The primary type must be one of the roles the party actually holds,
    // otherwise a journal entry could file a party under a role it does not
    // have.
    check(
      "parties_primary_type_matches_role",
      sql`(${t.primaryType} = 'customer' AND ${t.isCustomer})
       OR (${t.primaryType} = 'supplier' AND ${t.isSupplier})
       OR (${t.primaryType} = 'employee' AND ${t.isEmployee})
       OR (${t.primaryType} = 'other')`,
    ),
  ],
);
