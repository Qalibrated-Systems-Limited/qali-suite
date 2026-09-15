// ============================================
// LICENSING CATALOGUES — ported from the Lante ERP License microservice
// (LicenseFeatures.cs and LicenseAppIds.cs).
//
// Single source of truth for the issue form (which features/apps can be
// picked), the JWT `features[]` / `app` claims, and validation. Plain JS with
// no server-only imports so a client component (the issue form) and a server
// action can both import it.
//
// Adding a feature: add an entry to FEATURES. Wrap the client module in a
// FeatureLicenseGate keyed on its `value`. Nothing else changes.
// ============================================

export const FEATURE_GROUPS = Object.freeze({
  hardware: "Hardware",
  modules: "Modules",
});

// value — the string embedded in the JWT features[] claim and stored in the DB.
// Must match exactly what the client app's feature gate expects.
export const FEATURES = Object.freeze([
  // Hardware peripherals
  { value: "anpr", label: "ANPR / NPR Camera", group: "hardware" },
  { value: "ticket_printer", label: "Ticket Printer", group: "hardware" },
  { value: "rfid", label: "RFID Reader", group: "hardware" },
  { value: "nfc", label: "NFC Reader", group: "hardware" },
  // Software modules
  { value: "kiosk", label: "Unmanned Kiosk", group: "modules" },
  { value: "dual_lane", label: "Dual Lane / Second Scale", group: "modules" },
  { value: "reports", label: "Advanced Reports", group: "modules" },
  { value: "analytics", label: "Analytics Dashboard", group: "modules" },
  { value: "user_management", label: "User Management", group: "modules" },
  { value: "shifts", label: "Shifts", group: "modules" },
  { value: "boom_barrier", label: "Boom Barrier Controller", group: "modules" },
  { value: "sms_alerts", label: "SMS Alerts", group: "modules" },
  { value: "backup", label: "Backup & Microservice Management", group: "modules" },
]);

const FEATURE_VALUES = new Set(FEATURES.map((f) => f.value));

/** True if `value` is a known feature flag. */
export function isValidFeature(value) {
  return FEATURE_VALUES.has(value);
}

/** The values in `values` that are not in the catalogue. */
export function findUnknownFeatures(values) {
  return (values || []).filter((v) => !FEATURE_VALUES.has(v));
}

/** Human label for a feature value, or the value itself if unknown. */
export function featureLabel(value) {
  return FEATURES.find((f) => f.value === value)?.label ?? value;
}

// Every application that can be licensed. The JWT `app` claim must match one.
export const APP_IDS = Object.freeze([
  { value: "qalitrack-frontend", label: "QaliTrack — Web" },
  { value: "qalitrack-mobile", label: "QaliTrack — Mobile" },
  { value: "qalitrack-kiosk", label: "QaliTrack — Kiosk" },
]);

const APP_ID_VALUES = new Set(APP_IDS.map((a) => a.value));

/** True if `value` is a known app id. */
export function isValidAppId(value) {
  return APP_ID_VALUES.has(value);
}

/** Human label for an app id, or the value itself if unknown. */
export function appLabel(value) {
  return APP_IDS.find((a) => a.value === value)?.label ?? value;
}

/** Parse the stored comma-separated `features` column into an array. */
export function parseFeatures(features) {
  if (!features) return [];
  return String(features)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
