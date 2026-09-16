"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Page,
  SectionHeader,
  StatGrid,
  Stat,
  Tabs,
  DataTable,
  Badge,
  Btn,
  Input,
  Select,
  Modal,
  fmt,
} from "@/components/erp-ui";
import { createSop, markReviewed, deleteSop, updateSop } from "@/app/db/actions/sops-actions";

const STATUS = {
  draft: { label: "Draft", variant: "blue" },
  in_review: { label: "In review", variant: "amber" },
  approved: { label: "Approved", variant: "green" },
  retired: { label: "Retired", variant: "default" },
};

function isReviewDue(sop) {
  return (
    (sop.status === "approved" || sop.status === "in_review") &&
    sop.nextReview &&
    new Date(sop.nextReview) <= new Date(new Date().toDateString())
  );
}
function statusBadge(sop) {
  if (isReviewDue(sop)) return <Badge variant="amber">Review due</Badge>;
  const c = STATUS[sop.status] || { label: sop.status, variant: "default" };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export default function SopsBoard({ sops, stats, users, canManage }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState("library");
  const [creating, setCreating] = useState(false);

  const pending = useMemo(() => sops.filter((x) => x.status === "in_review" || x.status === "draft" || isReviewDue(x)), [sops]);

  function refresh() {
    startTransition(() => router.refresh());
  }
  async function run(fn, ...args) {
    const res = await fn(...args);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    refresh();
  }

  const libRows = sops.map((sop) => [
    <span key="c" style={{ fontWeight: 600 }}>{sop.code}</span>,
    sop.title,
    sop.department || "—",
    sop.category || "—",
    sop.version,
    fmt.date(sop.lastReviewed),
    <span key="nr" style={{ color: isReviewDue(sop) ? "#B8600B" : "var(--foreground)" }}>{fmt.date(sop.nextReview)}</span>,
    statusBadge(sop),
    canManage ? (
      <div key="a" style={{ display: "flex", gap: 6 }}>
        <Btn size="sm" variant="outline" onClick={() => run(markReviewed, sop._id, "", "")}>Mark reviewed</Btn>
        <Btn size="sm" variant="danger" onClick={() => confirm(`Delete ${sop.code}?`) && run(deleteSop, sop._id)}>✕</Btn>
      </div>
    ) : "",
  ]);

  const pendingRows = pending.map((sop) => [
    <span key="c" style={{ fontWeight: 600 }}>{sop.code}</span>,
    sop.title,
    sop.department || "—",
    isReviewDue(sop) ? "Review overdue" : sop.status === "in_review" ? "Awaiting sign-off" : "Drafting",
    statusBadge(sop),
    canManage ? (
      <select
        key="s"
        value={sop.status}
        onChange={(e) => run(updateSop, sop._id, { status: e.target.value })}
        style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 12 }}
      >
        {Object.entries(STATUS).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
      </select>
    ) : "",
  ]);

  return (
    <Page>
      <SectionHeader
        title="SOP Library"
        sub="Controlled documents & review schedule"
        action={canManage ? <Btn variant="gold" onClick={() => setCreating(true)}>+ New SOP</Btn> : null}
      />

      <StatGrid>
        <Stat label="Total SOPs" value={stats.total} icon="📚" />
        <Stat label="Approved" value={stats.approved} variant="green" icon="✅" />
        <Stat label="Review Due" value={stats.reviewDue} variant={stats.reviewDue ? "amber" : "green"} icon="🔁" />
        <Stat label="Drafts" value={stats.drafts} variant="blue" icon="✍️" />
      </StatGrid>

      <div style={{ margin: "18px 0" }}>
        <Tabs tabs={[{ id: "library", label: "Library" }, { id: "pending", label: `Pending Review (${pending.length})` }]} active={tab} setActive={setTab} />
      </div>

      {tab === "library" && (
        <DataTable headers={["Code", "Title", "Department", "Category", "Version", "Last Reviewed", "Next Review", "Status", ""]} rows={libRows} empty="No SOPs yet." searchable />
      )}
      {tab === "pending" && (
        <DataTable headers={["Code", "Title", "Department", "Note", "Status", ""]} rows={pendingRows} empty="Nothing pending review." />
      )}

      {creating && <SopModal users={users} onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); }} />}
    </Page>
  );
}

function SopModal({ users, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ title: "", department: "", category: "", version: "v1", status: "draft", ownerUserId: "", lastReviewed: "", nextReview: "" });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    if (!f.title.trim()) return toast.error("A title is required");
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    const who = users.find((u) => u.id === f.ownerUserId);
    if (who) fd.set("ownerName", who.name);
    const res = await createSop(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title="New SOP" width={600} onClose={onClose}>
      <Input label="Title" value={f.title} onChange={set("title")} required placeholder="e.g. Goods Receiving & Inspection" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Input label="Department" value={f.department} onChange={set("department")} placeholder="Stores" />
        <Input label="Category" value={f.category} onChange={set("category")} placeholder="Operations" />
        <Input label="Version" value={f.version} onChange={set("version")} placeholder="v1" />
        <Select label="Status" value={f.status} onChange={set("status")} options={Object.entries(STATUS).map(([v, o]) => ({ value: v, label: o.label }))} />
        <Select label="Owner" value={f.ownerUserId} onChange={set("ownerUserId")} options={[{ value: "", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        <Input label="Last reviewed" type="date" value={f.lastReviewed} onChange={set("lastReviewed")} />
        <Input label="Next review" type="date" value={f.nextReview} onChange={set("nextReview")} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Create SOP"}</Btn>
      </div>
    </Modal>
  );
}
