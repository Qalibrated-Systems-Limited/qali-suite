"use client";

import { useActionState, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, MapPin, Wifi, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveAttendanceConfig } from "@/app/mongodb/actions/hr-attendance-config-actions";

const initial = { success: false, error: null };

const ALL_METHODS = [
  { key: "web",       label: "Web (browser)" },
  { key: "mobile",    label: "Mobile web" },
  { key: "qr",        label: "QR Code scan" },
  { key: "biometric", label: "Biometric device" },
  { key: "manual",    label: "Manager manual entry" },
];

function SectionCard({ title, icon: Icon, iconColor, children }) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <Icon className={`h-5 w-5 ${iconColor}`} />
        <h2 className="font-semibold text-foreground">{title}</h2>
      </div>
      <div className="px-5 py-5 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-foreground">{label}</label>
      {hint && <p className="mb-1.5 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

export default function AttendanceConfigClient({ config }) {
  const [state, formAction, isPending] = useActionState(saveAttendanceConfig, initial);

  const defaults = config || {};
  const [ipEnabled, setIpEnabled]   = useState(defaults.ipEnabled  || false);
  const [geoEnabled, setGeoEnabled] = useState(defaults.geoEnabled || false);

  // Use browser geolocation to auto-fill office coordinates
  function fillMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      document.getElementById("geoLat").value = pos.coords.latitude.toFixed(6);
      document.getElementById("geoLng").value = pos.coords.longitude.toFixed(6);
    });
  }

  return (
    <form action={formAction} className="space-y-6">
      {state.success && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:border-emerald-800 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> Attendance configuration saved.
        </div>
      )}
      {state.error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 p-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> {state.error}
        </div>
      )}

      {/* ── Shift & Overtime ── */}
      <SectionCard title="Shift & Hours" icon={Clock} iconColor="text-blue-500">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Shift Start" hint="Standard start time (24h)">
            <input name="shiftStart" type="time" defaultValue={defaults.shiftStart || "08:00"} className={inputCls} />
          </Field>
          <Field label="Shift End" hint="Standard end time (24h)">
            <input name="shiftEnd" type="time" defaultValue={defaults.shiftEnd || "17:00"} className={inputCls} />
          </Field>
          <Field label="Standard Hours / Day" hint="Used for overtime calculation">
            <input name="standardHours" type="number" min="1" max="24" step="0.5" defaultValue={defaults.standardHours ?? 8} className={inputCls} />
          </Field>
          <Field label="Late Grace Period (min)" hint="Minutes after shift start before 'late'">
            <input name="lateGraceMinutes" type="number" min="0" max="60" defaultValue={defaults.lateGraceMinutes ?? 15} className={inputCls} />
          </Field>
          <Field label="Overtime Rate Multiplier" hint="e.g. 1.5 = time-and-a-half">
            <input name="overtimeRateMultiplier" type="number" min="1" max="3" step="0.1" defaultValue={defaults.overtimeRateMultiplier ?? 1.5} className={inputCls} />
          </Field>
        </div>

        <Field label="Allowed Clock-In Methods" hint="Uncheck to block specific methods">
          <div className="mt-1 flex flex-wrap gap-4">
            {ALL_METHODS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  name={`method_${key}`}
                  defaultChecked={defaults.allowedMethods ? defaults.allowedMethods.includes(key) : true}
                  className="rounded border-border"
                />
                {label}
              </label>
            ))}
          </div>
        </Field>
      </SectionCard>

      {/* ── IP Whitelist ── */}
      <SectionCard title="Office Network (IP Whitelist)" icon={Wifi} iconColor="text-emerald-500">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
          <input
            type="checkbox"
            name="ipEnabled"
            checked={ipEnabled}
            onChange={(e) => setIpEnabled(e.target.checked)}
            className="rounded border-border"
          />
          Restrict clock-in to specific IP addresses
        </label>

        {ipEnabled && (
          <div className="space-y-4 pt-1">
            <Field
              label="Allowed IPs"
              hint="One IP per line. Use exact IPs (e.g. 41.139.0.5) or prefixes (e.g. 192.168.1.) to match a subnet."
            >
              <textarea
                name="ips"
                rows={4}
                defaultValue={defaults.ips || ""}
                placeholder={"41.139.0.5\n192.168.1.\n10.0.0."}
                className={inputCls}
              />
            </Field>
            <Field label="Network Label" hint="Shown to employees when their IP is rejected">
              <input name="ipDescription" type="text" defaultValue={defaults.ipDescription || "Office network"} className={inputCls} />
            </Field>
          </div>
        )}

        {!ipEnabled && (
          <p className="text-xs text-muted-foreground">When disabled, employees can clock in from any network.</p>
        )}
      </SectionCard>

      {/* ── Geofence ── */}
      <SectionCard title="Geofence (GPS Restriction)" icon={MapPin} iconColor="text-amber-500">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
          <input
            type="checkbox"
            name="geoEnabled"
            checked={geoEnabled}
            onChange={(e) => setGeoEnabled(e.target.checked)}
            className="rounded border-border"
          />
          Restrict clock-in to a GPS radius around the office
        </label>

        {geoEnabled && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Office Latitude">
                <input id="geoLat" name="geoLat" type="number" step="any" defaultValue={defaults.geoLat || ""} placeholder="-1.286389" className={inputCls} />
              </Field>
              <Field label="Office Longitude">
                <input id="geoLng" name="geoLng" type="number" step="any" defaultValue={defaults.geoLng || ""} placeholder="36.817223" className={inputCls} />
              </Field>
            </div>
            <button
              type="button"
              onClick={fillMyLocation}
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <MapPin className="h-3 w-3" /> Use my current location as office location
            </button>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Radius (metres)" hint="Employees must be within this distance">
                <input name="geoRadius" type="number" min="50" max="5000" defaultValue={defaults.geoRadius || 200} className={inputCls} />
              </Field>
              <Field label="Location Label" hint="Shown in error messages">
                <input name="geoLabel" type="text" defaultValue={defaults.geoLabel || "Office"} placeholder="Head Office" className={inputCls} />
              </Field>
            </div>
          </div>
        )}

        {!geoEnabled && (
          <p className="text-xs text-muted-foreground">When disabled, employees can clock in from any location.</p>
        )}
      </SectionCard>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save Configuration
        </Button>
      </div>
    </form>
  );
}
