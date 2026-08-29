import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { users } from "./users";
import { notificationTypeEnum } from "./enums";

/**
 * The in-app bell — one row per recipient per event.
 *
 * WHY IT MOVED. Reported from the running app: every dashboard render logged
 * "No legacy Mongo id for company <uuid>" from `notification-queries.js`. The
 * bell read the Mongo `Notification` collection and scoped it by translating
 * the company uuid back to an ObjectId, and a company created AFTER the
 * migration has no ObjectId to translate to. `cMyNotifications` swallows its
 * own errors, so the bell rendered empty and the layout kept going — the
 * failure was a log line, not a crash, which is why it survived.
 *
 * It would have been broken for older tenants too, one step further along:
 * `userId` is matched with `ObjectId.isValid`, and users are Postgres now.
 *
 * FAN-OUT AT WRITE TIME, as in Mongo. A request with four eligible approvers
 * writes four rows. The bell's query is "my unread", and denormalising at write
 * keeps that a single index scan rather than a join against a recipients list.
 *
 * APPEND-ONLY. The only mutation is stamping `read_at`.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    /**
     * The recipient. `text`, because `users.id` is text — these ids come from
     * a system that predates the migration and are not uuids.
     *
     * ON DELETE CASCADE: a notification addressed to a deleted login is not
     * history worth keeping, it is unreachable. Unlike a ledger row, nothing
     * reconciles against it.
     */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    type: notificationTypeEnum("type").notNull(),

    title: text("title").notNull(),
    body: text("body"),
    /** Where clicking it goes. App-relative — see the check below. */
    href: text("href"),

    /** NULL means unread. The column IS the read flag; there is no boolean. */
    readAt: timestamp("read_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * The bell's only query: my latest N, and my unread count. Both are served
     * by this one index in the order it declares.
     */
    index("notifications_company_user_idx").on(
      t.companyId,
      t.userId,
      t.createdAt.desc(),
    ),
    /**
     * The unread count, which runs on EVERY dashboard render. Partial, so it
     * scans only what is actually unread — the read archive grows without
     * limit and is never the answer to "how many unread".
     */
    index("notifications_unread_idx")
      .on(t.companyId, t.userId)
      .where(sql`${t.readAt} IS NULL`),
    /**
     * The 90-day sweep (see `deleteOlderThan`). Mongo expired these with a TTL
     * index; Postgres has no such thing, so the sweep is a cron and this is
     * what keeps it cheap.
     */
    index("notifications_created_idx").on(t.createdAt),

    // Mongo enforced these with maxlength. They are the same limits, stated
    // where every writer meets them rather than in one Mongoose schema that
    // only Mongoose callers pass through.
    check("notifications_title_length", sql`length(${t.title}) BETWEEN 1 AND 200`),
    check("notifications_body_length", sql`${t.body} IS NULL OR length(${t.body}) <= 500`),
    /**
     * An app-relative path, or nothing.
     *
     * NOT in the Mongo schema, and added deliberately: `href` is written into a
     * link the recipient clicks, and every writer today hardcodes
     * "/dashboard/approvals". Refusing an absolute URL at the column means a
     * future writer cannot turn the bell into an open redirect by accident.
     */
    check(
      "notifications_href_is_relative",
      sql`${t.href} IS NULL OR ${t.href} ~ '^/[^/]'`,
    ),
  ],
);
