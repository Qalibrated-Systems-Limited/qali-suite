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
  Modal,
  fmt,
} from "@/components/erp-ui";
import { createOrder, setOrderStatus, deleteOrder, setListing } from "@/app/db/actions/shop-actions";

const ORDER_STATUS = {
  awaiting_payment: { label: "Awaiting Payment", variant: "amber" },
  paid: { label: "Paid", variant: "green" },
  shipped: { label: "Shipped", variant: "blue" },
  delivered: { label: "Delivered", variant: "green" },
  cancelled: { label: "Cancelled", variant: "red" },
};
const KES = (n) => `Kshs ${Number(n || 0).toLocaleString("en-KE")}`;

function pill(map, k) {
  const c = map[k] || { label: k, variant: "default" };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export default function ShopBoard({ orders, catalog, stats, canManage }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState("orders");
  const [creating, setCreating] = useState(false);

  function refresh() {
    startTransition(() => router.refresh());
  }
  async function run(fn, ...args) {
    const res = await fn(...args);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    refresh();
  }

  const orderRows = orders.map((o) => [
    <span key="n" style={{ fontWeight: 600 }}>{o.orderNumber}</span>,
    o.customerName || "—",
    o.itemCount,
    KES(o.total),
    canManage ? (
      <select
        key="s"
        value={o.status}
        onChange={(e) => run(setOrderStatus, o._id, e.target.value)}
        style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 12 }}
      >
        {Object.entries(ORDER_STATUS).map(([v, x]) => <option key={v} value={v}>{x.label}</option>)}
      </select>
    ) : pill(ORDER_STATUS, o.status),
    fmt.date(o.placedAt),
    canManage ? <Btn key="x" size="sm" variant="danger" onClick={() => confirm(`Delete ${o.orderNumber}?`) && run(deleteOrder, o._id)}>✕</Btn> : "",
  ]);

  const catalogRows = catalog.map((p) => [
    p.code || "—",
    p.name,
    p.category || "—",
    <span key="st" style={{ color: p.stock <= 0 ? "#C00000" : "var(--foreground)" }}>{Number(p.stock).toLocaleString()}</span>,
    KES(p.price),
    p.stock <= 0 ? <Badge variant="red">Out of stock</Badge> : p.listed ? <Badge variant="green">Listed</Badge> : <Badge variant="amber">Unlisted</Badge>,
    canManage ? (
      <Btn
        key="t"
        size="sm"
        variant={p.listed ? "ghost" : "gold"}
        onClick={() => run(setListing, { productId: p.productId, listed: !p.listed, shopPrice: p.shopPrice })}
      >
        {p.listed ? "Unlist" : "List"}
      </Btn>
    ) : "",
  ]);

  return (
    <Page>
      <SectionHeader
        title="Online Shop"
        sub="Storefront orders & catalog"
        action={canManage ? <Btn variant="gold" onClick={() => setCreating(true)}>+ New Order</Btn> : null}
      />

      <StatGrid>
        <Stat label="Total Orders" value={stats.totalOrders} icon="🛒" />
        <Stat label="Awaiting Payment" value={stats.awaitingPayment} variant="amber" icon="⏳" />
        <Stat label="Listed Products" value={stats.listedProducts} variant="green" icon="🏷️" />
        <Stat label="Catalog Items" value={stats.catalogItems} variant="blue" icon="📦" />
      </StatGrid>

      <div style={{ margin: "18px 0" }}>
        <Tabs tabs={[{ id: "orders", label: "Orders" }, { id: "catalog", label: "Catalog" }]} active={tab} setActive={setTab} />
      </div>

      {tab === "orders" && (
        <DataTable headers={["Order No", "Customer", "Items", "Total", "Status", "Placed", ""]} rows={orderRows} empty="No orders yet." />
      )}
      {tab === "catalog" && (
        <DataTable headers={["Code", "Item", "Category", "Stock", "Price", "Listed?", ""]} rows={catalogRows} empty="No products in inventory yet." searchable />
      )}

      {creating && <OrderModal catalog={catalog} onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); }} />}
    </Page>
  );
}

function OrderModal({ catalog, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const listed = useMemo(() => catalog.filter((p) => p.listed || p.stock > 0), [catalog]);
  const [lines, setLines] = useState([{ productId: "", description: "", qty: "1", unitPrice: "" }]);

  function setLine(i, k, v) {
    setLines((cur) => {
      const next = cur.map((l, idx) => (idx === i ? { ...l, [k]: v } : l));
      if (k === "productId") {
        const p = catalog.find((x) => x.productId === v);
        if (p) { next[i].description = p.name; next[i].unitPrice = String(p.price); }
      }
      return next;
    });
  }
  const addLine = () => setLines((c) => [...c, { productId: "", description: "", qty: "1", unitPrice: "" }]);
  const rmLine = (i) => setLines((c) => (c.length > 1 ? c.filter((_, idx) => idx !== i) : c));
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);

  async function submit() {
    if (!customerName.trim()) return toast.error("A customer name is required");
    const cleaned = lines
      .filter((l) => (Number(l.qty) || 0) > 0 && (l.description.trim() || l.productId))
      .map((l) => ({ productId: l.productId || null, description: l.description, qty: Number(l.qty), unitPrice: Number(l.unitPrice) || 0 }));
    if (!cleaned.length) return toast.error("Add at least one line");
    setBusy(true);
    const res = await createOrder({ customerName, customerEmail, lines: cleaned });
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }

  return (
    <Modal title="New order" width={680} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Input label="Customer" value={customerName} onChange={setCustomerName} required />
        <Input label="Email (optional)" value={customerEmail} onChange={setCustomerEmail} />
      </div>

      <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Items</label>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 0.7fr 1fr auto", gap: 8, marginBottom: 8, alignItems: "end" }}>
          <div>
            <select
              value={l.productId}
              onChange={(e) => setLine(i, "productId", e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 7, background: "var(--background)", color: "var(--foreground)", fontSize: 12 }}
            >
              <option value="">— free text / choose product —</option>
              {listed.map((p) => <option key={p.productId} value={p.productId}>{p.name} ({KES(p.price)})</option>)}
            </select>
            {!l.productId && (
              <input
                value={l.description}
                onChange={(e) => setLine(i, "description", e.target.value)}
                placeholder="Description"
                style={{ width: "100%", marginTop: 4, padding: "7px 10px", border: "1.5px solid var(--border)", borderRadius: 7, background: "var(--background)", color: "var(--foreground)", fontSize: 12, boxSizing: "border-box" }}
              />
            )}
          </div>
          <input type="number" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} placeholder="Qty" style={{ padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 7, background: "var(--background)", color: "var(--foreground)", fontSize: 12, width: "100%", boxSizing: "border-box" }} />
          <input type="number" value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} placeholder="Unit price" style={{ padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 7, background: "var(--background)", color: "var(--foreground)", fontSize: 12, width: "100%", boxSizing: "border-box" }} />
          <Btn size="sm" variant="ghost" onClick={() => rmLine(i)}>✕</Btn>
        </div>
      ))}
      <Btn size="sm" variant="ghost" onClick={addLine}>+ Add line</Btn>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <span style={{ fontWeight: 700 }}>Total: {KES(total)}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create order"}</Btn>
        </div>
      </div>
    </Modal>
  );
}
