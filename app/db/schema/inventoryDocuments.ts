import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies";

/** Documents attached to inventory records. See inventory_records_carry_attached_documents. */
export const inventoryDocuments = pgTable(
  "inventory_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    category: text("category").notNull().default("other"),
    name: text("name").notNull(),
    url: text("url").notNull(),
    publicId: text("public_id"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    note: text("note").notNull().default(""),
    uploadedById: text("uploaded_by_id"),
    uploadedByName: text("uploaded_by_name").notNull().default("System"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_documents_entity_idx").on(t.companyId, t.entityType, t.entityId, t.uploadedAt)],
);
