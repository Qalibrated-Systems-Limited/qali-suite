"use client";

import { useActionState } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
import { createProject, updateProject } from "@/app/db/actions/project-actions";
import { PartyCombobox, FieldError } from "./ProjectForm";

/**
 * "Start a project" — the project data sheet, after the QSL Project Control
 * template: five groups (Identification, Commercial, Programme, Cost of being
 * paid, Control) laid out four fields wide, the fields marked required, and a
 * readiness bar that fills as they are completed. Completion date is derived
 * from the possession date and the contract period. Built in the app's theme.
 */

const REQUIRED = [
  "name",
  "awardedToCompany",
  "clientPartyId",
  "contractNumber",
  "county",
  "typeId",
  "scope",
  "contractValue",
  "vatRate",
  "startDate",
  "contractMonths",
  "bankAccount",
  "projectManagerUserId",
];

const COLS = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

function Group({ title, cols = 4, children }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className={`grid grid-cols-1 gap-4 ${COLS[cols]}`}>{children}</div>
    </div>
  );
}

function Field({ label, required, help, children, span }) {
  return (
    <div className={`space-y-1.5 ${span === 2 ? "sm:col-span-2" : ""}`}>
      <Label className="text-sm">
        {label}
        {required && <span className="ml-1 text-xs font-semibold text-red-500">required</span>}
      </Label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

export default function ProjectDataSheet({
  clients = [],
  users = [],
  projectTypes = [],
  project = null,
}) {
  const isEdit = !!project;
  const action = isEdit ? updateProject.bind(null, project._id) : createProject;
  const [state, formAction, isPending] = useActionState(action, null);
  const errors = state?.errors;
  const formRef = useRef(null);

  const [clientPartyId, setClientPartyId] = useState(project?.client?.partyId || "");
  const [pmUserId, setPmUserId] = useState(project?.projectManager?.userId || "");
  const [pmName, setPmName] = useState(project?.projectManager?.name || "");

  const iso = (d) => (d ? new Date(d).toISOString().split("T")[0] : "");
  const [startDate, setStartDate] = useState(iso(project?.startDate));
  const [months, setMonths] = useState(project?.contractMonths ?? "");
  const [endDate, setEndDate] = useState(iso(project?.endDate));

  useEffect(() => {
    if (startDate && months) {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + parseInt(months || "0", 10));
      setEndDate(d.toISOString().split("T")[0]);
    }
  }, [startDate, months]);

  const [filled, setFilled] = useState(new Set());
  const recompute = () => {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const next = new Set();
    for (const key of REQUIRED) {
      const v = (fd.get(key) ?? "").toString().trim();
      if (v) next.add(key);
    }
    setFilled(next);
  };
  useEffect(() => {
    recompute();
  }, [clientPartyId, pmUserId, startDate, months]);

  const readiness = useMemo(
    () => Math.round((filled.size / REQUIRED.length) * 100),
    [filled],
  );
  const dv = (key, fallback = "") =>
    project?.[key] ?? state?.values?.[key] ?? fallback;

  return (
    <>
      <div className="flex items-center gap-3 sm:gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={isEdit ? `/dashboard/projects/${project._id}` : "/dashboard/projects"}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold sm:text-2xl">
            {isEdit ? "Project data sheet" : "Start a project"}
          </h1>
          <p className="text-sm text-muted-foreground">
            The data sheet every new project passes through before it goes to
            budget.
          </p>
        </div>
      </div>

      {/* Readiness */}
      <Card className="p-4">
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="font-medium">
            {readiness === 100 ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> Ready
              </span>
            ) : (
              "Readiness"
            )}
          </span>
          <span className="text-muted-foreground">
            {filled.size} of {REQUIRED.length} required fields
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${
              readiness === 100 ? "bg-emerald-500" : "bg-primary"
            }`}
            style={{ width: `${readiness}%` }}
          />
        </div>
      </Card>

      <form action={formAction} ref={formRef} onInput={recompute}>
        <input type="hidden" name="clientPartyId" value={clientPartyId} />
        <input type="hidden" name="projectManagerUserId" value={pmUserId} />
        <input type="hidden" name="projectManagerName" value={pmName} />

        {errors?._form && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            {errors._form.map((e, i) => (
              <p key={i} className="text-sm text-red-600 dark:text-red-400">
                {e}
              </p>
            ))}
          </div>
        )}

        <Card className="space-y-8 p-4 sm:p-6">
          {/* Identification */}
          <Group title="Identification" cols={4}>
            <Field label="Project name" required>
              <Input name="name" placeholder="e.g. Otho Road construction" defaultValue={dv("name")} required />
              <FieldError errors={errors} field="name" />
            </Field>
            <Field label="Company the work is awarded to" required>
              <Input name="awardedToCompany" placeholder="Group entity holding the contract" defaultValue={dv("awardedToCompany")} />
            </Field>
            <Field label="Client or employer" required help="A project's client is a customer — add under Parties if missing.">
              <PartyCombobox
                value={clientPartyId}
                onValueChange={setClientPartyId}
                parties={clients}
                placeholder="Select customer..."
                label="customers"
              />
            </Field>
            <Field label="Contract number" required>
              <Input name="contractNumber" defaultValue={dv("contractNumber")} placeholder="e.g. RWC/772/2024" />
            </Field>
            <Field label="County" required>
              <Input name="county" defaultValue={dv("county")} placeholder="e.g. Mombasa" />
            </Field>
            <Field label="Kind of work" required>
              <Select name="typeId" defaultValue={project?.typeId || state?.values?.typeId || "none"}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No type (shows everything)</SelectItem>
                  {projectTypes.map((t) => (
                    <SelectItem key={t._id || t.id} value={t._id || t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Scope in one sentence" required span={2}>
              <Input name="scope" defaultValue={dv("scope")} placeholder="What the works are, in a sentence." />
            </Field>
          </Group>

          {/* Commercial */}
          <Group title="Commercial" cols={4}>
            <Field label="Contract sum including tax (KES)" required>
              <Input name="contractValue" type="number" min="0" step="1" defaultValue={dv("contractValue")} />
              <FieldError errors={errors} field="contractValue" />
            </Field>
            <Field label="Document the contract sum is taken from" required help="Name the signed document and its date.">
              <Input name="contractSumSource" defaultValue={dv("contractSumSource")} />
            </Field>
            <Field label="VAT rate applied (%)" required>
              <Input name="vatRate" type="number" step="any" min="0" defaultValue={dv("vatRate", "16")} />
            </Field>
            <Field label="Advance payment expected (KES)">
              <Input name="advanceAmount" type="number" min="0" step="1" defaultValue={dv("advanceAmount")} />
            </Field>
            <Field label="Retention percentage (%)">
              <Input name="retentionPercent" type="number" step="any" min="0" defaultValue={dv("retentionPercent")} />
            </Field>
            <Field label="Defects liability period (months)">
              <Input name="defectsMonths" type="number" min="0" step="1" defaultValue={dv("defectsMonths")} />
            </Field>
          </Group>

          {/* Programme */}
          <Group title="Programme" cols={3}>
            <Field label="Site possession date" required>
              <Input name="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Contract period (months)" required>
              <Input name="contractMonths" type="number" min="0" step="1" value={months} onChange={(e) => setMonths(e.target.value)} />
            </Field>
            <Field label="Contractual completion date" help="Filled from possession date + period; edit if it differs.">
              <Input name="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </Group>

          {/* Cost of being paid */}
          <Group title="Cost of being paid" cols={4}>
            <Field label="Performance bond & guarantees (KES)" help="Enter zero only if none are required.">
              <Input name="bondCost" type="number" min="0" step="1" defaultValue={dv("bondCost")} />
            </Field>
            <Field label="Contractors' all-risks & WIBA (KES)">
              <Input name="insuranceCost" type="number" min="0" step="1" defaultValue={dv("insuranceCost")} />
            </Field>
            <Field label="Bank charges, interest & facility (KES)">
              <Input name="financeCost" type="number" min="0" step="1" defaultValue={dv("financeCost")} />
            </Field>
            <Field label="Statutory, permits & compliance (KES)">
              <Input name="statutoryCost" type="number" min="0" step="1" defaultValue={dv("statutoryCost")} />
            </Field>
          </Group>

          {/* Control */}
          <Group title="Control" cols={4}>
            <Field label="Bank account this project runs on" required help="One account per project — do not mix contracts.">
              <Input name="bankAccount" defaultValue={dv("bankAccount")} />
            </Field>
            <Field label="Project manager" required>
              <PartyCombobox
                value={pmUserId}
                onValueChange={(id, name) => {
                  setPmUserId(id);
                  setPmName(name);
                }}
                parties={users.map((u) => ({ _id: u._id, name: `${u.name} (${u.role})` }))}
                placeholder="Select PM..."
                label="users"
              />
            </Field>
            <Field label="Site agent or foreman">
              <Input name="siteAgentName" defaultValue={dv("siteAgentName")} />
            </Field>
            <Field label="Quantity surveyor">
              <Input name="qsName" defaultValue={dv("qsName")} />
            </Field>
            <Field label="Priority">
              <Select name="priority" defaultValue={project?.priority || state?.values?.priority || "normal"}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="flex flex-col justify-end gap-2 sm:col-span-2 lg:col-span-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="fundsRingfenced" value="true" defaultChecked={!!project?.fundsRingfenced} className="h-4 w-4" />
                Funds are ring-fenced to this project
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="boqOnFile" value="true" defaultChecked={!!project?.boqOnFile} className="h-4 w-4" />
                Priced bill of quantities exists and is filed
              </label>
            </div>
          </Group>

          <div className="flex items-center justify-end gap-3 border-t pt-4">
            <Button type="button" variant="outline" asChild>
              <Link href={isEdit ? `/dashboard/projects/${project._id}` : "/dashboard/projects"}>
                Cancel
              </Link>
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {isEdit ? "Save data sheet" : "Create project"}
            </Button>
          </div>
        </Card>
      </form>
    </>
  );
}
