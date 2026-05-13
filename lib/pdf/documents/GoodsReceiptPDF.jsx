// NOTE: intentionally no "use client" directive here. The other PDF
// docs (DeliveryNotePDF, PurchaseOrderPDF) mark themselves "use client"
// but they're rendered from client components via PDFDownloadLink. Our
// GRN PDF is generated server-side inside the /api/grn/[id]/pdf route,
// so it must be importable as a plain server module — same pattern as
// PayslipDocument.jsx.
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";

// ============================================
// GOODS RECEIPT NOTE PDF
// ============================================
// Mirrors the visual language of the existing PDF docs (DeliveryNote,
// PurchaseOrder, Invoice) but laid out for receiving operations:
//
//   1. Header (company, GRN number, status pill)
//   2. Supplier + source-reference (Bill / PO / Unscheduled)
//   3. Receipt event (date, received by)
//   4. Line table with expected / received / accepted + condition
//   5. Sales & Finance sign-off blocks at the bottom — required for
//      audit, matches SOP §10.1.2 step 5
//   6. Discrepancy note + reject reason if applicable
//   7. Footer with audit info
// ============================================

const colors = {
  primary: "#eab308",
  dark: "#18181b",
  gray: "#71717a",
  grayLight: "#d4d4d8",
  grayLightest: "#f4f4f5",
  white: "#ffffff",
  good: "#16a34a",
  warn: "#d97706",
  bad: "#dc2626",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    padding: 36,
    backgroundColor: colors.white,
    color: colors.dark,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  logoSection: { flex: 1 },
  logo: { width: 130, height: 40, objectFit: "contain", marginBottom: 6 },
  companyName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
    marginBottom: 2,
  },
  companyDetails: {
    fontSize: 8,
    color: colors.gray,
    lineHeight: 1.4,
  },
  docHeader: { alignItems: "flex-end" },
  docTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    marginBottom: 4,
  },
  docNumber: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
  },
  statusPill: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
  },

  divider: {
    height: 2,
    backgroundColor: colors.primary,
    marginBottom: 16,
  },

  // Two-column info row (supplier left, source right)
  infoRow: {
    flexDirection: "row",
    marginBottom: 14,
    gap: 10,
  },
  infoCard: {
    flex: 1,
    backgroundColor: colors.grayLightest,
    padding: 10,
    borderRadius: 4,
  },
  infoLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.gray,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  infoText: { fontSize: 9, color: colors.dark, lineHeight: 1.4 },
  infoTextBold: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
  },

  // Receipt meta row (received date, received by, period)
  metaRow: {
    flexDirection: "row",
    marginBottom: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: colors.grayLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.grayLight,
  },
  metaCol: { flex: 1 },
  metaLabel: {
    fontSize: 7,
    color: colors.gray,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
  },

  // Line table
  table: { marginBottom: 14 },
  thRow: {
    flexDirection: "row",
    backgroundColor: colors.dark,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  th: {
    color: colors.white,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    paddingHorizontal: 4,
  },
  tdRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.grayLight,
  },
  td: { fontSize: 9, color: colors.dark, paddingHorizontal: 4 },
  tdMuted: { fontSize: 8, color: colors.gray, paddingHorizontal: 4 },
  // Column widths sum to 100
  colIdx: { width: "4%" },
  colDesc: { width: "32%" },
  colExp: { width: "10%", textAlign: "right" },
  colRec: { width: "10%", textAlign: "right" },
  colAcc: { width: "10%", textAlign: "right" },
  colUnit: { width: "8%" },
  colPack: { width: "12%" },
  colPhys: { width: "14%" },

  // Sign-off (industry-standard receipt section)
  signoffRow: {
    flexDirection: "row",
    marginTop: 18,
    gap: 14,
  },
  signoffBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.grayLight,
    borderRadius: 4,
    padding: 10,
    minHeight: 70,
  },
  signoffTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.gray,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  signoffName: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
  },
  signoffMeta: { fontSize: 8, color: colors.gray, marginTop: 2 },
  signoffPlaceholder: {
    fontSize: 8,
    fontStyle: "italic",
    color: colors.grayLight,
  },

  // Notes block
  notesBox: {
    marginTop: 14,
    padding: 10,
    backgroundColor: colors.grayLightest,
    borderRadius: 4,
  },
  notesLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.gray,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  notesText: { fontSize: 9, color: colors.dark, lineHeight: 1.5 },
  discrepancyText: {
    fontSize: 9,
    color: colors.warn,
    lineHeight: 1.5,
    fontFamily: "Helvetica-Bold",
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: colors.gray,
    borderTopWidth: 0.5,
    borderTopColor: colors.grayLight,
    paddingTop: 6,
  },
});

// Status-specific pill colours
const STATUS_PILL = {
  draft: { bg: "#f4f4f5", color: "#71717a" },
  pending_acceptance: { bg: "#fef3c7", color: "#92400e" },
  accepted: { bg: "#d1fae5", color: "#065f46" },
  partially_accepted: { bg: "#dbeafe", color: "#1e40af" },
  rejected: { bg: "#fee2e2", color: "#991b1b" },
  voided: { bg: "#f4f4f5", color: "#71717a" },
};
const STATUS_LABEL = {
  draft: "Draft",
  pending_acceptance: "Pending acceptance",
  accepted: "Accepted",
  partially_accepted: "Partially accepted",
  rejected: "Rejected",
  voided: "Voided",
};

const CONDITION_COLOR = {
  good: colors.good,
  damaged: colors.warn,
  moisture: colors.warn,
  tampered: colors.bad,
  broken: colors.bad,
  deformed: colors.warn,
  defective: colors.bad,
};

function formatAddress(addr) {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  // Structured address subdoc — join non-empty parts with commas.
  const parts = [
    addr.street,
    addr.city,
    addr.state,
    addr.postalCode,
    addr.country,
  ].filter((p) => typeof p === "string" && p.trim());
  return parts.join(", ");
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const GoodsReceiptPDF = ({ grn, company }) => {
  const pill = STATUS_PILL[grn?.status] || STATUS_PILL.draft;
  const sourceLabel = (() => {
    if (grn?.source?.type === "bill") return `Bill: ${grn.source.reference || "—"}`;
    if (grn?.source?.type === "purchase_order")
      return `Purchase Order: ${grn.source.reference || "—"}`;
    return "Unscheduled receipt";
  })();

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.logoSection}>
            {/* Some tenants store logo as an object ({url, publicId});
                @react-pdf needs a string src. Resolve defensively. */}
            {typeof company?.logo === "string" && company.logo ? (
              <Image src={company.logo} style={styles.logo} />
            ) : company?.logo?.url ? (
              <Image src={company.logo.url} style={styles.logo} />
            ) : (
              <Text style={styles.companyName}>
                {company?.name || "Your Company"}
              </Text>
            )}
            {/* Address may be a string OR a structured object
                ({ street, city, state, postalCode, country }) depending
                on tenant. Flatten to a single string before rendering;
                Text children must be primitives in @react-pdf. */}
            <Text style={styles.companyDetails}>
              {formatAddress(company?.address)}
              {formatAddress(company?.address) ? "\n" : ""}
              {company?.email || ""}
              {company?.email && company?.phone ? " · " : ""}
              {company?.phone || ""}
            </Text>
          </View>
          <View style={styles.docHeader}>
            <Text style={styles.docTitle}>GOODS RECEIPT NOTE</Text>
            <Text style={styles.docNumber}>{grn?.grnNumber || ""}</Text>
            <Text
              style={[
                styles.statusPill,
                { backgroundColor: pill.bg, color: pill.color },
              ]}
            >
              {STATUS_LABEL[grn?.status] || grn?.status}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* SUPPLIER + SOURCE */}
        <View style={styles.infoRow}>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Supplier</Text>
            <Text style={styles.infoTextBold}>
              {grn?.supplier?.name || "—"}
            </Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Source</Text>
            <Text style={styles.infoText}>{sourceLabel}</Text>
            {grn?.source?.proformaInvoiceNumber ? (
              <Text style={styles.infoText}>
                PI: {grn.source.proformaInvoiceNumber}
              </Text>
            ) : null}
            {grn?.source?.packingListNumber ? (
              <Text style={styles.infoText}>
                Packing list: {grn.source.packingListNumber}
              </Text>
            ) : null}
          </View>
        </View>

        {/* META */}
        <View style={styles.metaRow}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Received date</Text>
            <Text style={styles.metaValue}>{fmtDate(grn?.receivedDate)}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Received by</Text>
            <Text style={styles.metaValue}>
              {grn?.receivedBy?.name || "—"}
            </Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Acceptance</Text>
            <Text style={styles.metaValue}>
              {grn?.acceptedAt
                ? fmtDate(grn.acceptedAt)
                : grn?.status === "rejected"
                ? fmtDate(grn.rejectedAt)
                : "Pending"}
            </Text>
          </View>
        </View>

        {/* LINES */}
        <View style={styles.table}>
          <View style={styles.thRow}>
            <Text style={[styles.th, styles.colIdx]}>#</Text>
            <Text style={[styles.th, styles.colDesc]}>Item</Text>
            <Text style={[styles.th, styles.colExp]}>Expected</Text>
            <Text style={[styles.th, styles.colRec]}>Received</Text>
            <Text style={[styles.th, styles.colAcc]}>Accepted</Text>
            <Text style={[styles.th, styles.colUnit]}>Unit</Text>
            <Text style={[styles.th, styles.colPack]}>Packaging</Text>
            <Text style={[styles.th, styles.colPhys]}>Physical</Text>
          </View>

          {(grn?.lines || []).map((line, i) => (
            <View key={line._id || i} style={styles.tdRow}>
              <Text style={[styles.td, styles.colIdx]}>{i + 1}</Text>
              <View style={styles.colDesc}>
                <Text style={styles.td}>{line.description}</Text>
                {line.sku ? (
                  <Text style={styles.tdMuted}>{line.sku}</Text>
                ) : null}
                {line.inspectionNotes ? (
                  <Text style={[styles.tdMuted, { color: colors.warn }]}>
                    “{line.inspectionNotes}”
                  </Text>
                ) : null}
                {line.storageLocation ? (
                  <Text style={styles.tdMuted}>
                    Storage: {line.storageLocation}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.td, styles.colExp]}>{line.expectedQty}</Text>
              <Text style={[styles.td, styles.colRec]}>{line.receivedQty}</Text>
              <Text style={[styles.td, styles.colAcc]}>
                {line.acceptedQty || (line.lineStatus === "rejected" ? "0" : "—")}
              </Text>
              <Text style={[styles.td, styles.colUnit]}>{line.unit || ""}</Text>
              <Text
                style={[
                  styles.td,
                  styles.colPack,
                  {
                    color:
                      CONDITION_COLOR[line.packagingCondition] || colors.dark,
                  },
                ]}
              >
                {line.packagingCondition || "good"}
              </Text>
              <Text
                style={[
                  styles.td,
                  styles.colPhys,
                  {
                    color:
                      CONDITION_COLOR[line.physicalCondition] || colors.dark,
                  },
                ]}
              >
                {line.physicalCondition || "good"}
              </Text>
            </View>
          ))}
        </View>

        {/* DISCREPANCY / NOTES */}
        {grn?.hasDiscrepancy && grn?.discrepancyNotes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Discrepancy</Text>
            <Text style={styles.discrepancyText}>{grn.discrepancyNotes}</Text>
          </View>
        ) : null}
        {grn?.notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{grn.notes}</Text>
          </View>
        ) : null}
        {grn?.rejectReason ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Reject reason</Text>
            <Text style={[styles.notesText, { color: colors.bad }]}>
              {grn.rejectReason}
            </Text>
          </View>
        ) : null}

        {/* SIGN-OFFS */}
        <View style={styles.signoffRow}>
          <View style={styles.signoffBox}>
            <Text style={styles.signoffTitle}>Received & inspected by</Text>
            <Text style={styles.signoffName}>
              {grn?.receivedBy?.name || "—"}
            </Text>
            <Text style={styles.signoffMeta}>
              {fmtDateTime(grn?.createdAt)}
            </Text>
          </View>
          <View style={styles.signoffBox}>
            <Text style={styles.signoffTitle}>Sales acceptance</Text>
            {grn?.salesAccepted?.at ? (
              <>
                <Text style={styles.signoffName}>
                  {grn.salesAccepted.name}
                </Text>
                <Text style={styles.signoffMeta}>
                  {fmtDateTime(grn.salesAccepted.at)}
                </Text>
              </>
            ) : (
              <Text style={styles.signoffPlaceholder}>Awaiting</Text>
            )}
          </View>
          <View style={styles.signoffBox}>
            <Text style={styles.signoffTitle}>Finance acceptance</Text>
            {grn?.financeAccepted?.at ? (
              <>
                <Text style={styles.signoffName}>
                  {grn.financeAccepted.name}
                </Text>
                <Text style={styles.signoffMeta}>
                  {fmtDateTime(grn.financeAccepted.at)}
                </Text>
              </>
            ) : (
              <Text style={styles.signoffPlaceholder}>Awaiting</Text>
            )}
          </View>
        </View>

        {/* FOOTER */}
        <View style={styles.footer} fixed>
          <Text>
            {company?.name || "Company"} · GRN {grn?.grnNumber}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages} · Generated ${fmtDate(new Date())}`
            }
          />
        </View>
      </Page>
    </Document>
  );
};
