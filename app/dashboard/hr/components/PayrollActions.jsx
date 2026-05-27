"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Play, CheckCircle2, XCircle, Loader2, AlertCircle, Banknote, Pencil, Download, FileText, Smartphone, Shield, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  generatePayrollEntries,
  approvePayrollRun,
  voidPayrollRun,
  markPayrollPaid,
  updatePayrollEntry,
} from "@/app/mongodb/actions/hr-payroll-actions";

const voidInitial = { success: false, error: null, fieldErrors: null };
const entryInitial = { success: false, error: null };

// ─── Void Dialog ────────────────────────────────────────────
function VoidDialog({ open, onClose, payrollRunId, onSuccess }) {
  const [state, formAction, isPending] = useActionState(voidPayrollRun, voidInitial);
  if (!open) return null;
  if (state.success) onSuccess?.();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">Void Payroll Run</h3>
        <p className="mt-1 text-sm text-muted-foreground">This action cannot be undone. Provide a reason.</p>
        <form action={formAction} className="mt-4 space-y-3">
          <input type="hidden" name="payrollRunId" value={payrollRunId} />
          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 p-2 text-xs text-red-700 dark:border-red-900 dark:text-red-400">
              <AlertCircle className="h-3 w-3" /> {state.error}
            </div>
          )}
          <textarea
            name="reason"
            rows={3}
            required
            placeholder="Reason for voiding..."
            className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.reason ? "border-destructive" : "border-border"}`}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" variant="destructive" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Void Run
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Entry Edit Dialog ───────────────────────────────────────
function EntryEditDialog({ entry, payrollRunId, open, onClose, onSuccess }) {
  const [state, formAction, isPending] = useActionState(updatePayrollEntry, entryInitial);
  if (!open || !entry) return null;
  if (state.success) onSuccess?.();

  const e = entry.earnings || {};
  const d = entry.deductions || {};

  function NumInput({ name, label, defaultValue }) {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
        <input
          name={name}
          type="number"
          min="0"
          step="1"
          defaultValue={defaultValue || 0}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">Override Entry</h3>
            <p className="text-sm text-muted-foreground">{entry.employeeName} · {entry.employeeNumber}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>

        {state.error && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 p-2 text-xs text-red-700 dark:border-red-900 dark:text-red-400">
            <AlertCircle className="h-3 w-3" /> {state.error}
          </div>
        )}

        <form action={formAction} className="space-y-5">
          <input type="hidden" name="entryId" value={entry._id} />
          <input type="hidden" name="payrollRunId" value={payrollRunId} />

          {/* Earnings */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earnings</p>
            <div className="grid grid-cols-2 gap-3">
              <NumInput name="basicSalary" label="Basic Salary" defaultValue={e.basicSalary} />
              <NumInput name="housingAllowance" label="Housing" defaultValue={e.housingAllowance} />
              <NumInput name="transportAllowance" label="Transport" defaultValue={e.transportAllowance} />
              <NumInput name="medicalAllowance" label="Medical" defaultValue={e.medicalAllowance} />
              <NumInput name="overtime" label="Overtime" defaultValue={e.overtime} />
              <NumInput name="bonus" label="Bonus" defaultValue={e.bonus} />
              <NumInput name="commission" label="Commission" defaultValue={e.commission} />
            </div>
          </div>

          {/* Deductions */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deductions</p>
            <div className="grid grid-cols-2 gap-3">
              <NumInput name="paye" label="PAYE" defaultValue={d.paye} />
              <NumInput name="nssf" label="NSSF" defaultValue={d.nssf} />
              <NumInput name="shif" label="SHIF" defaultValue={d.shif} />
              <NumInput name="housingLevy" label="Housing Levy" defaultValue={d.housingLevy} />
              <NumInput name="loanRepayment" label="Loan Repayment" defaultValue={d.loanRepayment} />
              <NumInput name="saccoDeduction" label="SACCO" defaultValue={d.saccoDeduction} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Override Note</label>
            <textarea
              name="notes"
              rows={2}
              defaultValue={entry.notes || ""}
              placeholder="Reason for manual override..."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Save Override
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main PayrollActions ─────────────────────────────────────
export function PayrollActions({ payrollRun, userRole }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [voidOpen, setVoidOpen] = useState(false);

  const { _id: runId, status } = payrollRun;

  const canGenerate = ["draft", "processing"].includes(status) && ["SuperAdmin", "Admin", "HR"].includes(userRole);
  const canApprove = ["processing", "review"].includes(status) && userRole === "Admin";
  const canMarkPaid = status === "approved" && userRole === "Admin";
  const canVoid = !["paid", "voided"].includes(status) && userRole === "Admin";

  function handleGenerate() {
    startTransition(async () => {
      const result = await generatePayrollEntries(runId);
      if (result?.success === false) {
        toast.error(result.error);
      } else {
        toast.success(`Entries generated for ${result.employeeCount} employees`);
        router.refresh();
      }
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const result = await approvePayrollRun(runId);
      if (result?.success === false) {
        toast.error(result.error);
      } else {
        toast.success("Payroll run approved");
        router.refresh();
      }
    });
  }

  function handleMarkPaid() {
    if (!confirm("Mark this payroll run as paid? All entries will be updated.")) return;
    startTransition(async () => {
      const result = await markPayrollPaid(runId);
      if (result?.success === false) {
        toast.error(result.error);
      } else {
        toast.success("Payroll marked as paid");
        router.refresh();
      }
    });
  }

  if (!canGenerate && !canApprove && !canMarkPaid && !canVoid) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canGenerate && (
          <Button onClick={handleGenerate} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            <span className="hidden sm:inline">{status === "processing" ? "Re-generate" : "Generate Entries"}</span>
          </Button>
        )}
        {canApprove && (
          <Button onClick={handleApprove} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Approve
          </Button>
        )}
        {canMarkPaid && (
          <Button onClick={handleMarkPaid} disabled={isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
            <span className="hidden sm:inline">Mark as Paid</span>
          </Button>
        )}
        {canVoid && (
          <Button
            variant="outline"
            onClick={() => setVoidOpen(true)}
            disabled={isPending}
            className="border-destructive/30 text-destructive hover:bg-destructive/5"
          >
            <XCircle className="h-4 w-4" />
            Void
          </Button>
        )}
      </div>

      <VoidDialog
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        payrollRunId={runId}
        onSuccess={() => { setVoidOpen(false); router.refresh(); }}
      />
    </>
  );
}

// ─── Entry Edit Button (used per-row in the payroll detail table) ─
export function EntryEditButton({ entry, payrollRunId, canEdit }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!canEdit) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Override entry"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <EntryEditDialog
        entry={entry}
        payrollRunId={payrollRunId}
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={() => { setOpen(false); router.refresh(); }}
      />
    </>
  );
}

// ─── Payslip Download Button (per-row) ───────────────────────────
export function PayslipButton({ payrollRunId, entryId }) {
  return (
    <a
      href={`/api/hr/payroll/${payrollRunId}/payslip/${entryId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      title="Download payslip"
    >
      <FileText className="h-3.5 w-3.5" />
    </a>
  );
}

// ─── Payroll Export Buttons (bank CSV, M-Pesa CSV, statutory) ────
export function PayrollExportButtons({ payrollRunId, userRole }) {
  if (!["SuperAdmin", "Admin", "HR"].includes(userRole)) return null;

  const exportLink = (href, icon, label) => (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
    >
      {icon}
      {label}
    </a>
  );

  return (
    <div className="space-y-2">
      {/* Payment exports */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <span className="text-xs font-medium text-muted-foreground">Payment:</span>
        {exportLink(`/api/hr/payroll/${payrollRunId}/bank-export`, <Download className="h-3.5 w-3.5" />, "Bank CSV")}
        {exportLink(`/api/hr/payroll/${payrollRunId}/mpesa-export`, <Smartphone className="h-3.5 w-3.5" />, "M-Pesa CSV")}
        {exportLink(`/api/hr/payroll/${payrollRunId}/summary-pdf`, <BookOpen className="h-3.5 w-3.5" />, "Summary PDF")}
      </div>
      {/* Statutory remittance exports */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <span className="text-xs font-medium text-muted-foreground">Statutory:</span>
        {exportLink(`/api/hr/payroll/${payrollRunId}/p10`, <Shield className="h-3.5 w-3.5" />, "P10 (PAYE)")}
        {exportLink(`/api/hr/payroll/${payrollRunId}/nssf-export`, <FileText className="h-3.5 w-3.5" />, "NSSF")}
        {exportLink(`/api/hr/payroll/${payrollRunId}/shif-export`, <FileText className="h-3.5 w-3.5" />, "SHIF")}
        {exportLink(`/api/hr/payroll/${payrollRunId}/ahl-export`, <FileText className="h-3.5 w-3.5" />, "AHL")}
      </div>
    </div>
  );
}
