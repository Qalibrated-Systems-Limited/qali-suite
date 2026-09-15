"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Wallet,
  Plus,
  Send,
  Check,
  X,
  Banknote,
  Trash2,
  Loader2,
  Undo2,
} from "lucide-react";
import {
  createCashRequisition,
  setCashRequisitionStatus,
  fundCashRequisition,
  deleteCashRequisition,
} from "@/app/db/actions/project-actions";
import { toast } from "sonner";

/**
 * The cash requisition register — 0107.
 *
 * IT AUTHORISES; IT MOVES NO MONEY. The register says what the site asked for
 * and who allowed it. Marking one funded records WHICH existing document
 * released the cash — an advance, the petty cash float, a stock request — and
 * posts nothing itself, because those already post and a second entry would
 * count the same shilling twice.
 *
 * ── Built for a thumb in a yard ────────────────────────────────────────────
 *
 * The person raising these is a site agent on a phone, so: the form is four
 * fields and opens in place rather than on another screen; the amount is the
 * first field and gets the numeric keypad; and every action is a 44px target.
 * The table is the DESKTOP rendering of the same rows — head office reads a
 * cash book across, the site reads it down.
 *
 * ── Refusing takes a reason, and the box says so ───────────────────────────
 *
 * The database requires ten characters on a rejection, so the reject button
 * opens the box rather than firing and returning a constraint violation. "No"
 * with no grounds is not an answer a site can act on.
 */

const STATUS_STYLES = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  approved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  rejected: "bg-red-500/10 text-red-600 dark:text-red-400",
  funded: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  cancelled: "bg-muted text-muted-foreground line-through",
};

const STATUS_LABEL = {
  draft: "Draft",
  submitted: "Awaiting approval",
  approved: "Approved",
  rejected: "Refused",
  funded: "Funded",
  cancelled: "Cancelled",
};

const SOURCE_LABEL = {
  employee_advance: "staff advance",
  petty_cash: "petty cash",
  stock_request: "stock request",
  other: "other",
};

const money = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Number(n) || 0);

const shortDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      })
    : "—";

function Metric({ label, value, tone }) {
  return (
    <div className="min-w-0 bg-card px-3 py-2.5 sm:px-4">
      <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`truncate text-base font-semibold sm:text-lg ${tone ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }) {
  return (
    <Badge
      variant="secondary"
      className={`whitespace-nowrap text-xs ${STATUS_STYLES[status] ?? ""}`}
    >
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export default function CashRequisitionRegister({
  projectId,
  requisitions = [],
  summary,
  costCodes = [],
  canManage = false,
  canDecide = false,
  canFund = false,
  readOnly = false,
}) {
  const [isPending, startTransition] = useTransition();
  const [showNew, setShowNew] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");
  const [form, setForm] = useState({
    amount: "",
    purpose: "",
    costCodeId: "",
    neededBy: "",
  });

  const run = (fn, onDone) =>
    startTransition(async () => {
      const res = await fn();
      if (res?.success) {
        toast.success(res.message ?? "Done");
        onDone?.();
      } else {
        toast.error(res?.error ?? res?.errors?._form?.[0] ?? "That did not work");
      }
    });

  const submitNew = () => {
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("amount", form.amount);
    fd.set("purpose", form.purpose);
    if (form.costCodeId) fd.set("costCodeId", form.costCodeId);
    if (form.neededBy) fd.set("neededBy", form.neededBy);
    run(
      () => createCashRequisition(null, fd),
      () => {
        setForm({ amount: "", purpose: "", costCodeId: "", neededBy: "" });
        setShowNew(false);
      },
    );
  };

  const move = (id, status, notes) =>
    run(() => setCashRequisitionStatus(id, projectId, { status, notes }));

  const fund = (id, source) =>
    run(() => fundCashRequisition(id, projectId, { source }));

  const rows = requisitions;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          Requests for cash
        </h2>
        {canManage && !readOnly && (
          <Button
            size="sm"
            onClick={() => setShowNew((v) => !v)}
            className="h-9 bg-yellow-500 font-semibold text-black hover:bg-yellow-600"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New request
          </Button>
        )}
      </div>

      {/* The MD's four figures, and `Awaiting` carries the count because that
          is the one somebody has to act on. */}
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        <Metric label="Requested" value={money(summary?.requested)} />
        <Metric
          label="Approved"
          value={money(summary?.approved)}
          tone="text-emerald-600 dark:text-emerald-500"
        />
        <Metric
          label="Funded"
          value={money(summary?.funded)}
          tone="text-blue-600 dark:text-blue-500"
        />
        <Metric
          label={`Awaiting${summary?.awaitingCount ? ` · ${summary.awaitingCount}` : ""}`}
          value={money(summary?.awaiting)}
          tone={summary?.awaitingCount ? "text-amber-600 dark:text-amber-500" : ""}
        />
      </div>

      {showNew && (
        <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Amount (KES)
              </label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                className="h-10"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">
                What for
              </label>
              <Input
                className="h-10"
                placeholder="e.g. Fuel and lubricants, week to 12 April"
                value={form.purpose}
                onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Needed by
              </label>
              <Input
                type="date"
                className="h-10"
                value={form.neededBy}
                onChange={(e) => setForm((f) => ({ ...f, neededBy: e.target.value }))}
              />
            </div>
          </div>

          {costCodes.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Cost code — so it reads against the budget
              </label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.costCodeId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, costCodeId: e.target.value }))
                }
              >
                <option value="">Not coded</option>
                {costCodes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={submitNew} disabled={isPending}>
              {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Send for approval
            </Button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No cash has been requested against this project yet.
        </p>
      ) : (
        <>
          {/* PHONE — one card per request. */}
          <div className="flex flex-col gap-px border-t border-border bg-border md:hidden">
            {rows.map((r) => (
              <div key={r.id} className="space-y-2 bg-card px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {r.requisitionNumber} · {shortDate(r.requestDate)}
                    </p>
                    <p className="text-sm leading-snug">{r.purpose}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {r.costCode ?? "Not coded"}
                  </span>
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {money(r.amount)}
                  </span>
                </div>
                <RowActions
                  r={r}
                  canManage={canManage}
                  canDecide={canDecide}
                  canFund={canFund}
                  readOnly={readOnly}
                  isPending={isPending}
                  onMove={move}
                  onFund={fund}
                  onReject={() => {
                    setRejecting(r.id);
                    setReason("");
                  }}
                  onDelete={(id) =>
                    run(() => deleteCashRequisition(id, projectId))
                  }
                />
                {rejecting === r.id && (
                  <RejectBox
                    reason={reason}
                    setReason={setReason}
                    isPending={isPending}
                    onCancel={() => setRejecting(null)}
                    onConfirm={() => {
                      move(r.id, "rejected", reason);
                      setRejecting(null);
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* DESKTOP — the cash book, read across. */}
          <div className="hidden overflow-x-auto border-t border-border md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="whitespace-nowrap px-3 py-2 text-left font-medium">No.</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Requested by</th>
                  <th className="px-3 py-2 text-left font-medium">Cost code</th>
                  <th className="px-3 py-2 text-left font-medium">What for</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                    Amount (KES)
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                      {r.requisitionNumber}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                      {shortDate(r.requestDate)}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{r.requestedByName}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {r.costCode ?? "—"}
                    </td>
                    <td className="max-w-[18rem] px-3 py-2.5">
                      {r.purpose}
                      {r.status === "rejected" && r.decisionNotes && (
                        <span className="mt-0.5 block text-xs text-red-600 dark:text-red-400">
                          {r.decisionNotes}
                        </span>
                      )}
                      {r.status === "funded" && r.fundedSource && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Paid from {SOURCE_LABEL[r.fundedSource]}
                        </span>
                      )}
                      {rejecting === r.id && (
                        <RejectBox
                          reason={reason}
                          setReason={setReason}
                          isPending={isPending}
                          onCancel={() => setRejecting(null)}
                          onConfirm={() => {
                            move(r.id, "rejected", reason);
                            setRejecting(null);
                          }}
                        />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                      {money(r.amount)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={r.status} />
                      {r.decidedByName && r.status !== "rejected" && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {r.decidedByName}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <RowActions
                        r={r}
                        canManage={canManage}
                        canDecide={canDecide}
                        canFund={canFund}
                        readOnly={readOnly}
                        isPending={isPending}
                        onMove={move}
                        onFund={fund}
                        onReject={() => {
                          setRejecting(r.id);
                          setReason("");
                        }}
                        onDelete={(id) =>
                          run(() => deleteCashRequisition(id, projectId))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function RejectBox({ reason, setReason, isPending, onCancel, onConfirm }) {
  const short = reason.trim().length < 10;
  return (
    <div className="mt-2 space-y-2">
      <Textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is it refused? The site has to be able to act on the answer."
        className="text-sm"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={short || isPending}
          onClick={onConfirm}
        >
          Refuse
        </Button>
        {short && (
          <span className="text-xs text-muted-foreground">
            A few more words.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * WHAT THIS PERSON CAN DO TO THIS ROW, and nothing else rendered.
 *
 * Three gates, because they are three different authorities: the site asks,
 * the supervisor decides, finance records that the cash left. A button that
 * appears and then fails on the server is worse than no button.
 */
function RowActions({
  r,
  canManage,
  canDecide,
  canFund,
  readOnly,
  isPending,
  onMove,
  onFund,
  onReject,
  onDelete,
}) {
  if (readOnly) return null;
  const btn = "h-8 px-2.5";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {canManage && r.status === "draft" && (
        <>
          <Button
            size="sm"
            variant="outline"
            className={btn}
            disabled={isPending}
            onClick={() => onMove(r.id, "submitted")}
          >
            <Send className="mr-1 h-3.5 w-3.5" />
            Send
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={btn}
            disabled={isPending}
            onClick={() => onDelete(r.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}

      {canManage && r.status === "submitted" && (
        <Button
          size="sm"
          variant="ghost"
          className={btn}
          disabled={isPending}
          onClick={() => onMove(r.id, "draft")}
          title="Pull it back to make a change"
        >
          <Undo2 className="mr-1 h-3.5 w-3.5" />
          Recall
        </Button>
      )}

      {canDecide && r.status === "submitted" && (
        <>
          <Button
            size="sm"
            className={`${btn} bg-emerald-600 hover:bg-emerald-700`}
            disabled={isPending}
            onClick={() => onMove(r.id, "approved")}
          >
            <Check className="mr-1 h-3.5 w-3.5" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={`${btn} border-red-500/40 text-red-600`}
            disabled={isPending}
            onClick={onReject}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Refuse
          </Button>
        </>
      )}

      {canManage && r.status === "rejected" && (
        <Button
          size="sm"
          variant="outline"
          className={btn}
          disabled={isPending}
          onClick={() => onMove(r.id, "submitted")}
        >
          <Send className="mr-1 h-3.5 w-3.5" />
          Send again
        </Button>
      )}

      {canFund && r.status === "approved" && (
        <>
          <Button
            size="sm"
            variant="outline"
            className={btn}
            disabled={isPending}
            onClick={() => onFund(r.id, "petty_cash")}
          >
            <Banknote className="mr-1 h-3.5 w-3.5" />
            Paid from petty cash
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={btn}
            disabled={isPending}
            onClick={() => onFund(r.id, "employee_advance")}
          >
            Paid as advance
          </Button>
        </>
      )}
    </div>
  );
}
