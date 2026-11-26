import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

/** A device a person turned push notifications on for. See people_get_notifications_on_their_devices. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    failures: integer("failures").notNull().default(0),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint), index("push_subscriptions_user_idx").on(t.userId)],
);
