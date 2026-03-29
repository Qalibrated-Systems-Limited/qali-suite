"use client";

import { useActionState, useState } from "react";
import { createWebhookSubscription } from "@/app/mongodb/actions/integration-actions";
import { Copy, Check, Plus } from "lucide-react";

const EVENT_OPTIONS = [
  { value: "*",                          label: "All events",              group: "General" },
  { value: "invoice.created",            label: "Invoice created",         group: "Sales" },
  { value: "invoice.paid",               label: "Invoice paid",            group: "Sales" },
  { value: "invoice.cancelled",          label: "Invoice cancelled",       group: "Sales" },
  { value: "payment.received",           label: "Payment received",        group: "Sales" },
  { value: "receipt.created",            label: "Goods receipt created",   group: "Inventory" },
  { value: "dispatch.created",           label: "Dispatch / delivery note",group: "Inventory" },
  { value: "stock.adjusted",             label: "Stock adjusted",          group: "Inventory" },
  { value: "stock.low",                  label: "Stock low alert",         group: "Inventory" },
  { value: "order.created",              label: "Order created",           group: "Purchases" },
  { value: "order.fulfilled",            label: "Order fulfilled",         group: "Purchases" },
  { value: "weighbridge.ticket_completed", label: "Weighbridge ticket",   group: "Integrations" },
  { value: "collection.intake_created",  label: "Farmer intake",          group: "Integrations" },
];

const CONNECTOR_OPTIONS = [
  { value: "",            label: "Any connector" },
  { value: "weighbridge", label: "Weighbridge" },
  { value: "coffee_coop", label: "Coffee Collection" },
  { value: "logistics",   label: "Logistics / TMS" },
  { value: "miller",      label: "Miller / Production" },
];

export default function CreateWebhookForm() {
  const [open, setOpen] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState(["*"]);
  const [copied, setCopied] = useState(false);
  const [result, formAction, pending] = useActionState(createWebhookSubscription, null);

  function toggleEvent(value) {
    if (value === "*") {
      setSelectedEvents(["*"]);
      return;
    }
    setSelectedEvents((prev) => {
      const without = prev.filter((e) => e !== "*");
      return without.includes(value)
        ? without.filter((e) => e !== value)
        : [...without, value];
    });
  }

  async function copySecret() {
    if (!result?.secret) return;
    await navigator.clipboard.writeText(result.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (result?.success && result.secret) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-500/5 p-5 dark:border-emerald-900">
        <h3 className="font-semibold text-emerald-700 dark:text-emerald-400">
          Webhook created — save your signing secret
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Use this secret to verify incoming deliveries. It will not be shown again.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-card p-3">
          <code className="flex-1 break-all font-mono text-xs text-foreground">
            {result.secret}
          </code>
          <button
            onClick={copySecret}
            className="shrink-0 rounded-md border border-border p-2 hover:bg-accent transition-colors"
            title="Copy to clipboard"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <button
          onClick={() => { setOpen(false); window.location.reload(); }}
          className="mt-4 text-sm text-primary hover:underline"
        >
          Done — close this
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card py-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <Plus className="h-4 w-4" />
        Register New Webhook
      </button>
    );
  }

  return (
    <form action={formAction} className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-foreground">New Webhook</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>

      {result?.error && (
        <div className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {result.error}
        </div>
      )}

      {/* Name */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Name</label>
        <input
          name="name"
          placeholder="e.g. Logistics TMS sync, Finance system"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          required
        />
      </div>

      {/* URL */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Endpoint URL</label>
        <input
          name="url"
          type="url"
          placeholder="https://your-system.com/webhooks/qalisuite"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          required
        />
        <p className="text-xs text-muted-foreground">Must be HTTPS. Localhost allowed for testing.</p>
      </div>

      {/* Events */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Events to subscribe</label>
        <input type="hidden" name="events" value={selectedEvents.join(",")} />
        <div className="grid gap-1.5 sm:grid-cols-2">
          {EVENT_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                selectedEvents.includes(opt.value)
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border bg-background text-foreground hover:bg-accent"
              }`}
            >
              <input
                type="checkbox"
                checked={selectedEvents.includes(opt.value)}
                onChange={() => toggleEvent(opt.value)}
                className="shrink-0"
              />
              <span>{opt.label}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{opt.group}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Connector filter */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          Connector filter <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <select
          name="connectorType"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          {CONNECTOR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Only deliver events from a specific connector.</p>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          name="notes"
          rows={2}
          placeholder="e.g. Notifies Kamau Transport's dispatch system on every goods receipt"
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="flex justify-end gap-3 border-t border-border pt-4">
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent">
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || selectedEvents.length === 0}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create Webhook"}
        </button>
      </div>
    </form>
  );
}
