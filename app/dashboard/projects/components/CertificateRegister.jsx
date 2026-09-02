"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MetricBar } from "@/components/metric-bar";
import Link from "next/link";
import {
  Receipt,
  Plus,
  Loader2,
  Stamp,
  FileText,
  Trash2,
  Ban,
  X,
  Info,
} from "lucide-react";
import {
  saveProjectContract,
  createProjectCertificate,
  certifyProjectCertificate,
  cancelProjectCertificate,
  deleteProjectCertificate,
  raiseCertificateInvoice,
} from "@/app/db/actions/project-actions";
import { toast } from "sonner";

/**
 * Interim payment certificates — 0081.
 *
 * TWO THINGS ON ONE PAGE, and the order is the point: the CONTRACT first,
 * because a certificate cannot be computed without terms, and then the
 * certificates. A project with no contract gets the terms form and nothing
 * else, which is more use than an empty table.
 *
 * THE ARITHMETIC IS SHOWN IN FULL on every certificate, because a certificate
 * is a document somebody argues with. A net figure with no working is a number
 * the quantity surveyor on the other side cannot check, and the first thing
 * they will do is ask for the breakdown.
 *
 * NOTHING HERE IS TAX. VAT, VAT withholding and WHT belong to the invoice this
 * raises and the payment that settles it — 0081 decision 2.
 */

const STATUS_BADGE = {
  draft: "bg-amber-500/10 text-amber-600",
  certified: "bg-emerald-500/10 text-emerald-600",
  cancelled: "bg-muted text-muted-foreground",
};

const SOURCE_LABEL = {
  measured: "Measured against the bill",
  milestone: "Milestone achieved",
  manual: "Entered by hand",
};

function money(n) {
  return new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function Row({ label, value, tone, strong, hint }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className={`text-sm ${strong ? "font-medium" : "text-muted-foreground"}`}>
        {label}
        {hint && <span className="ml-1.5 text-xs text-muted-foreground/70">{hint}</span>}
      </span>
      <span
        className={`text-sm tabular-nums ${strong ? "font-semibold" : ""} ${
          tone === "negative" ? "text-red-600" : tone === "positive" ? "text-emerald-600" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

const EMPTY_TERMS = {
  reference: "",
  title: "",
  counterpartyName: "",
  contractSum: "",
  retentionPercent: "",
  retentionCapPercent: "",
  advanceAmount: "",
  advanceRecoveryPercent: "",
  defectsLiabilityMonths: "",
  commencementDate: "",
  completionDate: "",
};

export default function CertificateRegister({
  projectId,
  contract,
  certificates = [],
  position,
  basis,
  boq,
  canManage = false,
  canCertify = false,
}) {
  const [isPending, startTransition] = useTransition();
  const [showTerms, setShowTerms] = useState(!contract);
  const [showNew, setShowNew] = useState(false);
  const [terms, setTerms] = useState(
    contract
      ? {
          reference: contract.reference || "",
          title: contract.title || "",
          counterpartyName: contract.counterpartyName || "",
          contractSum: contract.contractSum || "",
          retentionPercent: contract.retentionPercent || "",
          retentionCapPercent: contract.retentionCapPercent || "",
          advanceAmount: contract.advanceAmount || "",
          advanceRecoveryPercent: contract.advanceRecoveryPercent || "",
          defectsLiabilityMonths: contract.defectsLiabilityMonths ?? "",
          commencementDate: contract.commencementDate || "",
          completionDate: contract.completionDate || "",
        }
      : EMPTY_TERMS,
  );

  const today = new Date().toISOString().slice(0, 10);
  const [draftForm, setDraftForm] = useState({
    workDoneToDate: "",
    materialsOnSite: "",
    dayworksToDate: "",
    retentionReleasedToDate: "",
    valuationDate: today,
    periodFrom: "",
    periodTo: "",
  });

  const hasDraft = certificates.some((c) => c.status === "draft");

  function saveTerms() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("projectId", projectId);
      if (contract) fd.set("contractId", contract.id);
      Object.entries(terms).forEach(([k, v]) => fd.set(k, v ?? ""));
      const res = await saveProjectContract(null, fd);
      if (res?.success) {
        toast.success(res.message);
        setShowTerms(false);
      } else {
        toast.error(Object.values(res?.errors ?? {}).flat()[0] || "Failed to save");
      }
    });
  }

  function startCertificate() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("projectId", projectId);
      fd.set("contractId", contract.id);
      Object.entries(draftForm).forEach(([k, v]) => fd.set(k, v ?? ""));
      // The source is a FACT about where the figure came from, not a choice:
      // it says `measured` only when the number actually came off an awarded
      // bill, so a certificate cannot claim evidence it does not have.
      fd.set(
        "valuationSource",
        boq && draftForm.workDoneToDate === String(boq.measured) ? "measured" : "manual",
      );
      const res = await createProjectCertificate(null, fd);
      if (res?.success) {
        toast.success(res.message);
        setShowNew(false);
        setDraftForm((f) => ({ ...f, workDoneToDate: "", materialsOnSite: "", dayworksToDate: "" }));
      } else {
        toast.error(Object.values(res?.errors ?? {}).flat()[0] || "Failed to save");
      }
    });
  }

  function run(fn, ...args) {
    startTransition(async () => {
      const res = await fn(...args);
      if (res?.success) toast.success(res.message);
      else toast.error(res?.error || "Failed");
    });
  }

  // ── No contract ────────────────────────────────────────────────────────────
  if (!contract && !showTerms) {
    return (
      <Card className="p-8 sm:p-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Receipt className="h-6 w-6 text-primary" />
        </div>
        <h2 className="font-semibold text-lg mb-1">No contract terms yet</h2>
        <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
          A payment certificate is computed from the contract — the sum, the
          retention percentage and its cap, the advance and how it is recovered.
          Every one of them may be zero; none of them can be guessed.
        </p>
        {canCertify && (
          <Button size="sm" onClick={() => setShowTerms(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Enter the terms
          </Button>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── The contract ──────────────────────────────────────────────────── */}
      {contract && !showTerms && (
        <Card className="p-4 sm:p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Receipt className="h-5 w-5 text-muted-foreground shrink-0" />
                <h3 className="font-semibold">
                  {contract.title || "Contract"}
                </h3>
                {contract.reference && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {contract.reference}
                  </span>
                )}
              </div>
              {contract.counterpartyName && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  with {contract.counterpartyName}
                </p>
              )}
            </div>
            {canCertify && (
              <Button size="sm" variant="outline" onClick={() => setShowTerms(true)}>
                Edit terms
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              Sum{" "}
              <span className="text-foreground font-medium tabular-nums">
                {contract.currency} {money(contract.contractSum)}
              </span>
            </span>
            <span className="text-muted-foreground">
              Retention{" "}
              <span className="text-foreground font-medium tabular-nums">
                {Number(contract.retentionPercent)}%
                {contract.retentionCapPercent
                  ? ` capped at ${Number(contract.retentionCapPercent)}%`
                  : " uncapped"}
              </span>
            </span>
            {Number(contract.advanceAmount) > 0 && (
              <span className="text-muted-foreground">
                Advance{" "}
                <span className="text-foreground font-medium tabular-nums">
                  {money(contract.advanceAmount)}, recovered at{" "}
                  {Number(contract.advanceRecoveryPercent)}%
                </span>
              </span>
            )}
            {contract.defectsLiabilityMonths && (
              <span className="text-muted-foreground">
                DLP{" "}
                <span className="text-foreground font-medium">
                  {contract.defectsLiabilityMonths} months
                </span>
              </span>
            )}
          </div>

          {position && (
            <MetricBar
              items={[
                { label: "Certified", value: `${money(position.grossCertified)}` },
                { label: "of contract", value: `${position.percentCertified}%` },
                {
                  label: "Retention held",
                  value: money(position.retentionOutstanding),
                  tone: position.retentionOutstanding > 0 ? "warn" : "muted",
                },
                {
                  label: "Advance outstanding",
                  value: money(position.advanceOutstanding),
                  tone: position.advanceOutstanding > 0 ? "warn" : "muted",
                },
                { label: "Certificates", value: position.certificateCount },
              ]}
            />
          )}

          {/*
            Said on the page, not only in the migration: the retention BALANCE is
            here and the retention JOURNAL is not. Somebody reading this figure
            should not assume the ledger knows about it.
          */}
          {position?.retentionOutstanding > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900/50 dark:bg-blue-950/40">
              <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <p className="text-blue-900 dark:text-blue-200">
                Retention of {contract.currency} {money(position.retentionOutstanding)} is
                held against this contract. It is tracked here and does not yet post
                to the ledger — a retention receivable account and its release
                schedule are the next step.
              </p>
            </div>
          )}
        </Card>
      )}

      {/* ── The terms form ────────────────────────────────────────────────── */}
      {showTerms && canCertify && (
        <Card className="p-4 sm:p-5 space-y-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Contract terms</h4>
            {contract && (
              <Button size="icon" variant="ghost" onClick={() => setShowTerms(false)}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            These are this contract&apos;s terms, not a company setting. Any of them
            may be zero — a job that holds no retention is a contract with a zero
            percentage, not a different kind of project.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              ["reference", "Contract reference", "text", "RWC 772"],
              ["title", "Title", "text", "Otho–Got Kachola Road"],
              ["counterpartyName", "Employer / client", "text", "KeRRA"],
              ["contractSum", "Contract sum", "number", "0.00"],
              ["retentionPercent", "Retention %", "number", "10"],
              ["retentionCapPercent", "Retention cap % of sum", "number", "5"],
              ["advanceAmount", "Advance paid", "number", "0.00"],
              ["advanceRecoveryPercent", "Advance recovery %", "number", "20"],
              ["defectsLiabilityMonths", "Defects liability (months)", "number", "12"],
              ["commencementDate", "Commencement", "date", ""],
              ["completionDate", "Completion", "date", ""],
            ].map(([key, label, type, placeholder]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{label}</label>
                <Input
                  type={type}
                  step={type === "number" ? "0.01" : undefined}
                  placeholder={placeholder}
                  className="h-9"
                  value={terms[key] ?? ""}
                  onChange={(e) => setTerms((t) => ({ ...t, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            {contract && (
              <Button size="sm" variant="outline" onClick={() => setShowTerms(false)}>
                Cancel
              </Button>
            )}
            <Button size="sm" onClick={saveTerms} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Save terms
            </Button>
          </div>
        </Card>
      )}

      {/* ── A new certificate ─────────────────────────────────────────────── */}
      {contract && !showTerms && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-semibold">Certificates</h3>
          {canManage && !hasDraft && !showNew && (
            <Button size="sm" onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              New certificate
            </Button>
          )}
          {hasDraft && (
            <span className="text-xs text-muted-foreground">
              A draft is open — certify or remove it before starting another.
            </span>
          )}
        </div>
      )}

      {showNew && contract && canManage && (
        <Card className="p-4 sm:p-5 space-y-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              IPC No. {basis?.sequence ?? 1} — the figures to date
            </h4>
            <Button size="icon" variant="ghost" onClick={() => setShowNew(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Every figure is CUMULATIVE — the position at the valuation date, not
            what changed this month. What is due this certificate is worked out
            by subtracting the last one, which is why a correction here fixes
            itself on the next.
          </p>

          {boq && (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3 text-sm">
              <span className="text-muted-foreground">
                Measured against bill v{boq.version}:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {money(boq.measured)}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setDraftForm((f) => ({ ...f, workDoneToDate: String(boq.measured) }))
                }
              >
                Use this
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              ["workDoneToDate", "Value of permanent work to date", "number"],
              ["materialsOnSite", "Materials on site", "number"],
              ["dayworksToDate", "Dayworks to date", "number"],
              ["retentionReleasedToDate", "Retention released to date", "number"],
              ["valuationDate", "Valuation date", "date"],
              ["periodFrom", "Period from", "date"],
              ["periodTo", "Period to", "date"],
            ].map(([key, label, type]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{label}</label>
                <Input
                  type={type}
                  step={type === "number" ? "0.01" : undefined}
                  className="h-9"
                  value={draftForm[key] ?? ""}
                  onChange={(e) => setDraftForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={startCertificate} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Start certificate
            </Button>
          </div>
        </Card>
      )}

      {/* ── The register ──────────────────────────────────────────────────── */}
      {contract && !showTerms && certificates.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No certificates yet. The first one values everything done to date.
          </p>
        </Card>
      )}

      {contract &&
        !showTerms &&
        [...certificates].reverse().map((c) => {
          const f = c.figures;
          const cancelled = c.status === "cancelled";
          return (
            <Card key={c.id} className={`p-4 sm:p-5 space-y-3 ${cancelled ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold">IPC No. {c.sequence}</h4>
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.certificateNumber}
                    </span>
                    <Badge className={`text-xs capitalize ${STATUS_BADGE[c.status]}`}>
                      {c.status}
                    </Badge>
                    <Badge variant="outline" className="text-xs font-normal">
                      {SOURCE_LABEL[c.valuationSource]}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Valued at {c.valuationDate}
                    {c.periodFrom && c.periodTo && ` · period ${c.periodFrom} to ${c.periodTo}`}
                    {c.certifiedByName && ` · certified by ${c.certifiedByName}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.status === "draft" && canCertify && (
                    <Button
                      size="sm"
                      onClick={() => run(certifyProjectCertificate, c.id, projectId)}
                      disabled={isPending}
                    >
                      <Stamp className="h-4 w-4 mr-1.5" />
                      Certify
                    </Button>
                  )}
                  {c.status === "certified" && !c.invoiceId && canCertify && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => run(raiseCertificateInvoice, c.id, projectId)}
                      disabled={isPending}
                    >
                      <FileText className="h-4 w-4 mr-1.5" />
                      Raise draft invoice
                    </Button>
                  )}
                  {c.invoiceId && (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/dashboard/invoices/${c.invoiceId}`}>
                        <FileText className="h-4 w-4 mr-1.5" />
                        Invoice
                      </Link>
                    </Button>
                  )}
                  {c.status === "draft" && canManage && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => run(deleteProjectCertificate, c.id, projectId)}
                      disabled={isPending}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                  {c.status === "certified" && canCertify && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Withdraw this certificate"
                      onClick={() => run(cancelProjectCertificate, c.id, projectId)}
                      disabled={isPending}
                    >
                      <Ban className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </div>

              {/* The working, in full. */}
              <div className="rounded-lg border p-3 sm:p-4">
                <Row label="Value of permanent work to date" value={money(f.workDoneToDate)} />
                {f.materialsOnSite > 0 && (
                  <Row label="Materials on site" value={money(f.materialsOnSite)} />
                )}
                {f.dayworksToDate > 0 && (
                  <Row label="Dayworks to date" value={money(f.dayworksToDate)} />
                )}
                <div className="border-t my-1" />
                <Row label="Gross valuation" value={money(f.grossValuation)} strong />
                <Row
                  label="Less retention"
                  hint={f.retentionCapped ? "(at the cap)" : undefined}
                  value={`(${money(f.retentionHeld)})`}
                  tone="negative"
                />
                {f.retentionReleased > 0 && (
                  <Row label="Add retention released" value={money(f.retentionReleased)} tone="positive" />
                )}
                {f.advanceRecovered > 0 && (
                  <Row
                    label="Less advance recovery"
                    value={`(${money(f.advanceRecovered)})`}
                    tone="negative"
                  />
                )}
                <div className="border-t my-1" />
                <Row label="Net to date" value={money(f.netToDate)} strong />
                <Row
                  label="Less previously certified"
                  value={`(${money(f.previouslyCertified)})`}
                  tone="negative"
                />
                <div className="border-t my-1" />
                <Row
                  label="Net this certificate"
                  value={`${contract.currency} ${money(f.netThisCertificate)}`}
                  strong
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Before VAT and any withholding — those are on the invoice and at
                  payment.
                </p>
              </div>

              {c.notes && <p className="text-sm text-muted-foreground">{c.notes}</p>}
            </Card>
          );
        })}
    </div>
  );
}
