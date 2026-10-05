"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { saveContractAdminData } from "@/app/db/actions/project-actions";

/**
 * Contract administration data — the FIDIC conditions a notice/claim clock and a
 * payment run against. Taken from the particular conditions of contract, never a
 * template default. Saved on its own, so this is a focused screen.
 */
function daysUntil(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.round((dt - Date.now()) / 86400000);
}

function Field({ label, children, help }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

export default function ContractDataForm({ project, canManage = false }) {
  const router = useRouter();
  const formRef = useRef(null);
  const [pending, startTransition] = useTransition();
  const dv = (k) => project?.[k] ?? "";

  const [perfExp, setPerfExp] = useState(dv("perfSecurityExpires"));
  const [advExp, setAdvExp] = useState(dv("advanceGuaranteeExpires"));
  const [variationCap, setVariationCap] = useState(dv("variationCapPct"));

  const save = () => {
    const fd = new FormData(formRef.current);
    startTransition(async () => {
      const res = await saveContractAdminData(project.id, fd);
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.message ?? "Saved.");
        router.refresh();
      }
    });
  };

  const perfDays = daysUntil(perfExp);
  const advDays = daysUntil(advExp);

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-semibold">Contract data for {project?.name}</h2>
        {canManage && (
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            Save
          </Button>
        )}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Taken from your conditions of contract and the particular conditions, not
        from a template.
      </p>

      <form ref={formRef} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Form of contract">
          <Input name="formOfContract" defaultValue={dv("formOfContract")} disabled={!canManage} placeholder="e.g. FIDIC Red Book 2017" />
        </Field>
        <Field label="Engineer or project manager">
          <Input name="engineerName" defaultValue={dv("engineerName")} disabled={!canManage} />
        </Field>
        <Field label="Days to give notice of a claim">
          <Input name="noticeDays" type="number" min="0" defaultValue={dv("noticeDays")} disabled={!canManage} />
        </Field>
        <Field label="Days to give the detailed claim">
          <Input name="detailClaimDays" type="number" min="0" defaultValue={dv("detailClaimDays")} disabled={!canManage} />
        </Field>
        <Field label="Days the employer has to pay">
          <Input name="employerPaysDays" type="number" min="0" defaultValue={dv("employerPaysDays")} disabled={!canManage} />
        </Field>
        <Field label="Late payment interest, % above CBK base">
          <Input name="latePaymentInterestPct" type="number" step="any" min="0" defaultValue={dv("latePaymentInterestPct")} disabled={!canManage} />
        </Field>
        <Field label="Retention %">
          <Input name="retentionPercent" type="number" step="any" min="0" defaultValue={dv("retentionPercent")} disabled={!canManage} />
        </Field>
        <Field label="Retention limit, KES">
          <Input name="retentionLimit" type="number" min="0" defaultValue={dv("retentionLimit")} disabled={!canManage} />
        </Field>
        <Field label="Defects liability, months">
          <Input name="defectsMonths" type="number" min="0" defaultValue={dv("defectsMonths")} disabled={!canManage} />
        </Field>
        <Field label="Liquidated damages per day, KES">
          <Input name="ldPerDay" type="number" min="0" defaultValue={dv("ldPerDay")} disabled={!canManage} />
        </Field>
        <Field label="Damages cap, % of contract">
          <Input name="damagesCapPct" type="number" step="any" min="0" defaultValue={dv("damagesCapPct")} disabled={!canManage} />
        </Field>
        <Field label="Variation cap, % of contract">
          <Input name="variationCapPct" type="number" step="any" min="0" value={variationCap} onChange={(e) => setVariationCap(e.target.value)} disabled={!canManage} />
        </Field>
        <Field label="Performance security expires">
          <Input name="perfSecurityExpires" type="date" value={perfExp} onChange={(e) => setPerfExp(e.target.value)} disabled={!canManage} />
        </Field>
        <Field label="Advance payment guarantee expires">
          <Input name="advanceGuaranteeExpires" type="date" value={advExp} onChange={(e) => setAdvExp(e.target.value)} disabled={!canManage} />
        </Field>
      </form>

      {/* Warnings */}
      <div className="mt-4 space-y-2">
        {perfDays != null && perfDays <= 60 && (
          <Warning>
            Performance security {perfDays < 0 ? "expired" : `expires in ${perfDays} days`}. An
            expired security is a breach — renew or have it released.
          </Warning>
        )}
        {advDays != null && advDays <= 60 && (
          <Warning>
            Advance payment guarantee {advDays < 0 ? "expired" : `expires in ${advDays} days`}. An
            expired security is a breach — renew or have it released.
          </Warning>
        )}
      </div>
    </Card>
  );
}

function Warning({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
