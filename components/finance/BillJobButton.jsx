"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Receipt, Loader2, X } from "lucide-react";
import { getBillingCustomers, billTechnicalJobPg } from "@/app/db/actions/finance-handoff-actions";

/**
 * "Bill" on a finished calibration job or inspection: raises a draft invoice
 * to the client for finance to review and send. Once raised, the button
 * becomes a link to that invoice.
 */
export default function BillJobButton({ kind, job, canBill }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState(null);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [taxRate, setTaxRate] = useState("16");
  const [description, setDescription] = useState("");
  const [busy, start] = useTransition();
  const number = job.jobNumber || job.inspectionNumber;

  if (job.invoiceId) {
    return (
      <Link href={`/dashboard/invoices/${job.invoiceId}`} className="tech-rowbtn" title="Open the invoice">
        <Receipt size={14} /> Invoice
      </Link>
    );
  }
  const finished = ["approved", "completed"].includes(job.status);
  if (!canBill || !finished || job.billingStatus !== "pending") return null;

  const openDialog = async () => {
    setOpen(true);
    if (!customers) {
      const list = await getBillingCustomers();
      setCustomers(list);
      const match = list.find((c) => c.name?.toLowerCase() === String(job.clientName ?? "").toLowerCase());
      if (match) setCustomerId(match.id);
    }
  };

  const field = { width: "100%", padding: "8px 10px", border: "1px solid var(--border, #d4d4d8)", borderRadius: 8, background: "var(--background, #fff)", color: "inherit", fontSize: 14 };

  return (
    <>
      <button type="button" className="tech-rowbtn" onClick={openDialog} title="Raise a draft invoice to the client">
        <Receipt size={14} /> Bill
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={`Bill ${number}`} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", padding: 16 }}>
          <div style={{ width: "min(460px, 100%)", background: "var(--card, #fff)", color: "inherit", borderRadius: 14, padding: 18, boxShadow: "0 20px 50px rgba(0,0,0,.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <strong>Bill {number}</strong>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: 0, cursor: "pointer", color: "inherit" }}>
                <X size={18} />
              </button>
            </div>
            <p style={{ fontSize: 12, opacity: 0.7, margin: "0 0 12px" }}>
              Raises a draft invoice for finance to review and send. Client on the job: {job.clientName || "—"}.
            </p>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Customer account</label>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ ...field, marginBottom: 10 }}>
              <option value="">{customers ? "Choose…" : "Loading…"}</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Amount (KES, before VAT)</label>
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={field} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>VAT %</label>
                <input inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} style={field} />
              </div>
            </div>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Line description (optional)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={`${job.serviceType || job.type || "Service"} — ${number}`} style={{ ...field, marginBottom: 14 }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="tech-rowbtn" onClick={() => setOpen(false)}>Cancel</button>
              <button
                type="button"
                className="tech-btn-gold"
                disabled={busy || !customerId || !(Number(amount) > 0)}
                onClick={() =>
                  start(async () => {
                    const r = await billTechnicalJobPg({ kind, id: job.id, customerId, amount: Number(amount), taxRate: Number(taxRate) || 0, description });
                    if (!r.success) return toast.error(r.error);
                    toast.success(r.message);
                    setOpen(false);
                    router.refresh();
                  })
                }
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />} Raise invoice
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
