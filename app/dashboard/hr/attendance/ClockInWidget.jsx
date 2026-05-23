"use client";

import { useState, useEffect, useTransition } from "react";
import { Clock, LogIn, LogOut, Loader2, AlertCircle, MapPin, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clockIn, clockOut, getMyTodayAttendance } from "@/app/mongodb/actions/hr-attendance-actions";

// ── Helpers ────────────────────────────────────────────────────────────────

// Pin to Africa/Nairobi so the displayed time matches the Kenyan
// business's wall clock even when an employee logs in from another
// timezone (and matches what the server-rendered list shows). Without
// this option the browser falls back to local TZ.
const TZ = "Africa/Nairobi";

function fmtTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

function ElapsedTime({ since }) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    function tick() {
      const diffMs = Date.now() - new Date(since).getTime();
      const h = Math.floor(diffMs / 3_600_000);
      const m = Math.floor((diffMs % 3_600_000) / 60_000);
      const s = Math.floor((diffMs % 60_000) / 1_000);
      setElapsed(`${h > 0 ? `${h}h ` : ""}${m}m ${s}s`);
    }
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [since]);

  return <span className="font-mono text-sm text-foreground">{elapsed}</span>;
}

// ── Status badge colours matching the attendance model ─────────────────────
const STATUS_STYLE = {
  present:   "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  late:      "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  absent:    "bg-red-500/15 text-red-700 dark:text-red-400",
  "half-day":"bg-blue-500/15 text-blue-700 dark:text-blue-400",
  "on-leave":"bg-purple-500/15 text-purple-700 dark:text-purple-400",
};

// ══════════════════════════════════════════════════════════════════════════
// ClockInWidget
// Loaded by the HR Attendance page for the current session user.
// Initialised from a server-side snapshot; keeps UI in sync client-side.
// ══════════════════════════════════════════════════════════════════════════
export default function ClockInWidget({ initial }) {
  // `initial` = { profileId, record, config, noProfile }  (serialised from server)
  const [record, setRecord]   = useState(initial?.record || null);
  const [error, setError]     = useState(null);
  const [success, setSuccess] = useState(null);
  const [isPending, startTransition] = useTransition();

  const profileId   = initial?.profileId;
  const needsGeo    = initial?.config?.geoFenceEnabled;
  const needsIpNote = initial?.config?.ipWhitelistEnabled;

  if (initial?.noProfile) return null; // Not an employee — don't show widget

  // ── Acquire GPS coords if geofence is enabled ──────────────────────────
  function getLocation() {
    return new Promise((resolve) => {
      if (!needsGeo || !navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => resolve(null),
        { timeout: 8_000, maximumAge: 0, enableHighAccuracy: true }
      );
    });
  }

  // ── Clock In ────────────────────────────────────────────────────────────
  function handleClockIn() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const location = await getLocation();
      // Best-effort IP detection: the server reads the real IP from request headers.
      // We pass undefined here — the server action will capture it via Next.js internals.
      const result = await clockIn({ profileId, method: "web", location });
      if (result.success) {
        setRecord({ checkIn: result.checkIn, checkOut: null, status: result.status });
        setSuccess(`Clocked in at ${fmtTime(result.checkIn)}`);
      } else {
        setError(result.error);
      }
    });
  }

  // ── Clock Out ───────────────────────────────────────────────────────────
  function handleClockOut() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await clockOut({ profileId, method: "web" });
      if (result.success) {
        setRecord((prev) => ({
          ...prev,
          checkOut: new Date().toISOString(),
          hoursWorked: result.hoursWorked,
        }));
        setSuccess(`Clocked out · ${result.hoursWorked.toFixed(1)}h worked${result.overtime > 0 ? ` · OT: ${result.overtime.toFixed(1)}h` : ""}`);
      } else {
        setError(result.error);
      }
    });
  }

  const isClockedIn  = !!record?.checkIn && !record?.checkOut;
  const isClockedOut = !!record?.checkOut;

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left — status */}
        <div className="flex items-center gap-3">
          <div className={`rounded-full p-2 ${isClockedIn ? "bg-emerald-500/10" : "bg-muted"}`}>
            <Clock className={`h-5 w-5 ${isClockedIn ? "text-emerald-500" : "text-muted-foreground"}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">
                {isClockedOut
                  ? "Clocked Out"
                  : isClockedIn
                  ? "Clocked In"
                  : "Not Yet Clocked In"}
              </p>
              {record?.status && (
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[record.status] || "bg-muted text-muted-foreground"}`}>
                  {record.status?.replace("-", " ")}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground flex flex-wrap gap-3">
              {record?.checkIn && (
                <span>In: <span className="font-medium text-foreground">{fmtTime(record.checkIn)}</span></span>
              )}
              {record?.checkOut && (
                <span>Out: <span className="font-medium text-foreground">{fmtTime(record.checkOut)}</span></span>
              )}
              {isClockedIn && (
                <span>Elapsed: <ElapsedTime since={record.checkIn} /></span>
              )}
              {isClockedOut && record?.hoursWorked > 0 && (
                <span>Total: <span className="font-medium text-foreground">{record.hoursWorked.toFixed(1)}h</span></span>
              )}
            </div>
          </div>
        </div>

        {/* Right — action button */}
        <div className="flex items-center gap-2">
          {needsGeo && !isClockedIn && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <MapPin className="h-3 w-3" /> Location required
            </span>
          )}
          {!isClockedIn && !isClockedOut && (
            <Button onClick={handleClockIn} disabled={isPending} className="gap-1.5">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              Clock In
            </Button>
          )}
          {isClockedIn && (
            <Button onClick={handleClockOut} disabled={isPending} variant="outline" className="gap-1.5">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Clock Out
            </Button>
          )}
          {isClockedOut && (
            <span className="text-xs text-muted-foreground">Done for today</span>
          )}
        </div>
      </div>

      {/* Feedback messages */}
      {success && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {success}
        </div>
      )}
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {needsIpNote && (
        <p className="mt-2 text-xs text-muted-foreground">
          Your company requires clock-in from the office network.
        </p>
      )}
    </div>
  );
}
