// Server-render safe (no "use client") — rendered via renderToBuffer inside the
// /api/projects/[id]/methodology/pdf route, sharing the house PDF theme.
import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { formatDate, formatAddress } from "../utils";

const colors = {
  primary: "#eab308",
  primaryLight: "#fef3c7",
  dark: "#18181b",
  gray: "#71717a",
  grayLight: "#d4d4d8",
  grayLightest: "#f4f4f5",
  white: "#ffffff",
};

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: 40, backgroundColor: colors.white, color: colors.dark },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  logoSection: { flex: 1 },
  logo: { width: 140, height: 45, objectFit: "contain", marginBottom: 6 },
  companyDetails: { fontSize: 8, color: colors.gray, lineHeight: 1.4 },
  companyTagline: { fontSize: 8, fontFamily: "Helvetica-Oblique", color: colors.primary, marginTop: 4 },
  docHead: { alignItems: "flex-end" },
  docTitle: { fontSize: 20, fontFamily: "Helvetica-Bold", color: colors.primary, textAlign: "right" },
  docSub: { fontSize: 9, fontFamily: "Helvetica-Bold", color: colors.dark, marginTop: 4 },
  divider: { height: 2, backgroundColor: colors.primary, marginBottom: 16 },
  projectTitle: { fontSize: 15, fontFamily: "Helvetica-Bold", color: colors.dark, marginBottom: 2 },
  projectNo: { fontSize: 9, color: colors.gray, marginBottom: 12 },

  planRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  planCard: { flex: 1, backgroundColor: colors.grayLightest, padding: 10, borderRadius: 4 },
  planLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: colors.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  planValue: { fontSize: 11, fontFamily: "Helvetica-Bold", color: colors.dark },
  planSub: { fontSize: 8, color: colors.gray },

  sectionBar: { fontSize: 9, fontFamily: "Helvetica-Bold", color: colors.dark, textTransform: "uppercase", letterSpacing: 0.4, borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: 6, marginTop: 14, marginBottom: 6 },
  para: { fontSize: 9.5, color: colors.dark, lineHeight: 1.5 },
  empty: { fontSize: 9, color: colors.gray, fontFamily: "Helvetica-Oblique" },

  footer: { position: "absolute", bottom: 24, left: 40, right: 40, borderTopWidth: 1, borderTopColor: colors.grayLight, paddingTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footerMotto: { fontSize: 8, color: colors.primary, fontFamily: "Helvetica-Bold" },
  footerText: { fontSize: 7, color: colors.gray },
});

const SECTIONS = [
  ["scope", "Scope of Works"],
  ["approach", "Methodology / Approach"],
  ["sequenceOfWorks", "Sequence of Works"],
  ["resources", "Resources (Plant, Labour, Materials)"],
  ["healthSafety", "Health & Safety"],
  ["qualityControl", "Quality Control"],
  ["programmeSummary", "Programme Summary"],
  ["risks", "Risks & Mitigations"],
];

const money = (n) => `KES ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Number(n) || 0)}`;

export function MethodologyPDF({ methodology, project, company, links = {} }) {
  company = company || {};
  const m = methodology || {};
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={s.logoSection}>
            {typeof company?.logo === "string" && company.logo ? (
              <Image style={s.logo} src={company.logo} />
            ) : company?.logo?.url ? (
              <Image style={s.logo} src={company.logo.url} />
            ) : (
              <Text style={s.planValue}>{company?.name || "Qalibrated Systems Ltd"}</Text>
            )}
            <Text style={s.companyDetails}>
              {company?.name || "Qalibrated Systems Ltd"}
              {formatAddress(company?.address) ? `\n${formatAddress(company.address)}` : ""}
              {company?.phone || company?.email ? `\n${[company.phone, company.email].filter(Boolean).join(" | ")}` : ""}
            </Text>
            {company?.tagline ? <Text style={s.companyTagline}>{company.tagline}</Text> : null}
          </View>
          <View style={s.docHead}>
            <Text style={s.docTitle}>METHOD STATEMENT</Text>
            <Text style={s.docSub}>Implementation Methodology</Text>
          </View>
        </View>

        <View style={s.divider} />

        <Text style={s.projectTitle}>{project?.name || "Project"}</Text>
        <Text style={s.projectNo}>
          {project?.projectNumber || ""}
          {m.updatedAt ? `   ·   Updated ${formatDate(m.updatedAt)}` : ""}
        </Text>

        <View style={s.planRow}>
          <View style={s.planCard}>
            <Text style={s.planLabel}>Bill of Quantities</Text>
            <Text style={s.planValue}>{money(links.boqTotal)}</Text>
            <Text style={s.planSub}>{links.boqItems || 0} items</Text>
          </View>
          <View style={s.planCard}>
            <Text style={s.planLabel}>Milestones</Text>
            <Text style={s.planValue}>{links.milestoneCount || 0}</Text>
            <Text style={s.planSub}>{links.milestoneValue ? money(links.milestoneValue) : "no value set"}</Text>
          </View>
          <View style={s.planCard}>
            <Text style={s.planLabel}>Programme</Text>
            <Text style={s.planValue}>{links.taskCount || 0}</Text>
            <Text style={s.planSub}>activities</Text>
          </View>
        </View>

        {SECTIONS.map(([key, label]) => (
          <View key={key} wrap={false}>
            <Text style={s.sectionBar}>{label}</Text>
            {m[key] && String(m[key]).trim() ? (
              <Text style={s.para}>{String(m[key])}</Text>
            ) : (
              <Text style={s.empty}>Not set.</Text>
            )}
          </View>
        ))}

        <View style={s.footer} fixed>
          <Text style={s.footerMotto}>{company?.tagline || "Qalibrated Systems"}</Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Method Statement · Page ${pageNumber} of ${totalPages}`}
            fixed
          />
        </View>
      </Page>
    </Document>
  );
}

export default MethodologyPDF;
