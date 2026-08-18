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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { accountTypeEnum } from "./enums";

/**
 * Chart of accounts.
 *
 * Two deliberate departures from app/models/account.js:
 *
 * 1. `currentBalance` / `balanceUpdatedAt` are GONE. The Mongo version keeps a
 *    cached balance refreshed by a fire-and-forget promise
 *    (`updateAccountBalances().catch(console.error)`), so a failed refresh
 *    silently desynchronises the cache from the ledger. The balance is now
 *    derived — see the account_balances view in
 *    app/db/migrations/0002_account_balances_view.sql.
 *
 * 2. `ancestors[]` + `path` collapse to `parentId` + an ltree `path`. Postgres
 *    walks the hierarchy natively; we no longer maintain a denormalised
 *    ancestor array on every write.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    accountCode: text("account_code").notNull(),
    accountName: text("account_name").notNull(),
    accountType: accountTypeEnum("account_type").notNull(),
    subType: text("sub_type"),

    // Self-FK. Typed as AnyPgColumn to allow the circular reference.
    parentId: uuid("parent_id").references((): AnyPgColumn => accounts.id, {
      onDelete: "restrict",
    }),
    // ltree — see migration 0001 for the column type + GiST index.
    path: text("path"),
    level: integer("level").notNull().default(0),

    // Header accounts (canPost = false) are structural only.
    canPost: boolean("can_post").notNull().default(true),
    // System accounts (accounts_receivable, bank_main, ...) cannot be deleted;
    // enforced by a trigger in migration 0001 rather than a pre-remove hook.
    systemAccount: text("system_account"),

    currency: text("currency").notNull().default("KES"),
    isActive: boolean("is_active").notNull().default(true),
    description: text("description"),

    taxable: boolean("taxable").notNull().default(false),
    defaultTaxRate: numeric("default_tax_rate", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("0"),

    // Bank detail fields, flattened from the embedded bankDetails object.
    bankName: text("bank_name"),
    bankAccountNumber: text("bank_account_number"),
    bankBranch: text("bank_branch"),
    bankSwiftCode: text("bank_swift_code"),

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
    uniqueIndex("accounts_company_code_uq").on(t.companyId, t.accountCode),
    // Partial unique: one account per system role per company, but many NULLs.
    // Mirrors the partialFilterExpression index on the Mongo schema.
    uniqueIndex("accounts_company_system_uq")
      .on(t.companyId, t.systemAccount)
      .where(sql`${t.systemAccount} IS NOT NULL`),
    index("accounts_company_type_active_idx").on(
      t.companyId,
      t.accountType,
      t.isActive,
    ),
    index("accounts_company_postable_idx")
      .on(t.companyId, t.canPost)
      .where(sql`${t.isActive} = true`),
    index("accounts_parent_idx").on(t.parentId),
    check("accounts_level_range", sql`${t.level} BETWEEN 0 AND 5`),
    check(
      "accounts_tax_rate_range",
      sql`${t.defaultTaxRate} BETWEEN 0 AND 100`,
    ),
  ],
);

/**
 * Normal balance side is a pure function of account type, so it stays derived
 * rather than becoming a column — same as the Mongo virtual.
 */
export function normalBalanceSide(
  accountType: (typeof accountTypeEnum.enumValues)[number],
): "debit" | "credit" {
  return accountType === "asset" || accountType === "expense"
    ? "debit"
    : "credit";
}
