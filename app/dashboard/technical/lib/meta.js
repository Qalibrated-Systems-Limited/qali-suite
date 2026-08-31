/**
 * Technical module — the single source of truth for the report sheets, the
 * review-workflow statuses and the status folders. Mirrors the standalone QSL
 * app: eight sheet templates (WB01–WB06, SI01, TR01), a four-state review
 * workflow, and a "browse by status" folder set.
 *
 * The report's stored `type` column holds the sheet CODE (e.g. "WB01"); the
 * serial number is issued per-sheet, so a report reads QSL-WB01-00001.
 */

import { TEMPLATES } from "./templates";

/**
 * The sheet catalogue for the pickers and cards, derived from the ported QSL
 * template definitions so there is one source of truth for both the fields a
 * sheet renders (templates.js) and how it is listed here.
 */
export const SHEETS = TEMPLATES.filter((t) => !t.hidden).map((t) => ({
  code: t.code,
  name: t.name,
  blurb: t.desc,
  filledBy: t.who,
}));

export const SHEET_BY_CODE = Object.fromEntries(SHEETS.map((s) => [s.code, s]));

export function sheetName(code) {
  return SHEET_BY_CODE[code]?.name || code || "Report";
}

/** Display serial: QSL-WB01-00001 from the stored "WB01-00001". */
export function displaySerial(reportNumber) {
  if (!reportNumber) return "";
  return `QSL-${reportNumber}`;
}

/**
 * Review workflow. The stored status is draft/submitted/reviewed/approved;
 * the labels are the QSL sign-off stages the standalone app shows on its
 * dashboard (Supervisor review / Manager approval / Approved).
 */
export const STATUS_CONFIG = {
  draft: { label: "Draft", color: "var(--tech-slate)" },
  submitted: { label: "Supervisor review", color: "var(--tech-olive)" },
  reviewed: { label: "Manager approval", color: "var(--tech-amber)" },
  approved: { label: "Approved", color: "var(--tech-green)" },
};

/** The one forward step from each state (drives the workflow buttons). */
export const NEXT_STEP = {
  draft: { action: "submit", label: "Submit for review" },
  submitted: { action: "review", label: "Supervisor sign-off" },
  reviewed: { action: "approve", label: "Manager approval" },
  approved: null,
};

/** Folders shown on the registry — All / Draft / In review / Approved. */
export const FOLDERS = [
  {
    key: "all",
    label: "All reports",
    caption: "Every report across all projects and statuses.",
    g1: "#57493A",
    g2: "#1E1911",
    icon: "grid",
  },
  {
    key: "draft",
    label: "Drafts",
    caption: "Started but not yet submitted for review.",
    g1: "#7C8695",
    g2: "#464F5C",
    icon: "edit",
  },
  {
    key: "in_review",
    label: "In review",
    caption: "Waiting on a supervisor or manager to sign off.",
    g1: "#D8AE3E",
    g2: "#8B6F1F",
    icon: "clock",
  },
  {
    key: "approved",
    label: "Approved",
    caption: "Reviewed, signed off and filed — no action needed.",
    g1: "#33A473",
    g2: "#155038",
    icon: "check",
  },
];

export const FOLDER_ICON_PATHS = {
  grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
};

/** Which stored statuses each folder holds. */
export function statusesForFolder(key) {
  if (key === "draft") return ["draft"];
  if (key === "in_review") return ["submitted", "reviewed"];
  if (key === "approved") return ["approved"];
  return ["draft", "submitted", "reviewed", "approved"];
}

export function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function fmtMoney(n) {
  if (n == null) return "—";
  return `KES ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Number(n) || 0)}`;
}

export function timeAgo(value) {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return fmtDate(value);
}
