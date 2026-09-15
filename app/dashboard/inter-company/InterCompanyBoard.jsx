"use client";

import { useState, useTransition } from "react";
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
import {
  createContract,
  deleteContract,
  recordTransaction,
  setTransactionStatus,
  deleteTransaction,
} from "@/app/db/actions/intercompany-actions";

const TYPE = {
  mgmt_fee: "Mgmt Fee",
  shared_services: "Shared Services",
  royalty: "Royalty",
  license: "License",
  loan: "Loan",
  other: "Other",
};
const CONTRACT_STATUS = {
  settled: { label: "Settled", variant: "green" },
  partial: { label: "Partial", variant: "amber" },
  outstanding: { label: "Outstanding", variant: "red" },
};
const TXN_STATUS = {
  invoiced: { label: "Invoiced", variant: "amber" },
  collected: { label: "Collected", variant: "green" },
  overdue: { label: "Overdue", variant: "red" },
  written_off: { label: "Written off", variant: "default" },
};
const KES = (n) => `Kshs ${Number(n || 0).toLocaleString("en-KE")}`;
const KESm = (n) => `Kshs ${(Number(n || 0) / 1_000_000).toFixed(2)}M`;

function pill(map, k) {
  const c = map[k] || { label: k, variant: "default" };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export default function InterCompanyBoard({ contracts, transactions, stats, canManage }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState("contracts");
  const [modal, setModal] = useState(null); // "contract" | "txn"

  function refresh() {
    startTransition(() => router.refresh());
  }
  async function run(fn, ...args) {
    const res = await fn(...args);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    refresh();
  }

  const contractRows = contracts.map((c) => [
    <span key="s" style={{ fontWeight: 600 }}>{c.sisterCompany}</span>,
    TYPE[c.contractType] || c.contractType,
    KES(c.contractValue),
    KES(c.fee),
    KES(c.minRequired),
    KES(c.collected),
    <span key="o" style={{ color: c.outstanding > 0 ? "#C00000" : "var(--foreground)" }}>{KES(c.outstanding)}</span>,
    pill(CONTRACT_STATUS, c.status),
    canManage ? <Btn key="x" size="sm" variant="danger" onClick={() => confirm(`Delete ${c.contractNumber}?`) && run(deleteContract, c._id)}>✕</Btn> : "",
  ]);

  const txnRows = transactions.map((t) => [
    fmt.date(t.txnDate),
    t.sisterCompany,
    t.transactionType || "—",
    KES(t.amount),
    canManage ? (
      <select
        key="st"
        value={t.status}
        onChange={(e) => run(setTransactionStatus, t._id, e.target.value)}
        style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 12 }}
      >
        {Object.entries(TXN_STATUS).map(([v, x]) => <option key={v} value={v}>{x.label}</option>)}
      </select>
    ) : pill(TXN_STATUS, t.status),
    canManage ? <Btn key="x" size="sm" variant="danger" onClick={() => run(deleteTransaction, t._id)}>✕</Btn> : "",
  ]);

  return (
    <Page>
      <SectionHeader
        title="Inter-Company"
        sub="Sister-company contracts, fees & eliminations"
        action={canManage ? (
          <div style={{ display: "flex", gap: 8 }}>
            {tab === "transactions" && contracts.length > 0 && <Btn variant="outline" onClick={() => setModal("txn")}>+ Transaction</Btn>}
            <Btn variant="gold" onClick={() => setModal("contract")}>+ New Contract</Btn>
          </div>
        ) : null}
      />

      <StatGrid>
        <Stat label="Total IC Fees" value={KESm(stats.totalFees)} icon="🔗" />
        <Stat label="Collected" value={KESm(stats.collected)} variant="green" icon="✅" />
        <Stat label="Outstanding" value={KESm(stats.outstanding)} variant="red" icon="⏳" />
        <Stat label="Transactions" value={stats.transactions} variant="blue" icon="📊" />
      </StatGrid>

      <div style={{ margin: "18px 0" }}>
        <Tabs tabs={[{ id: "contracts", label: "Contracts" }, { id: "transactions", label: "Transactions" }]} active={tab} setActive={setTab} />
      </div>

      {tab === "contracts" && (
        <DataTable headers={["Sister Company", "Type", "Contract Value", "Fee", "Min Required", "Collected", "Outstanding", "Status", ""]} rows={contractRows} empty="No inter-company contracts yet." />
      )}
      {tab === "transactions" && (
        <DataTable headers={["Date", "Sister Company", "Type", "Amount", "Status", ""]} rows={txnRows} empty="No transactions recorded." />
      )}

      {modal === "contract" && <ContractModal onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === "txn" && <TxnModal contracts={contracts} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </Page>
  );
}

function ContractModal({ onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ sisterCompany: "", contractType: "mgmt_fee", contractValue: "", fee: "", minRequired: "", currency: "KES" });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    if (!f.sisterCompany.trim()) return toast.error("A sister company is required");
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    const res = await createContract(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title="New inter-company contract" width={600} onClose={onClose}>
      <Input label="Sister company" value={f.sisterCompany} onChange={set("sisterCompany")} required placeholder="Qalibrated Labs Ltd" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Select label="Type" value={f.contractType} onChange={set("contractType")} options={Object.entries(TYPE).map(([v, l]) => ({ value: v, label: l }))} />
        <Input label="Contract value" type="number" value={f.contractValue} onChange={set("contractValue")} />
        <Input label="Fee" type="number" value={f.fee} onChange={set("fee")} note="What collection is measured against" />
        <Input label="Min required" type="number" value={f.minRequired} onChange={set("minRequired")} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Create contract"}</Btn>
      </div>
    </Modal>
  );
}

function TxnModal({ contracts, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ contractId: contracts[0]?._id || "", txnDate: new Date().toISOString().slice(0, 10), transactionType: "", amount: "", status: "invoiced", reference: "" });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    if (!f.contractId) return toast.error("Choose a contract");
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    const res = await recordTransaction(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title="Record transaction" width={560} onClose={onClose}>
      <Select label="Contract" value={f.contractId} onChange={set("contractId")} options={contracts.map((c) => ({ value: c._id, label: `${c.sisterCompany} — ${TYPE[c.contractType] || c.contractType}` }))} required />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Input label="Date" type="date" value={f.txnDate} onChange={set("txnDate")} required />
        <Input label="Amount" type="number" value={f.amount} onChange={set("amount")} required />
        <Input label="Type" value={f.transactionType} onChange={set("transactionType")} placeholder="Mgmt Fee" />
        <Select label="Status" value={f.status} onChange={set("status")} options={Object.entries(TXN_STATUS).map(([v, x]) => ({ value: v, label: x.label }))} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Record"}</Btn>
      </div>
    </Modal>
  );
}
