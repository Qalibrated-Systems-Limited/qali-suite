"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Page,
  SectionHeader,
  StatGrid,
  Stat,
  Tabs,
  DataTable,
  Badge,
  Btn,
  Alert,
  Input,
  Select,
  Modal,
  fmt,
} from "@/components/erp-ui";
import {
  issueLicense,
  revokeLicense,
  renewLicense,
  validateLicense,
} from "@/app/db/actions/licensing-actions";
import { appLabel, featureLabel } from "@/lib/licensing/features";

// ── vocab ─────────────────────────────────────────────────────────────────────
// The state of a license is derived, not stored: a row is Revoked, Expired, or
// Active, and Active rows within 30 days of expiry are flagged Expiring.
function licenseState(l) {
  if (l.revoked) return { key: "revoked", label: "Revoked", variant: "red" };
  const exp = l.expiresAt ? new Date(l.expiresAt) : null;
  if (exp && exp < new Date()) return { key: "expired", label: "Expired", variant: "default" };
  if (exp && exp <= new Date(Date.now() + 30 * 86400000))
    return { key: "expiring", label: "Expiring", variant: "amber" };
  return { key: "active", label: "Active", variant: "green" };
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  return d;
}

const TABS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "expiring", label: "Expiring" },
  { id: "revoked", label: "Revoked/Expired" },
];

// A default one-year expiry, formatted for <input type=date>.
function defaultExpiry() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export default function LicensingBoard({
  licenses,
  stats,
  catalogue,
  signingKeyConfigured,
  canManage,
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState("all");
  const [issuing, setIssuing] = useState(false);
  const [revokeFor, setRevokeFor] = useState(null); // license row
  const [renewFor, setRenewFor] = useState(null);
  const [validating, setValidating] = useState(false);
  const [issuedToken, setIssuedToken] = useState(null); // { licenseNumber, token }

  const rows = useMemo(() => {
    return licenses.filter((l) => {
      const st = licenseState(l).key;
      if (tab === "all") return true;
      if (tab === "active") return st === "active" || st === "expiring";
      if (tab === "expiring") return st === "expiring";
      if (tab === "revoked") return st === "revoked" || st === "expired";
      return true;
    });
  }, [licenses, tab]);

  function refresh() {
    startTransition(() => router.refresh());
  }

  const tableRows = rows.map((l) => {
    const st = licenseState(l);
    const dLeft = daysUntil(l.expiresAt);
    return [
      l.licenseNumber,
      <div key="cust">
        <div style={{ fontWeight: 600 }}>{l.customerName || l.customerId}</div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{l.customerId}</div>
      </div>,
      <Badge key="app" variant="navy">{appLabel(l.appId)}</Badge>,
      <div key="feat" style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 260 }}>
        {(l.featureList || []).length === 0
          ? <span style={{ color: "var(--muted-foreground)" }}>—</span>
          : (l.featureList || []).map((f) => (
              <Badge key={f} variant="blue" size="sm">{featureLabel(f)}</Badge>
            ))}
      </div>,
      l.machineId ? <span key="m" title={l.machineId}>🔒 bound</span> : <span key="m" style={{ color: "var(--muted-foreground)" }}>—</span>,
      <div key="exp">
        <div>{fmt.date(l.expiresAt)}</div>
        {!l.revoked && dLeft != null && (
          <div style={{ fontSize: 11, color: dLeft < 0 ? "#C00000" : dLeft <= 30 ? "#B8600B" : "var(--muted-foreground)" }}>
            {dLeft < 0 ? `${Math.abs(dLeft)}d ago` : `${dLeft}d left`}
          </div>
        )}
      </div>,
      <Badge key="st" variant={st.variant}>{st.label}</Badge>,
      l.lastSeen ? fmt.date(l.lastSeen) : <span style={{ color: "var(--muted-foreground)" }}>never</span>,
      <div key="act" style={{ display: "flex", gap: 6 }}>
        <Btn size="sm" variant="ghost" onClick={() => copyToken(l.token, l.licenseNumber)}>Copy key</Btn>
        {canManage && !l.revoked && (
          <>
            <Btn size="sm" variant="outline" onClick={() => setRenewFor(l)}>Renew</Btn>
            <Btn size="sm" variant="danger" onClick={() => setRevokeFor(l)}>Revoke</Btn>
          </>
        )}
      </div>,
    ];
  });

  async function copyToken(token, number) {
    try {
      await navigator.clipboard.writeText(token);
      toast.success(`${number} key copied to clipboard`);
    } catch {
      toast.error("Could not copy — your browser blocked clipboard access");
    }
  }

  return (
    <Page>
      <SectionHeader
        title="Licensing"
        sub="Issue, validate, revoke and renew ES256 license keys for the QaliTrack product line"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="outline" onClick={() => setValidating(true)}>Validate a key</Btn>
            {canManage && <Btn variant="gold" onClick={() => setIssuing(true)}>+ Issue license</Btn>}
          </div>
        }
      />

      {!signingKeyConfigured && (
        <Alert type="warning">
          No <code>LICENSE_JWT_PRIVATE_KEY</code> is configured — keys are being signed
          with an ephemeral development key that changes on restart. Configure a stable
          key before issuing production licenses.
        </Alert>
      )}

      <StatGrid>
        <Stat label="Total" value={stats.total} icon="🔑" />
        <Stat label="Active" value={stats.active} variant="green" icon="✅" />
        <Stat label="Expiring (30d)" value={stats.expiringSoon} variant="amber" icon="⏳" />
        <Stat label="Revoked" value={stats.revoked} variant="red" icon="🚫" />
        <Stat label="Expired" value={stats.expired} icon="📅" />
      </StatGrid>

      <div style={{ margin: "18px 0" }}>
        <Tabs tabs={TABS} active={tab} setActive={setTab} />
      </div>

      <DataTable
        headers={["License", "Customer", "App", "Features", "Machine", "Expires", "State", "Last seen", ""]}
        rows={tableRows}
        empty="No licenses yet. Issue one to get started."
      />

      {issuing && (
        <IssueModal
          catalogue={catalogue}
          onClose={() => setIssuing(false)}
          onIssued={(res) => {
            setIssuing(false);
            setIssuedToken({ licenseNumber: res.message, token: res.token });
            refresh();
          }}
        />
      )}

      {issuedToken && (
        <Modal title="License issued" width={620} onClose={() => setIssuedToken(null)}>
          <Alert type="success">
            {issuedToken.licenseNumber}. Copy the key now and hand it to the customer —
            it is the whole license.
          </Alert>
          <textarea
            readOnly
            value={issuedToken.token}
            onClick={(e) => e.target.select()}
            style={{ width: "100%", height: 130, fontFamily: "monospace", fontSize: 11, padding: 10, border: "1.5px solid var(--border)", borderRadius: 7, boxSizing: "border-box", background: "var(--muted)", color: "var(--foreground)" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <Btn variant="ghost" onClick={() => copyToken(issuedToken.token, issuedToken.licenseNumber)}>Copy key</Btn>
            <Btn onClick={() => setIssuedToken(null)}>Done</Btn>
          </div>
        </Modal>
      )}

      {revokeFor && (
        <RevokeModal
          license={revokeFor}
          pending={pending}
          onClose={() => setRevokeFor(null)}
          onDone={() => { setRevokeFor(null); refresh(); }}
        />
      )}

      {renewFor && (
        <RenewModal
          license={renewFor}
          onClose={() => setRenewFor(null)}
          onDone={() => { setRenewFor(null); refresh(); }}
        />
      )}

      {validating && <ValidateModal onClose={() => setValidating(false)} apps={catalogue.apps} />}
    </Page>
  );
}

// ── Issue ──────────────────────────────────────────────────────────────────────
function IssueModal({ catalogue, onClose, onIssued }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    customerId: "",
    customerName: "",
    appId: catalogue.apps[0]?.value || "",
    machineId: "",
    expiresAt: defaultExpiry(),
    notes: "",
  });
  const [features, setFeatures] = useState([]);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  function toggleFeature(v) {
    setFeatures((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  }

  async function submit() {
    if (!form.customerId.trim()) return toast.error("A customer id is required");
    if (!form.appId) return toast.error("Choose an application");
    setBusy(true);
    const fd = new FormData();
    fd.set("customerId", form.customerId);
    fd.set("customerName", form.customerName);
    fd.set("appId", form.appId);
    fd.set("machineId", form.machineId);
    fd.set("expiresAt", form.expiresAt);
    fd.set("notes", form.notes);
    features.forEach((f) => fd.append("features", f));
    const res = await issueLicense(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onIssued(res);
  }

  const groups = ["hardware", "modules"];
  return (
    <Modal title="Issue a license" width={640} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Input label="Customer ID" value={form.customerId} onChange={set("customerId")} required placeholder="CRM customer id" />
        <Input label="Customer name" value={form.customerName} onChange={set("customerName")} placeholder="Acme Weighbridge Ltd" />
      </div>
      <Select label="Application" value={form.appId} onChange={set("appId")} options={catalogue.apps} required />

      <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Features</label>
      {groups.map((g) => (
        <div key={g} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--muted-foreground)", marginBottom: 4 }}>{g}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {catalogue.features.filter((f) => f.group === g).map((f) => {
              const on = features.includes(f.value);
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => toggleFeature(f.value)}
                  style={{ padding: "5px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", border: on ? "1.5px solid #1B3A5C" : "1.5px solid var(--border)", background: on ? "#DCE8F5" : "var(--background)", color: on ? "#1B3A5C" : "var(--muted-foreground)" }}
                >
                  {on ? "✓ " : ""}{f.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 4 }}>
        <Input label="Expires on" type="date" value={form.expiresAt} onChange={set("expiresAt")} required />
        <Input label="Machine ID (optional)" value={form.machineId} onChange={set("machineId")} note="Binds the key to one machine" />
      </div>
      <Input label="Notes (optional)" value={form.notes} onChange={set("notes")} />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Issuing…" : "Issue license"}</Btn>
      </div>
    </Modal>
  );
}

// ── Revoke ──────────────────────────────────────────────────────────────────────
function RevokeModal({ license, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    const res = await revokeLicense(license._id, reason);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title={`Revoke ${license.licenseNumber}`} onClose={onClose}>
      <Alert type="error">
        Revoking is immediate and permanent. The client app fails its next check-in
        with <code>revoked</code>. This cannot be undone — issue a new key instead.
      </Alert>
      <Input label="Reason" value={reason} onChange={setReason} placeholder="e.g. contract ended, key leaked" />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" disabled={busy} onClick={submit}>{busy ? "Revoking…" : "Revoke license"}</Btn>
      </div>
    </Modal>
  );
}

// ── Renew ──────────────────────────────────────────────────────────────────────
function RenewModal({ license, onClose, onDone }) {
  const [when, setWhen] = useState(() => {
    const base = license.expiresAt ? new Date(license.expiresAt) : new Date();
    base.setFullYear(base.getFullYear() + 1);
    return base.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    const res = await renewLicense(license._id, when);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title={`Renew ${license.licenseNumber}`} onClose={onClose}>
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 0 }}>
        Currently expires {fmt.date(license.expiresAt)}. Choose a later date.
      </p>
      <Input label="New expiry" type="date" value={when} onChange={setWhen} required />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn disabled={busy} onClick={submit}>{busy ? "Renewing…" : "Renew license"}</Btn>
      </div>
    </Modal>
  );
}

// ── Validate ────────────────────────────────────────────────────────────────────
const REASONS = {
  unknown_key: "Unknown key — not found on the server.",
  revoked: "This key has been revoked.",
  wrong_app: "This key is for a different application.",
  expired: "This key has expired.",
  machine_mismatch: "This key is bound to a different machine.",
  bad_signature: "The token signature is invalid or tampered.",
};

function ValidateModal({ onClose, apps }) {
  const [form, setForm] = useState({ token: "", appId: apps[0]?.value || "", machineId: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.token.trim()) return toast.error("Paste a license key");
    setBusy(true);
    setResult(null);
    const res = await validateLicense({ token: form.token.trim(), appId: form.appId, machineId: form.machineId || undefined });
    setBusy(false);
    setResult(res);
  }

  return (
    <Modal title="Validate a license key" width={620} onClose={onClose}>
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 0 }}>
        Runs the same check a client app performs on activation and daily check-in.
      </p>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5 }}>License key</label>
      <textarea
        value={form.token}
        onChange={(e) => set("token")(e.target.value)}
        placeholder="Paste the JWT license key…"
        style={{ width: "100%", height: 100, fontFamily: "monospace", fontSize: 11, padding: 10, border: "1.5px solid var(--border)", borderRadius: 7, boxSizing: "border-box", background: "var(--background)", color: "var(--foreground)", marginBottom: 12 }}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Select label="Application" value={form.appId} onChange={set("appId")} options={apps} />
        <Input label="Machine ID (optional)" value={form.machineId} onChange={set("machineId")} />
      </div>

      {result && (
        result.valid ? (
          <Alert type="success">
            Valid — customer {result.customerId}, {appLabel(result.appId)}, expires {fmt.date(result.expiresAt)}
            {result.features?.length ? ` · features: ${result.features.map(featureLabel).join(", ")}` : ""}
          </Alert>
        ) : (
          <Alert type="error">{REASONS[result.reason] || `Invalid — ${result.reason}`}</Alert>
        )
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
        <Btn disabled={busy} onClick={submit}>{busy ? "Checking…" : "Validate"}</Btn>
      </div>
    </Modal>
  );
}
