import { NextResponse } from "next/server";
import { loadRunForExport, csvResponse, q, n } from "@/lib/hr/payroll-exports";

/** Safaricom B2C bulk payment file. */
export async function GET(_req, { params }) {
  const { id } = await params;
  const { run, entries, error } = await loadRunForExport(id);
  if (error) return error;

  const payable = entries.filter((e) => e.paymentMethod === "mpesa");
  if (!payable.length) {
    return NextResponse.json(
      { error: "Nobody on this run is paid by M-Pesa." },
      { status: 404 },
    );
  }

  /**
   * 254XXXXXXXXX, which is the only form Daraja accepts.
   *
   * A number that cannot be normalised is refused rather than written into
   * the file — the source emits whatever it has, and the batch fails at
   * Safaricom with no indication of which row is wrong.
   */
  const normalise = (raw) => {
    let phone = (raw ?? "").replace(/[\s-]/g, "");
    if (phone.startsWith("+")) phone = phone.slice(1);
    if (phone.startsWith("0")) phone = `254${phone.slice(1)}`;
    if (/^7\d{8}$/.test(phone) || /^1\d{8}$/.test(phone)) phone = `254${phone}`;
    return /^254[17]\d{8}$/.test(phone) ? phone : null;
  };

  const bad = payable.filter((e) => !normalise(e.mpesaNumber));
  if (bad.length) {
    return NextResponse.json(
      {
        error: `${bad.length} employee(s) are paid by M-Pesa but have no usable number: ${bad
          .map((e) => `${e.employeeName} (${e.mpesaNumber || "blank"})`)
          .join(", ")}. Correct them, then export again.`,
      },
      { status: 400 },
    );
  }

  const reference = `SAL-${run.payrollNumber}`;
  const headers = ["PhoneNumber", "Amount", "Occasion", "Remarks"];

  const rows = payable.map((e) =>
    [
      q(normalise(e.mpesaNumber)),
      n(e.netPay),
      q(`${run.label} Salary`),
      q(`${reference} - ${e.employeeName}`),
    ].join(","),
  );

  return csvResponse([headers.join(","), ...rows], { run, name: "mpesa-payroll" });
}
