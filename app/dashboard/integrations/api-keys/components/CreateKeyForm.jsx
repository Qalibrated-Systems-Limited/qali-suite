"use client";

import { useActionState, useState } from "react";
import { createIntegrationKey } from "@/app/mongodb/actions/integration-actions";
import { Copy, Check, Eye, EyeOff, Plus, ChevronDown } from "lucide-react";

const CONNECTOR_OPTIONS = [
  { value: "weighbridge", label: "Weighbridge", desc: "Gate software, weight bridge PC" },
  { value: "coffee_coop", label: "Coffee Collection", desc: "Farmer intake mobile app, coop system" },
  { value: "logistics",   label: "Logistics / TMS", desc: "Transport management, dispatch system" },
  { value: "miller",      label: "Miller / Production", desc: "Milling software, production system" },
  { value: "generic",     label: "Generic", desc: "Custom integration, passthrough logging" },
];

const SCOPE_OPTIONS = [
  { value: "inventory:read",   label: "Inventory — Read",   desc: "Read stock levels, products" },
  { value: "inventory:write",  label: "Inventory — Write",  desc: "Create receipts, dispatches" },
  { value: "contacts:read",    label: "Contacts — Read",    desc: "Read parties, suppliers, customers" },
  { value: "contacts:write",   label: "Contacts — Write",   desc: "Create or update parties" },
  { value: "orders:read",      label: "Orders — Read",      desc: "Read purchase and sales orders" },
  { value: "orders:write",     label: "Orders — Write",     desc: "Create and update orders" },
  { value: "invoices:read",    label: "Invoices — Read",    desc: "Read invoices" },
  { value: "invoices:write",   label: "Invoices — Write",   desc: "Create invoices, update status" },
  { value: "hr:read",          label: "HR — Read",          desc: "Read employee list (driver lookup)" },
  { value: "collection:write", label: "Collection — Write", desc: "Create farmer intake entries" },
  { value: "webhooks:manage",  label: "Webhooks — Manage",  desc: "Register and manage webhook subscriptions" },
];

// Default scopes per connector type
const DEFAULT_SCOPES = {
  weighbridge:  ["inventory:write", "contacts:read", "orders:read"],
  coffee_coop:  ["collection:write", "contacts:read"],
  logistics:    ["inventory:write", "orders:read", "invoices:write"],
  miller:       ["inventory:write", "inventory:read"],
  generic:      [],
};

export default function CreateKeyForm() {
  const [open, setOpen] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState("");
  const [selectedScopes, setSelectedScopes] = useState([]);
  const [copied, setCopied] = useState(false);
  const [result, formAction, pending] = useActionState(createIntegrationKey, null);

  function handleConnectorChange(value) {
    setSelectedConnector(value);
    setSelectedScopes(DEFAULT_SCOPES[value] || []);
  }

  function toggleScope(scope) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }

  async function copyKey() {
    if (!result?.plaintextKey) return;
    await navigator.clipboard.writeText(result.plaintextKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Show the "copy your key" screen after successful creation
  if (result?.success && result.plaintextKey) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-500/5 p-5 dark:border-emerald-900">
        <h3 className="font-semibold text-emerald-700 dark:text-emerald-400">
          API key created — copy it now
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          This key will not be shown again. Store it somewhere safe.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-card p-3">
          <code className="flex-1 break-all font-mono text-xs text-foreground">
            {result.plaintextKey}
          </code>
          <button
            onClick={copyKey}
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
        Create New API Key
      </button>
    );
  }

  return (
    <form action={formAction} className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-foreground">New API Key</h2>
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
        <label className="text-sm font-medium text-foreground">Key Name</label>
        <input
          name="name"
          placeholder="e.g. Gate 1 Weighbridge, Coffee Collection App"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          required
        />
        <p className="text-xs text-muted-foreground">A name to identify this key in logs.</p>
      </div>

      {/* Connector type */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Connector Type</label>
        <input type="hidden" name="connectorType" value={selectedConnector} />
        <div className="grid gap-2 sm:grid-cols-2">
          {CONNECTOR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleConnectorChange(opt.value)}
              className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
                selectedConnector === opt.value
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border bg-background text-foreground hover:bg-accent"
              }`}
            >
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Scopes */}
      {selectedConnector && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Permissions (Scopes)</label>
          <input type="hidden" name="scopes" value={selectedScopes.join(",")} />
          <p className="text-xs text-muted-foreground">
            Default scopes for this connector type are pre-selected. Adjust as needed.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCOPE_OPTIONS.map((scope) => (
              <label
                key={scope.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  selectedScopes.includes(scope.value)
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:bg-accent"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(scope.value)}
                  onChange={() => toggleScope(scope.value)}
                  className="mt-0.5 shrink-0"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">{scope.label}</p>
                  <p className="text-xs text-muted-foreground">{scope.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Environment */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Environment</label>
        <div className="flex gap-3">
          {["live", "test"].map((env) => (
            <label key={env} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="environment" value={env} defaultChecked={env === "live"} />
              <span className="text-sm capitalize text-foreground">{env}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Test keys are prefixed <code className="font-mono">qls_test_</code> and behave identically but are clearly distinguishable in logs.
        </p>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Notes <span className="text-muted-foreground font-normal">(optional)</span></label>
        <textarea
          name="notes"
          rows={2}
          placeholder="e.g. Issued to Kamau Transport for truck dispatch integration"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
        />
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-3 border-t border-border pt-4">
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent">
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !selectedConnector}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create Key"}
        </button>
      </div>
    </form>
  );
}
