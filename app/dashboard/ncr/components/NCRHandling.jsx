"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, Mail, Pencil, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  recordNcrHandlingPg,
  notifyNcrSupplierPg,
  recordNcrSupplierResponsePg,
} from "@/app/db/actions/ncr-actions";

/**
 * How this NCR is being handled, step by step, and what is still missing
 * before it may close. The same rule is checked on the server when the
 * disposition is carried out.
 */

const when = (d) =>
  d ? new Date(d).toLocaleString("en-KE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const field =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

function Step({ n, done, title, children, last }) {
  return (
    <li className="relative flex gap-3 pb-5">
      {!last && <span className="absolute left-[11px] top-6 h-full w-px bg-border" aria-hidden />}
      <span
        className={`relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          done ? "bg-emerald-600 text-white" : "border border-border bg-card text-muted-foreground"
        }`}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${done ? "" : "text-muted-foreground"}`}>{title}</p>
        <div className="mt-1 text-sm">{children}</div>
      </div>
    </li>
  );
}

function TextStep({ ncrId, step, value, placeholder, locked }) {
  const router = useRouter();
  const [editing, setEditing] = useState(!value && !locked);
  const [text, setText] = useState(value?.text ?? "");
  const [busy, start] = useTransition();
  if (!editing) {
    return value ? (
      <div className="space-y-1">
        <p className="whitespace-pre-line">{value.text}</p>
        <p className="text-xs text-muted-foreground">
          {value.by} · {when(value.at)}
          {!locked && (
            <button type="button" onClick={() => setEditing(true)} className="ml-2 inline-flex items-center gap-1 text-primary hover:underline">
              <Pencil className="h-3 w-3" /> Revise
            </button>
          )}
        </p>
      </div>
    ) : (
      <p className="text-xs text-muted-foreground">Not recorded.</p>
    );
  }
  return (
    <div className="space-y-2">
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} className={field} />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || text.trim().length < 5}
          onClick={() =>
            start(async () => {
              const r = await recordNcrHandlingPg(ncrId, step, text);
              if (!r.success) return toast.error(r.error);
              toast.success("Recorded");
              setEditing(false);
              router.refresh();
            })
          }
        >
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save
        </Button>
        {value && (
          <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function SupplierStep({ ncr, locked }) {
  const router = useRouter();
  const notice = ncr.supplierNotice;
  const [via, setVia] = useState("email");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState("");
  const [busy, start] = useTransition();
  const send = () =>
    start(async () => {
      const r = await notifyNcrSupplierPg(ncr._id, { via, to, message });
      if (!r.success) return toast.error(r.error);
      toast.success(r.message);
      router.refresh();
    });

  if (notice) {
    return (
      <div className="space-y-2">
        <p>
          Told <strong>{notice.to}</strong> by {String(notice.via).replace("_", " ")} — {notice.by}, {when(notice.at)}
        </p>
        {notice.text && <p className="whitespace-pre-line text-xs text-muted-foreground">“{notice.text}”</p>}
        {notice.response ? (
          <div className="rounded-md bg-muted/40 p-2 text-xs">
            <p className="font-medium">Supplier’s answer · {when(notice.responseAt)}</p>
            <p className="whitespace-pre-line">{notice.response}</p>
          </div>
        ) : (
          !locked && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Their answer: replacement, credit note, collection…" className={field} />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !response.trim()}
                onClick={() =>
                  start(async () => {
                    const r = await recordNcrSupplierResponsePg(ncr._id, response);
                    if (!r.success) return toast.error(r.error);
                    toast.success(r.message);
                    router.refresh();
                  })
                }
              >
                Record answer
              </Button>
            </div>
          )
        )}
      </div>
    );
  }
  if (locked) return <p className="text-xs text-muted-foreground">Not told.</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-amber-700 dark:text-amber-400">
        {ncr.supplier?.name} has not been told yet. The NCR cannot close until they are.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {[
          ["email", "Email from here"],
          ["phone", "Phoned"],
          ["letter", "Letter"],
          ["in_person", "In person"],
        ].map(([v, l]) => (
          <button
            type="button"
            key={v}
            onClick={() => setVia(v)}
            aria-pressed={via === v}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${via === v ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <input
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder={via === "email" ? "Email address (blank: the one on file)" : "Who was told"}
        className={field}
      />
      <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={via === "email" ? "Message (blank: the NCR description)" : "What they were told"} className={field} />
      <Button size="sm" onClick={send} disabled={busy}>
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-1.5 h-3.5 w-3.5" />}
        {via === "email" ? "Send to supplier" : "Record notice"}
      </Button>
    </div>
  );
}

export default function NCRHandling({ ncr }) {
  const locked = ncr.status === "closed" || ncr.status === "cancelled";
  const h = ncr.handling ?? {};
  const hasSupplier = Boolean(ncr.supplier);
  const steps = [
    { key: "raised", done: true },
    { key: "containment", done: Boolean(h.containment) },
    { key: "root", done: Boolean(h.rootCause) },
    { key: "disposition", done: Boolean(ncr.disposition?.authorizedBy) },
    { key: "corrective", done: Boolean(h.corrective) },
    ...(hasSupplier ? [{ key: "supplier", done: Boolean(ncr.supplierNotice) }] : []),
    { key: "closed", done: ncr.status === "closed" },
  ];
  const missing = [
    !h.containment && "containment",
    !h.rootCause && "root cause",
    !h.corrective && "corrective action",
    hasSupplier && !ncr.supplierNotice && "notice to the supplier",
    !ncr.disposition?.authorizedBy && "an authorised disposition",
  ].filter(Boolean);
  const doneCount = steps.filter((s) => s.done).length;
  let n = 0;

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">How this NCR is handled</h2>
          <p className="text-xs text-muted-foreground">
            {doneCount} of {steps.length} steps done
            {!locked && missing.length > 0 && ` · before closing: ${missing.join(", ")}`}
          </p>
        </div>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-emerald-600 transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
      </header>
      <ol className="p-4">
        <Step n={++n} done title="Raised">
          <p className="text-xs text-muted-foreground">
            {ncr.reasonLabel} · {ncr.createdBy?.name || "—"} · {when(ncr.createdAt)}
          </p>
        </Step>
        <Step n={++n} done={Boolean(h.containment)} title="Containment — what was done straight away">
          <TextStep ncrId={ncr._id} step="containment" value={h.containment} locked={locked} placeholder="e.g. Quarantined in bay Q2, tagged HOLD, stopped issue" />
        </Step>
        <Step n={++n} done={Boolean(h.rootCause)} title="Root cause — why it happened">
          <TextStep ncrId={ncr._id} step="root_cause" value={h.rootCause} locked={locked} placeholder="e.g. Supplier packed gauges without separators" />
        </Step>
        <Step n={++n} done={Boolean(ncr.disposition?.authorizedBy)} title="Disposition — proposed and authorised">
          <p className="text-xs text-muted-foreground">
            {ncr.disposition?.authorizedBy
              ? `Authorised by ${ncr.disposition.authorizedBy.name}`
              : ncr.disposition?.proposedBy
                ? `Proposed by ${ncr.disposition.proposedBy.name}; waiting for authorisation`
                : "Propose return, repair, downgrade, scrap or accept as is — use the buttons at the top."}
          </p>
        </Step>
        <Step n={++n} done={Boolean(h.corrective)} title="Corrective action — what stops it happening again">
          <TextStep ncrId={ncr._id} step="corrective" value={h.corrective} locked={locked} placeholder="e.g. Separators added to the PO terms; incoming inspection for this item" />
        </Step>
        {hasSupplier && (
          <Step n={++n} done={Boolean(ncr.supplierNotice)} title={`Supplier told — ${ncr.supplier.name}`}>
            <SupplierStep ncr={ncr} locked={locked} />
          </Step>
        )}
        <Step n={++n} done={ncr.status === "closed"} title="Closed" last>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {ncr.status === "closed" ? (
              <>Closed {when(ncr.disposition?.executedAt)} by {ncr.disposition?.executedBy?.name}</>
            ) : missing.length ? (
              <>
                <Lock className="h-3 w-3" /> Can close once {missing.join(", ")} {missing.length === 1 ? "is" : "are"} in place.
              </>
            ) : (
              <>
                <Circle className="h-3 w-3" /> Ready — carry out the disposition to close it.
              </>
            )}
          </p>
        </Step>
      </ol>
    </section>
  );
}
