import {
  loadRunForExport,
  csvResponse,
  taxableIncome,
  q,
  n,
} from "@/lib/hr/payroll-exports";

/**
 * KRA P10 — the monthly PAYE return.
 *
 * Taxable income comes from the shared definition: gross less NSSF, SHIF and
 * the housing levy, all three allowable since the Tax Laws (Amendment) Act
 * 2024. The source subtracted NSSF alone, so the return stated a taxable
 * income that did not agree with the PAYE beside it.
 */
export async function GET(_req, { params }) {
  const { id } = await params;
  const { run, entries, error } = await loadRunForExport(id);
  if (error) return error;

  const headers = [
    "Employee Name",
    "Employee No",
    "KRA PIN",
    "National ID",
    "Basic Salary (KES)",
    "Gross Pay (KES)",
    "Taxable Income (KES)",
    "PAYE (KES)",
    "Insurance Relief (KES)",
    "NSSF Employee (KES)",
    "SHIF (KES)",
    "AHL Employee (KES)",
  ];

  const rows = entries.map((e) =>
    [
      q(e.employeeName),
      q(e.employeeNumber),
      q(e.kraPin),
      q(e.nationalId),
      n(e.basicSalary),
      n(e.grossPay),
      n(taxableIncome(e)),
      n(e.paye),
      n(e.insuranceRelief),
      n(e.nssf),
      n(e.shif),
      n(e.housingLevy),
    ].join(","),
  );

  const sum = (fn) => entries.reduce((acc, e) => acc + fn(e), 0);
  const totals = [
    q(`TOTAL (${entries.length} employees)`),
    q(""),
    q(""),
    q(""),
    n(sum((e) => e.basicSalary)),
    n(sum((e) => e.grossPay)),
    n(sum(taxableIncome)),
    n(sum((e) => e.paye)),
    n(sum((e) => e.insuranceRelief)),
    n(sum((e) => e.nssf)),
    n(sum((e) => e.shif)),
    n(sum((e) => e.housingLevy)),
  ].join(",");

  return csvResponse(
    [
      q(`KRA P10 — Monthly PAYE Return — ${run.label}`),
      headers.join(","),
      ...rows,
      totals,
    ],
    { run, name: "p10-paye" },
  );
}
