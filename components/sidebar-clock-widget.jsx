"use client";

import { useState, useEffect, useTransition } from "react";
import { Clock, LogIn, LogOut, Loader2 } from "lucide-react";
import { clockIn, clockOut, getMyTodayAttendance } from "@/app/mongodb/actions/hr-attendance-actions";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui/tooltip";

function fmtTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function useElapsed(since) {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!since) return;
    function tick() {
      const ms = Date.now() - new Date(since).getTime();
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`);
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [since]);
  return elapsed;
}

export function SidebarClockWidget({ collapsed }) {
  const [initial, setInitial] = useState(null); // null = loading
  const [record, setRecord] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [config, setConfig] = useState(null);
  const [isPending, startTransition] = useTransition();
  const elapsed = useElapsed(record?.checkIn && !record?.checkOut ? record.checkIn : null);

  useEffect(() => {
    getMyTodayAttendance().then((data) => {
      if (data?.noProfile) { setInitial("noProfile"); return; }
      setInitial("ready");
      setRecord(data?.record || null);
      setProfileId(data?.profileId || null);
      setConfig(data?.config || null);
    });
  }, []);

  if (initial === null || initial === "noProfile") return null;

  const isClockedIn = !!record?.checkIn && !record?.checkOut;
  const isClockedOut = !!record?.checkOut;

  function handleClockIn() {
    startTransition(async () => {
      const location = await getGeo(config?.geoFenceEnabled);
      const res = await clockIn({ profileId, method: "web", location });
      if (res.success) setRecord({ checkIn: res.checkIn, checkOut: null, status: res.status });
    });
  }

  function handleClockOut() {
    startTransition(async () => {
      const res = await clockOut({ profileId, method: "web" });
      if (res.success) setRecord((p) => ({ ...p, checkOut: new Date().toISOString(), hoursWorked: res.hoursWorked }));
    });
  }

  // ── Collapsed: icon + status dot ────────────────────────────────────────
  if (collapsed) {
    const dotColor = isClockedIn
      ? "bg-emerald-500"
      : isClockedOut
      ? "bg-muted-foreground"
      : "bg-amber-500";

    const label = isClockedIn
      ? `Clocked in ${fmtTime(record.checkIn)} · ${elapsed}`
      : isClockedOut
      ? `Done · ${record.hoursWorked?.toFixed(1)}h`
      : "Not clocked in — tap to clock in";

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={!isClockedOut ? (isClockedIn ? handleClockOut : handleClockIn) : undefined}
            disabled={isPending || isClockedOut}
            className="relative w-full flex items-center justify-center p-2.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
          >
            {isPending
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Clock className={`w-5 h-5 ${isClockedIn ? "text-emerald-500" : ""}`} />
            }
            <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${dotColor}`} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
      </Tooltip>
    );
  }

  // ── Expanded ─────────────────────────────────────────────────────────────
  return (
    <div className="px-3 pb-2">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
        {/* Status */}
        <div className="flex items-center gap-2 min-w-0">
          <div className={`shrink-0 w-2 h-2 rounded-full ${isClockedIn ? "bg-emerald-500" : isClockedOut ? "bg-muted-foreground" : "bg-amber-500"}`} />
          <div className="min-w-0">
            {isClockedIn ? (
              <>
                <p className="text-xs font-medium text-foreground truncate">
                  {fmtTime(record.checkIn)}
                  {elapsed && <span className="text-muted-foreground"> · {elapsed}</span>}
                </p>
              </>
            ) : isClockedOut ? (
              <p className="text-xs text-muted-foreground truncate">
                Done · {record.hoursWorked?.toFixed(1)}h
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Not clocked in</p>
            )}
          </div>
        </div>

        {/* Button */}
        {!isClockedOut && (
          <button
            onClick={isClockedIn ? handleClockOut : handleClockIn}
            disabled={isPending}
            className={`shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              isClockedIn
                ? "border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                : "bg-emerald-500 text-white hover:bg-emerald-600"
            }`}
          >
            {isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : isClockedIn
              ? <><LogOut className="h-3 w-3" /> Out</>
              : <><LogIn className="h-3 w-3" /> In</>
            }
          </button>
        )}
      </div>
    </div>
  );
}

function getGeo(enabled) {
  return new Promise((resolve) => {
    if (!enabled || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { timeout: 8_000, maximumAge: 0, enableHighAccuracy: true }
    );
  });
}
