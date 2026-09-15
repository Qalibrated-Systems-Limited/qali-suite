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
  Progress,
  fmt,
} from "@/components/erp-ui";
import { createBid, setBidStage, deleteBid } from "@/app/db/actions/bids-actions";

const STAGE = {
  draft: { label: "Draft", variant: "default" },
  preparing: { label: "Preparing", variant: "blue" },
  submitted: { label: "Submitted", variant: "navy" },
  stage_2b: { label: "Stage 2B", variant: "blue" },
  evaluation: { label: "Evaluation", variant: "amber" },
  awarded: { label: "Awarded", variant: "purple" },
  lost: { label: "Lost", variant: "default" },
  stopped: { label: "Stopped", variant: "red" },
};
const COMPLIANCE = {
  pending: { label: "Pending", variant: "default" },
  compliant: { label: "Compliant", variant: "green" },
  non_compliant: { label: "Non-compliant", variant: "red" },
};
const OPEN_STAGES = ["draft", "preparing", "submitted", "stage_2b", "evaluation"];
const STAGE_ORDER = Object.keys(STAGE);
const KESm = (n) => `Kshs ${(Number(n || 0) / 1_000_000).toFixed(1)}M`;
const KES = (n) => `Kshs ${Number(n || 0).toLocaleString("en-KE")}`;

function pill(map, k) {
  const c = map[k] || { label: k, variant: "default" };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export default function BidsBoard({ bids, stats, users, canManage }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState("bids");
  const [creating, setCreating] = useState(false);

  const pipeline = useMemo(() => bids.filter((b) => OPEN_STAGES.includes(b.stage)), [bids]);
  function refresh() {
    startTransition(() => router.refresh());
  }
  async function run(fn, ...args) {
    const res = await fn(...args);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    refresh();
  }

  const bidRows = bids.map((b) => [
    <span key="r" style={{ fontWeight: 600 }}>{b.bidNumber}</span>,
    b.bidName,
    b.procuringEntity || "—",
    KES(b.value),
    canManage ? (
      <select
        key="s"
        value={b.stage}
        onChange={(e) => run(setBidStage, b._id, e.target.value)}
        style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 12 }}
      >
        {STAGE_ORDER.map((v) => <option key={v} value={v}>{STAGE[v].label}</option>)}
      </select>
    ) : pill(STAGE, b.stage),
    pill(COMPLIANCE, b.compliance),
    fmt.date(b.submissionDeadline),
    canManage ? <Btn key="x" size="sm" variant="danger" onClick={() => confirm(`Delete ${b.bidNumber}?`) && run(deleteBid, b._id)}>✕</Btn> : "",
  ]);

  const pipeRows = pipeline.map((b) => [
    b.bidName,
    b.procuringEntity || "—",
    KES(b.value),
    <div key="p" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1 }}><Progress value={(b.winProbability || 0) / 100} /></div>
      <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{b.winProbability || 0}%</span>
    </div>,
  ]);

  return (
    <Page>
      <SectionHeader
        title="Bids & Pre-Sales"
        sub="Tenders, compliance & pipeline"
        action={canManage ? <Btn variant="gold" onClick={() => setCreating(true)}>+ New Bid</Btn> : null}
      />

      <StatGrid>
        <Stat label="Total Bids" value={stats.total} icon="📋" />
        <Stat label="Pipeline Value" value={KESm(stats.pipelineValue)} sub={`Weighted ${KESm(stats.weightedValue)}`} variant="blue" icon="📈" />
        <Stat label="Stage 2B+ Clear" value={stats.stage2bClear} variant="green" icon="✅" />
        <Stat label="Stopped" value={stats.stopped} variant="red" icon="🛑" />
      </StatGrid>

      <div style={{ margin: "18px 0" }}>
        <Tabs tabs={[{ id: "bids", label: "Bids" }, { id: "pipeline", label: "Pipeline" }]} active={tab} setActive={setTab} />
      </div>

      {tab === "bids" && (
        <DataTable headers={["Ref", "Bid Name", "Procuring Entity", "Value", "Stage", "Compliance", "Deadline", ""]} rows={bidRows} empty="No bids yet." />
      )}
      {tab === "pipeline" && (
        <DataTable headers={["Bid Name", "Procuring Entity", "Value (Kshs)", "Win Probability"]} rows={pipeRows} empty="No live bids in the pipeline." />
      )}

      {creating && <BidModal users={users} onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); }} />}
    </Page>
  );
}

function BidModal({ users, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    bidName: "",
    procuringEntity: "",
    value: "",
    winProbability: "50",
    stage: "preparing",
    compliance: "pending",
    submissionDeadline: "",
    ownerUserId: "",
  });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    if (!f.bidName.trim()) return toast.error("A bid needs a name");
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    const who = users.find((u) => u.id === f.ownerUserId);
    if (who) fd.set("ownerName", who.name);
    const res = await createBid(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title="New bid" width={600} onClose={onClose}>
      <Input label="Bid name" value={f.bidName} onChange={set("bidName")} required placeholder="Supply of Weighing Equipment" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Input label="Procuring entity" value={f.procuringEntity} onChange={set("procuringEntity")} placeholder="Ministry of Health" />
        <Input label="Value (Kshs)" type="number" value={f.value} onChange={set("value")} />
        <Select label="Stage" value={f.stage} onChange={set("stage")} options={Object.entries(STAGE).map(([v, o]) => ({ value: v, label: o.label }))} />
        <Select label="Compliance" value={f.compliance} onChange={set("compliance")} options={Object.entries(COMPLIANCE).map(([v, o]) => ({ value: v, label: o.label }))} />
        <Input label="Win probability (%)" type="number" value={f.winProbability} onChange={set("winProbability")} />
        <Input label="Deadline" type="date" value={f.submissionDeadline} onChange={set("submissionDeadline")} />
      </div>
      <Select label="Owner" value={f.ownerUserId} onChange={set("ownerUserId")} options={[{ value: "", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create bid"}</Btn>
      </div>
    </Modal>
  );
}
