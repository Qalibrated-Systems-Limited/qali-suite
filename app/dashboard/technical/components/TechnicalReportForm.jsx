"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2 } from "lucide-react";
import {
  createWorkflowReport,
  updateWorkflowReport,
} from "@/app/db/actions/workflow-report-actions";
import { toast } from "sonner";
import { templateByCode, TEMPLATES } from "../lib/templates";
import SheetFormFields from "./SheetFormFields";

const EMPTY_DATA = { header: {}, values: {}, checks: {}, runs: {}, grids: {} };

/**
 * The report sheet form. The QSL body (header + the chosen sheet's own
 * sections) is rendered by SheetFormFields into one `data` object; the report's
 * title and summary are derived from that, so the operator only fills the real
 * form — no separate title/summary boxes. Drives both create and draft-edit.
 */
export default function TechnicalReportForm({
  sheet,
  projects = [],
  defaultProjectId = "",
  defaultAuthorName = "",
  report = null,
  onDone,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEdit = Boolean(report);
  const template =
    sheet || templateByCode(report?.type) || templateByCode("TR01") || TEMPLATES[0];

  const [projectId, setProjectId] = useState(
    report?.projectId || defaultProjectId || projects[0]?.id || "",
  );
  const [data, setData] = useState(() => ({
    ...EMPTY_DATA,
    ...(report?.data && typeof report.data === "object" ? report.data : {}),
    header: { ...(report?.data?.header || {}) },
    values: { ...(report?.data?.values || {}) },
    checks: { ...(report?.data?.checks || {}) },
    runs: { ...(report?.data?.runs || {}) },
    grids: { ...(report?.data?.grids || {}) },
  }));

  function deriveTitleSummary() {
    const client = (data.header.client || "").trim();
    const site = (data.header.site || "").trim();
    const title = client ? `${template.name} — ${client}` : template.name;
    const summary = [template.name, client, site].filter(Boolean).join(" · ") || template.name;
    return { title, summary };
  }

  function submit(e) {
    e.preventDefault();
    if (!projectId) return toast.error("Choose a project");

    const { title, summary } = deriveTitleSummary();
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("type", template.code);
    fd.set("title", title);
    fd.set("summary", summary);
    fd.set("periodStart", "");
    fd.set("periodEnd", "");
    fd.set("workCompleted", "");
    fd.set("issues", "");
    fd.set("nextSteps", "");
    fd.set("data", JSON.stringify(data));

    startTransition(async () => {
      const res = isEdit
        ? await updateWorkflowReport(report.id, null, fd)
        : await createWorkflowReport(null, fd);
      if (res?.success) {
        toast.success(res.message);
        if (isEdit) {
          onDone?.();
          router.refresh();
        } else if (res.id) {
          router.push(`/dashboard/technical/${res.id}`);
        }
      } else {
        toast.error(Object.values(res?.errors ?? {}).flat()[0] || "Failed to save");
      }
    });
  }

  return (
    <form className="tech-panel" onSubmit={submit}>
      {!isEdit && (
        <div className="tech-form-grid" style={{ marginBottom: 4 }}>
          <div className="tech-field">
            <label className="tech-label">Project</label>
            <select className="tech-select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectNumber} — {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <p className="tech-muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
        Serial number is assigned when you submit.
      </p>

      <SheetFormFields template={template} data={data} onChange={setData} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 18,
          flexWrap: "wrap",
        }}
      >
        <span className="tech-muted" style={{ fontSize: 12 }}>
          Saved as a draft{defaultAuthorName ? ` — filed by ${defaultAuthorName}` : ""}. Submit it
          for review from the report page.
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {isEdit && (
            <button type="button" className="tech-btn-ghost" onClick={() => onDone?.()} disabled={isPending}>
              Cancel
            </button>
          )}
          <button type="submit" className="tech-btn-gold" disabled={isPending}>
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isEdit ? "Save changes" : "Create draft"}
          </button>
        </div>
      </div>
    </form>
  );
}
