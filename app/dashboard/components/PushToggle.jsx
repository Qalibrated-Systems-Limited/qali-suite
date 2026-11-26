"use client";

import { useEffect, useState } from "react";
import { BellRing, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getPushPublicKey,
  savePushSubscription,
  removePushSubscription,
} from "@/app/db/actions/notification-setup-actions";

/**
 * "Notify me on this device": registers the service worker and a push
 * subscription for the signed-in person. Hidden where the browser cannot do
 * push or the server has no keys yet.
 */
function keyBytes(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function PushToggle() {
  const [state, setState] = useState("checking"); // checking | unsupported | off | on | blocked
  const [busy, setBusy] = useState(false);
  const [publicKey, setPublicKey] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return setState("unsupported");
      }
      const key = await getPushPublicKey().catch(() => null);
      if (cancelled) return;
      if (!key) return setState("unsupported");
      setPublicKey(key);
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "checking" || state === "unsupported") return null;

  const turnOn = async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return toast.error("Notifications were not allowed in this browser.");
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const r = await savePushSubscription(JSON.parse(JSON.stringify(sub)), navigator.userAgent);
      if (!r.success) throw new Error(r.error);
      setState("on");
      toast.success(r.message);
    } catch (e) {
      toast.error(e.message || "Could not turn notifications on.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      toast.success("Notifications are off for this device.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "blocked") {
    return (
      <p className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <BellOff className="h-3.5 w-3.5" /> Notifications are blocked for this site — allow them in the browser’s site settings.
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={state === "on" ? turnOff : turnOn}
      disabled={busy}
      className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "on" ? <BellOff className="h-3.5 w-3.5" /> : <BellRing className="h-3.5 w-3.5" />}
      {state === "on" ? "Stop notifications on this device" : "Notify me on this device (phone or browser)"}
    </button>
  );
}
