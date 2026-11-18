"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
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
  Alert,
  Input,
  Select,
  Modal,
  fmt,
} from "@/components/erp-ui";
import {
  createVehicle,
  updateVehicle,
  setVehicleStatus,
  deleteVehicle,
  logTrip,
  deleteTrip,
  logMaintenance,
  setMaintenanceStatus,
  completeMaintenance,
  deleteMaintenance,
} from "@/app/db/actions/fleet-actions";

const VEH_STATUS = {
  active: { label: "Active", variant: "green" },
  service_due: { label: "Service Due", variant: "amber" },
  grounded: { label: "Grounded", variant: "red" },
  retired: { label: "Retired", variant: "default" },
};
const MAINT_STATUS = {
  scheduled: { label: "Scheduled", variant: "blue" },
  in_progress: { label: "In progress", variant: "amber" },
  done: { label: "Done", variant: "green" },
};
const EXPENSE_STATUS = {
  draft: { label: "Draft — awaiting finance", variant: "amber" },
  posted: { label: "Posted", variant: "blue" },
  paid: { label: "Paid", variant: "green" },
  void: { label: "Void", variant: "default" },
};
const KES = (n) => `Kshs ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function pill(map, k) {
  const c = map[k] || { label: k, variant: "default" };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}
function ExpenseChip({ expense }) {
  if (!expense) return <span style={{ color: "var(--muted-foreground)" }}>—</span>;
  const c = EXPENSE_STATUS[expense.status] || { label: expense.status, variant: "default" };
  return (
    <Link href={`/dashboard/expenses/${expense.id}`} style={{ textDecoration: "none" }}>
      <span style={{ fontSize: 11, color: "var(--muted-foreground)", marginRight: 6 }}>{expense.number}</span>
      <Badge variant={c.variant}>{c.label}</Badge>
    </Link>
  );
}
function serviceDueLabel(v) {
  const parts = [];
  if (v.nextServiceDate) parts.push(fmt.date(v.nextServiceDate));
  if (v.nextServiceKm != null) parts.push(`${v.nextServiceKm.toLocaleString()} km`);
  return parts.join(" or ") || "—";
}
function isServiceDue(v) {
  if (v.status === "retired") return false;
  if (v.status === "service_due") return true;
  if (v.nextServiceDate && daysUntil(v.nextServiceDate) <= 0) return true;
  return v.nextServiceKm != null && v.mileageKm >= v.nextServiceKm;
}

export default function FleetBoard({
  vehicles,
  trips,
  maintenance,
  stats,
  users,
  expenseAccounts,
  assets,
  canManage,
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState("vehicles");
  const [modal, setModal] = useState(null); // { kind, record? }

  const activeVehicles = vehicles.filter((v) => v.status !== "retired");
  const vehicleOptions = useMemo(
    () =>
      activeVehicles.map((v) => ({ value: v._id, label: `${v.regNo} — ${v.make} ${v.model}`.trim() })),
    [activeVehicles],
  );
  const byId = useMemo(() => Object.fromEntries(vehicles.map((v) => [v._id, v])), [vehicles]);

  function refresh() {
    startTransition(() => router.refresh());
  }
  async function run(fn, ...args) {
    const res = await fn(...args);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    refresh();
  }
  const close = () => setModal(null);
  const done = () => {
    setModal(null);
    refresh();
  };

  const vehicleRows = vehicles.map((v) => {
    const dLeft = daysUntil(v.insuranceExpiry);
    const due = isServiceDue(v);
    const hasHistory = v.tripCount + v.serviceCount > 0;
    return [
      <span key="r" style={{ fontWeight: 600 }}>
        {v.regNo}
        {v.assetNumber && (
          <span style={{ display: "block", fontSize: 11, fontWeight: 400, color: "var(--muted-foreground)" }}>
            Asset {v.assetNumber}
          </span>
        )}
      </span>,
      `${v.make} ${v.model}`.trim() || "—",
      v.driverName || <span style={{ color: "var(--muted-foreground)" }}>—</span>,
      <span key="i" style={{ color: dLeft != null && dLeft <= 30 ? "#B8600B" : "var(--foreground)" }}>
        {fmt.date(v.insuranceExpiry)}
      </span>,
      <span key="s" style={{ color: due ? "#B8600B" : "var(--foreground)" }}>{serviceDueLabel(v)}</span>,
      `${Number(v.mileageKm || 0).toLocaleString()} km`,
      v.costPerKm != null ? `${KES(v.costPerKm)}/km` : <span style={{ color: "var(--muted-foreground)" }}>—</span>,
      pill(VEH_STATUS, due && v.status === "active" ? "service_due" : v.status),
      canManage ? (
        <span key="a" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <Btn size="sm" variant="ghost" onClick={() => setModal({ kind: "vehicle", record: v })}>Edit</Btn>
          {v.status !== "retired" && hasHistory && (
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => confirm(`Retire ${v.regNo}? Its history is kept.`) && run(setVehicleStatus, v._id, "retired")}
            >
              Retire
            </Btn>
          )}
          {!hasHistory && (
            <Btn size="sm" variant="danger" onClick={() => confirm(`Remove ${v.regNo}?`) && run(deleteVehicle, v._id)}>✕</Btn>
          )}
        </span>
      ) : (
        ""
      ),
    ];
  });

  const tripRows = trips.map((t) => [
    fmt.date(t.tripDate),
    byId[t.vehicleId]?.regNo || "—",
    t.purpose || "—",
    [t.fromLocation, t.toLocation].filter(Boolean).join(" → ") || "—",
    t.driverName || "—",
    <span key="d">
      {Number(t.distanceKm || 0).toLocaleString()} km
      {t.odometerEnd != null && (
        <span style={{ display: "block", fontSize: 11, color: "var(--muted-foreground)" }}>
          {Number(t.odometerStart ?? 0).toLocaleString()} → {Number(t.odometerEnd).toLocaleString()}
        </span>
      )}
    </span>,
    <span key="f">
      {KES(t.fuelCost)}
      {Number(t.fuelLitres) > 0 && (
        <span style={{ display: "block", fontSize: 11, color: "var(--muted-foreground)" }}>{Number(t.fuelLitres)} L</span>
      )}
    </span>,
    <ExpenseChip key="e" expense={t.expense} />,
    canManage ? (
      <Btn key="x" size="sm" variant="danger" onClick={() => confirm("Delete this trip?") && run(deleteTrip, t._id)}>✕</Btn>
    ) : (
      ""
    ),
  ]);

  const maintRows = maintenance.map((m) => [
    fmt.date(m.serviceDate),
    byId[m.vehicleId]?.regNo || "—",
    m.service || "—",
    m.garage || "—",
    KES(m.cost),
    canManage && m.status !== "done" ? (
      <span key="s" style={{ display: "flex", gap: 6 }}>
        <select
          value={m.status}
          onChange={(e) => run(setMaintenanceStatus, m._id, e.target.value)}
          style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 12 }}
        >
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In progress</option>
        </select>
        <Btn size="sm" variant="green" onClick={() => setModal({ kind: "complete", record: m })}>Complete</Btn>
      </span>
    ) : (
      <span key="s">
        {pill(MAINT_STATUS, m.status)}
        {m.status === "done" && m.odometerKm != null && (
          <span style={{ display: "block", fontSize: 11, color: "var(--muted-foreground)" }}>
            at {Number(m.odometerKm).toLocaleString()} km
          </span>
        )}
      </span>
    ),
    <ExpenseChip key="e" expense={m.expense} />,
    canManage ? (
      <Btn key="x" size="sm" variant="danger" onClick={() => confirm("Delete this record?") && run(deleteMaintenance, m._id)}>✕</Btn>
    ) : (
      ""
    ),
  ]);

  const actionFor = { vehicles: "+ Add Vehicle", trips: "+ Log Trip", maint: "+ Add Service" };
  const openFor = { vehicles: "vehicle", trips: "trip", maint: "maint" };

  return (
    <Page>
      <SectionHeader
        title="Fleet"
        sub="Vehicles, trips, fuel & maintenance"
        action={
          canManage ? (
            <Btn
              variant="gold"
              disabled={tab !== "vehicles" && activeVehicles.length === 0}
              onClick={() => setModal({ kind: openFor[tab] })}
            >
              {actionFor[tab]}
            </Btn>
          ) : null
        }
      />

      {(stats.insuranceExpiring > 0 || stats.serviceDue > 0) && (
        <Alert type="warning">
          {[
            stats.insuranceExpiring > 0 &&
              `${stats.insuranceExpiring} vehicle${stats.insuranceExpiring === 1 ? " has" : "s have"} insurance expiring within 30 days`,
            stats.serviceDue > 0 &&
              `${stats.serviceDue} vehicle${stats.serviceDue === 1 ? " is" : "s are"} due for service`,
          ]
            .filter(Boolean)
            .join(", and ")}
          .
        </Alert>
      )}
      {stats.draftsAwaitingFinance > 0 && (
        <Alert type="info">
          {stats.draftsAwaitingFinance} fleet cost{stats.draftsAwaitingFinance === 1 ? " is" : "s are"} waiting
          in Expenses as a draft for finance to post.
        </Alert>
      )}

      <StatGrid>
        <Stat label="Fleet Size" value={stats.fleetSize} icon="🚗" />
        <Stat label="Service Due" value={stats.serviceDue} variant="amber" icon="🔧" />
        <Stat label="Insurance Expiring" value={stats.insuranceExpiring} variant="red" icon="📄" />
        <Stat label="Fuel this month" value={KES(stats.fuelThisMonth)} icon="⛽" />
        <Stat label="Maintenance this month" value={KES(stats.maintenanceThisMonth)} icon="🧾" />
      </StatGrid>

      <div style={{ margin: "18px 0" }}>
        <Tabs
          tabs={[{ id: "vehicles", label: "Vehicles" }, { id: "trips", label: "Trip Log" }, { id: "maint", label: "Maintenance" }]}
          active={tab}
          setActive={setTab}
        />
      </div>

      {tab === "vehicles" && (
        <DataTable
          headers={["Reg No", "Make/Model", "Driver", "Insurance Expiry", "Next Service", "Odometer", "Cost/km", "Status", ""]}
          rows={vehicleRows}
          empty="No vehicles yet."
        />
      )}
      {tab === "trips" && (
        <DataTable
          headers={["Date", "Vehicle", "Purpose", "Route", "Driver", "Distance", "Fuel", "Expense", ""]}
          rows={tripRows}
          empty="No trips logged."
        />
      )}
      {tab === "maint" && (
        <DataTable
          headers={["Date", "Vehicle", "Service", "Garage", "Cost", "Status", "Expense", ""]}
          rows={maintRows}
          empty="No maintenance recorded."
        />
      )}

      {modal?.kind === "vehicle" && (
        <VehicleModal vehicle={modal.record} users={users} assets={assets} onClose={close} onDone={done} />
      )}
      {modal?.kind === "trip" && (
        <TripModal vehicles={activeVehicles} users={users} expenseAccounts={expenseAccounts} onClose={close} onDone={done} />
      )}
      {modal?.kind === "maint" && (
        <MaintModal vehicles={vehicleOptions} expenseAccounts={expenseAccounts} onClose={close} onDone={done} />
      )}
      {modal?.kind === "complete" && (
        <CompleteModal record={modal.record} vehicle={byId[modal.record.vehicleId]} onClose={close} onDone={done} />
      )}
    </Page>
  );
}

function submitWith(action, fields, onDone, setBusy) {
  return async () => {
    setBusy(true);
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.set(k, v == null ? "" : String(v)));
    const res = await action(fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  };
}

function Footer({ onClose, busy, label, onSubmit }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn variant="gold" disabled={busy} onClick={onSubmit}>{busy ? "Saving…" : label}</Btn>
    </div>
  );
}

/** Raise a draft expense for this cost? On by default when there is a cost. */
function ExpenseToggle({ amount, on, setOn, accountId, setAccountId, accounts }) {
  if (!(Number(amount) > 0)) return null;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 14 }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Send this cost to Expenses as a draft for finance to post
      </label>
      {on && (
        <div style={{ marginTop: 10 }}>
          <Select
            label="Expense account"
            value={accountId}
            onChange={setAccountId}
            options={[
              { value: "", label: "Choose an account…" },
              ...accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
            ]}
          />
        </div>
      )}
    </div>
  );
}

function VehicleModal({ vehicle, users, assets, onClose, onDone }) {
  const editing = Boolean(vehicle);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    regNo: vehicle?.regNo ?? "",
    make: vehicle?.make ?? "",
    model: vehicle?.model ?? "",
    vehicleClass: vehicle?.vehicleClass ?? "",
    driverUserId: vehicle?.driverUserId ?? "",
    insuranceExpiry: vehicle?.insuranceExpiry ?? "",
    nextServiceDate: vehicle?.nextServiceDate ?? "",
    nextServiceKm: vehicle?.nextServiceKm ?? "",
    mileageKm: vehicle?.mileageKm ?? "",
    status: vehicle?.status ?? "active",
    assetId: vehicle?.assetId ?? "",
  });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const driverName = users.find((u) => u.id === f.driverUserId)?.name ?? "";
  const submit = submitWith(
    (fd) => (editing ? updateVehicle(vehicle._id, fd) : createVehicle(null, fd)),
    { ...f, driverName },
    onDone,
    setBusy,
  );

  return (
    <Modal title={editing ? `Edit ${vehicle.regNo}` : "Add vehicle"} width={620} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Input label="Reg No" value={f.regNo} onChange={set("regNo")} required placeholder="KDA 123A" />
        <Select label="Class" value={f.vehicleClass} onChange={set("vehicleClass")} options={["", "Saloon", "Truck", "Pickup", "Van", "Bus", "Motorcycle"].map((v) => ({ value: v, label: v || "—" }))} />
        <Input label="Make" value={f.make} onChange={set("make")} placeholder="Toyota" />
        <Input label="Model" value={f.model} onChange={set("model")} placeholder="Hilux" />
        <Select label="Driver" value={f.driverUserId} onChange={set("driverUserId")} options={[{ value: "", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        <Input label="Odometer (km)" type="number" min="0" value={f.mileageKm} onChange={set("mileageKm")} note={editing ? "It can only go up." : undefined} />
        <Input label="Insurance expiry" type="date" value={f.insuranceExpiry} onChange={set("insuranceExpiry")} />
        <Select label="Status" value={f.status} onChange={set("status")} options={Object.entries(VEH_STATUS).map(([v, o]) => ({ value: v, label: o.label }))} />
        <Input label="Next service date" type="date" value={f.nextServiceDate} onChange={set("nextServiceDate")} />
        <Input label="Next service at (km)" type="number" min="0" value={f.nextServiceKm} onChange={set("nextServiceKm")} note="Due at whichever comes first." />
      </div>
      <Select
        label="Fixed asset"
        value={f.assetId}
        onChange={set("assetId")}
        options={[
          { value: "", label: "Not linked" },
          ...assets.map((a) => ({ value: a.id, label: `${a.assetNumber} — ${a.name}` })),
        ]}
      />
      <Footer onClose={onClose} busy={busy} label={editing ? "Save" : "Add vehicle"} onSubmit={submit} />
    </Modal>
  );
}

function TripModal({ vehicles, users, expenseAccounts, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const first = vehicles[0];
  const [f, setF] = useState({
    vehicleId: first?._id || "",
    tripDate: today(),
    purpose: "",
    fromLocation: "",
    toLocation: "",
    odometerStart: first?.mileageKm ?? "",
    odometerEnd: "",
    distanceKm: "",
    fuelLitres: "",
    fuelCost: "",
    fuelStation: "",
    driverUserId: first?.driverUserId ?? "",
  });
  const [sendExpense, setSendExpense] = useState(true);
  const [accountId, setAccountId] = useState(expenseAccounts.defaultFuelAccountId ?? "");
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const chooseVehicle = (id) => {
    const v = vehicles.find((x) => x._id === id);
    setF((s) => ({ ...s, vehicleId: id, odometerStart: v?.mileageKm ?? "", driverUserId: v?.driverUserId ?? s.driverUserId }));
  };
  const computed =
    f.odometerStart !== "" && f.odometerEnd !== "" ? Number(f.odometerEnd) - Number(f.odometerStart) : null;
  const driverName = users.find((u) => u.id === f.driverUserId)?.name ?? "";

  const submit = () => {
    if (sendExpense && Number(f.fuelCost) > 0 && !accountId) return toast.error("Choose the expense account for the fuel");
    return submitWith(
      (fd) => logTrip(null, fd),
      { ...f, driverName, expenseAccountId: sendExpense ? accountId : "" },
      onDone,
      setBusy,
    )();
  };

  return (
    <Modal title="Log trip" width={620} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Select label="Vehicle" value={f.vehicleId} onChange={chooseVehicle} options={vehicles.map((v) => ({ value: v._id, label: `${v.regNo} — ${v.make} ${v.model}`.trim() }))} required />
        <Input label="Date" type="date" value={f.tripDate} onChange={set("tripDate")} required />
        <Select label="Driver" value={f.driverUserId} onChange={set("driverUserId")} options={[{ value: "", label: "—" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        <Input label="Purpose" value={f.purpose} onChange={set("purpose")} placeholder="Client site visit" />
        <Input label="From" value={f.fromLocation} onChange={set("fromLocation")} />
        <Input label="To" value={f.toLocation} onChange={set("toLocation")} />
        <Input label="Odometer start (km)" type="number" min="0" value={f.odometerStart} onChange={set("odometerStart")} />
        <Input label="Odometer end (km)" type="number" min="0" value={f.odometerEnd} onChange={set("odometerEnd")} />
      </div>
      {computed != null ? (
        <p style={{ fontSize: 12, color: computed < 0 ? "#C0392B" : "var(--muted-foreground)", margin: "0 0 14px" }}>
          {computed < 0 ? "The closing reading is below the opening one." : `Distance: ${computed.toLocaleString()} km`}
        </p>
      ) : (
        <Input label="Distance (km)" type="number" min="0" value={f.distanceKm} onChange={set("distanceKm")} note="Or enter both odometer readings." />
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        <Input label="Fuel (litres)" type="number" min="0" step="0.01" value={f.fuelLitres} onChange={set("fuelLitres")} />
        <Input label="Fuel cost (Kshs)" type="number" min="0" step="0.01" value={f.fuelCost} onChange={set("fuelCost")} />
        <Input label="Fuel station" value={f.fuelStation} onChange={set("fuelStation")} />
      </div>
      <ExpenseToggle
        amount={f.fuelCost}
        on={sendExpense}
        setOn={setSendExpense}
        accountId={accountId}
        setAccountId={setAccountId}
        accounts={expenseAccounts.accounts}
      />
      <Footer onClose={onClose} busy={busy} label="Log trip" onSubmit={submit} />
    </Modal>
  );
}

function MaintModal({ vehicles, expenseAccounts, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    vehicleId: vehicles[0]?.value || "",
    serviceDate: today(),
    service: "",
    garage: "",
    cost: "",
    status: "scheduled",
    odometerKm: "",
    nextServiceDate: "",
    nextServiceKm: "",
  });
  const [sendExpense, setSendExpense] = useState(true);
  const [accountId, setAccountId] = useState(expenseAccounts.defaultRepairsAccountId ?? "");
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const submit = () => {
    if (sendExpense && Number(f.cost) > 0 && !accountId) return toast.error("Choose the expense account for the cost");
    return submitWith(
      (fd) => logMaintenance(null, fd),
      { ...f, expenseAccountId: sendExpense ? accountId : "" },
      onDone,
      setBusy,
    )();
  };

  return (
    <Modal title="Record maintenance" width={600} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Select label="Vehicle" value={f.vehicleId} onChange={set("vehicleId")} options={vehicles} required />
        <Input label="Date" type="date" value={f.serviceDate} onChange={set("serviceDate")} required />
        <Input label="Service" value={f.service} onChange={set("service")} placeholder="Full service" />
        <Input label="Garage" value={f.garage} onChange={set("garage")} />
        <Input label="Cost (Kshs)" type="number" min="0" step="0.01" value={f.cost} onChange={set("cost")} />
        <Select label="Status" value={f.status} onChange={set("status")} options={Object.entries(MAINT_STATUS).map(([v, o]) => ({ value: v, label: o.label }))} />
      </div>
      {f.status === "done" && <CompletionFields f={f} set={set} />}
      <ExpenseToggle
        amount={f.cost}
        on={sendExpense}
        setOn={setSendExpense}
        accountId={accountId}
        setAccountId={setAccountId}
        accounts={expenseAccounts.accounts}
      />
      <Footer onClose={onClose} busy={busy} label="Record" onSubmit={submit} />
    </Modal>
  );
}

function CompletionFields({ f, set }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
      <Input label="Odometer at service (km)" type="number" min="0" value={f.odometerKm} onChange={set("odometerKm")} />
      <Input label="Next service date" type="date" value={f.nextServiceDate} onChange={set("nextServiceDate")} />
      <Input label="Next service at (km)" type="number" min="0" value={f.nextServiceKm} onChange={set("nextServiceKm")} />
    </div>
  );
}

function CompleteModal({ record, vehicle, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    odometerKm: vehicle?.mileageKm ?? "",
    nextServiceDate: "",
    nextServiceKm: "",
  });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const submit = submitWith((fd) => completeMaintenance(record._id, fd), f, onDone, setBusy);
  return (
    <Modal title={`Complete service — ${vehicle?.regNo ?? ""}`} width={560} onClose={onClose}>
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 0 }}>
        The vehicle&apos;s odometer and next service are updated from this, and a service-due flag clears.
      </p>
      <CompletionFields f={f} set={set} />
      <Footer onClose={onClose} busy={busy} label="Complete" onSubmit={submit} />
    </Modal>
  );
}
