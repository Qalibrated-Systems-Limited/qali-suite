import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

/**
 * The two documents an employee leaves with: the certificate of service
 * (s.51) and the statement of their final dues.
 */

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10, color: "#111827", padding: 48, backgroundColor: "#ffffff" },
  header: { marginBottom: 24, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: "#CA8A04" },
  companyName: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  companyMeta: { fontSize: 8, color: "#6b7280", marginTop: 2 },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "center", marginBottom: 4, letterSpacing: 1 },
  subtitle: { fontSize: 8, color: "#6b7280", textAlign: "center", marginBottom: 24 },
  paragraph: { fontSize: 10, lineHeight: 1.6, marginBottom: 12 },
  table: { marginTop: 4, marginBottom: 16 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", paddingVertical: 5 },
  label: { width: "38%", color: "#6b7280" },
  value: { width: "62%", fontFamily: "Helvetica-Bold" },
  sectionTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#6b7280", marginTop: 12, marginBottom: 4, textTransform: "uppercase" },
  lineRow: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#f3f4f6" },
  lineDesc: { flex: 1, paddingRight: 8 },
  lineSub: { fontSize: 7, color: "#6b7280", marginTop: 1 },
  lineAmount: { width: 110, textAlign: "right" },
  totalRow: { flexDirection: "row", paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#111827", marginTop: 2 },
  totalLabel: { flex: 1, fontFamily: "Helvetica-Bold" },
  totalAmount: { width: 110, textAlign: "right", fontFamily: "Helvetica-Bold" },
  signatures: { flexDirection: "row", justifyContent: "space-between", marginTop: 48 },
  signature: { width: "42%" },
  signatureLine: { borderTopWidth: 0.75, borderTopColor: "#111827", paddingTop: 4, fontSize: 8, color: "#6b7280" },
  footer: { position: "absolute", bottom: 28, left: 48, right: 48, fontSize: 7, color: "#9ca3af", textAlign: "center" },
});

const longDate = (d) =>
  d
    ? new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "—";
const kes = (n) =>
  (Number(n) || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Letterhead({ company }) {
  const address = company?.address
    ? [company.address.street, company.address.city, company.address.country].filter(Boolean).join(", ")
    : null;
  return (
    <View style={styles.header}>
      <Text style={styles.companyName}>{company?.name || "Company"}</Text>
      {address && <Text style={styles.companyMeta}>{address}</Text>}
      {company?.email && <Text style={styles.companyMeta}>{company.email}</Text>}
      {company?.phone && <Text style={styles.companyMeta}>{company.phone}</Text>}
    </View>
  );
}

function Detail({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value || "—"}</Text>
    </View>
  );
}

/**
 * s.51(2): the employer and its address, the employee, the dates the
 * employment began and ended, and the nature and usual place of the work.
 * Deliberately nothing else — no reason for leaving, no remark on conduct.
 */
export function CertificateOfServiceDocument({ company, data, issuedOn }) {
  const e = data.employee;
  const positions = data.positions.map((p, i) => {
    const to = i + 1 < data.positions.length ? data.positions[i + 1].from : e.terminationDate;
    return `${p.title} (${longDate(p.from)} – ${longDate(to)})`;
  });

  return (
    <Document title={`Certificate of Service — ${e.fullName}`}>
      <Page size="A4" style={styles.page}>
        <Letterhead company={company} />
        <Text style={styles.title}>CERTIFICATE OF SERVICE</Text>
        <Text style={styles.subtitle}>Issued under section 51 of the Employment Act, 2007</Text>

        <Text style={styles.paragraph}>
          This is to certify that {e.fullName} was employed by {company?.name || "the employer"} as set out
          below.
        </Text>

        <View style={styles.table}>
          <Detail label="Name of employee" value={e.fullName} />
          <Detail label="National ID / Passport" value={e.nationalId} />
          <Detail label="Employee number" value={e.employeeNumber} />
          <Detail label="Date employment commenced" value={longDate(e.hireDate)} />
          <Detail label="Date employment terminated" value={longDate(e.terminationDate)} />
          <Detail label="Nature of employment" value={positions.join("; ")} />
          {e.department && <Detail label="Department" value={e.department} />}
          <Detail label="Usual place of work" value={e.workLocation} />
        </View>

        <Text style={styles.paragraph}>
          Issued on {longDate(issuedOn)}
          {data.reference ? `, reference ${data.reference}` : ""}.
        </Text>

        <View style={styles.signatures}>
          <View style={styles.signature}>
            <Text style={styles.signatureLine}>Signed for and on behalf of the employer</Text>
          </View>
          <View style={styles.signature}>
            <Text style={styles.signatureLine}>Name, title and company stamp</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          {company?.name} · Certificate of service for {e.fullName} · {e.employeeNumber}
        </Text>
      </Page>
    </Document>
  );
}

export function FinalDuesStatementDocument({ company, data }) {
  const { exit, employee, dues } = data;
  const t = dues.totals;
  const earnings = dues.lines.filter((l) => l.kind === "earning");
  const preTax = dues.lines.filter((l) => l.kind === "deduction" && l.taxable);
  const postTax = dues.lines.filter((l) => l.kind === "deduction" && !l.taxable);
  const sub = (l) => (l.quantity != null && l.rate != null ? `${l.quantity} × ${kes(l.rate)}` : null);

  const Line = ({ l, negative }) => (
    <View style={styles.lineRow}>
      <View style={styles.lineDesc}>
        <Text>{l.description}</Text>
        {sub(l) && <Text style={styles.lineSub}>{sub(l)}</Text>}
      </View>
      <Text style={styles.lineAmount}>{negative ? `(${kes(l.amount)})` : kes(l.amount)}</Text>
    </View>
  );
  const Simple = ({ label, amount }) => (
    <View style={styles.lineRow}>
      <Text style={styles.lineDesc}>{label}</Text>
      <Text style={styles.lineAmount}>({kes(amount)})</Text>
    </View>
  );

  return (
    <Document title={`Final dues — ${employee.fullName}`}>
      <Page size="A4" style={styles.page}>
        <Letterhead company={company} />
        <Text style={styles.title}>STATEMENT OF FINAL DUES</Text>
        <Text style={styles.subtitle}>{exit.exitNumber}</Text>

        <View style={styles.table}>
          <Detail label="Employee" value={`${employee.fullName} (${employee.employeeNumber})`} />
          <Detail label="Position" value={[employee.designation, employee.department].filter(Boolean).join(", ")} />
          <Detail label="Date employment commenced" value={longDate(employee.hireDate)} />
          <Detail label="Last working day" value={longDate(exit.lastWorkingDate)} />
          <Detail label="Separation" value={exit.exitTypeLabel} />
        </View>

        <Text style={styles.sectionTitle}>Earnings (KES)</Text>
        {earnings.map((l) => <Line key={l.id} l={l} />)}
        {preTax.map((l) => <Line key={l.id} l={l} negative />)}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Gross final dues</Text>
          <Text style={styles.totalAmount}>{kes(t.grossEarnings)}</Text>
        </View>

        <Text style={styles.sectionTitle}>Deductions (KES)</Text>
        <Simple label="PAYE" amount={t.paye} />
        <Simple label="NSSF" amount={t.nssf} />
        <Simple label="SHIF" amount={t.shif} />
        <Simple label="Affordable Housing Levy" amount={t.housingLevy} />
        {postTax.map((l) => <Line key={l.id} l={l} negative />)}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Net final dues payable</Text>
          <Text style={styles.totalAmount}>{kes(t.net)}</Text>
        </View>

        <Text style={[styles.paragraph, { marginTop: 16, fontSize: 9 }]}>
          I acknowledge receipt of the net final dues above in full and final settlement of my dues on
          leaving employment.
        </Text>

        <View style={styles.signatures}>
          <View style={styles.signature}>
            <Text style={styles.signatureLine}>Employee signature and date</Text>
          </View>
          <View style={styles.signature}>
            <Text style={styles.signatureLine}>For the employer</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          {company?.name} · {exit.exitNumber} · approved by {exit.approvedByName}
        </Text>
      </Page>
    </Document>
  );
}
