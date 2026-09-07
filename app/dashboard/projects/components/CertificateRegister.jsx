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

/**
 * A NEW CONTRACT OPENS ON WHAT THE PROJECT ALREADY KNOWS.
 *
 * It used to open on eleven empty boxes, so somebody who had already typed
 * the job's name, its client, its contract value and its dates on the project
 * form typed all four again — and the two records then disagreed the moment
 * one of them was corrected.
 *
 * Five come straight across. The rest are contract TERMS: retention, its cap,
 * the advance and its recovery rate exist nowhere else and cannot be guessed
 * from a project — which is the whole reason this form exists.
 *
 * `counterpartyPartyId` travels with the name so the contract is LINKED to the
 * customer record rather than merely labelled with it. The form never sent it
 * before, so every contract saved here had a null counterparty.
 */
const EMPTY_TERMS = {
  reference: "",
  title: "",
  counterpartyPartyId: "",
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

const asDate = (v) => (v ? String(v).slice(0, 10) : "");
const asAmount = (v) => (Number(v) > 0 ? String(Number(v)) : "");

function termsFromProject(project) {
  if (!project) return { ...EMPTY_TERMS };
  return {
    ...EMPTY_TERMS,
    title: project.name ?? "",
    counterpartyPartyId: project.client?.partyId ?? "",
    counterpartyName: project.client?.name ?? "",
    /** The figure the project form already collected, if it collected one. */
    contractSum: asAmount(project.contractValue),
    commencementDate: asDate(project.startDate),
    completionDate: asDate(project.endDate),
  };
}

export default function CertificateRegister({
  projectId,
  project,
  contract,
  certificates = [],
  position,
  basis,
  boq,
  billableTime,
  milestones,
  canManage = false,
  canCertify = false,
}) {
  const [isPending, startTransition] = useTransition();
  /**
   * `!contract` alone opened the terms form for everybody, and the form itself
   * renders only for `canCertify` — so a Manager (who is in
   * PROJECT_MANAGE_ROLES and NOT in FINANCE_WRITE_ROLES) landed on a page with
   * no terms form, no certificate button and no empty state, because the
   * "No contract terms yet" card below is only reached when this is false.
   * A blank page, on the section they were sent to.
   */
  const [showTerms, setShowTerms] = useState(!contract && canCertify);
  const [showNew, setShowNew] = useState(false);
  const [terms, setTerms] = useState(
    contract
      ? {
          reference: contract.reference || "",
          title: contract.title || "",
          counterpartyPartyId: contract.counterpartyPartyId || "",
          counterpartyName: contract.counterpartyName || "",
          /**
           * THE ORIGINAL, not the current sum — 0091. `contract_sum` is now
           * derived from this plus the approved variations, so showing the
           * derived figure in an editable box would let somebody save the
           * variations' effect back into the base and double it.
           */
          contractSum: contract.originalSum ?? contract.contractSum ?? "",
          retentionPercent: contract.retentionPercent || "",
          retentionCapPercent: contract.retentionCapPercent || "",
          advanceAmount: contract.advanceAmount || "",
          advanceRecoveryPercent: contract.advanceRecoveryPercent || "",
          defectsLiabilityMonths: contract.defectsLiabilityMonths ?? "",
          commencementDate: contract.commencementDate || "",
          completionDate: contract.completionDate || "",
        }
      : termsFromProject(project),
  );

  const today = new Date().toISOString().slice(0, 10);

  /**
   * THE FORM OPENS ON THE LAST CERTIFICATE'S POSITION, not on blanks.
   *
   * Every box here is cumulative, so an empty box is not "nothing entered
   * yet" — it is a claim that the figure has fallen to zero, and the
   * arithmetic believes it. Opening blank made the commonest mistake on the
   * page invisible: type the new work-done figure, leave the other three as
   * you found them, and the certificate silently under-claims by whatever
   * materials and dayworks stood at, and CLAWS BACK any retention already
   * released.
   *
   * So the QS edits figures upward from where they were, which is what
   * "cumulative" means in practice, and the panel below states what each one
   * carried forward from.
   */
  const carried = (n) => (Number(n) > 0 ? String(Number(n)) : "");
  const dayAfter = (d) => {
    if (!d) return "";
    const next = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(next.getTime())) return "";
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
  };

  const [draftForm, setDraftForm] = useState({
    workDoneToDate: carried(basis?.lastWorkDoneToDate),
    materialsOnSite: carried(basis?.lastMaterialsOnSite),
    dayworksToDate: carried(basis?.lastDayworksToDate),
    retentionReleasedToDate: carried(basis?.lastRetentionReleased),
    valuationDate: today,
    /** The day after the last certificate's period ended — never typed. */
    periodFrom: dayAfter(basis?.lastPeriodTo),
    periodTo: today,
  });

  const hasDraft = certificates.some((c) => c.status === "draft");
  /** Issued, whether it still stands or was withdrawn — both keep a snapshot. */
  const issuedCount = certificates.filter((c) => c.status !== "draft").length;

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
      <Card className="p-5 sm:p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Receipt className="h-6 w-6 text-primary" />
        </div>
        <h2 className="font-semibold text-lg mb-1">No contract terms yet</h2>
        <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
          A payment certificate is computed from the contract — the sum, the
          retention percentage and its cap, the advance and how it is recovered.
          Every one of them may be zero; none of them can be guessed.
        </p>
        {canCertify ? (
          <Button size="sm" onClick={() => setShowTerms(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Enter the terms
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Finance enters the contract terms. Once they are in, a certificate
            can be raised against them here.
          </p>
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
            This used to say the retention did NOT reach the ledger, and that
            stopped being true with 0085: certifying holds it as
            `1125 Retention Receivable` and releasing it clears the account.
            A stale reassurance about somebody's own books is worse than none.
          */}
          {position?.retentionOutstanding > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900/50 dark:bg-blue-950/40">
              <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <p className="text-blue-900 dark:text-blue-200">
                Retention of {contract.currency} {money(position.retentionOutstanding)} is
                held against this contract and sits in Retention Receivable (1125)
                in the ledger. Release it by raising a certificate with a higher
                &ldquo;retention released to date&rdquo;.
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
          <p className="text-xs text-muted-foreground">
            The sum and the completion date are the figures the contract was{" "}
            <span className="font-medium text-foreground">let at</span>. Approved
            variations move the current ones from here, and both are shown on
            the contract card.
          </p>

          {/*
            Said where the edit happens, because "which certificates does this
            move" is the first thing anybody changing a retention percentage
            wants to know — and before 0092 the answer was "all of them,
            including the ones you have already invoiced".
          */}
          {issuedCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
              <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-amber-900 dark:text-amber-200">
                {issuedCount} certificate{issuedCount === 1 ? " has" : "s have"} already
                been issued against this contract.{" "}
                {issuedCount === 1 ? "It keeps" : "They keep"} the terms{" "}
                {issuedCount === 1 ? "it was" : "they were"} signed under — changes
                here apply to the open draft and to future certificates only.
              </p>
            </div>
          )}

          {/*
            PLACEHOLDERS SHOW WHAT A BLANK SAVES, NOT WHAT IT OUGHT TO BE.
            
            This grid used to placeholder the percentages with 10, 5, 20 and 12
            — the common values on a Kenyan public-works contract — in grey
            text that reads exactly like a filled-in field. Every term here is
            optional and a blank stores ZERO, so saving the form untouched gave
            a contract with retention 0% while the screen appeared to say 10,
            and every certificate on that job then held nothing back.
            
            So the placeholder is now the figure a blank actually produces, and
            the common value is a hint underneath where it cannot be mistaken
            for an entry. The text placeholders carry "e.g." for the same
            reason: on a form headed "Constructions of Sori Road", a greyed
            "Otho–Got Kachola Road" reads as the wrong contract having loaded.
          */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              ["reference", "Contract reference", "text", "e.g. RWC 772", ""],
              ["title", "Title", "text", "e.g. Otho–Got Kachola Road", ""],
              ["counterpartyName", "Employer / client", "text", "e.g. KeRRA", ""],
              ["contractSum", "Contract sum (as let)", "number", "0.00", ""],
              ["retentionPercent", "Retention %", "number", "0", "Commonly 10"],
              ["retentionCapPercent", "Retention cap % of sum", "number", "0", "Commonly 5"],
              ["advanceAmount", "Advance paid", "number", "0.00", ""],
              ["advanceRecoveryPercent", "Advance recovery %", "number", "0", "Commonly 20"],
              ["defectsLiabilityMonths", "Defects liability (months)", "number", "", "Commonly 12"],
              ["commencementDate", "Commencement", "date", "", ""],
              ["completionDate", "Completion (as let)", "date", "", ""],
            ].map(([key, label, type, placeholder, hint]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{label}</label>
                <Input
                  type={type}
                  step={type === "number" ? "0.01" : undefined}
                  placeholder={placeholder}
                  className="h-9"
                  value={terms[key] ?? ""}
                  onChange={(e) =>
                    setTerms((t) => ({
                      ...t,
                      [key]: e.target.value,
                      /**
                       * Retyping the employer breaks the link to the project's
                       * client, rather than leaving the contract pointing at a
                       * party whose name is no longer on it. The employer under
                       * a contract is not always the project's client.
                       */
                      ...(key === "counterpartyName"
                        ? { counterpartyPartyId: "" }
                        : null),
                    }))
                  }
                />
                {hint && (
                  <p className="text-[11px] leading-tight text-muted-foreground/80">{hint}</p>
                )}
              </div>
            ))}
          </div>

          {/* A term left blank is a term of zero, and that is worth saying once. */}
          <p className="text-xs text-muted-foreground">
            A box left blank is saved as <span className="font-medium text-foreground">zero</span>,
            not as &ldquo;not yet decided&rdquo;. A contract with retention 0% holds
            nothing back on any certificate.
          </p>

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
          {basis?.lastCertificateNumber && (
            <p className="text-xs rounded-md border bg-background px-3 py-2 text-muted-foreground">
              Carried forward from{" "}
              <span className="font-medium text-foreground">
                {basis.lastCertificateNumber}
              </span>
              . Edit each figure UP to today&apos;s position — clearing a box claims
              that it has fallen to zero.
            </p>
          )}

          {/*
            What the project already knows, offered rather than filled in. The
            measured bill is EVIDENCE for the permanent work; approved billable
            time is the dayworks figure on a time-and-material job and a
            different thing with a similar name on a lump-sum one, which is why
            neither is written into the box without somebody pressing it.
          */}
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
                Use for work done
              </Button>
            </div>
          )}

          {/*
            The milestone schedule's figure — 0093. A job values by REMEASURING
            a bill or by ACHIEVING stages; it is unusual to do both, so this
            and the measured figure above rarely appear together.

            The retention line is the schedule's real prize: releasing
            retention used to mean somebody typing a cumulative figure and
            remembering when it fell due.
          */}
          {milestones?.value > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3 text-sm">
              <span className="text-muted-foreground">
                {milestones.stages} stage{milestones.stages === 1 ? "" : "s"} achieved
                to date:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {money(milestones.value)}
                </span>
                {milestones.releasePercent > 0 && (
                  <>
                    {" · releases "}
                    <span className="font-medium text-foreground">
                      {milestones.releasePercent}%
                    </span>
                    {" of retention"}
                  </>
                )}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setDraftForm((f) => {
                    const next = { ...f, workDoneToDate: String(milestones.value) };
                    /**
                     * The release is a PERCENTAGE OF WHAT IS HELD, and what is
                     * held is the chain's business — so it is applied to this
                     * contract's retention rather than carried as a figure the
                     * schedule cannot know.
                     */
                    if (milestones.releasePercent > 0 && position?.retentionHeld) {
                      next.retentionReleasedToDate = String(
                        Math.round(
                          (position.retentionHeld * milestones.releasePercent) / 100,
                        ),
                      );
                    }
                    return next;
                  })
                }
              >
                Use for work done
              </Button>
            </div>
          )}

          {billableTime?.amount > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3 text-sm">
              <span className="text-muted-foreground">
                Billable time approved to date ({billableTime.entries} entr
                {billableTime.entries === 1 ? "y" : "ies"}):{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {money(billableTime.amount)}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setDraftForm((f) => ({
                    ...f,
                    dayworksToDate: String(billableTime.amount),
                  }))
                }
              >
                Use for dayworks
              </Button>
            </div>
          )}

          {/*
            The amounts carry a hint each. "Value of permanent work to date" is
            the correct term and it is not an obvious one — the field somebody
            arrives looking for is "the amount", and without the hint they read
            past it and report that the form has nowhere to type a figure.
          */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              [
                "workDoneToDate",
                "Value of permanent work to date",
                "number",
                "The main amount — everything measured or agreed since the job started, not just this month",
              ],
              [
                "materialsOnSite",
                "Materials on site",
                "number",
                "Delivered and unfixed, if the contract pays for them",
              ],
              ["dayworksToDate", "Dayworks to date", "number", "Work done on daywork rates"],
              [
                "retentionReleasedToDate",
                "Retention released to date",
                "number",
                "Raise this to release retention — usually at completion, then after the defects period",
              ],
              ["valuationDate", "Valuation date", "date", "The date the work was valued"],
              ["periodFrom", "Period from", "date", ""],
              ["periodTo", "Period to", "date", ""],
            ].map(([key, label, type, hint]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{label}</label>
                <Input
                  type={type}
                  step={type === "number" ? "0.01" : undefined}
                  className="h-9"
                  value={draftForm[key] ?? ""}
                  onChange={(e) => setDraftForm((f) => ({ ...f, [key]: e.target.value }))}
                />
                {hint && (
                  <p className="text-[11px] leading-tight text-muted-foreground/80">{hint}</p>
                )}
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
