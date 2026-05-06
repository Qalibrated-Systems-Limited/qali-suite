// ============================================
// HR TIMEZONE HELPERS
// ============================================
// All attendance / shift logic runs in the company's local timezone, not
// the server's UTC. The clock-in record's `date` is the local YYYY-MM-DD
// rendered as UTC midnight — a stable day key for indexing and grouping,
// not a literal moment in time.
//
// Default to Africa/Nairobi (EAT, UTC+3, no DST) since that's the primary
// market. AttendanceConfig.timezone overrides per tenant.
// ============================================

export const DEFAULT_HR_TIMEZONE = "Africa/Nairobi";

// Returns the configured timezone for a tenant or the default.
export function getTimezone(config) {
  return config?.timezone || DEFAULT_HR_TIMEZONE;
}

// Returns "YYYY-MM-DD" representing the local date of `date` in `tz`.
// en-CA produces ISO-style "YYYY-MM-DD" output.
export function getLocalYMD(date, tz = DEFAULT_HR_TIMEZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Returns a Date that is UTC midnight of the local YMD — used as the unique
// per-employee-per-day key in the Attendance collection. Intentionally NOT a
// real moment in time; just a stable bucket id.
export function getLocalDateKey(date = new Date(), tz = DEFAULT_HR_TIMEZONE) {
  const ymd = getLocalYMD(date, tz);
  return new Date(`${ymd}T00:00:00.000Z`);
}

// Returns minutes since local midnight (0–1439) for `date` in `tz`.
// Used to compare "now" against shiftStart "HH:MM" without UTC drift.
export function getLocalMinutesSinceMidnight(date, tz = DEFAULT_HR_TIMEZONE) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  // Intl can output "24" for midnight in some locales; normalize to "0".
  let h = parseInt(parts.find((p) => p.type === "hour").value, 10);
  if (Number.isNaN(h) || h === 24) h = 0;
  const m = parseInt(parts.find((p) => p.type === "minute").value, 10) || 0;
  return h * 60 + m;
}

// Offset minutes of `tz` from UTC at the moment `date` (e.g. +180 for EAT).
// Robust under DST transitions.
export function getTimezoneOffsetMinutes(date, tz = DEFAULT_HR_TIMEZONE) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
  let hour = get("hour");
  if (hour === 24) hour = 0;
  const tzAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return Math.round((tzAsUtc - date.getTime()) / 60_000);
}

// Construct a UTC Date corresponding to a wall-clock time in `tz`.
// `dateKey` is the UTC-midnight day-key produced by getLocalDateKey;
// `hhmm` is "HH:MM" interpreted in `tz`.
//
//   localDateTime("2026-01-15T00:00:00Z", "08:00", "Africa/Nairobi")
//     → 2026-01-15T05:00:00Z  (= 08:00 EAT)
export function localDateTime(dateKey, hhmm, tz = DEFAULT_HR_TIMEZONE) {
  const ymd = dateKey.toISOString().slice(0, 10);
  const [h, m] = hhmm.split(":").map(Number);
  // Treat hh:mm as if it were UTC, then subtract the tz offset to land on
  // the right UTC instant (since UTC + offset = local).
  const naive = new Date(
    `${ymd}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`,
  );
  const offsetMs = getTimezoneOffsetMinutes(naive, tz) * 60_000;
  return new Date(naive.getTime() - offsetMs);
}
