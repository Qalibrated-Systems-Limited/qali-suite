/**
 * Project documents — 0126.
 *
 * The files a project carries: the signed contract, the BOQ as issued, the
 * approved budget, drawings, certificates, correspondence. Uploaded through the
 * existing /api/upload → Cloudinary path; only the metadata and the returned
 * URL/publicId live here. Tenant-scoped like everything else.
 *
 * `category` files a document so the contract screen can show contracts, the
 * BOQ screen the bills, and so on — while a single Documents panel lists them
 * all. It is free-ish text with a CHECK of the known kinds, so a new kind is a
 * one-line migration, not a schema redesign.
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { users } from "./users";
import { projects } from "./projects";

export const projectDocuments = pgTable(
  "project_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    category: text("category").notNull().default("other"),
    title: text("title").notNull().default(""),
    fileUrl: text("file_url").notNull(),
    fileName: text("file_name").notNull().default(""),
    mimeType: text("mime_type").notNull().default(""),
    sizeBytes: integer("size_bytes").notNull().default(0),
    /** Cloudinary identifiers — needed to sign PDF URLs and to delete. */
    publicId: text("public_id"),
    resourceType: text("resource_type"),
    uploadedById: text("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    uploadedByName: text("uploaded_by_name").notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("project_documents_company_project_idx").on(
      t.companyId,
      t.projectId,
    ),
    index("project_documents_company_category_idx").on(
      t.companyId,
      t.category,
    ),
    check("project_documents_url_not_blank", sql`length(btrim(${t.fileUrl})) > 0`),
    check(
      "project_documents_category_valid",
      sql`${t.category} IN ('contract','boq','budget','drawing','certificate','variation','correspondence','permit','insurance','other')`,
    ),
  ],
);
