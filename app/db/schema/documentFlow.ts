import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";

/**
 * Which document became which (0041).
 *
 * SAP's VBFA, in the small: a predecessor becomes a successor, and either may
 * be any document. NOT a `quote_id` column on invoices — today a quote
 * converts straight to an invoice, but SAP, NetSuite and Odoo all put an ORDER
 * between them and this codebase already has a salesOrder model waiting. A
 * column named quote_id encodes "an invoice comes from a quote", which stops
 * being true the day the order step lands.
 *
 * Header rows carry no quantity ("this invoice came from that quote"). Line
 * rows carry the quantity that flowed, which is what makes partial conversion
 * answerable — and what `quote_line_invoiced` sums, recursively, so it keeps
 * working when the chain grows a step.
 */
export const documentFlow = pgTable(
  "document_flow",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    predecessorType: text("predecessor_type").notNull(),
    predecessorId: uuid("predecessor_id").notNull(),
    successorType: text("successor_type").notNull(),
    successorId: uuid("successor_id").notNull(),

    /** Null on a header link; set on a line link. */
    quantity: numeric("quantity", { precision: 19, scale: 4, mode: "string" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdById: text("created_by_id"),
  },
  (t) => [
    uniqueIndex("document_flow_pair_uq").on(t.predecessorId, t.successorId),
    index("document_flow_predecessor_idx").on(
      t.companyId,
      t.predecessorType,
      t.predecessorId,
    ),
    index("document_flow_successor_idx").on(
      t.companyId,
      t.successorType,
      t.successorId,
    ),
  ],
);
