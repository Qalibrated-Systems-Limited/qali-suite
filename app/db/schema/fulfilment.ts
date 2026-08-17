import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { parties } from "./parties";
import { products } from "./products";

/**
 * Fulfilment sources referenced by invoice lines (see fulfilmentSourceEnum).
 *
 * These are intentionally MINIMAL for this slice — enough to carry the foreign
 * keys that make §8.1's CHECK constraint meaningful, and no more. The full
 * StockRequest (563 lines), ItemCheckout (384) and WeighbridgeTicket (193)
 * models port in their own right later; what matters now is that an invoice
 * line naming a stock request cannot name one that does not exist.
 *
 * Each carries the (id, company_id) unique key so invoice lines can reference
 * them with a composite FK, keeping the tenant boundary inside referential
 * integrity rather than in application code.
 */

export const stockRequests = pgTable(
  "stock_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    requestNumber: text("request_number").notNull(),
    /** The technician the stock was issued to. */
    technicianId: uuid("technician_id").references(() => parties.id, {
      onDelete: "restrict",
    }),
    status: text("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_requests_company_number_uq").on(
      t.companyId,
      t.requestNumber,
    ),
    uniqueIndex("stock_requests_id_company_uq").on(t.id, t.companyId),
    index("stock_requests_company_technician_idx").on(
      t.companyId,
      t.technicianId,
    ),
  ],
);

export const itemCheckouts = pgTable(
  "item_checkouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    checkoutNumber: text("checkout_number").notNull(),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "restrict",
    }),
    status: text("status").notNull().default("open"),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("item_checkouts_company_number_uq").on(
      t.companyId,
      t.checkoutNumber,
    ),
    uniqueIndex("item_checkouts_id_company_uq").on(t.id, t.companyId),
  ],
);

export const weighbridgeTickets = pgTable(
  "weighbridge_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ticketNumber: text("ticket_number").notNull(),
    transactionType: text("transaction_type").notNull(),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "restrict",
    }),
    /**
     * The weighed quantity. This — not the invoiced quantity — is what COGS is
     * costed on when the bridge posts first. §8.3 records why the two can
     * differ and why that difference must be recorded rather than warned about.
     */
    netWeight: numeric("net_weight", { precision: 19, scale: 4 }),
    weightUnit: text("weight_unit").notNull().default("kg"),
    vehicleReg: text("vehicle_reg"),
    ticketDate: date("ticket_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("weighbridge_tickets_company_number_uq").on(
      t.companyId,
      t.ticketNumber,
    ),
    uniqueIndex("weighbridge_tickets_id_company_uq").on(t.id, t.companyId),
  ],
);
