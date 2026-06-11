import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// IN-APP NOTIFICATION SCHEMA
// ============================================
// One document per recipient per event — the bell reads "my unread", so
// fan-out happens at write time (a request with 4 eligible approvers
// creates 4 docs). Append-only; the only mutation is stamping readAt.
//
// Self-cleaning: a TTL index expires documents 90 days after creation,
// so the collection never needs a manual sweep.

export const NOTIFICATION_TYPES = [
  "approval_request", // you can approve something
  "approval_decision", // your request was decided
  "system",
];

const notificationSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Recipient.
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, trim: true, maxlength: 500 },

    // Where clicking the notification takes you (app-relative).
    href: { type: String, trim: true },

    // null/absent = unread.
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The bell's two queries: unread count + latest-N for me.
notificationSchema.index({ companyId: 1, userId: 1, readAt: 1, createdAt: -1 });
// Self-expiry after 90 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const Notification =
  mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema);

export default Notification;
