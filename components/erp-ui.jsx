"use client";
import { useState } from "react";

// ============================================================================
// ERP UI KIT — ported verbatim from the QSL ERP app (src/components/dashboard/
// ui.js) so the newly-adapted modules render pixel-identical to ERP. These are
// self-contained, inline-styled primitives (no Tailwind, no external deps) so
// they are immune to erpinventory's own design tokens. Brand/accent colours are
// inlined from T (rather than CSS vars) to avoid collisions with the app's
// shadcn --accent token.
// ============================================================================

// ── DESIGN TOKENS ───────────────────────────────────────────────────────────
export const T = {
  navy: "#1B3A5C", navyD: "#0D2238", navyL: "#2E5F8A", gold: "#C8960C",
  white: "#FFFFFF", offwt: "#F0F4F8", lgrey: "#E8ECF0", mgrey: "#94A3B8",
  dgrey: "#334155", green: "#1E6B3C", greenL: "#DCFCE7", red: "#C00000",
  redL: "#FEE2E2", amber: "#B8600B", amberL: "#FEF3C7", blue: "#0070C0",
  blueL: "#EFF6FF", purple: "#6A0DAD", purpleL: "#F3E8FF",
};

// ── UTILITY ─────────────────────────────────────────────────────────────────
export const fmt = {
  kes: (n) => (n == null ? "—" : `Kshs ${Number(n).toLocaleString("en-KE")}`),
  pct: (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`),
  date: (d) =>
    d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—",
  num: (n) => (n == null ? "—" : Number(n).toLocaleString()),
};

export const cs = (obj) =>
  Object.entries(obj).filter(([, v]) => v).map(([k]) => k).join(" ");

// ── PAGE WRAPPER ──────────────────────────────────────────────────────────────
// The dashboard layout already provides the off-white canvas + padding, so this
// just centres the module content at a comfortable max width.
export function Page({ children }) {
  return <div style={{ maxWidth: 1440, margin: "0 auto" }}>{children}</div>;
}

// ── SHARED UI COMPONENTS ──────────────────────────────────────────────────────
export function Badge({ children, variant = "default", size = "sm" }) {
  const map = {
    green: { bg: T.greenL, color: T.green }, red: { bg: T.redL, color: T.red },
    amber: { bg: T.amberL, color: T.amber }, blue: { bg: T.blueL, color: T.blue },
    navy: { bg: "#DCE8F5", color: T.navy }, purple: { bg: T.purpleL, color: T.purple },
    gold: { bg: "#FBF0D2", color: T.gold },
    default: { bg: T.lgrey, color: T.dgrey },
  };
  const s = map[variant] || map.default;
  return (
    <span style={{ background: s.bg, color: s.color, padding: size === "sm" ? "2px 8px" : "4px 12px", borderRadius: 20, fontSize: size === "sm" ? 11 : 12, fontWeight: 600, whiteSpace: "nowrap", display: "inline-block" }}>
      {children}
    </span>
  );
}

export function Card({ children, style = {}, onClick }) {
  return (
    <div onClick={onClick} style={{ background: "var(--card)", color: "var(--foreground)", borderRadius: 10, padding: 20, boxShadow: "0 1px 3px rgba(27,58,92,.08)", border: "1px solid var(--border)", cursor: onClick ? "pointer" : "default", ...style }}>
      {children}
    </div>
  );
}

export function Stat({ label, value, sub, icon, variant }) {
  const cols = { green: T.green, red: T.red, amber: T.amber, blue: T.blue };
  const bgs = { green: T.greenL, red: T.redL, amber: T.amberL, blue: T.blueL };
  return (
    <Card style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 10, color: "var(--muted-foreground)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5 }}>{label}</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: cols[variant] || "var(--foreground)", lineHeight: 1 }}>{value}</p>
          {sub && <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>{sub}</p>}
        </div>
        {icon && <div style={{ width: 36, height: 36, background: bgs[variant] || "#DCE8F5", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{icon}</div>}
      </div>
    </Card>
  );
}

export function Btn({ children, variant = "primary", onClick, size = "md", disabled = false, style = {}, type = "button" }) {
  const styles = {
    primary: { bg: T.navy, color: T.white },
    gold: { bg: T.gold, color: T.white },
    outline: { bg: "transparent", color: T.navy, border: `1.5px solid ${T.navy}` },
    danger: { bg: T.red, color: T.white },
    ghost: { bg: "var(--muted)", color: "var(--foreground)", border: "1px solid var(--border)" },
    green: { bg: T.green, color: T.white },
  };
  const s = styles[variant] || styles.primary;
  const pads = { sm: "5px 12px", md: "8px 18px", lg: "11px 24px" };
  // Defaults to type="button" so a Btn placed inside a <form> never triggers an
  // accidental submit — every Btn is onClick-driven. Pass type="submit" for the
  // rare form-submitting button.
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ background: disabled ? "var(--muted)" : s.bg, color: disabled ? "var(--muted-foreground)" : s.color, border: s.border || "none", padding: pads[size], borderRadius: 7, fontSize: size === "sm" ? 12 : 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", ...style }}>
      {children}
    </button>
  );
}

export function Alert({ type = "info", children }) {
  // Translucent brand tints over the page background rather than fixed pastel
  // fills, so the banner reads the same in light and dark mode instead of
  // punching a light patch into a dark page. Text is --foreground (always
  // legible); the colour lives in the accent border and icon.
  const t = {
    info: { rgb: "0,112,192", icon: "ℹ️" },
    warning: { rgb: "184,96,11", icon: "⚠️" },
    error: { rgb: "192,0,0", icon: "🔴" },
    success: { rgb: "30,107,60", icon: "✅" },
  }[type] || { rgb: "0,112,192", icon: "ℹ️" };
  return (
    <div style={{ background: `rgba(${t.rgb},0.10)`, border: `1px solid rgba(${t.rgb},0.32)`, borderLeft: `3px solid rgba(${t.rgb},0.8)`, color: "var(--foreground)", padding: "10px 14px", borderRadius: 8, display: "flex", gap: 8, fontSize: 13, marginBottom: 14 }}>
      <span>{t.icon}</span>
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  );
}

export function Progress({ value, height = 6 }) {
  return (
    <div style={{ background: "var(--muted)", borderRadius: 99, overflow: "hidden", height }}>
      <div style={{ width: `${Math.min((value || 0) * 100, 100)}%`, height: "100%", background: value >= 0.95 ? T.red : value >= 0.8 ? T.amber : T.green, borderRadius: 99, transition: "width .3s" }} />
    </div>
  );
}

export function Input({ label, value, onChange, name, defaultValue, type = "text", placeholder = "", required, note, readOnly, min, max, step }) {
  // Two modes, decided by whether the caller drives the value:
  //  - CONTROLLED  (value/onChange given, e.g. a modal with useState): the input
  //    mirrors that state.
  //  - UNCONTROLLED (only `name` given, e.g. a <form> read via FormData): the
  //    input keeps its own value and posts under `name`. Without this branch the
  //    field was pinned to "" with no onChange — so it looked frozen and you
  //    could not type (the Help Desk "New Ticket" form hit exactly this).
  const controlled = onChange !== undefined || value !== undefined;
  const modeProps = controlled
    ? { value: value ?? "", onChange: (e) => onChange && onChange(e.target.value) }
    : { defaultValue: defaultValue ?? "" };
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)", marginBottom: 5 }}>{label}{required && <span style={{ color: T.red }}> *</span>}</label>
      <input name={name} type={type} required={required} placeholder={placeholder} readOnly={readOnly} min={min} max={max} step={step} {...modeProps} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13, color: "var(--foreground)", background: readOnly ? "var(--muted)" : "var(--background)", outline: "none", boxSizing: "border-box" }} />
      {note && <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 3 }}>{note}</p>}
    </div>
  );
}

export function Select({ label, value, onChange, options, required, name, defaultValue }) {
  // Same controlled/uncontrolled split as Input, so <Select name=…> inside a
  // plain <form> posts its value via FormData without needing local state.
  const controlled = onChange !== undefined || value !== undefined;
  const modeProps = controlled
    ? { value: value ?? "", onChange: (e) => onChange && onChange(e.target.value) }
    : { defaultValue: defaultValue ?? "" };
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)", marginBottom: 5 }}>{label}{required && <span style={{ color: T.red }}> *</span>}</label>
      <select name={name} required={required} {...modeProps} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13, color: "var(--foreground)", background: "var(--background)", outline: "none", boxSizing: "border-box" }}>
        {options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
    </div>
  );
}

export function Modal({ title, children, onClose, width = 540 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(13,34,56,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "var(--card)", color: "var(--foreground)", borderRadius: 12, width: "100%", maxWidth: width, maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.3)" }}>
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${T.lgrey}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: T.navy, borderRadius: "12px 12px 0 0" }}>
          <h3 style={{ color: T.white, fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.white, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
      </div>
    </div>
  );
}

function cellText(node) {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(cellText).join(" ");
  if (typeof node === "object" && node.props) return cellText(node.props.children);
  return "";
}

export function DataTable({ headers, rows, empty = "No records found.", searchable }) {
  const [q, setQ] = useState("");
  const showSearch = searchable === true || (searchable !== false && rows.length > 8);
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = terms.length
    ? rows.filter((row) => { const t = row.map(cellText).join(" ").toLowerCase(); return terms.every((term) => t.includes(term)); })
    : rows;
  return (
    <div>
      {showSearch && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 13px 6px" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔎  Search this table…" aria-label="Search this table" style={{ flex: 1, maxWidth: 340, padding: "8px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, background: "var(--background)", color: "var(--foreground)" }} />
          {q && <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{visible.length} of {rows.length} rows</span>}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>{headers.map((h, i) => <th key={i} style={{ background: T.navy, color: T.white, padding: "9px 13px", textAlign: "left", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {visible.length === 0
              ? <tr><td colSpan={headers.length} style={{ padding: 40, textAlign: "center", color: "var(--muted-foreground)" }}>{q ? `Nothing matches "${q}".` : empty}</td></tr>
              : visible.map((row, i) => <tr key={i} style={{ background: i % 2 === 0 ? "var(--card)" : "var(--muted)" }}>{row.map((cell, j) => <td key={j} style={{ padding: "9px 13px", borderBottom: "1px solid var(--border)", verticalAlign: "middle", color: "var(--foreground)" }}>{cell}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SectionHeader({ title, sub, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
      <div><h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--foreground)", margin: 0 }}>{title}</h2>{sub && <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 3, margin: 0 }}>{sub}</p>}</div>
      {action}
    </div>
  );
}

export function Loading() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60, color: T.mgrey, fontSize: 13 }}>
      <div style={{ width: 24, height: 24, border: `3px solid ${T.lgrey}`, borderTopColor: T.navy, borderRadius: "50%", animation: "spin 1s linear infinite", marginRight: 12 }} />Loading…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export function Tabs({ tabs, active, setActive }) {
  return (
    <div style={{ display: "flex", gap: 0, marginBottom: 22, borderBottom: "1px solid var(--border)" }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => setActive(t.id)} style={{ padding: "9px 18px", background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: active === t.id ? 700 : 400, color: active === t.id ? "var(--foreground)" : "var(--muted-foreground)", borderBottom: active === t.id ? `2px solid ${T.gold}` : "2px solid transparent", marginBottom: -1 }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// A tidy responsive grid for Stat rows.
export function StatGrid({ children, min = 210 }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 14, marginBottom: 18 }}>
      {children}
    </div>
  );
}
