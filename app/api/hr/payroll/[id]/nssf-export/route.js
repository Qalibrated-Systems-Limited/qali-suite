import { loadRunForExport, csvResponse, q, n } from "@/lib/hr/payroll-exports";

/** NSSF monthly contribution return — employee and employer sides. */
export async function GET(_req, { params }) {
  const { id } = await params;
  const { run, entries, error } = await loadRunForExport(id);
  if (error) return error;

  const headers = [
    "Employee Name",
    "Employee No",
    "National ID",
    "NSSF No",
    "Gross Pay (KES)",
    "Employee NSSF (KES)",
    "Employer NSSF (KES)",
    "Total NSSF (KES)",
  ];

  const rows = entries.map((e) =>
    [
      q(e.employeeName),
      q(e.employeeNumber),
      q(e.nationalId),
      q(e.nssfNumber),
      n(e.grossPay),
      n(e.nssf),
      n(e.employerNssf),
      n(e.nssf + e.employerNssf),
    ].join(","),
  );

  const sum = (fn) => entries.reduce((acc, e) => acc + fn(e), 0);
  const totals = [
    q(`TOTAL (${entries.length} employees)`),
    q(""),
    q(""),
    q(""),
    n(sum((e) => e.grossPay)),
    n(sum((e) => e.nssf)),
    n(sum((e) => e.employerNssf)),
    n(sum((e) => e.nssf + e.employerNssf)),
  ].join(",");

  return csvResponse(
    [
      q(`NSSF Monthly Contribution Return — ${run.label}`),
      headers.join(","),
      ...rows,
      totals,
    ],
    { run, name: "nssf" },
  );
}
