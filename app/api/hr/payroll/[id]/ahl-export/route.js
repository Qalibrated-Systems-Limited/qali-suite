import { loadRunForExport, csvResponse, q, n } from "@/lib/hr/payroll-exports";

/**
 * Affordable Housing Levy return.
 *
 * Employee and employer each contribute; both are remitted together.
 */
export async function GET(_req, { params }) {
  const { id } = await params;
  const { run, entries, error } = await loadRunForExport(id);
  if (error) return error;

  const headers = [
    "Employee Name",
    "Employee No",
    "National ID",
    "KRA PIN",
    "Gross Pay (KES)",
    "Employee AHL (KES)",
    "Employer AHL (KES)",
    "Total AHL (KES)",
  ];

  const rows = entries.map((e) =>
    [
      q(e.employeeName),
      q(e.employeeNumber),
      q(e.nationalId),
      q(e.kraPin),
      n(e.grossPay),
      n(e.housingLevy),
      n(e.employerHousingLevy),
      n(e.housingLevy + e.employerHousingLevy),
    ].join(","),
  );

  const sum = (fn) => entries.reduce((acc, e) => acc + fn(e), 0);
  const totals = [
    q(`TOTAL (${entries.length} employees)`),
    q(""),
    q(""),
    q(""),
    n(sum((e) => e.grossPay)),
    n(sum((e) => e.housingLevy)),
    n(sum((e) => e.employerHousingLevy)),
    n(sum((e) => e.housingLevy + e.employerHousingLevy)),
  ].join(",");

  return csvResponse(
    [
      q(`Affordable Housing Levy Return — ${run.label}`),
      headers.join(","),
      ...rows,
      totals,
    ],
    { run, name: "ahl" },
  );
}
