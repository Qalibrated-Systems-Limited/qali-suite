/**
 * Licensing — 0108.
 *
 * Ported from the Lante ERP License microservice
 * (packages/microservices/licensing) into QaliSuite's Postgres/Drizzle stack —
 * the same kind of port as Help Desk (0104, from Ticketing) and HSE (0105).
 *
 * The .NET service issues, validates, revokes and renews ES256-signed JWT
 * license keys for the Qalibrated Systems product line (QaliTrack frontend,
 * mobile and kiosk). This brings across that spine:
 *
 *   - `licenses`           — the issued keys. The signed JWT string IS the key
 *                            given to the customer (stored in `token`); the row
 *                            is the server-side record used to validate,
 *                            revoke, renew and audit it.
 *   - `license_audit_logs` — an append-only field-level trail, the same idea as
 *                            the .NET LicenseAuditLog interceptor: who did what
 *                            to which license and when.
 *
 * Everything is company-scoped, RLS'd and granted exactly the way `helpdesk_*`
 * and the HSE tables are — the ISSUING tenant (a Qalibrated reseller/operator)
 * owns the license records; the `customerId`/`customerName` name the external
 * license holder, which is NOT a tenant of this ERP.
 *
 * App ids, feature flags, statuses and revoke reasons are text + CHECK, not pg
 * enums, for the same reason the help-desk vocabularies are: the catalogues are
 * small, grow over time, and a CHECK is cheaper to evolve than an enum. The
 * canonical catalogues live in lib/licensing/features.js so the client apps and
 * the issue form share one source of truth.
 */
import {
  pgTable,
  uuid,
  text,
  boolean,
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

// ── Licenses ─────────────────────────────────────────────────────────────────
export const licenses = pgTable(
  "licenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    /** LIC-00001, from next_entry_number — a human-friendly handle for the UI. */
    licenseNumber: text("license_number").notNull(),
    /** The full ES256 JWT — this IS the license key handed to the customer. */
    token: text("token").notNull(),
    /** External customer identifier (from CRM); NOT a tenant of this ERP. */
    customerId: text("customer_id").notNull(),
    customerName: text("customer_name").notNull().default(""),
    /** Which product this licenses — must match the client app's THIS_APP_ID. */
    appId: text("app_id").notNull(),
    /** Comma-separated feature flags, e.g. "kiosk,reports". */
    features: text("features").notNull().default(""),
    /** Optional hardware binding. Null = not bound to a machine. */
    machineId: text("machine_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revoked: boolean("revoked").notNull().default(false),
    revokeReason: text("revoke_reason"),
    /** Last time a client app checked in with the server (validate). */
    lastSeen: timestamp("last_seen", { withTimezone: true }),
    lastMachineId: text("last_machine_id"),
    notes: text("notes"),
    ...audit,
  },
  (t) => [
    // The token is the key; it must be unique so validation resolves exactly one
    // record. Scoped per-company because RLS already partitions the table and a
    // JWT is unique by construction anyway.
    uniqueIndex("licenses_token_idx").on(t.token),
    uniqueIndex("licenses_company_number_idx").on(t.companyId, t.licenseNumber),
    index("licenses_customer_idx").on(t.companyId, t.customerId),
    index("licenses_app_idx").on(t.companyId, t.appId),
    index("licenses_expiry_idx").on(t.companyId, t.expiresAt),
    check("licenses_customer_not_blank", sql`length(btrim(${t.customerId})) > 0`),
    check("licenses_app_not_blank", sql`length(btrim(${t.appId})) > 0`),
  ],
);

// ── Audit log (append-only) ──────────────────────────────────────────────────
// Same shape as the .NET LicenseAuditLog: entity/entityId/action/actor/details.
// One row per lifecycle event (issued, validated, revoked, renewed), written by
// the repository alongside the mutation it records.
export const licenseAuditLogs = pgTable(
  "license_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    licenseId: uuid("license_id").references(() => licenses.id, { onDelete: "set null" }),
    entity: text("entity").notNull().default("License"),
    entityId: text("entity_id").notNull().default(""),
    action: text("action").notNull(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull().default("System"),
    details: text("details"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("license_audit_license_idx").on(t.licenseId, t.at),
    index("license_audit_company_idx").on(t.companyId, t.at),
  ],
);
