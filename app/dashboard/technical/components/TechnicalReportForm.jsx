"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createWorkflowReport,
  updateWorkflowReport,
  submitWorkflowReport,
} from "@/app/db/actions/workflow-report-actions";
import { templateByCode, TEMPLATES } from "../lib/templates";
import SheetFormFields from "./SheetFormFields";
import { PaperCard, COAL, GOLD, INK, WAIT, weeklyVerdict } from "./ui";

const EMPTY_DATA = { header: {}, values: {}, checks: {}, runs: {}, grids: {} };

/**
 * The report form, as the Workflow Reports app lays it out: the paper card
 * with the sheet name and its code chip, the sheet itself, and at the foot the
 * gold "Approval route" panel — name who signs it, then Review & submit (which
 * asks you to re-read the key details first) or Save draft & leave.
 *
 * The app routes to one manager; here the submitter names the supervisor who
 * signs off and the manager who approves. Drives draft edits too, where it is
 * just Save changes.
 */
export default function TechnicalReportForm({
  sheet,
  projects = [],
  defaultProjectId = "",
  defaultAuthorName = "",
  report = null,
  signoffUsers = [],
  currentUserId = null,
  onDone,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEdit = Boolean(report);
  const template = sheet || templateByCode(report?.type) || templateByCode("TR01") || TEMPLATES[0];

  const [projectId, setProjectId] = useState(report?.projectId || defaultProjectId || projects[0]?.id || "");
  const [data, setData] = useState(() => ({
    ...EMPTY_DATA,
    ...(report?.data && typeof report.data === "object" ? report.data : {}),
    header: { ...(report?.data?.header || {}) },
    values: { ...(report?.data?.values || {}) },
    checks: { ...(report?.data?.checks || {}) },
    runs: { ...(report?.data?.runs || {}) },
    grids: { ...(report?.data?.grids || {}) },
  }));
  const [reviewerId, setReviewerId] = useState("");
  const [approverId, setApproverId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState("");

  const people = signoffUsers.filter((u) => u.id !== currentUserId);
  const nameOf = (id) => people.find((u) => u.id === id)?.name || "—";
  const client = (data.header.client || "").trim();
  const site = (data.header.site || "").trim();
  const filledCount =
    Object.values(data.values).filter((v) => v !== "" && v != null).length + Object.keys(data.checks).length;

  function formData() {
    const title = client ? `${template.name} — ${client}` : template.name;
    const summary = [template.name, client, site].filter(Boolean).join(" · ") || template.name;
    // The weekly verdict is stored with the report, as the app stores it.
    const hasWeekly = (template.sections || []).some((s) => s.type === "weekly");
    const body = hasWeekly ? { ...data, weekly: weeklyVerdict(data.runs, data.values.limit) } : data;
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
    fd.set("data", JSON.stringify(body));
    return fd;
  }

  const failed = (res) => Object.values(res?.errors ?? {}).flat()[0] || res?.error || "Failed to save";

  function saveDraft() {
    if (!projectId) return setMsg("Choose a project.");
    startTransition(async () => {
      const res = isEdit ? await updateWorkflowReport(report.id, null, formData()) : await createWorkflowReport(null, formData());
      if (!res?.success) return toast.error(failed(res));
      toast.success(res.message);
      if (isEdit) {
        onDone?.();
        router.refresh();
      } else if (res.id) {
        router.push(`/dashboard/technical/${res.id}`);
      }
    });
  }

  function review() {
    if (!projectId) return setMsg("Choose a project.");
    if (!client) return setMsg("Enter the client before submitting.");
    if (!reviewerId || !approverId) return setMsg("Name the supervisor and the approving manager.");
    if (reviewerId === approverId) return setMsg("The supervisor and the approving manager must be different people.");
    setMsg("");
    setConfirming(true);
  }

  function submit() {
    startTransition(async () => {
      const created = await createWorkflowReport(null, formData());
      if (!created?.success || !created.id) {
        setConfirming(false);
        return toast.error(failed(created));
      }
      const sent = await submitWorkflowReport(created.id, projectId, { reviewerId, approverId });
      if (sent?.success) toast.success(sent.message);
      else toast.error(`Saved as a draft, but not submitted: ${sent?.error || "try again from the report"}`);
      router.push(`/dashboard/technical/${created.id}`);
    });
  }

  return (
    <div>
      {confirming && (
        <div
          role="dialog"
          aria-label="Confirm before sending"
          style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(22,19,16,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setConfirming(false)}
        >
          <div className="card modal-card" style={{ maxWidth: 460, width: "100%", padding: 18, background: "#fff", borderColor: GOLD }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 900, textTransform: "uppercase", fontSize: 14, color: INK }}>Please re-read before sending</div>
            <p className="muted" style={{ fontSize: 13, margin: "6px 0 12px" }}>
              Once sent, this goes to the supervisor for sign-off, then to the manager for approval. Check the details below are correct.
            </p>
            <div style={{ fontSize: 13, color: INK, display: "grid", gap: 4 }}>
              <div>
                <b>Form:</b> {template.code} — {template.name}
              </div>
              <div>
                <b>Client:</b> {client || "—"}
              </div>
              <div>
                <b>Site / location:</b> {site || "—"}
              </div>
              {template.category === "Weighing & Metrology" && (
                <div>
                  <b>Weighbridge:</b> {data.header.weighbridge || "—"}
                </div>
              )}
              <div>
                <b>Supervisor:</b> {nameOf(reviewerId)}
              </div>
              <div>
                <b>Approving manager:</b> {nameOf(approverId)}
              </div>
              <div>
                <b>Entries filled:</b> {filledCount}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn" style={{ flex: 1 }} disabled={isPending} onClick={() => setConfirming(false)}>
                ← Keep editing
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={isPending} onClick={submit}>
                {isPending ? "Saving…" : "Confirm & send"}
              </button>
            </div>
          </div>
        </div>
      )}

      <PaperCard>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <h1 className="h1">{template.name}</h1>
          <span className="mono" style={{ fontSize: 11, color: GOLD, background: COAL, padding: "3px 6px" }}>
            {template.code}
          </span>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          {isEdit ? "Editing a draft — submit it from the report page when it is ready." : "Serial number is assigned when you submit."}
        </p>

        {!isEdit && projects.length > 1 && (
          <label className="field" style={{ maxWidth: 460 }}>
            <span className="label">Project</span>
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectNumber} — {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <SheetFormFields template={template} data={data} onChange={setData} />

        <div style={{ marginTop: 20 }}>
          {isEdit ? (
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn" disabled={isPending} onClick={() => onDone?.()}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={isPending} onClick={saveDraft}>
                {isPending ? "Saving…" : "Save changes"}
              </button>
            </div>
          ) : (
            <div className="card" style={{ borderColor: GOLD, padding: 16 }}>
              <div style={{ fontWeight: 900, textTransform: "uppercase", fontSize: 13, color: INK }}>Approval route</div>
              <div className="muted" style={{ margin: "4px 0 12px" }}>
                You → a supervisor signs it off → a manager approves it. Each is notified when it is their turn.
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, background: "#efe8d6", color: INK, padding: "8px 10px", borderRadius: 2, marginBottom: 12 }}>
                Submitting as {defaultAuthorName || "you"}
                {client ? ` · ${client}` : ""}
                {site ? ` - ${site}` : ""}
              </div>
              <div className="grid md-2">
                <label className="field">
                  <span className="label">Supervisor (signs off first)</span>
                  <select className="input" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
                    <option value="">— select —</option>
                    {people
                      .filter((u) => u.id !== approverId)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} — {u.role}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span className="label">Approving manager</span>
                  <select className="input" value={approverId} onChange={(e) => setApproverId(e.target.value)}>
                    <option value="">— select —</option>
                    {people
                      .filter((u) => u.id !== reviewerId)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} — {u.role}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {people.length < 2 && (
                <div className="muted" style={{ fontSize: 11.5, marginTop: -4 }}>
                  The sign-off group needs at least two people other than you — an admin can give them a manager role in Users.
                </div>
              )}
              {msg && <div style={{ color: WAIT, fontWeight: 700, fontSize: 13, margin: "8px 0" }}>{msg}</div>}
              <button className="btn btn-primary" style={{ width: "100%", padding: 13 }} disabled={isPending} onClick={review}>
                {isPending ? "Working…" : "Review & submit"}
              </button>
              <button className="btn" style={{ width: "100%", padding: 12, marginTop: 8 }} disabled={isPending} onClick={saveDraft}>
                Save draft &amp; leave
              </button>
            </div>
          )}
        </div>
      </PaperCard>
    </div>
  );
}
