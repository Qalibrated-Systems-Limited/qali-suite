import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// WEBHOOK SUBSCRIPTION MODEL
// Stores registered subscriber URLs per company.
// When an ERP event fires, all matching active
// subscriptions receive a signed POST delivery.
// ============================================

const webhookSubscriptionSchema = new Schema(
  {
    // Tenant
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    // Human label — shown in UI
    name: {
      type: String,
      required: [true, "Webhook name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    // Target URL — must be HTTPS in production
    url: {
      type: String,
      required: [true, "Webhook URL is required"],
      trim: true,
      maxlength: [500, "URL cannot exceed 500 characters"],
    },

    // Which events this subscription listens for.
    // ["*"] means all events.
    events: {
      type: [String],
      default: ["*"],
    },

    // HMAC-SHA256 signing secret.
    // Random bytes, stored in plaintext here (unlike API keys,
    // this never leaves the server — we use it to sign outbound payloads).
    // The subscriber uses it to verify deliveries.
    secret: {
      type: String,
      required: true,
    },

    // Circuit breaker — pause delivery after consecutive failures
    failureCount: { type: Number, default: 0 },
    lastFailureAt: { type: Date, default: null },
    // Suspended when failureCount >= 5; auto-resets on first success
    suspended: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true, index: true },

    // Optional: only deliver events from a specific connector
    connectorType: {
      type: String,
      enum: ["weighbridge", "coffee_coop", "logistics", "miller", "generic", null],
      default: null,
    },

    createdBy: {
      id: String,
      name: String,
    },

    notes: {
      type: String,
      maxlength: [300, "Notes cannot exceed 300 characters"],
      default: "",
    },
  },
  {
    timestamps: true,
    collection: "webhookSubscriptions",
  }
);

webhookSubscriptionSchema.index({ companyId: 1, isActive: 1 });
webhookSubscriptionSchema.index({ companyId: 1, events: 1 });

const WebhookSubscription =
  mongoose.models.WebhookSubscription ||
  mongoose.model("WebhookSubscription", webhookSubscriptionSchema);

export default WebhookSubscription;
