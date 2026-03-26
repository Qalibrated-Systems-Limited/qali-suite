import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

// ============================================
// STYLES
// ============================================
const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#111827",
    padding: 32,
    backgroundColor: "#ffffff",
  },
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: "#CA8A04",
  },
  companyLogo: {
    width: 36,
    height: 36,
    marginRight: 8,
    borderRadius: 6,
  },
  companyHeaderLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  companyName: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  companyMeta: {
    fontSize: 8,
    color: "#6b7280",
    marginTop: 2,
  },
  payslipTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#CA8A04",
    textAlign: "right",
  },
  periodLabel: {
    fontSize: 9,
    color: "#374151",
    textAlign: "right",
    marginTop: 2,
  },
  payrollNumber: {
    fontSize: 7,
    color: "#9ca3af",
    textAlign: "right",
    marginTop: 1,
  },
  // Employee info block
  infoSection: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 14,
    backgroundColor: "#f9fafb",
    borderRadius: 4,
    padding: 10,
  },
  infoCol: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 7,
    color: "#9ca3af",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 9,
    color: "#111827",
    fontFamily: "Helvetica-Bold",
  },
  // Tables
  tableSection: {
    marginBottom: 10,
  },
  tableTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    color: "#6b7280",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  table: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 3,
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#fefce8",
    borderBottomWidth: 1,
    borderBottomColor: "#fde047",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tableRow: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  tableRowLast: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tableRowTotal: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: "#f9fafb",
    borderTopWidth: 1,
    borderTopColor: "#d1d5db",
  },
  colDescription: {
    flex: 3,
    fontSize: 8,
    color: "#374151",
  },
  colDescriptionHeader: {
    flex: 3,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#6b7280",
    textTransform: "uppercase",
  },
  colAmount: {
    flex: 1,
    fontSize: 8,
    color: "#374151",
    textAlign: "right",
  },
  colAmountHeader: {
    flex: 1,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#6b7280",
    textTransform: "uppercase",
    textAlign: "right",
  },
  colAmountTotal: {
    flex: 1,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    textAlign: "right",
  },
  colDescriptionTotal: {
    flex: 3,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  deductionAmount: {
    flex: 1,
    fontSize: 8,
    color: "#dc2626",
    textAlign: "right",
  },
  // Net pay box
  netPayBox: {
    backgroundColor: "#a16207",
    borderRadius: 6,
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 12,
  },
  netPayLabel: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  netPayAmount: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  // Employer contributions
  employerBox: {
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: 4,
    padding: 8,
    marginBottom: 10,
  },
  employerTitle: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#16a34a",
    textTransform: "uppercase",
    marginBottom: 5,
  },
  employerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  employerLabel: {
    fontSize: 8,
    color: "#374151",
  },
  employerValue: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#15803d",
  },
  // Payment details
  paymentBox: {
    backgroundColor: "#fefce8",
    borderWidth: 1,
    borderColor: "#fde047",
    borderRadius: 4,
    padding: 8,
    marginBottom: 10,
  },
  paymentTitle: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#CA8A04",
    textTransform: "uppercase",
    marginBottom: 5,
  },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  paymentLabel: {
    fontSize: 8,
    color: "#374151",
  },
  paymentValue: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  // Footer
  footer: {
    marginTop: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 7,
    color: "#9ca3af",
  },
  confidential: {
    fontSize: 7,
    color: "#9ca3af",
    fontStyle: "italic",
  },
  // Two-column layout for tables
  twoCol: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  col: {
    flex: 1,
  },
});

// ============================================
// HELPERS
// ============================================
function fmt(n) {
  if (!n && n !== 0) return "—";
  return new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function EarningRow({ label, value, isTotal, isLast }) {
  const rowStyle = isTotal ? styles.tableRowTotal : isLast ? styles.tableRowLast : styles.tableRow;
  return (
    <View style={rowStyle}>
      <Text style={isTotal ? styles.colDescriptionTotal : styles.colDescription}>{label}</Text>
      <Text style={isTotal ? styles.colAmountTotal : styles.colAmount}>{fmt(value)}</Text>
    </View>
  );
}

function DeductionRow({ label, value, isTotal, isLast }) {
  const rowStyle = isTotal ? styles.tableRowTotal : isLast ? styles.tableRowLast : styles.tableRow;
  return (
    <View style={rowStyle}>
      <Text style={isTotal ? styles.colDescriptionTotal : styles.colDescription}>{label}</Text>
      <Text style={isTotal ? styles.colAmountTotal : styles.deductionAmount}>{fmt(value)}</Text>
    </View>
  );
}

// ============================================
// PAYSLIP DOCUMENT
// ============================================
export function PayslipDocument({ run, entry, company }) {
  const e = entry.earnings || {};
  const d = entry.deductions || {};
  const emp = entry.employerContributions || {};
  const period = run.period?.label || `${run.period?.month}/${run.period?.year}`;

  const allowances = (e.housingAllowance || 0) + (e.transportAllowance || 0) + (e.medicalAllowance || 0);
  const variableEarnings = (e.overtime || 0) + (e.bonus || 0) + (e.commission || 0);

  const companyAddress = company?.address
    ? [company.address.street, company.address.city, company.address.country].filter(Boolean).join(", ")
    : null;

  return (
    <Document title={`Payslip — ${entry.employeeName} — ${period}`}>
      <Page size="A4" style={styles.page}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{company?.name || "Company"}</Text>
            {companyAddress && <Text style={styles.companyMeta}>{companyAddress}</Text>}
            {company?.email && <Text style={styles.companyMeta}>{company.email}</Text>}
            {company?.phone && <Text style={styles.companyMeta}>{company.phone}</Text>}
          </View>
          <View>
            <Text style={styles.payslipTitle}>PAYSLIP</Text>
            <Text style={styles.periodLabel}>{period}</Text>
            <Text style={styles.payrollNumber}>{run.payrollNumber}</Text>
          </View>
        </View>

        {/* ── Employee Info ── */}
        <View style={styles.infoSection}>
          <View style={styles.infoCol}>
            <Text style={styles.infoLabel}>Employee Name</Text>
            <Text style={styles.infoValue}>{entry.employeeName}</Text>
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoLabel}>Employee No</Text>
            <Text style={styles.infoValue}>{entry.employeeNumber || "—"}</Text>
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoLabel}>Department</Text>
            <Text style={styles.infoValue}>{entry.department || "—"}</Text>
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoLabel}>Designation</Text>
            <Text style={styles.infoValue}>{entry.designation || "—"}</Text>
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoLabel}>Employment Type</Text>
            <Text style={styles.infoValue}>{(entry.employmentType || "—").replace("_", " ").toUpperCase()}</Text>
          </View>
        </View>

        {/* ── Earnings & Deductions side by side ── */}
        <View style={styles.twoCol}>
          {/* Earnings */}
          <View style={styles.col}>
            <Text style={styles.tableTitle}>Earnings</Text>
            <View style={styles.table}>
              <View style={styles.tableHeaderRow}>
                <Text style={styles.colDescriptionHeader}>Description</Text>
                <Text style={styles.colAmountHeader}>Amount (KES)</Text>
              </View>
              <EarningRow label="Basic Salary" value={e.basicSalary} />
              {allowances > 0 && (
                <>
                  {e.housingAllowance > 0 && <EarningRow label="Housing Allowance" value={e.housingAllowance} />}
                  {e.transportAllowance > 0 && <EarningRow label="Transport Allowance" value={e.transportAllowance} />}
                  {e.medicalAllowance > 0 && <EarningRow label="Medical Allowance" value={e.medicalAllowance} />}
                </>
              )}
              {e.overtime > 0 && <EarningRow label="Overtime" value={e.overtime} />}
              {e.bonus > 0 && <EarningRow label="Bonus" value={e.bonus} />}
              {e.commission > 0 && <EarningRow label="Commission" value={e.commission} />}
              {(e.additional || []).map((item, i) => (
                <EarningRow key={i} label={item.description} value={item.amount} />
              ))}
              <EarningRow label="GROSS PAY" value={e.grossPay} isTotal />
            </View>
          </View>

          {/* Deductions */}
          <View style={styles.col}>
            <Text style={styles.tableTitle}>Deductions</Text>
            <View style={styles.table}>
              <View style={styles.tableHeaderRow}>
                <Text style={styles.colDescriptionHeader}>Description</Text>
                <Text style={styles.colAmountHeader}>Amount (KES)</Text>
              </View>
              <DeductionRow label="PAYE (Income Tax)" value={d.paye} />
              {d.insuranceRelief > 0 && <DeductionRow label="  Less: Insurance Relief" value={-d.insuranceRelief} />}
              <DeductionRow label="NSSF (Employee)" value={d.nssf} />
              <DeductionRow label="SHIF" value={d.shif} />
              <DeductionRow label="Housing Levy (AHL)" value={d.housingLevy} />
              {d.loanRepayment > 0 && <DeductionRow label="Loan Repayment" value={d.loanRepayment} />}
              {d.saccoDeduction > 0 && <DeductionRow label="SACCO" value={d.saccoDeduction} />}
              {(d.additional || []).map((item, i) => (
                <DeductionRow key={i} label={item.description} value={item.amount} />
              ))}
              <DeductionRow label="TOTAL DEDUCTIONS" value={d.totalDeductions} isTotal />
            </View>
          </View>
        </View>

        {/* ── Net Pay ── */}
        <View style={styles.netPayBox}>
          <Text style={styles.netPayLabel}>NET PAY</Text>
          <Text style={styles.netPayAmount}>KES {fmt(entry.netPay)}</Text>
        </View>

        {/* ── Employer Contributions (not deducted from employee) ── */}
        {(emp.nssf > 0 || emp.housingLevy > 0) && (
          <View style={styles.employerBox}>
            <Text style={styles.employerTitle}>Employer Contributions (Not deducted from your salary)</Text>
            <View style={styles.employerRow}>
              <Text style={styles.employerLabel}>NSSF Employer Share</Text>
              <Text style={styles.employerValue}>KES {fmt(emp.nssf)}</Text>
            </View>
            <View style={styles.employerRow}>
              <Text style={styles.employerLabel}>Housing Levy Employer Share (AHL)</Text>
              <Text style={styles.employerValue}>KES {fmt(emp.housingLevy)}</Text>
            </View>
          </View>
        )}

        {/* ── Payment Details ── */}
        <View style={styles.paymentBox}>
          <Text style={styles.paymentTitle}>Payment Details</Text>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Payment Method</Text>
            <Text style={styles.paymentValue}>{(entry.paymentMethod || "Bank").toUpperCase()}</Text>
          </View>
          {entry.paymentMethod === "bank" && (
            <>
              {entry.bankName && (
                <View style={styles.paymentRow}>
                  <Text style={styles.paymentLabel}>Bank</Text>
                  <Text style={styles.paymentValue}>{entry.bankName}</Text>
                </View>
              )}
              {entry.bankBranch && (
                <View style={styles.paymentRow}>
                  <Text style={styles.paymentLabel}>Branch</Text>
                  <Text style={styles.paymentValue}>{entry.bankBranch}</Text>
                </View>
              )}
              {entry.bankAccount && (
                <View style={styles.paymentRow}>
                  <Text style={styles.paymentLabel}>Account Number</Text>
                  <Text style={styles.paymentValue}>
                    {"•".repeat(Math.max(0, (entry.bankAccount.length || 4) - 4)) +
                      entry.bankAccount.slice(-4)}
                  </Text>
                </View>
              )}
            </>
          )}
          {entry.paymentMethod === "mpesa" && entry.mpesaNumber && (
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>M-Pesa Number</Text>
              <Text style={styles.paymentValue}>
                {entry.mpesaNumber.slice(0, 3) + "••••••" + entry.mpesaNumber.slice(-3)}
              </Text>
            </View>
          )}
          {entry.paidAt && (
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Payment Date</Text>
              <Text style={styles.paymentValue}>
                {new Date(entry.paidAt).toLocaleDateString("en-KE", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </Text>
            </View>
          )}
        </View>

        {/* ── Notes ── */}
        {entry.notes && (
          <View style={{ marginBottom: 10 }}>
            <Text style={{ fontSize: 7, color: "#6b7280", fontStyle: "italic" }}>
              Note: {entry.notes}
            </Text>
          </View>
        )}

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Generated on {new Date().toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}
          </Text>
          <Text style={styles.confidential}>CONFIDENTIAL — For the named employee only</Text>
          <Text style={{ fontSize: 7, color: "#CA8A04" }}>Powered by QaliSuite</Text>
        </View>
      </Page>
    </Document>
  );
}
