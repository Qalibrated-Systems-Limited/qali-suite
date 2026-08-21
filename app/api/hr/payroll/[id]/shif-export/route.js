import { loadRunForExport, csvResponse, q, n } from "@/lib/hr/payroll-exports";

/**
 * SHIF monthly contribution return.
 *
 * SHIF replaced NHIF in October 2024: a flat percentage of gross with a
 * statutory floor, and no employer share.
 */
export async function GET(_req, { params }) {
  const { id } = await params;
  const { run, entries, error } = await loadRunForExport(id);
  if (error) return error;

  const headers = [
    "Employee Name",
    "Employee No",
    "National ID",
    "SHA No",
    "Gross Pay (KES)",
    "SHIF Contribution (KES)",
  ];

  const rows = entries.map((e) =>
    [
      q(e.employeeName),
      q(e.employeeNumber),
      q(e.nationalId),
      q(e.shaNumber),
      n(e.grossPay),
      n(e.shif),
    ].join(","),
  );

  const sum = (fn) => entries.reduce((acc, e) => acc + fn(e), 0);
  const totals = [
    q(`TOTAL (${entries.length} employees)`),
    q(""),
    q(""),
    q(""),
    n(sum((e) => e.grossPay)),
    n(sum((e) => e.shif)),
  ].join(",");

  return csvResponse(
    [
      q(`SHIF Monthly Contribution Return — ${run.label}`),
      headers.join(","),
      ...rows,
      totals,
    ],
    { run, name: "shif" },
  );
}
