import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";

/**
 * What happened to a document we emailed (0041).
 *
 * ONE ROW PER ATTEMPT, and generic over the document type. The source kept
 * sentTo, deliveredAt, deliveryAttempts and lastDeliveryError as columns on the
 * quote — four fields describing something that is not the quote, each
 * overwritten by the next send, so "what happened on the second attempt" had no
 * answer. SAP's output management, NetSuite's communication log and Odoo's
 * mail.message all keep a row per attempt instead.
 *
 * Everything the source stored is derived from these rows: attempts is a count,
 * the last error is the newest failed row, delivered_at is the newest delivered
 * one.
 *
 * `documentId` is deliberately not a foreign key — this table serves quotes,
 * invoices, bills, credit notes, purchase orders and statements, and a nullable
 * FK per type plus a CHECK keeping exactly one populated buys nothing over an
 * index on the pair.
 */
export const documentDeliveries = pgTable(
  "document_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    documentType: text("document_type").notNull(),
    documentId: uuid("document_id").notNull(),

    recipient: text("recipient").notNull(),
    status: text("status").notNull(),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    attemptedById: text("attempted_by_id"),
    attemptedByName: text("attempted_by_name"),
  },
  (t) => [
    index("document_deliveries_document_idx").on(
      t.companyId,
      t.documentType,
      t.documentId,
      t.attemptedAt,
    ),
  ],
);
