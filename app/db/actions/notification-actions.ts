"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { getTenantContextSafe } from "@/lib/utils/tenant-utils";
import * as notifications from "../repositories/notifications";

/**
 * The notification bell.
 *
 * WHAT THIS REPLACES. `app/mongodb/queries/notification-queries.js` and
 * `app/mongodb/actions/notification-actions.js`. The read was reported from the
 * running app, logging on every dashboard render:
 *
 *   No legacy Mongo id for company 4d6ab761-… _migration_id_map has no
 *   'companies' row for this uuid
 *
 * It scoped the bell by translating the active company's uuid BACK to an
 * ObjectId; a company created after the migration has no ObjectId to translate
 * to. Because `cMyNotifications` catches its own errors, the layout kept
 * rendering and the bell was simply always empty — a log line rather than a
 * crash, which is why it lasted.
 *
 * For older tenants it would have failed one step later regardless: the query
 * gates on `ObjectId.isValid(userId)`, and users moved in 0036.
 *
 * NO `cache()` WRAPPER HERE. The Mongo query was wrapped in React `cache()`
 * because the layout called it on every render. `withAuthorizedTenant` opens a
 * transaction, and caching a transaction-scoped read across a request is how
 * you serve one company's rows inside another's after a company switch. The
 * layout calls this once; that is the right place for the deduplication.
 */

/** Roles: none. Everyone has a bell, and it shows only their own rows. */
const ANY_SIGNED_IN: string[] = [];

export async function getMyNotifications(limit = 12) {
  /**
   * NO SESSION IS NOT AN ERROR HERE, and this is the whole reason the Mongo
   * version used `getTenantContextSafe` — its comment said "layout must render
   * even mid-logout".
   *
   * `app/dashboard/layout.js` guards with `user && user.role !== "SuperAdmin"
   * && !user.companyId`, which short-circuits on `user &&`: when there is NO
   * user at all the guard is false and the layout falls through to here. So a
   * signed-out render reaches the bell, `withAuthorizedTenant` throws
   * "Unauthorized: No session", and every such render logged an error that
   * described normal behaviour.
   *
   * Reported after the 0074 port, and made more frequent by the role-refresh
   * added to auth.ts the same day — clearing a stale session is precisely the
   * moment a render happens without one.
   */
  const ctx = await getTenantContextSafe();
  if (!ctx?.user?.id) return { items: [], unread: 0 };

  try {
    return await withAuthorizedTenant(ANY_SIGNED_IN, (tx, { user }) =>
      notifications.listForUser(tx, user.id, limit),
    );
  } catch (err) {
    // Anything else IS worth knowing about, but not worth taking the dashboard
    // down for: the layout wraps every page, so a bell that throws is a blank
    // app.
    console.error("[getMyNotifications]", err);
    return { items: [], unread: 0 };
  }
}

export async function markNotificationRead(notificationId: string) {
  if (!notificationId) return { ok: false };

  try {
    const changed = await withAuthorizedTenant(ANY_SIGNED_IN, (tx, { user }) =>
      // The recipient is in the WHERE, not just the company — RLS scopes this
      // to the tenant, which is not the same as scoping it to the reader.
      notifications.markRead(tx, user.id, notificationId),
    );
    revalidatePath("/dashboard");
    return { ok: changed };
  } catch (err) {
    console.error("[markNotificationRead]", err);
    return { ok: false };
  }
}

export async function markAllNotificationsRead() {
  try {
    const count = await withAuthorizedTenant(ANY_SIGNED_IN, (tx, { user }) =>
      notifications.markAllRead(tx, user.id),
    );
    revalidatePath("/dashboard");
    return { ok: true, count };
  } catch (err) {
    console.error("[markAllNotificationsRead]", err);
    return { ok: false, count: 0 };
  }
}
