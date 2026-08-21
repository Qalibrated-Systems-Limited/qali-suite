import { NextResponse } from "next/server";
import {
  loadRunForExport,
  csvResponse,
  q,
  n,
} from "@/lib/hr/payroll-exports";

/**
 * Bulk bank transfer file.
 *
 * Generic CSV, which is what most Kenyan bank portals accept for a bulk
 * upload.
 */
export async function GET(_req, { params }) {
  const { id } = await params;
  const { run, entries, error } = await loadRunForExport(id);
  if (error) return error;

  const payable = entries.filter((e) => e.paymentMethod === "bank");
  if (!payable.length) {
    return NextResponse.json(
      { error: "Nobody on this run is paid by bank transfer." },
      { status: 404 },
    );
  }

  // Somebody paid by bank with no account number cannot be paid. The source
  // writes them into the file with an empty column, where the bank rejects the
  // whole batch.
  const missing = payable.filter((e) => !e.bankAccount);
  if (missing.length) {
    return NextResponse.json(
      {
        error: `${missing.length} employee(s) are paid by bank transfer but have no account number: ${missing
          .map((e) => e.employeeName)
          .join(", ")}. Add their bank details, then export again.`,
      },
      { status: 400 },
    );
  }

  const reference = `SAL-${run.payrollNumber}`;
  const headers = [
    "Employee Name",
    "Employee No",
    "Department",
    "Bank Name",
    "Branch",
    "Account Number",
    "Amount (KES)",
    "Narrative",
    "Payment Status",
  ];

  const rows = payable.map((e) =>
    [
      q(e.employeeName),
      q(e.employeeNumber),
      q(e.department),
      q(e.bankName),
      q(e.bankBranch),
      q(e.bankAccount),
      n(e.netPay),
      q(`${run.label} Salary - ${reference}`),
      q(e.paymentStatus),
    ].join(","),
  );

  return csvResponse([headers.join(","), ...rows], { run, name: "bank-payroll" });
}
