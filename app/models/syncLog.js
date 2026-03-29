import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// SYNC LOG MODEL
// Append-only audit trail of every exchange
// between the ERP and external systems.
// Inbound: external → ERP
// Outbound: ERP → webhook subscriber
// ============================================

const syncLogSchema = new Schema(
  {
    // Tenant
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    // Which API key / webhook subscription triggered this
    integrationKeyId: {
      type: Schema.Types.ObjectId,
      ref: "IntegrationKey",
      default: null,
    },
    webhookSubscriptionId: {
      type: Schema.Types.ObjectId,
      default: null,
    },

    // Direction of data flow
    direction: {
      type: String,
      enum: ["inbound", "outbound"],
      required: true,
      index: true,
    },

    // What event / endpoint this relates to
    event: {
      type: String,
      required: true,
      // e.g. "weighbridge.ticket_completed", "invoice.paid"
    },

    // The connector that processed this (inbound only)
    connectorType: {
      type: String,
      enum: ["weighbridge", "coffee_coop", "logistics", "miller", "generic", null],
      default: null,
    },

    // External system's unique ID for this event (idempotency key)
    externalRef: {
      type: String,
      default: null,
      index: true,
    },

    // The ERP record created / updated as a result
    internalRef: {
      type: String,
      default: null,
      // e.g. "REC-000789", "INV-000456"
    },
    internalId: {
      type: Schema.Types.ObjectId,
      default: null,
    },

    // The data exchanged
    rawPayload: {
      type: Schema.Types.Mixed,
      default: null,
    },
    mappedPayload: {
      type: Schema.Types.Mixed,
      default: null,
    },
    result: {
      type: Schema.Types.Mixed,
      default: null,
    },

    // Processing outcome
    status: {
      type: String,
      enum: ["received", "processing", "processed", "failed", "skipped", "retrying"],
      default: "received",
      index: true,
    },
    error: {
      type: String,
      default: null,
    },

    // Retry tracking (outbound webhooks)
    attempts: { type: Number, default: 0 },
    nextRetryAt: { type: Date, default: null },
    lastAttemptAt: { type: Date, default: null },

    // HTTP details (outbound webhook delivery)
    httpStatus: { type: Number, default: null },
    responseBody: { type: String, default: null },
    webhookUrl: { type: String, default: null },

    // Request metadata (inbound)
    requestIp: { type: String, default: null },
    requestId: { type: String, default: null },

    processedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "syncLogs",
  }
);

// ── Indexes ───────────────────────────────────────
syncLogSchema.index({ companyId: 1, status: 1, createdAt: -1 });
syncLogSchema.index({ companyId: 1, externalRef: 1 });
syncLogSchema.index({ companyId: 1, internalRef: 1 });
syncLogSchema.index({ companyId: 1, direction: 1, createdAt: -1 });
syncLogSchema.index({ companyId: 1, integrationKeyId: 1, createdAt: -1 });
syncLogSchema.index({ nextRetryAt: 1, status: 1 }); // for retry worker

const SyncLog =
  mongoose.models.SyncLog ||
  mongoose.model("SyncLog", syncLogSchema);

export default SyncLog;
