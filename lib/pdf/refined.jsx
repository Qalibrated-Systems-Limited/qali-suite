import React from "react";
import { Text, View, StyleSheet, Image } from "@react-pdf/renderer";

/**
 * THE REFINED DOCUMENT DESIGN — ported from the QSL Workflow Reports app
 * (src/pdf/refined.jsx), so a report printed here is the report printed there:
 * a thin accent bar across the top, the boxed logo with contact lines and the
 * right-hand LABEL / value meta, a deep-gold rule, the coal title pill with gold
 * lettering and a status badge, gold-square section heads, and the ISO footer
 * with the "scan to verify" code.
 *
 * One difference from the original: it hard-coded Qalibrated's own name,
 * address and accreditations. Here they come from the company record
 * (Company Profile), so another company's reports carry that company's
 * details — the accreditation line is the company tagline.
 */

export const R = {
  GOLD: "#F5A800",
  GOLD_DK: "#8A6A00",
  COAL: "#161310",
  INK: "#26221C",
  MUTE: "#6B6355",
  FAINT: "#9A927F",
  PASS: "#2E7D46",
  FAIL: "#B03A2E",
  WAIT: "#946B00",
  LINE: "#E4DCCB",
  HAIR: "#D9D2C3",
  CREAM: "#F6F1E4",
  ACCENT: {
    report: { bar: "#1E6B63", tint: "#EDF5F3" },
    quotation: { bar: "#2E5E8E", tint: "#EBF2F8" },
    invoice: { bar: "#8A5A1E", tint: "#FAF3E9" },
    statement: { bar: "#5A4A7A", tint: "#F1EEF6" },
    management: { bar: "#2F6E4F", tint: "#ECF4EF" },
    calibration: { bar: "#1E6B63", tint: "#EDF5F3" },
    survey: { bar: "#8A5A1E", tint: "#FAF3E9" },
    training: { bar: "#2F6E4F", tint: "#ECF4EF" },
    audit: { bar: "#444039", tint: "#F2F0EC" },
    default: { bar: "#161310", tint: "#F5F2EB" },
  },
};

export function accentOf(kind) {
  return R.ACCENT[kind] || R.ACCENT.default;
}

const s = StyleSheet.create({
  topBar: { position: "absolute", top: 0, left: 0, right: 0, height: 13 },

  hRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  hLeft: { flexDirection: "row", alignItems: "flex-start", flex: 1, paddingRight: 14 },
  logoBox: {
    width: 62,
    height: 62,
    borderWidth: 0.8,
    borderColor: R.HAIR,
    borderRadius: 4,
    padding: 4,
    marginRight: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: { width: 52, height: 52, objectFit: "contain" },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold", color: R.COAL, letterSpacing: 0.3 },
  hText: { flex: 1, paddingTop: 3 },
  contact: { fontSize: 7.3, color: R.INK, marginTop: 1.5, lineHeight: 1.35 },
  contactGold: { fontSize: 7.3, color: R.GOLD_DK, marginTop: 1.5, fontFamily: "Helvetica-Bold" },
  hRight: { minWidth: 210 },
  metaRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 3.5, justifyContent: "flex-end" },
  metaK: {
    fontSize: 6.8,
    fontFamily: "Helvetica-Bold",
    color: R.FAINT,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    width: 52,
    textAlign: "right",
    marginRight: 10,
  },
  metaV: { fontSize: 8.6, fontFamily: "Helvetica-Bold", color: R.COAL, width: 148, textAlign: "left" },
  metaVMono: { fontSize: 8.4, fontFamily: "Courier-Bold", color: R.COAL, width: 148, textAlign: "left" },
  headRule: { borderBottomWidth: 1.4, borderBottomColor: R.GOLD_DK, marginTop: 8 },

  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12, marginBottom: 10 },
  pill: { backgroundColor: R.COAL, paddingVertical: 7, paddingHorizontal: 16, borderRadius: 3, maxWidth: "75%" },
  pillText: { fontSize: 15, fontFamily: "Helvetica-Bold", color: R.GOLD, letterSpacing: 2.5, textTransform: "uppercase" },
  badge: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 3 },
  badgeText: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 0.6, textTransform: "uppercase" },

  secHead: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: R.GOLD_DK,
    paddingBottom: 3,
    marginTop: 10,
    marginBottom: 6,
  },
  secSquare: { width: 6, height: 6, backgroundColor: R.GOLD, marginRight: 6 },
  secLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: R.MUTE, letterSpacing: 1, textTransform: "uppercase" },
  secCount: { fontSize: 7.5, color: R.FAINT, fontFamily: "Helvetica-Bold", marginLeft: 4 },

  footer: { position: "absolute", bottom: 20, left: 34, right: 34 },
  footRule: { borderBottomWidth: 1.2, borderBottomColor: R.GOLD_DK, marginBottom: 5 },
  footIso: { fontSize: 7, fontFamily: "Helvetica-Bold", color: R.COAL, textAlign: "center", letterSpacing: 0.3 },
  footSub: { fontSize: 6.6, fontFamily: "Courier", color: R.FAINT, textAlign: "center", marginTop: 3 },
  footNote: { fontSize: 6.6, color: R.MUTE, textAlign: "center", marginBottom: 5 },
  verifyBox: { position: "absolute", bottom: 54, right: 34, alignItems: "center" },
  verifyQr: { width: 46, height: 46 },
  verifyTxt: { fontSize: 5.8, fontFamily: "Helvetica-Bold", color: R.FAINT, letterSpacing: 0.6, marginTop: 2 },
});

/** A logo stored as a URL string or as { url, publicId }. */
export function logoOf(company) {
  if (typeof company?.logo === "string" && company.logo) return company.logo;
  return company?.logo?.url || null;
}

function addressOf(company) {
  if (!company) return "";
  if (company.fullAddress) return company.fullAddress;
  const a = company.address || {};
  if (typeof a === "string") return a;
  return [a.street, a.city, a.postalCode, a.country].filter(Boolean).join(", ");
}

/** A thin full-width accent bar pinned to the top of every page. */
export function TopBar({ kind = "default", color }) {
  const c = color || accentOf(kind).bar;
  return <View fixed style={[s.topBar, { backgroundColor: c }]} />;
}

/**
 * The letterhead: boxed logo and contact lines on the left, right-aligned
 * LABEL / value rows, closed by a deep-gold rule. meta: [{ k, v, mono? }].
 */
export function RefinedHeader({ company, meta = [] }) {
  const logo = logoOf(company);
  const lines = [addressOf(company), [company?.phone, company?.taxPin ? `PIN ${company.taxPin}` : null].filter(Boolean).join(" · ")]
    .filter(Boolean);
  const web = [company?.email, company?.website].filter(Boolean).join(" · ");
  return (
    <View>
      <View style={s.hRow}>
        <View style={s.hLeft}>
          {logo ? (
            <View style={s.logoBox}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
              <Image src={logo} style={s.logo} />
            </View>
          ) : null}
          <View style={s.hText}>
            {!logo && company?.name ? <Text style={s.brand}>{String(company.name).toUpperCase()}</Text> : null}
            {lines.map((ln, i) => (
              <Text key={i} style={s.contact}>{ln}</Text>
            ))}
            {web ? <Text style={s.contactGold}>{web}</Text> : null}
          </View>
        </View>
        <View style={s.hRight}>
          {meta.map((m, i) => (
            <View key={i} style={s.metaRow}>
              <Text style={s.metaK}>{m.k}</Text>
              <Text style={m.mono ? s.metaVMono : s.metaV}>{m.v == null || m.v === "" ? "—" : String(m.v)}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={s.headRule} />
    </View>
  );
}

/** Coal title pill with gold lettering, and a coloured status badge. */
export function TitlePill({ title, status }) {
  return (
    <View style={s.titleRow}>
      <View style={s.pill}>
        <Text style={s.pillText}>{title}</Text>
      </View>
      {status ? (
        <View style={[s.badge, { backgroundColor: status.bg || R.COAL }]}>
          <Text style={[s.badgeText, { color: status.color || "#fff" }]}>{status.label}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Gold-square section head with a gold underline. `count` prints "· N". */
export function SectionHead({ children, count, style }) {
  return (
    <View style={[s.secHead, style]}>
      <View style={s.secSquare} />
      <Text style={s.secLabel}>{children}</Text>
      {count != null ? <Text style={s.secCount}>· {count}</Text> : null}
    </View>
  );
}

/**
 * The ISO footer on every page: an optional note, the gold rule, the
 * accreditation line (the company tagline) and "Company · serial ·
 * System-generated · Page x of y".
 */
export function RefinedFooter({ company, serial, note }) {
  const iso = company?.tagline ? String(company.tagline).replace(/\s*·\s*/g, "  |  ").toUpperCase() : null;
  return (
    <View style={s.footer} fixed>
      {note ? <Text style={s.footNote}>{note}</Text> : null}
      <View style={s.footRule} />
      {iso ? <Text style={s.footIso}>{iso}</Text> : null}
      <Text
        style={s.footSub}
        render={({ pageNumber, totalPages }) =>
          [company?.name, serial, "System-generated", `Page ${pageNumber} of ${totalPages}`].filter(Boolean).join(" · ")
        }
      />
    </View>
  );
}

/** The small "SCAN TO VERIFY" code, bottom-right above the footer, page 1 only. */
export function VerifyQr({ qrSrc }) {
  if (!qrSrc) return null;
  return (
    <View
      fixed
      style={s.verifyBox}
      render={({ pageNumber }) =>
        pageNumber === 1 ? (
          <>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            <Image src={qrSrc} style={s.verifyQr} />
            <Text style={s.verifyTxt}>SCAN TO VERIFY</Text>
          </>
        ) : null
      }
    />
  );
}

/** Timestamps in East Africa Time, as the app prints them: "05 Nov 2026, 09:06 am EAT". */
export function fmtEat(d, withTime = true) {
  if (!d) return "—";
  try {
    return (
      new Date(d).toLocaleString("en-GB", {
        timeZone: "Africa/Nairobi",
        day: "2-digit",
        month: "short",
        year: "numeric",
        ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: true } : {}),
      }) + (withTime ? " EAT" : "")
    );
  } catch {
    return String(d);
  }
}
