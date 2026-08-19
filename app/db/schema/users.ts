import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";

/**
 * A login (0036).
 *
 * The table 0031 said did not exist yet, which is why 47 actor columns are
 * bare text with a name snapshot.
 *
 * ITS ID IS TEXT. Every actor column and user_company_access.user_id already
 * hold the id this platform has always used for a person; a uuid key here
 * would mean rewriting all of them and carrying a second id map forever. New
 * users get a uuid — as text.
 *
 * PLATFORM-LEVEL. A user may operate in several companies (0033), so a
 * company_id here would contradict the grants. `homeCompanyId` is what Mongo
 * calls User.companyId, and is also the grant marked 'primary'.
 *
 * No password column: moving credentials is a deliberate cutover of its own,
 * and a column nothing enforces reads like a control and is not one.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull().default("Employee"),
    status: text("status").notNull().default("active"),
    department: text("department"),
    avatar: text("avatar"),
    authProvider: text("auth_provider").notNull().default("credentials"),
    /** Null for platform staff, who belong to no company. */
    homeCompanyId: uuid("home_company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    /** Bumped when a privilege or credential changes, to reject issued JWTs. */
    tokenVersion: integer("token_version").notNull().default(0),
    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
    index("users_home_company_idx").on(t.homeCompanyId),
    check("users_status_valid", sql`${t.status} IN ('active', 'inactive')`),
    /**
     * Mirrors `userRoles` in app/models/user.js. Duplicated on purpose: the
     * constraint belongs where the data is, and a role added to one list and
     * not the other fails at the INSERT rather than silently at every
     * permission check — which is the right way round.
     */
    check(
      "users_role_valid",
      sql`${t.role} IN (
      'SuperAdmin', 'Admin', 'CFO', 'Finance Manager', 'Accountant',
      'Sales Manager', 'Procurement Officer', 'Manager', 'Store Manager',
      'Storekeeper', 'HR Manager', 'Employee', 'Viewer'
    )`,
    ),
    check(
      "users_auth_provider_valid",
      sql`${t.authProvider} IN ('credentials', 'google')`,
    ),
    check("users_email_present", sql`length(btrim(${t.email})) > 0`),
  ],
);
