import mongoose from "mongoose";

// ============================================
// ATTENDANCE CONFIG MODEL
// ============================================
// Per-company attendance policy. One active record per company.
//
// Controls:
//  - Standard shift hours (for overtime calc)
//  - Late-arrival grace window
//  - IP whitelist enforcement (office network)
//  - Geofence enforcement (GPS proximity to office)
//  - Allowed clock-in methods
// ============================================

const { Schema, model, models } = mongoose;

const AttendanceConfigSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    isActive:  { type: Boolean, default: true },

    // ── Timezone ──────────────────────────────────────────────────────────
    // IANA timezone name. All shift times (shiftStart/shiftEnd) and date
    // bucketing (today's "day key") are interpreted in this zone, not UTC.
    // Default to Kenya since that's the primary market.
    timezone:             { type: String, default: "Africa/Nairobi", trim: true },

    // ── Shift defaults ────────────────────────────────────────────────────
    // Used when no per-employee shift is specified
    shiftStart:           { type: String, default: "08:00" }, // HH:MM (24h, local)
    shiftEnd:             { type: String, default: "17:00" }, // HH:MM (24h, local)
    standardHours:        { type: Number, default: 8 },       // hours per day
    lateGraceMinutes:     { type: Number, default: 15 },      // minutes after shiftStart before "late"
    overtimeRateMultiplier: { type: Number, default: 1.5 },   // 1.5 = time-and-a-half

    // ── Enforcement rules ─────────────────────────────────────────────────
    enforcement: {
      // Allowed clock-in methods (empty = all allowed)
      allowedMethods: {
        type: [String],
        enum: ["web", "mobile", "qr", "biometric", "manual"],
        default: ["web", "mobile", "qr", "biometric", "manual"],
      },

      // IP whitelist — restrict clock-in to specific IP addresses/prefixes
      // Examples: "41.139.0.1" (exact) or "192.168.1." (prefix match)
      ipWhitelist: {
        enabled: { type: Boolean, default: false },
        // Comma-separated list stored as array for querying
        ips: [{ type: String, trim: true }],
        // Human-readable description shown to user on failure
        description: { type: String, default: "Office network" },
      },

      // Geofence — restrict clock-in to a radius from a fixed point
      geoFence: {
        enabled:      { type: Boolean, default: false },
        lat:          { type: Number },  // Office latitude
        lng:          { type: Number },  // Office longitude
        radiusMeters: { type: Number, default: 200 }, // 200m default
        label:        { type: String, default: "Office" }, // Shown in error message
      },
    },

    // ── Audit ─────────────────────────────────────────────────────────────
    createdBy:      { name: String, id: Schema.Types.ObjectId },
    lastModifiedBy: { name: String, id: Schema.Types.ObjectId },
  },
  { timestamps: true, collection: "attendanceconfigs" }
);

// One active config per company
AttendanceConfigSchema.index({ companyId: 1, isActive: 1 });

// ── Static helpers ─────────────────────────────────────────────────────────

// Get the active config for a company (returns null if none configured)
AttendanceConfigSchema.statics.getActive = async function (companyId) {
  return this.findOne({ companyId, isActive: true }).lean();
};

// Haversine distance in metres between two lat/lng points
AttendanceConfigSchema.statics.haversineDistance = function (lat1, lon1, lat2, lon2) {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Validate clock-in request against enforcement rules.
// Returns { allowed: true } or { allowed: false, reason: string }
AttendanceConfigSchema.statics.validateClockIn = function (config, { ipAddress, location, method }) {
  if (!config) return { allowed: true }; // No config → no restrictions

  const { enforcement } = config;

  // ── Method check ──────────────────────────────────────────────────────
  if (
    enforcement?.allowedMethods?.length > 0 &&
    method &&
    !enforcement.allowedMethods.includes(method)
  ) {
    return { allowed: false, reason: `Clock-in via "${method}" is not permitted. Allowed: ${enforcement.allowedMethods.join(", ")}.` };
  }

  // ── IP whitelist ──────────────────────────────────────────────────────
  if (enforcement?.ipWhitelist?.enabled) {
    const allowedIPs = enforcement.ipWhitelist.ips || [];
    if (allowedIPs.length > 0 && ipAddress) {
      const ip = ipAddress.trim();
      const ok = allowedIPs.some((allowed) => {
        const a = allowed.trim();
        // Exact match or prefix match (e.g. "192.168.1." matches "192.168.1.100")
        return ip === a || ip.startsWith(a);
      });
      if (!ok) {
        const desc = enforcement.ipWhitelist.description || "office network";
        return {
          allowed: false,
          reason: `Clock-in is only allowed from the ${desc}. Your current network (${ip}) is not on the whitelist.`,
        };
      }
    }
  }

  // ── Geofence ──────────────────────────────────────────────────────────
  if (enforcement?.geoFence?.enabled) {
    const { lat, lng, radiusMeters, label } = enforcement.geoFence;
    if (lat != null && lng != null) {
      if (!location?.lat || !location?.lng) {
        return {
          allowed: false,
          reason: `Clock-in requires your location to verify you are within ${radiusMeters}m of ${label || "the office"}. Please allow location access and try again.`,
        };
      }
      const dist = this.haversineDistance(lat, lng, location.lat, location.lng);
      if (dist > radiusMeters) {
        return {
          allowed: false,
          reason: `You are ${Math.round(dist)}m from ${label || "the office"} (limit: ${radiusMeters}m). Move closer and try again.`,
        };
      }
    }
  }

  return { allowed: true };
};

const AttendanceConfig = models.AttendanceConfig || model("AttendanceConfig", AttendanceConfigSchema);
export default AttendanceConfig;
