import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

/** Office-only access, office networks and remote-access tokens. See the
 *  staff_away_from_the_office_need_a_remote_access_token migration. */
export const companyNetworkPolicy = pgTable("company_network_policy", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  officeOnly: boolean("office_only").notNull().default(false),
  updatedById: text("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name").notNull().default("System"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companyOfficeNetworks = pgTable(
  "company_office_networks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    network: text("network").notNull(),
    label: text("label").notNull().default(""),
    createdByName: text("created_by_name").notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("company_office_networks_unique_idx").on(t.companyId, t.network)],
);

export const remoteAccessTokens = pgTable(
  "remote_access_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    userName: text("user_name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenHint: text("token_hint").notNull(),
    label: text("label").notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByName: text("revoked_by_name"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastUsedIp: text("last_used_ip"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("remote_access_tokens_hash_idx").on(t.tokenHash),
    index("remote_access_tokens_company_idx").on(t.companyId, t.userId),
  ],
);
