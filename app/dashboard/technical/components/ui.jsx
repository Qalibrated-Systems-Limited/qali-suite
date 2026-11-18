/**
 * The Workflow Reports app's UI kit (its src/components/ui.jsx and
 * src/lib/theme.js), so this module's screens are made of the same parts:
 * the paper card between hazard stripes, the gold-square section bar, the
 * solid status pill and the labelled identifier chip.
 *
 * Server-safe — no hooks — so both the server pages and the client forms use it.
 */

export const GOLD = "#F5A800";
export const COAL = "#161310";
export const INK = "#26221C";
export const PASS = "#2E7D46";
export const FAIL = "#B03A2E";
export const WAIT = "#946B00";
export const MUTE = "#6B6355";

/**
 * The app's status pills, for this module's four states. The app routes every
 * report to one manager; here the submitter names a supervisor and an
 * approving manager, so the review is two pills where the app has one.
 */
export const STATUS = {
  draft: { label: "DRAFT", color: MUTE },
  submitted: { label: "SUPERVISOR REVIEW", color: WAIT },
  reviewed: { label: "MANAGER APPROVAL", color: WAIT },
  approved: { label: "APPROVED", color: PASS },
};

const STATE_COLORS = { ok: PASS, pass: PASS, attn: WAIT, adj: WAIT, na: MUTE, problem: FAIL, fail: FAIL };
export function colorFor(key) {
  return STATE_COLORS[key] || FAIL;
}

export function Stripe() {
  return <div className="stripe" />;
}

export function Pill({ status }) {
  const s = STATUS[status] || { label: String(status || "").toUpperCase(), color: INK };
  return (
    <span className="pill" style={{ background: s.color }}>
      {s.label}
    </span>
  );
}

export function SectionBar({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 8px" }}>
      <span style={{ background: GOLD, width: 10, height: 10, flexShrink: 0 }} />
      <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: ".03em", textTransform: "uppercase", color: INK }}>
        {children}
      </span>
    </div>
  );
}

export function PaperCard({ children }) {
  return (
    <div className="card">
      <Stripe />
      <div className="paper" style={{ padding: 20 }}>
        {children}
      </div>
      <Stripe />
    </div>
  );
}

/** A labelled identifier chip — Client / Site / Weighbridge on the report header. */
export function IdChip({ label, value, mono }) {
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 1,
        background: "#FBF8F0",
        border: `1px solid ${GOLD}`,
        borderRadius: 8,
        padding: "5px 11px",
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: MUTE }}>
        {label}
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: mono ? "var(--mono)" : "inherit" }}>
        {value}
      </span>
    </span>
  );
}

/** Findings on a report: checklist answers other than the good one. */
export function findingsCount(report, template) {
  const checks = report?.data?.checks || {};
  let n = 0;
  (template?.sections || []).forEach((sec, si) => {
    if (sec.type !== "checklist") return;
    const good = (sec.states || [{ key: "ok" }])[0].key;
    sec.items.forEach((_, ii) => {
      const st = checks[`${si}:${ii}`]?.state;
      if (st && st !== good && st !== "na") n++;
    });
  });
  return n;
}

/**
 * The weekly End–Middle–End verdict, computed as the app computes it live on
 * the form: the biggest spread across a run against the site's limit. Null
 * until a run and the limit are both in.
 */
export function weeklyVerdict(runs = {}, limitValue) {
  const diffs = [1, 2].map((r) => {
    const nums = ["a", "m", "b"].map((p) => parseFloat(runs[`${r}${p}`]));
    if (nums.some((n) => Number.isNaN(n))) return null;
    return Math.max(...nums) - Math.min(...nums);
  });
  const limit = parseFloat(limitValue);
  const worst = Math.max(...diffs.map((d) => (d == null ? 0 : d)));
  const pass = diffs.every((d) => d == null) || Number.isNaN(limit) ? null : worst <= limit;
  return { worst, pass, limit: Number.isNaN(limit) ? null : limit };
}
