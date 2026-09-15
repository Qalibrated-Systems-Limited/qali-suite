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
  Alert,
  Input,
  Select,
  Modal,
  fmt,
} from "@/components/erp-ui";
import {
  createVehicle,
  deleteVehicle,
  logTrip,
  deleteTrip,
  logMaintenance,
  setMaintenanceStatus,
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
const KES = (n) => `Kshs ${Number(n || 0).toLocaleString("en-KE")}`;

function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function pill(map, k) {
  const c = map[k] || { label: k, variant: "default" };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export default function FleetBoard({ vehicles, trips, maintenance, stats, users, canManage }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState("vehicles");
  const [modal, setModal] = useState(null); // "vehicle" | "trip" | "maint" | null

  const vehicleOptions = useMemo(
    () => vehicles.map((v) => ({ value: v._id, label: `${v.regNo} — ${v.make} ${v.model}`.trim() })),
    [vehicles],
  );

  function refresh() {
    startTransition(() => router.refresh());
  }
  async function run(fn, ...args) {
    const res = await fn(...args);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    refresh();
  }

  const vehicleRows = vehicles.map((v) => {
    const dLeft = daysUntil(v.insuranceExpiry);
    return [
      <span key="r" style={{ fontWeight: 600 }}>{v.regNo}</span>,
      `${v.make} ${v.model}`.trim() || "—",
      v.vehicleClass || "—",
      v.driverName || <span style={{ color: "var(--muted-foreground)" }}>—</span>,
      <span key="i" style={{ color: dLeft != null && dLeft <= 30 ? "#B8600B" : "var(--foreground)" }}>
        {fmt.date(v.insuranceExpiry)}
      </span>,
      fmt.date(v.nextServiceDate),
      `${Number(v.mileageKm || 0).toLocaleString()} km`,
      pill(VEH_STATUS, v.status),
      canManage ? <Btn key="x" size="sm" variant="danger" onClick={() => confirm(`Remove ${v.regNo}?`) && run(deleteVehicle, v._id)}>✕</Btn> : "",
    ];
  });

  const tripRows = trips.map((t) => {
    const veh = vehicles.find((v) => v._id === t.vehicleId);
    return [
      fmt.date(t.tripDate),
      veh?.regNo || "—",
      t.purpose || "—",
      t.fromLocation || "—",
      t.toLocation || "—",
      `${Number(t.distanceKm || 0).toLocaleString()} km`,
      KES(t.fuelCost),
      canManage ? <Btn key="x" size="sm" variant="danger" onClick={() => run(deleteTrip, t._id)}>✕</Btn> : "",
    ];
  });

  const maintRows = maintenance.map((m) => {
    const veh = vehicles.find((v) => v._id === m.vehicleId);
    return [
      fmt.date(m.serviceDate),
      veh?.regNo || "—",
      m.service || "—",
      m.garage || "—",
      KES(m.cost),
      canManage ? (
        <select
          key="s"
          value={m.status}
          onChange={(e) => run(setMaintenanceStatus, m._id, e.target.value)}
          style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 12 }}
        >
          {Object.entries(MAINT_STATUS).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
        </select>
      ) : pill(MAINT_STATUS, m.status),
      canManage ? <Btn key="x" size="sm" variant="danger" onClick={() => run(deleteMaintenance, m._id)}>✕</Btn> : "",
    ];
  });

  const actionFor = { vehicles: "+ Add Vehicle", trips: "+ Log Trip", maint: "+ Add Service" };
  const openFor = { vehicles: "vehicle", trips: "trip", maint: "maint" };

  return (
    <Page>
      <SectionHeader
        title="Fleet"
        sub="Vehicles, trips, fuel & maintenance"
        action={canManage ? <Btn variant="gold" onClick={() => setModal(openFor[tab])}>{actionFor[tab]}</Btn> : null}
      />

      {(stats.insuranceExpiring > 0 || stats.serviceDue > 0) && (
        <Alert type="warning">
          {stats.insuranceExpiring} vehicle{stats.insuranceExpiring === 1 ? "" : "s"} have insurance
          expiring within 30 days and {stats.serviceDue} {stats.serviceDue === 1 ? "is" : "are"} due for service.
        </Alert>
      )}

      <StatGrid>
        <Stat label="Fleet Size" value={stats.fleetSize} icon="🚗" />
        <Stat label="Active" value={stats.active} variant="green" icon="✅" />
        <Stat label="Service Due" value={stats.serviceDue} variant="amber" icon="🔧" />
        <Stat label="Insurance Expiring" value={stats.insuranceExpiring} variant="red" icon="📄" />
      </StatGrid>

      <div style={{ margin: "18px 0" }}>
        <Tabs
          tabs={[{ id: "vehicles", label: "Vehicles" }, { id: "trips", label: "Trip Log" }, { id: "maint", label: "Maintenance" }]}
          active={tab}
          setActive={setTab}
        />
      </div>

      {tab === "vehicles" && (
        <DataTable headers={["Reg No", "Make/Model", "Class", "Driver", "Insurance Expiry", "Next Service", "Mileage", "Status", ""]} rows={vehicleRows} empty="No vehicles yet." />
      )}
      {tab === "trips" && (
        <DataTable headers={["Date", "Vehicle", "Purpose", "From", "To", "Distance", "Fuel Cost", ""]} rows={tripRows} empty="No trips logged." />
      )}
      {tab === "maint" && (
        <DataTable headers={["Date", "Vehicle", "Service", "Garage", "Cost", "Status", ""]} rows={maintRows} empty="No maintenance recorded." />
      )}

      {modal === "vehicle" && <VehicleModal users={users} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === "trip" && <TripModal vehicles={vehicleOptions} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === "maint" && <MaintModal vehicles={vehicleOptions} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </Page>
  );
}

function VehicleModal({ users, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ regNo: "", make: "", model: "", vehicleClass: "", driverUserId: "", insuranceExpiry: "", nextServiceDate: "", mileageKm: "", status: "active" });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    if (!f.regNo.trim()) return toast.error("A registration is required");
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    const who = users.find((u) => u.id === f.driverUserId);
    if (who) fd.set("driverName", who.name);
    const res = await createVehicle(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title="Add vehicle" width={600} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Input label="Reg No" value={f.regNo} onChange={set("regNo")} required placeholder="KDA 123A" />
        <Select label="Class" value={f.vehicleClass} onChange={set("vehicleClass")} options={["", "Saloon", "Truck", "Pickup", "Van", "Bus", "Motorcycle"].map((v) => ({ value: v, label: v || "—" }))} />
        <Input label="Make" value={f.make} onChange={set("make")} placeholder="Toyota" />
        <Input label="Model" value={f.model} onChange={set("model")} placeholder="Hilux" />
        <Select label="Driver" value={f.driverUserId} onChange={set("driverUserId")} options={[{ value: "", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        <Input label="Mileage (km)" type="number" value={f.mileageKm} onChange={set("mileageKm")} />
        <Input label="Insurance expiry" type="date" value={f.insuranceExpiry} onChange={set("insuranceExpiry")} />
        <Input label="Next service" type="date" value={f.nextServiceDate} onChange={set("nextServiceDate")} />
      </div>
      <Select label="Status" value={f.status} onChange={set("status")} options={Object.entries(VEH_STATUS).map(([v, o]) => ({ value: v, label: o.label }))} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Add vehicle"}</Btn>
      </div>
    </Modal>
  );
}

function TripModal({ vehicles, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ vehicleId: vehicles[0]?.value || "", tripDate: new Date().toISOString().slice(0, 10), purpose: "", fromLocation: "", toLocation: "", distanceKm: "", fuelCost: "" });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    if (!f.vehicleId) return toast.error("Choose a vehicle");
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    const res = await logTrip(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title="Log trip" width={560} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Select label="Vehicle" value={f.vehicleId} onChange={set("vehicleId")} options={vehicles} required />
        <Input label="Date" type="date" value={f.tripDate} onChange={set("tripDate")} required />
      </div>
      <Input label="Purpose" value={f.purpose} onChange={set("purpose")} placeholder="Client site visit" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Input label="From" value={f.fromLocation} onChange={set("fromLocation")} />
        <Input label="To" value={f.toLocation} onChange={set("toLocation")} />
        <Input label="Distance (km)" type="number" value={f.distanceKm} onChange={set("distanceKm")} />
        <Input label="Fuel cost (Kshs)" type="number" value={f.fuelCost} onChange={set("fuelCost")} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Log trip"}</Btn>
      </div>
    </Modal>
  );
}

function MaintModal({ vehicles, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ vehicleId: vehicles[0]?.value || "", serviceDate: new Date().toISOString().slice(0, 10), service: "", garage: "", cost: "", status: "scheduled" });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    if (!f.vehicleId) return toast.error("Choose a vehicle");
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    const res = await logMaintenance(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title="Record maintenance" width={560} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Select label="Vehicle" value={f.vehicleId} onChange={set("vehicleId")} options={vehicles} required />
        <Input label="Date" type="date" value={f.serviceDate} onChange={set("serviceDate")} required />
      </div>
      <Input label="Service" value={f.service} onChange={set("service")} placeholder="Full service" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Input label="Garage" value={f.garage} onChange={set("garage")} />
        <Input label="Cost (Kshs)" type="number" value={f.cost} onChange={set("cost")} />
      </div>
      <Select label="Status" value={f.status} onChange={set("status")} options={Object.entries(MAINT_STATUS).map(([v, o]) => ({ value: v, label: o.label }))} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Record"}</Btn>
      </div>
    </Modal>
  );
}
