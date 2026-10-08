"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, Download, Ruler, Flag, CalendarDays } from "lucide-react";
import { saveMethodology } from "@/app/db/actions/methodology-actions";

/** The eight method-statement sections, in order. */
const SECTIONS = [
  { key: "scope", label: "Scope of Works", hint: "What is included in the works this methodology covers." },
  { key: "approach", label: "Methodology / Approach", hint: "The overall approach and construction method." },
  { key: "sequenceOfWorks", label: "Sequence of Works", hint: "The order the works are carried out in." },
  { key: "resources", label: "Resources (Plant, Labour, Materials)", hint: "The plant, labour and materials the method relies on." },
  { key: "healthSafety", label: "Health & Safety", hint: "Hazards, controls and the safe system of work." },
  { key: "qualityControl", label: "Quality Control", hint: "Inspection, testing and acceptance." },
  { key: "programmeSummary", label: "Programme Summary", hint: "Key dates, durations and how they tie to the programme." },
  { key: "risks", label: "Risks & Mitigations", hint: "The main risks and how they are managed." },
];

function money(n) {
  return `KES ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Number(n) || 0)}`;
}

export default function MethodologyBoard({ projectId, methodology, links, canManage = false, readOnly = false }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const editable = canManage && !readOnly;

  const [form, setForm] = useState(() =>
    Object.fromEntries(SECTIONS.map((s) => [s.key, methodology?.[s.key] ?? ""])),
  );
  const [dirty, setDirty] = useState(false);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setDirty(true);
  };

  function save() {
    startTransition(async () => {
      const res = await saveMethodology(projectId, form);
      if (res?.success) {
        toast.success(res.message);
        setDirty(false);
        router.refresh();
      } else {
        toast.error(res?.error || "Failed to save");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Linked plan — the BOQ, milestones and programme this methodology plans for. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <LinkCard icon={Ruler} label="Bill of Quantities" value={money(links.boqTotal)} sub={`${links.boqItems} item${links.boqItems === 1 ? "" : "s"}`} href={`/dashboard/projects/boq?project=${projectId}`} />
        <LinkCard icon={Flag} label="Milestones" value={String(links.milestoneCount)} sub={links.milestoneValue ? money(links.milestoneValue) : "no value set"} href={`/dashboard/projects/milestones?project=${projectId}`} />
        <LinkCard icon={CalendarDays} label="Programme" value={String(links.taskCount)} sub={`activit${links.taskCount === 1 ? "y" : "ies"}`} href={`/dashboard/projects/programme?project=${projectId}`} />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {methodology?.lastModifiedByName
            ? `Last updated by ${methodology.lastModifiedByName}`
            : "Draft the method statement for how this project will be delivered."}
        </p>
        <a
          href={`/api/projects/${projectId}/methodology/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <Download className="h-4 w-4" />
          Download PDF
        </a>
      </div>

      <div className="grid gap-4">
        {SECTIONS.map((s) => (
          <Card key={s.key} className="p-4 sm:p-5 space-y-2">
            <div>
              <h3 className="text-sm font-semibold">{s.label}</h3>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </div>
            {editable ? (
              <Textarea
                value={form[s.key]}
                onChange={set(s.key)}
                rows={4}
                placeholder={s.hint}
                className="resize-y"
              />
            ) : (
              <p className="text-sm whitespace-pre-wrap text-foreground/90 min-h-[1.5rem]">
                {form[s.key] || <span className="text-muted-foreground">Not set.</span>}
              </p>
            )}
          </Card>
        ))}
      </div>

      {editable && (
        <div className="sticky bottom-4 flex justify-end">
          <Button onClick={save} disabled={isPending || !dirty} className="shadow-lg">
            {isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            {dirty ? "Save methodology" : "Saved"}
          </Button>
        </div>
      )}
    </div>
  );
}

function LinkCard({ icon: Icon, label, value, sub, href }) {
  return (
    <a href={href} className="block">
      <Card className="p-4 hover:border-primary/40 transition-colors">
        <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </Card>
    </a>
  );
}
