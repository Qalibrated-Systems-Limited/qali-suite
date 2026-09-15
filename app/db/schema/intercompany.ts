/**
 * Inter-Company — 0113.
 *
 * Sister-company contracts (management fees, shared services, royalties) and the
 * transactions that settle them — replacing the dummy Inter-Company page with
 * two real, company-scoped, RLS'd tables.
 *
 *   intercompany_contracts     — one agreement with a sister company: its value,
 *                                the fee owed, and the minimum required.
 *   intercompany_transactions  — the invoices/collections against a contract,
 *                                cascading from it.
 *
 * "Collected", "outstanding" and the settled/partial/outstanding status are
 * DERIVED from the transactions at read time, never stored — so a contract's
 * balance is always the sum of what actually moved against it.
 *
 * sister_company_party_id is a soft link into CRM parties (no FK): a sister
 * company may or may not be modelled as a party.
 */
import {
  pgTable,
  uuid,
  text,
  date,
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

export const intercompanyContracts = pgTable(
  "intercompany_contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    /** IC-00001, from next_entry_number. */
    contractNumber: text("contract_number").notNull(),
    sisterCompany: text("sister_company").notNull(),
    sisterCompanyPartyId: text("sister_company_party_id"),
    contractType: text("contract_type").notNull().default("mgmt_fee"),
    contractValue: doublePrecision("contract_value").notNull().default(0),
    /** The fee owed under the contract — what "collected" is measured against. */
    fee: doublePrecision("fee").notNull().default(0),
    minRequired: doublePrecision("min_required").notNull().default(0),
    currency: text("currency").notNull().default("KES"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    isActive: text("is_active").notNull().default("active"),
    notes: text("notes").notNull().default(""),
    ...audit,
  },
  (t) => [
    uniqueIndex("intercompany_contracts_company_number_idx").on(t.companyId, t.contractNumber),
    index("intercompany_contracts_sister_idx").on(t.companyId, t.sisterCompany),
    check("intercompany_contracts_sister_not_blank", sql`length(btrim(${t.sisterCompany})) > 0`),
    check(
      "intercompany_contracts_type_valid",
      sql`${t.contractType} IN ('mgmt_fee','shared_services','royalty','license','loan','other')`,
    ),
  ],
);

export const intercompanyTransactions = pgTable(
  "intercompany_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    contractId: uuid("contract_id").notNull().references(() => intercompanyContracts.id, { onDelete: "cascade" }),
    txnDate: date("txn_date").notNull(),
    transactionType: text("transaction_type").notNull().default(""),
    amount: doublePrecision("amount").notNull().default(0),
    status: text("status").notNull().default("invoiced"),
    reference: text("reference").notNull().default(""),
    notes: text("notes").notNull().default(""),
    ...audit,
  },
  (t) => [
    index("intercompany_txn_contract_idx").on(t.contractId, t.txnDate),
    index("intercompany_txn_company_idx").on(t.companyId, t.status),
    check(
      "intercompany_txn_status_valid",
      sql`${t.status} IN ('invoiced','collected','overdue','written_off')`,
    ),
  ],
);
