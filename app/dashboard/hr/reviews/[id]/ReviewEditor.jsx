"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePerformanceReview, acknowledgePerformanceReview, deletePerformanceReview } from "@/app/db/actions/hr-records-actions";
import { REVIEW_RECOMMENDATION_LABELS, RATING_LABELS } from "@/lib/hr/record-labels";
import { Field, inputClass, Button, Card, useRunAction } from "../../components/records-ui";

/**
 * One review, with each party writing only their part at their stage:
 * HR the objectives (draft), the employee their self-ratings (self
 * assessment), the reviewer the ratings and summary (manager review).
 * The employee sees the manager's ratings once the review is complete.
 */
export default function ReviewEditor({ r }) {
  const router = useRouter();
  const [pending, run] = useRunAction();
  const parts = r.parts || [];
  const status = r.status;
  const as =
    status === "draft" && parts.includes("hr")
      ? "hr"
      : status === "self_assessment" && parts.includes("employee")
        ? "employee"
        : status === "manager_review" && parts.includes("reviewer")
          ? "reviewer"
          : null;
  const [objs, setObjs] = useState(r.objectives || []);
  const [f, setF] = useState({
    selfComment: r.self_comment || "",
    managerComment: r.manager_comment || "",
    strengths: r.strengths || "",
    developmentAreas: r.development_areas || "",
    recommendation: r.recommendation || "",
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const setObj = (i, k, v) => setObjs((l) => l.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
  const showManager = status === "completed" || as === "reviewer" || parts.includes("hr") || parts.includes("reviewer");
  const total = objs.reduce((n, o) => n + Number(o.weight || 0), 0);

  const save = (advance) =>
    run(() =>
      savePerformanceReview(r.id, as, {
        objectives: objs,
        ...(as === "employee" ? { selfComment: f.selfComment } : {}),
        ...(as === "reviewer"
          ? { managerComment: f.managerComment, strengths: f.strengths, developmentAreas: f.developmentAreas, recommendation: f.recommendation }
          : {}),
        advance,
      }),
    );

  const ratingSelect = (i, k, editable) =>
    editable ? (
      <select className={inputClass()} value={objs[i][k] ?? ""} onChange={(e) => setObj(i, k, e.target.value ? Number(e.target.value) : null)}>
        <option value="">—</option>
        {Object.entries(RATING_LABELS).map(([n, l]) => <option key={n} value={n}>{l}</option>)}
      </select>
    ) : (
      <span>{objs[i][k] ?? "—"}</span>
    );

  return (
    <div className="space-y-4">
      <Card title="Objectives">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-2">Objective</th>
                <th className="w-20 py-2 pr-2">Weight %</th>
                <th className="w-48 py-2 pr-2">Self rating</th>
                {showManager && <th className="w-48 py-2 pr-2">Reviewer rating</th>}
                {showManager && <th className="py-2">Reviewer comment</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {objs.map((o, i) => (
                <tr key={i}>
                  <td className="py-2 pr-2">
                    {as === "hr" ? <input className={inputClass()} value={o.objective} onChange={(e) => setObj(i, "objective", e.target.value)} /> : o.objective}
                  </td>
                  <td className="py-2 pr-2">
                    {as === "hr" ? <input type="number" className={inputClass()} value={o.weight} onChange={(e) => setObj(i, "weight", Number(e.target.value))} /> : `${o.weight}%`}
                  </td>
                  <td className="py-2 pr-2">{ratingSelect(i, "selfRating", as === "employee")}</td>
                  {showManager && <td className="py-2 pr-2">{ratingSelect(i, "managerRating", as === "reviewer")}</td>}
                  {showManager && (
                    <td className="py-2">
                      {as === "reviewer" ? <input className={inputClass()} value={o.comment || ""} onChange={(e) => setObj(i, "comment", e.target.value)} /> : o.comment || "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {as === "hr" && (
          <div className="mt-2 flex items-center justify-between">
            <button type="button" className="text-sm text-primary hover:underline" onClick={() => setObjs((l) => [...l, { objective: "", weight: 0 }])}>+ Add objective</button>
            <span className={`text-xs ${total === 100 ? "text-emerald-600" : "text-destructive"}`}>Weights total {total}%</span>
          </div>
        )}
      </Card>

      <Card title="Self-assessment">
        {as === "employee" ? (
          <textarea rows={4} className={inputClass()} value={f.selfComment} onChange={set("selfComment")} placeholder="Your achievements, challenges and the support you need." />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{r.self_comment || <span className="text-muted-foreground">Not written yet.</span>}</p>
        )}
      </Card>

      {showManager && (
        <Card title="Reviewer's assessment">
          {as === "reviewer" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Strengths"><textarea rows={3} className={inputClass()} value={f.strengths} onChange={set("strengths")} /></Field>
              <Field label="Areas for development"><textarea rows={3} className={inputClass()} value={f.developmentAreas} onChange={set("developmentAreas")} /></Field>
              <Field label="Overall comment" className="sm:col-span-2"><textarea rows={3} className={inputClass()} value={f.managerComment} onChange={set("managerComment")} /></Field>
              <Field label="Recommendation">
                <select className={inputClass()} value={f.recommendation} onChange={set("recommendation")}>
                  <option value="">—</option>
                  {Object.entries(REVIEW_RECOMMENDATION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p><b>Strengths:</b> {r.strengths || "—"}</p>
              <p><b>Areas for development:</b> {r.development_areas || "—"}</p>
              <p><b>Comment:</b> {r.manager_comment || "—"}</p>
              <p><b>Recommendation:</b> {REVIEW_RECOMMENDATION_LABELS[r.recommendation] || "—"}</p>
            </div>
          )}
        </Card>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {as === "hr" && (
          <Button variant="danger" pending={pending} onClick={() => confirm("Delete this draft review?") && run(() => deletePerformanceReview(r.id), () => router.push("/dashboard/hr/reviews"))}>
            Delete draft
          </Button>
        )}
        {as && <Button variant="secondary" pending={pending} onClick={() => save(false)}>Save</Button>}
        {as === "hr" && <Button pending={pending} onClick={() => save(true)}>Open self-assessment</Button>}
        {as === "employee" && <Button pending={pending} onClick={() => save(true)}>Submit to reviewer</Button>}
        {as === "reviewer" && <Button pending={pending} onClick={() => confirm("Complete the review? The ratings are final once completed.") && save(true)}>Complete review</Button>}
        {status === "completed" && parts.includes("employee") && !r.employee_acknowledged_at && (
          <Button pending={pending} onClick={() => run(() => acknowledgePerformanceReview(r.id))}>I have read this review</Button>
        )}
      </div>
    </div>
  );
}
