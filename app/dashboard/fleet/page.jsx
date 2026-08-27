"use client";
import { useState } from "react";
import { Page, SectionHeader, StatGrid, Stat, Tabs, DataTable, Badge, Btn, Alert } from "@/components/erp-ui";

// Dummy-data adaptation of ERP's Fleet module. No API wiring — placeholder
// data only, pending backend integration.
const VEHICLES = [
  ["KDA 123A", "Toyota", "Saloon", "J. Otieno", "12 Mar 2026", "8 Sep 2025", "84,210 km", <Badge variant="green">Active</Badge>],
  ["KDG 884B", "Isuzu", "Truck", "P. Wanjiru", "02 Jan 2026", "20 Aug 2025", "142,530 km", <Badge variant="amber">Service Due</Badge>],
  ["KCX 471J", "Nissan", "Pickup", "S. Kamau", "28 Oct 2025", "15 Oct 2025", "61,940 km", <Badge variant="green">Active</Badge>],
  ["KDL 002M", "Toyota", "Van", "—", "05 Sep 2025", "01 Sep 2025", "39,120 km", <Badge variant="red">Grounded</Badge>],
  ["KBZ 990Q", "Mitsubishi", "Saloon", "A. Mwangi", "30 Nov 2025", "10 Dec 2025", "22,880 km", <Badge variant="green">Active</Badge>],
];
const TRIPS = [
  ["12 Aug 2025", "KDA 123A", "Client site visit", "Nairobi", "Thika", "45 km", "Kshs 1,200"],
  ["11 Aug 2025", "KDG 884B", "Delivery", "Nairobi", "Nakuru", "160 km", "Kshs 4,300"],
  ["10 Aug 2025", "KCX 471J", "Field calibration", "Nairobi", "Machakos", "63 km", "Kshs 1,650"],
  ["09 Aug 2025", "KBZ 990Q", "Admin errand", "Nairobi", "Nairobi", "12 km", "Kshs 350"],
];
const MAINT = [
  ["06 Aug 2025", "KDG 884B", "Full service", "AutoCare Ltd", "Kshs 28,500", <Badge variant="green">Done</Badge>],
  ["02 Aug 2025", "KDL 002M", "Gearbox repair", "Toyota KE", "Kshs 96,000", <Badge variant="amber">In progress</Badge>],
  ["21 Jul 2025", "KDA 123A", "Tyres x4", "Kingsway", "Kshs 44,000", <Badge variant="green">Done</Badge>],
];

export default function FleetPage() {
  const [tab, setTab] = useState("vehicles");
  return (
    <Page>
      <SectionHeader title="Fleet" sub="Vehicles, trips, fuel & maintenance" action={<Btn variant="gold">+ Add Vehicle</Btn>} />
      <Alert type="warning">2 vehicles have insurance expiring within 30 days and 3 are due for service.</Alert>
      <StatGrid>
        <Stat label="Fleet Size" value="14" icon="🚗" />
        <Stat label="Active" value="11" variant="green" icon="✅" />
        <Stat label="Service Due" value="3" variant="amber" icon="🔧" />
        <Stat label="Insurance Expiring" value="2" variant="red" icon="📄" />
      </StatGrid>
      <Tabs tabs={[{ id: "vehicles", label: "Vehicles" }, { id: "trips", label: "Trip Log" }, { id: "maint", label: "Maintenance" }]} active={tab} setActive={setTab} />
      {tab === "vehicles" && <DataTable headers={["Reg No", "Make", "Class", "Driver", "Insurance Expiry", "Next Service", "Mileage", "Status"]} rows={VEHICLES} />}
      {tab === "trips" && <DataTable headers={["Date", "Vehicle", "Purpose", "From", "To", "Distance", "Fuel Cost"]} rows={TRIPS} />}
      {tab === "maint" && <DataTable headers={["Date", "Vehicle", "Service", "Garage", "Cost", "Status"]} rows={MAINT} />}
    </Page>
  );
}
