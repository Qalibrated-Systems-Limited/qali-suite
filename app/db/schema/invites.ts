import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";

/**
 * Invitations (0044).
 *
 * Company-scoped and under RLS, unlike `users`. A login is a platform-wide
 * identity — one person, one row, whichever companies they hold. An invitation
 * is an act by one company: "we are asking this person to join US". Two
 * companies may invite the same address independently.
 *
 * The token stored is a HASH; the raw value goes in the email. Unique
 * platform-wide rather than per company, because a token is a credential and
 * two rows sharing one would make "which invite is this" ambiguous.
 */
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    email: text("email").notNull(),
    role: text("role").notNull().default("Employee"),
    /** Set for an employee-portal invite; composite FK keeps it in-tenant. */
    partyId: uuid("party_id"),

    token: text("token").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedById: text("accepted_by_id"),

    invitedById: text("invited_by_id").notNull(),
    invitedByName: text("invited_by_name").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invites_token_uq").on(t.token),
    index("invites_company_status_idx").on(t.companyId, t.status),
  ],
);
