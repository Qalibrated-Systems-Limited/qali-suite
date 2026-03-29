import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// INTEGRATION KEY MODEL
// API keys issued to external systems (weighbridges,
// collection apps, logistics TMS, etc.)
// Keys are stored hashed — plaintext shown only once.
// ============================================

const integrationKeySchema = new Schema(
  {
    // Tenant
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Human-readable name for this key
    name: {
      type: String,
      required: [true, "Key name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    // The hashed key (SHA-256 of plaintext). Never stored in plaintext.
    keyHash: {
      type: String,
      required: true,
      index: true,
    },

    // Last 4 chars of the plaintext key — for display/identification only
    keyPreview: {
      type: String,
      required: true,
      length: 4,
    },

    // Key prefix shown in UI: e.g. "qls_live_k_abc...xxxx"
    keyPrefix: {
      type: String,
      required: true,
    },

    // Which connector adapter this key routes to
    connectorType: {
      type: String,
      enum: ["weighbridge", "coffee_coop", "logistics", "miller", "generic"],
      required: [true, "Connector type is required"],
    },

    // What this key is permitted to do
    scopes: {
      type: [String],
      enum: [
        "inventory:read",
        "inventory:write",
        "contacts:read",
        "contacts:write",
        "orders:read",
        "orders:write",
        "invoices:read",
        "invoices:write",
        "hr:read",
        "collection:write",
        "webhooks:manage",
      ],
      default: [],
    },

    // Rate limiting overrides (null = use plan defaults)
    rateLimit: {
      requestsPerMinute: { type: Number, default: 60 },
      requestsPerDay: { type: Number, default: 5000 },
    },

    // Environment: live or test (sandbox)
    environment: {
      type: String,
      enum: ["live", "test"],
      default: "live",
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Set an expiry date (null = never expires)
    expiresAt: {
      type: Date,
      default: null,
    },

    // Usage tracking
    lastUsedAt: { type: Date, default: null },
    lastUsedIp: { type: String, default: null },
    totalRequests: { type: Number, default: 0 },

    // Who created this key
    createdBy: {
      id: String,
      name: String,
    },

    notes: {
      type: String,
      maxlength: [500, "Notes cannot exceed 500 characters"],
      default: "",
    },
  },
  {
    timestamps: true,
    collection: "integrationKeys",
  }
);

// ── Indexes ──────────────────────────────────
integrationKeySchema.index({ companyId: 1, isActive: 1 });
integrationKeySchema.index({ companyId: 1, connectorType: 1 });
integrationKeySchema.index({ keyHash: 1 }, { unique: true });

// ── Virtual: is this key expired? ────────────
integrationKeySchema.virtual("isExpired").get(function () {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
});

// ── Virtual: display label for UI ────────────
integrationKeySchema.virtual("displayKey").get(function () {
  return `${this.keyPrefix}...${this.keyPreview}`;
});

const IntegrationKey =
  mongoose.models.IntegrationKey ||
  mongoose.model("IntegrationKey", integrationKeySchema);

export default IntegrationKey;
