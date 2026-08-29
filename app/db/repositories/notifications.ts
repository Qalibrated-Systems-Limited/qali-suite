import { sql } from "drizzle-orm";
import type { Tx } from "../client";

/**
 * The in-app bell.
 *
 * Two of these run on EVERY dashboard render, so the shapes here are chosen for
 * that: one round trip, capped, and served by the partial unread index.
 *
 * No company filter appears below. RLS supplies it (0074).
 */

export type NotificationType =
  | "approval_request"
  | "approval_decision"
  | "system";

export interface NotificationRow {
  _id: string;
  type: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string | null;
}

export interface NewNotification {
  companyId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  href?: string | null;
}

/**
 * My latest N, and my unread count, in ONE query.
 *
 * Mongo issued a `find` and a `countDocuments` in parallel. Parallel is not
 * free here — they are two round trips on the same connection inside one
 * request, and the count is over a set the first query has already narrowed to
 * one user. A window aggregate gives both from one scan, and it cannot report a
 * count for a different set than the rows beside it.
 *
 * The count is of ALL my unread, not of the unread within the page — the badge
 * says "3 unread" while the list shows twelve items, and those are different
 * questions.
 */
export async function listForUser(
  tx: Tx,
  userId: string,
  limit = 12,
): Promise<{ items: NotificationRow[]; unread: number }> {
  const capped = Math.min(Math.max(limit, 1), 50);

  const rows = (await tx.execute(sql`
    WITH mine AS (
      SELECT id, type, title, body, href, read_at, created_at
        FROM notifications
       WHERE user_id = ${String(userId)}
    )
    SELECT m.*, (SELECT COUNT(*)::int FROM mine WHERE read_at IS NULL) AS unread
      FROM mine m
     ORDER BY m.created_at DESC
     LIMIT ${capped}
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    items: rows.map((r) => ({
      _id: String(r.id),
      type: String(r.type),
      title: String(r.title),
      body: (r.body as string) ?? "",
      href: (r.href as string) ?? "",
      read: r.read_at != null,
      createdAt: r.created_at ? new Date(r.created_at as string).toISOString() : null,
    })),
    // An empty page still has to report the count. With no rows the subquery
    // never runs, and the answer is necessarily zero.
    unread: rows.length ? Number(rows[0].unread ?? 0) : 0,
  };
}

/**
 * Stamps one notification read, for one reader.
 *
 * `user_id` is in the WHERE, not just the id. RLS scopes this to the company,
 * which is not the same as scoping it to the recipient — without the second
 * condition any colleague could mark another's bell read by id.
 *
 * Already-read rows are left alone rather than re-stamped, so `read_at` keeps
 * meaning "when they first saw it".
 */
export async function markRead(tx: Tx, userId: string, id: string) {
  const rows = (await tx.execute(sql`
    UPDATE notifications
       SET read_at = now()
     WHERE id = ${id}::uuid
       AND user_id = ${String(userId)}
       AND read_at IS NULL
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

/** Stamps every unread notification of one reader. Returns how many. */
export async function markAllRead(tx: Tx, userId: string) {
  const rows = (await tx.execute(sql`
    UPDATE notifications
       SET read_at = now()
     WHERE user_id = ${String(userId)}
       AND read_at IS NULL
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows.length;
}

/**
 * Fan-out at write time: one row per recipient.
 *
 * A single multi-row INSERT rather than a loop — a request with four eligible
 * approvers is one statement. Mongo used `insertMany({ ordered: false })`,
 * whose point was that one bad document does not stop the rest; here the CHECK
 * constraints are the only way a row can be bad, and a writer producing a
 * 300-character title should hear about it rather than silently notify three
 * people out of four.
 */
export async function createMany(tx: Tx, rows: readonly NewNotification[]) {
  if (rows.length === 0) return 0;

  const values = rows.map(
    (n) => sql`(
      ${n.companyId}::uuid,
      ${String(n.userId)},
      ${n.type}::notification_type,
      ${n.title},
      ${n.body ?? null},
      ${n.href ?? null}
    )`,
  );

  const inserted = (await tx.execute(sql`
    INSERT INTO notifications (company_id, user_id, type, title, body, href)
    VALUES ${sql.join(values, sql`, `)}
    RETURNING id
  `)) as unknown as Array<{ id: string }>;

  return inserted.length;
}

/**
 * The 90-day sweep.
 *
 * Mongo self-cleaned with a TTL index. Postgres has none, so this is a cron
 * (/api/cron/prune-notifications) — the property is kept rather than quietly
 * dropped, which is what porting the table alone would have done.
 *
 * Deliberately NOT RLS-scoped in the caller's usual sense: the sweep runs for
 * the whole platform. See the route for how that is granted.
 */
export async function deleteOlderThan(tx: Tx, days = 90) {
  const rows = (await tx.execute(sql`
    DELETE FROM notifications
     WHERE created_at < now() - make_interval(days => ${Math.max(days, 1)})
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows.length;
}
