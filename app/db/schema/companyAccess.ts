import { pgTable, uuid, text, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";

/**
 * Which companies a user may operate in (0033).
 *
 * Authorisation is a SET; operating context is ONE of it. RLS stays scoped to
 * the active company — see the migration for why widening it would blend
 * ledgers.
 *
 * Its policy keys on app.user_id rather than app.company_id, because "which
 * companies may I enter" is asked before a company is chosen.
 */
export const userCompanyAccess = pgTable(
  "user_company_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Text: there is no users table to reference yet (0031). */
    userId: text("user_id").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Null means "use the user's global role". */
    role: text("role"),
    /**
     * In THIS company, this login is that person (0036).
     *
     * On the grant rather than on `users`, because a party is company-scoped:
     * someone who is an employee of A and a supplier to B has two party rows,
     * and a single users.party_id would force one party for every company.
     * Null and staying null for logins that are not a party to any books —
     * platform staff, and admins with no employee record.
     */
    partyId: uuid("party_id"),
    status: text("status").notNull().default("active"),
    grantedVia: text("granted_via").notNull().default("manual"),
    grantedById: text("granted_by_id"),
    grantedByName: text("granted_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_company_access_user_company_uq").on(t.userId, t.companyId),
    uniqueIndex("user_company_access_party_uq")
      .on(t.companyId, t.partyId)
      .where(sql`${t.partyId} IS NOT NULL`),
    index("user_company_access_company_idx").on(t.companyId),
    check("user_company_access_status_valid", sql`${t.status} IN ('active', 'suspended')`),
    /** Null is allowed and means "use the user's global role" (0038). */
    check(
      "user_company_access_role_valid",
      sql`${t.role} IS NULL OR ${t.role} IN (
      'SuperAdmin', 'Admin', 'CFO', 'Finance Manager', 'Accountant',
      'Sales Manager', 'Procurement Officer', 'Manager', 'Store Manager',
      'Storekeeper', 'HR Manager', 'Employee', 'Viewer'
    )`,
    ),
    check(
      "user_company_access_granted_via_valid",
      sql`${t.grantedVia} IN ('primary', 'superadmin', 'invite', 'manual')`,
    ),
  ],
);
