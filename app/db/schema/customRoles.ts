/**
 * Custom roles — 0120.
 *
 * The app's roles were code constants (lib/utils.js `userRoles`) and its
 * permissions were frozen role arrays (lib/utils/role-gates.js). That is the
 * right place for the RULES — a gate that is a constant cannot be edited into
 * an insecure state — but it left no way to ADD a role from the product.
 *
 * A custom role is a company-defined NAME with a canonical BASE role it inherits
 * its authority from. Every permission gate in the app checks a canonical role,
 * so a custom role is resolved to its base at the single session choke point
 * (`resolveRoleForCompany`): assign "Quality Manager" (base Manager) and the
 * bearer is authorised exactly as a Manager everywhere, with a name of the
 * company's choosing. This keeps the ~400 existing gates untouched and safe
 * while making roles editable data.
 *
 * `is_system` marks the two roles this migration seeds for every company
 * (Quality Manager, Technical Manager) — the ones the old QMS/SOP/Compliance
 * gates referenced by name but no user could hold. They can be renamed or
 * deleted like any other.
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

export const customRoles = pgTable(
  "custom_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** The display name, unique per company (case-insensitively). */
    name: text("name").notNull(),
    /**
     * The canonical role this one is authorised as. Enforcement resolves a
     * custom role to this base, so it can never grant more than a base role the
     * code already trusts.
     */
    baseRole: text("base_role").notNull(),
    description: text("description").notNull().default(""),
    /** Seeded by 0120; still editable, just marks provenance. */
    isSystem: boolean("is_system").notNull().default(false),
    /** A role can be switched off without deleting it — 0121. */
    isActive: boolean("is_active").notNull().default(true),
    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name").notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("custom_roles_company_name_uq").on(
      t.companyId,
      sql`lower(${t.name})`,
    ),
    index("custom_roles_company_idx").on(t.companyId),
    check("custom_roles_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    /**
     * The base MUST be one of the canonical roles — the same list the users
     * table constrains. A custom role based on a name that is not a real
     * canonical role would resolve to nothing and lock its bearer out.
     */
    check(
      "custom_roles_base_valid",
      sql`${t.baseRole} IN (
      'SuperAdmin', 'Admin', 'CFO', 'Finance Manager', 'Accountant',
      'Sales Manager', 'Procurement Officer', 'Manager', 'Store Manager',
      'Storekeeper', 'HR Manager', 'Employee', 'Viewer'
    )`,
    ),
  ],
);

/**
 * A permission granted to a role — 0121.
 *
 * Presence of a row means the role holds that permission key. A role with NO
 * rows falls back to the code defaults for its base role; the first edit
 * materialises the whole set, after which these rows are authoritative. Applies
 * to canonical role names and custom role names alike.
 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    roleName: text("role_name").notNull(),
    permissionKey: text("permission_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("role_permissions_uq").on(
      t.companyId,
      sql`lower(${t.roleName})`,
      t.permissionKey,
    ),
    index("role_permissions_role_idx").on(t.companyId, sql`lower(${t.roleName})`),
  ],
);
