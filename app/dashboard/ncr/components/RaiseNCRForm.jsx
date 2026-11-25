"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Send, PackageSearch, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NCR_REASONS, categoryForReason } from "@/lib/ncr/reasons";
import {
  createNonconformancePg,
  createNonconformanceFromReceiptPg,
} from "@/app/db/actions/ncr-actions";
import { attachInventoryDocuments } from "@/app/db/actions/inventory-document-actions";
import { FileUpload } from "@/components/file-upload";

const input =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";
const blankLine = () => ({ productId: "", expected: "", actual: "", severity: "minor", notes: "" });

export default function RaiseNCRForm({ options, initialReceiptId = "" }) {
  const router = useRouter();
  const [mode, setMode] = useState(initialReceiptId ? "receipt" : "stock");
  const [receiptId, setReceiptId] = useState(initialReceiptId);
  const [reason, setReason] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [impact, setImpact] = useState("");
  const [requiresCar, setRequiresCar] = useState(false);
  const [lines, setLines] = useState([blankLine()]);
  const [files, setFiles] = useState([]);
  const [busy, start] = useTransition();

  /** Attach the evidence to the new NCR, then open it. */
  const finish = async (res) => {
    if (files.length) {
      const a = await attachInventoryDocuments(
        "nonconformance",
        res.nonconformanceId,
        files.map((f) => ({
          name: f.filename,
          url: f.url,
          publicId: f.publicId,
          mimeType: f.mimeType,
          size: f.size,
          category: f.mimeType?.startsWith("image/") ? "evidence_photo" : "inspection",
        })),
      );
      if (!a.success) toast.error(`NCR raised, but the files were not attached: ${a.error}`);
    }
    toast.success(res.message);
    router.push(`/dashboard/ncr/${res.nonconformanceId}`);
  };

  const reasons = useMemo(
    () => (mode === "receipt" ? NCR_REASONS.filter((r) => r.supplier || r.value === "other") : NCR_REASONS),
    [mode],
  );
  const supplier = options.suppliers.find((s) => s.id === supplierId);
  const productsById = useMemo(() => Object.fromEntries(options.products.map((p) => [p.id, p])), [options.products]);
  const setLine = (i, patch) => setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = () => {
    if (!reason) return toast.error("Choose the reason for this NCR.");
    if (mode === "receipt") {
      if (!receiptId) return toast.error("Choose the goods receipt.");
      start(async () => {
        const res = await createNonconformanceFromReceiptPg(receiptId, {
          reasonCode: reason,
          title: title.trim() || null,
          description: description.trim() || null,
          requiresCar,
        });
        if (!res.success) return toast.error(res.error);
        await finish(res);
      });
      return;
    }
    if (!title.trim() || !description.trim()) return toast.error("Give it a title and describe what is wrong.");
    const chosen = lines.filter((l) => l.productId);
    const payload = {
      category: categoryForReason(reason),
      sourceType: reason.startsWith("count_") ? "stock_count" : reason === "deterioration_in_store" ? "stock_deterioration" : "manual",
      supplierId: supplierId || null,
      supplierName: supplier?.name ?? null,
      title: title.trim(),
      description: description.trim(),
      estimatedImpact: impact === "" ? null : Number(impact),
      requiresCar,
      reasonCode: reason,
      lines: chosen.map((l) => {
        const p = productsById[l.productId];
        return {
          productId: l.productId,
          productName: p?.name ?? null,
          productSku: p?.sku ?? null,
          description: p?.name ?? null,
          unit: p?.unit ?? null,
          expectedQuantity: String(Number(l.expected || 0)),
          actualQuantity: String(Number(l.actual || 0)),
          severity: l.severity,
          notes: l.notes || null,
        };
      }),
    };
    start(async () => {
      const fd = new FormData();
      fd.append("data", JSON.stringify(payload));
      const res = await createNonconformancePg(null, fd);
      if (!res.success) {
        const first = res.fieldErrors ? Object.values(res.fieldErrors).flat()[0] : null;
        return toast.error(first || res.error);
      }
      await finish(res);
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        {[
          ["receipt", PackageSearch, "From a goods receipt", "Short, over, damaged or wrong deliveries"],
          ["stock", ClipboardList, "Stock in store", "Count variances, deterioration, other items"],
        ].map(([value, Icon, label, hint]) => (
          <button
            type="button"
            key={value}
            onClick={() => {
              setMode(value);
              setReason("");
            }}
            aria-pressed={mode === value}
            className={`rounded-xl border p-3 text-left transition-colors ${
              mode === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/40"
            }`}
          >
            <Icon className="mb-1 h-5 w-5 text-primary" />
            <p className="text-sm font-semibold">{label}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </button>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Reason for the NCR</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {reasons.map((r) => (
            <label
              key={r.value}
              className={`flex cursor-pointer gap-2 rounded-lg border p-2.5 text-sm transition-colors ${
                reason === r.value ? "border-amber-500 bg-amber-500/5 ring-1 ring-amber-500" : "border-border hover:bg-muted/40"
              }`}
            >
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="mt-0.5 accent-amber-600"
              />
              <span>
                <span className="block font-medium">{r.label}</span>
                <span className="block text-xs text-muted-foreground">{r.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {mode === "receipt" ? (
        <section className="space-y-2">
          <label className="text-sm font-semibold" htmlFor="ncr-grn">Goods receipt</label>
          <select id="ncr-grn" value={receiptId} onChange={(e) => setReceiptId(e.target.value)} className={input}>
            <option value="">Choose…</option>
            {options.receipts.map((g) => (
              <option key={g.id} value={g.id}>
                {g.number} — {g.supplier || "no supplier"} ({g.status.replace(/_/g, " ")})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            The lines that do not match what was ordered, or were not in good condition, are taken from the receipt.
          </p>
        </section>
      ) : (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Items affected</h2>
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((l) => [...l, blankLine()])}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add item
            </Button>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <select aria-label="Product" value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })} className={input}>
                <option value="">Product…</option>
                {options.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.sku ? `(${p.sku})` : ""}
                  </option>
                ))}
              </select>
              <input aria-label="Expected" inputMode="decimal" placeholder="Expected" value={l.expected} onChange={(e) => setLine(i, { expected: e.target.value })} className={input} />
              <input aria-label="Actual" inputMode="decimal" placeholder="Actual" value={l.actual} onChange={(e) => setLine(i, { actual: e.target.value })} className={input} />
              <select aria-label="Severity" value={l.severity} onChange={(e) => setLine(i, { severity: e.target.value })} className={input}>
                <option value="minor">Minor</option>
                <option value="major">Major</option>
                <option value="critical">Critical</option>
              </select>
              <button
                type="button"
                onClick={() => setLines((all) => (all.length > 1 ? all.filter((_, j) => j !== i) : [blankLine()]))}
                className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                aria-label="Remove item"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <input aria-label="Notes" placeholder="Notes for this item" value={l.notes} onChange={(e) => setLine(i, { notes: e.target.value })} className={`${input} sm:col-span-5`} />
            </div>
          ))}
          <div>
            <label className="text-sm font-semibold" htmlFor="ncr-supplier">Supplier (if it came from one)</label>
            <select id="ncr-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={input}>
              <option value="">None — an internal matter</option>
              {options.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.email ? "" : " (no email on file)"}
                </option>
              ))}
            </select>
            {supplier && (
              <p className="mt-1 text-xs text-muted-foreground">
                {supplier.email
                  ? `The discrepancy will be emailed to ${supplier.email} as soon as it is raised.`
                  : "No email on file — record on the NCR how the supplier was told (call, letter, in person)."}
              </p>
            )}
          </div>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="text-sm font-semibold" htmlFor="ncr-title">Title{mode === "receipt" ? " (optional)" : ""}</label>
          <input id="ncr-title" value={title} onChange={(e) => setTitle(e.target.value)} className={input} placeholder="e.g. 12 pressure gauges arrived with cracked glass" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-sm font-semibold" htmlFor="ncr-desc">What is wrong{mode === "receipt" ? " (optional)" : ""}</label>
          <textarea id="ncr-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={input} placeholder="What was found, where, and when" />
        </div>
        {mode === "stock" && (
          <div>
            <label className="text-sm font-semibold" htmlFor="ncr-impact">Estimated impact (KES)</label>
            <input id="ncr-impact" inputMode="decimal" value={impact} onChange={(e) => setImpact(e.target.value)} className={input} />
          </div>
        )}
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={requiresCar} onChange={(e) => setRequiresCar(e.target.checked)} className="h-4 w-4" />
          Needs a corrective action request (CAR)
        </label>
      </section>

      <section className="space-y-1">
        <h2 className="text-sm font-semibold">Evidence (optional)</h2>
        <p className="text-xs text-muted-foreground">Photos of the goods, test reports, the delivery note.</p>
        <FileUpload value={files} onChange={setFiles} folder="inventory" maxFiles={10} />
      </section>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Raise NCR
        </Button>
      </div>
    </div>
  );
}
