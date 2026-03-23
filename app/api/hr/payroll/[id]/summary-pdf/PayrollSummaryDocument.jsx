import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 8,
    color: "#111827",
    padding: 28,
    backgroundColor: "#ffffff",
  },
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: "#1d4ed8",
  },
  companyName: { fontSize: 14, fontFamily: "Helvetica-Bold", color: "#1d4ed8" },
  companyMeta: { fontSize: 7.5, color: "#6b7280", marginTop: 1 },
  docTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", color: "#111827", textAlign: "right" },
  docMeta: { fontSize: 7.5, color: "#6b7280", textAlign: "right", marginTop: 1 },
  // Section header
  sectionTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 10,
    paddingBottom: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
  },
  // Summary boxes
  boxRow: { flexDirection: "row", gap: 6, marginBottom: 10 },
  box: { flex: 1, borderWidth: 0.5, borderColor: "#e5e7eb", borderRadius: 4, padding: 8 },
  boxLabel: { fontSize: 7, color: "#6b7280", marginBottom: 2 },
  boxValue: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#111827" },
  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderTopWidth: 0.5,
    borderTopColor: "#d1d5db",
    borderBottomWidth: 0.5,
    borderBottomColor: "#d1d5db",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottomWidth: 0.3,
    borderBottomColor: "#f3f4f6",
  },
  tableRowAlt: { backgroundColor: "#f9fafb" },
  tableTotal: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: "#eff6ff",
    borderTopWidth: 0.5,
    borderTopColor: "#93c5fd",
  },
  th: { fontFamily: "Helvetica-Bold", color: "#374151" },
  td: { color: "#374151" },
  tdGray: { color: "#6b7280" },
  // Employer section
  empBox: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
    padding: 8,
    backgroundColor: "#f0fdf4",
    borderWidth: 0.5,
    borderColor: "#bbf7d0",
    borderRadius: 4,
  },
  empLabel: { fontSize: 7, color: "#166534", marginBottom: 1 },
  empValue: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#166534" },
  // Footer
  footer: {
    marginTop: 14,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: "#e5e7eb",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 7, color: "#9ca3af" },
  // Columns — named for clarity
  colNo: { width: "4%", color: "#374151" },
  colName: { width: "22%", color: "#374151" },
  colDept: { width: "14%", color: "#374151" },
  colBasic: { width: "10%", textAlign: "right", color: "#374151" },
  colGross: { width: "10%", textAlign: "right", color: "#374151" },
  colPAYE: { width: "9%", textAlign: "right", color: "#374151" },
  colNSSF: { width: "7%", textAlign: "right", color: "#374151" },
  colSHIF: { width: "7%", textAlign: "right", color: "#374151" },
  colAHL: { width: "7%", textAlign: "right", color: "#374151" },
  colNet: { width: "10%", textAlign: "right", fontFamily: "Helvetica-Bold", color: "#374151" },
});

const fmt = (n) => (n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PayrollSummaryDocument({ run, entries, company }) {
  const t = run.totals || {};
  const period = run.period?.label || `${run.period?.month}/${run.period?.year}`;
  const generatedAt = new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.companyName}>{company?.name || "Company"}</Text>
            {company?.email && <Text style={s.companyMeta}>{company.email}</Text>}
            {company?.phone && <Text style={s.companyMeta}>{company.phone}</Text>}
          </View>
          <View>
            <Text style={s.docTitle}>Payroll Summary Report</Text>
            <Text style={s.docMeta}>Period: {period}</Text>
            <Text style={s.docMeta}>Payroll No: {run.payrollNumber}</Text>
            <Text style={s.docMeta}>Status: {run.status?.toUpperCase()}</Text>
            <Text style={s.docMeta}>Generated: {generatedAt}</Text>
          </View>
        </View>

        {/* Summary boxes */}
        <View style={s.boxRow}>
          <View style={s.box}>
            <Text style={s.boxLabel}>Employees</Text>
            <Text style={s.boxValue}>{t.employeeCount || entries.length}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.boxLabel}>Total Gross Pay (KES)</Text>
            <Text style={s.boxValue}>{fmt(t.totalGrossPay)}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.boxLabel}>Total Deductions (KES)</Text>
            <Text style={s.boxValue}>{fmt(t.totalDeductions)}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.boxLabel}>Total Net Pay (KES)</Text>
            <Text style={{ ...s.boxValue, color: "#1d4ed8" }}>{fmt(t.totalNetPay)}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.boxLabel}>Total PAYE (KES)</Text>
            <Text style={s.boxValue}>{fmt(t.totalPAYE)}</Text>
          </View>
        </View>

        {/* Employee breakdown table */}
        <Text style={s.sectionTitle}>Employee Breakdown</Text>

        {/* Table header */}
        <View style={s.tableHeader}>
          <Text style={{ ...s.colNo, ...s.th }}>#</Text>
          <Text style={{ ...s.colName, ...s.th }}>Employee</Text>
          <Text style={{ ...s.colDept, ...s.th }}>Department</Text>
          <Text style={{ ...s.colBasic, ...s.th }}>Basic</Text>
          <Text style={{ ...s.colGross, ...s.th }}>Gross</Text>
          <Text style={{ ...s.colPAYE, ...s.th }}>PAYE</Text>
          <Text style={{ ...s.colNSSF, ...s.th }}>NSSF</Text>
          <Text style={{ ...s.colSHIF, ...s.th }}>SHIF</Text>
          <Text style={{ ...s.colAHL, ...s.th }}>AHL</Text>
          <Text style={{ ...s.colNet, ...s.th }}>Net Pay</Text>
        </View>

        {entries.map((e, idx) => (
          <View key={e._id?.toString() || idx} style={idx % 2 === 1 ? { ...s.tableRow, ...s.tableRowAlt } : s.tableRow}>
            <Text style={{ ...s.colNo, ...s.tdGray }}>{idx + 1}</Text>
            <Text style={s.colName}>{e.employeeName}</Text>
            <Text style={{ ...s.colDept, ...s.tdGray }}>{e.department || "—"}</Text>
            <Text style={s.colBasic}>{fmt(e.earnings?.basicSalary)}</Text>
            <Text style={s.colGross}>{fmt(e.earnings?.grossPay)}</Text>
            <Text style={s.colPAYE}>{fmt(e.deductions?.paye)}</Text>
            <Text style={s.colNSSF}>{fmt(e.deductions?.nssf)}</Text>
            <Text style={s.colSHIF}>{fmt(e.deductions?.shif)}</Text>
            <Text style={s.colAHL}>{fmt(e.deductions?.housingLevy)}</Text>
            <Text style={s.colNet}>{fmt(e.netPay)}</Text>
          </View>
        ))}

        {/* Totals row */}
        <View style={s.tableTotal}>
          <Text style={{ ...s.colNo, ...s.th }}></Text>
          <Text style={{ ...s.colName, ...s.th }}>TOTAL ({entries.length})</Text>
          <Text style={s.colDept}></Text>
          <Text style={{ ...s.colBasic, ...s.th }}>{fmt(t.totalBasicSalary)}</Text>
          <Text style={{ ...s.colGross, ...s.th }}>{fmt(t.totalGrossPay)}</Text>
          <Text style={{ ...s.colPAYE, ...s.th }}>{fmt(t.totalPAYE)}</Text>
          <Text style={{ ...s.colNSSF, ...s.th }}>{fmt(t.totalNSSF)}</Text>
          <Text style={{ ...s.colSHIF, ...s.th }}>{fmt(t.totalSHIF)}</Text>
          <Text style={{ ...s.colAHL, ...s.th }}>{fmt(t.totalHousingLevy)}</Text>
          <Text style={{ ...s.colNet, ...s.th, color: "#1d4ed8" }}>{fmt(t.totalNetPay)}</Text>
        </View>

        {/* Employer contributions */}
        <Text style={s.sectionTitle}>Employer Statutory Contributions</Text>
        <View style={s.empBox}>
          <View style={{ flex: 1 }}>
            <Text style={s.empLabel}>Employer NSSF (KES)</Text>
            <Text style={s.empValue}>{fmt(t.totalEmployerNSSF)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.empLabel}>Employer AHL (KES)</Text>
            <Text style={s.empValue}>{fmt(t.totalEmployerAHL)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.empLabel}>Total Employer Cost (KES)</Text>
            <Text style={s.empValue}>{fmt((t.totalGrossPay || 0) + (t.totalEmployerNSSF || 0) + (t.totalEmployerAHL || 0))}</Text>
          </View>
        </View>

        {/* Authorisation */}
        <View style={{ flexDirection: "row", gap: 30, marginTop: 16 }}>
          {["Prepared By", "Reviewed By", "Approved By"].map((label) => (
            <View key={label} style={{ flex: 1 }}>
              <Text style={{ fontSize: 7, color: "#6b7280", marginBottom: 18 }}>{label}:</Text>
              <View style={{ borderTopWidth: 0.5, borderTopColor: "#9ca3af" }} />
              <Text style={{ fontSize: 7, color: "#6b7280", marginTop: 3 }}>Name &amp; Signature</Text>
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>CONFIDENTIAL — For internal use only</Text>
          <Text style={s.footerText}>{company?.name} · {period} Payroll · {run.payrollNumber}</Text>
          <Text style={s.footerText}>Generated {generatedAt}</Text>
        </View>
      </Page>
    </Document>
  );
}
