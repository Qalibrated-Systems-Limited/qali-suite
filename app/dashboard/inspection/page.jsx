"use client";
import { useState } from "react";
import { Page, SectionHeader, StatGrid, Stat, Tabs, DataTable, Badge, Btn } from "@/components/erp-ui";

// Dummy-data adaptation of ERP's Inspection (ISO 17020) module.
const INSPECTIONS = [
  ["INS-2025-118", "Lifting Gear", "SN-44821", "Tarmac Ltd", "J. Otieno", <Badge variant="green">Pass</Badge>],
  ["INS-2025-117", "Pressure Vessel", "SN-90112", "Devki Steel", "S. Kamau", <Badge variant="red">Fail</Badge>],
  ["INS-2025-116", "Crane", "SN-33019", "Tarmac Ltd", "A. Mwangi", <Badge variant="amber">Quarantined</Badge>],
  ["INS-2025-115", "Fire Extinguisher", "SN-77340", "EABL", "J. Otieno", <Badge variant="green">Pass</Badge>],
];
const INSPECTORS = [
  ["J. Otieno", "Lifting & Cranes", "Tech. Manager", "01 Mar 2026", "01 Mar 2026", <Badge variant="green">Authorised</Badge>],
  ["S. Kamau", "Pressure Systems", "Tech. Manager", "15 Jan 2026", "15 Jan 2026", <Badge variant="green">Authorised</Badge>],
  ["A. Mwangi", "Electrical", "Tech. Manager", "20 Sep 2025", "20 Sep 2025", <Badge variant="amber">Renewal due</Badge>],
];
const APPEALS = [
  ["INS-2025-117", "Disputed weld defect ruling", "22 Aug 2025", <Badge variant="amber">Under review</Badge>],
  ["INS-2025-102", "Re-test requested", "10 Aug 2025", <Badge variant="green">Resolved</Badge>],
];

export default function InspectionPage() {
  const [tab, setTab] = useState("inspections");
  return (
    <Page>
      <SectionHeader title="Inspection (17020)" sub="ISO/IEC 17020 inspection bodies, rulings & appeals" action={<Btn variant="gold">+ New Inspection</Btn>} />
      <StatGrid>
        <Stat label="Open Inspections" value="9" icon="🔍" />
        <Stat label="Failed / Quarantined" value="2" variant="red" icon="🚫" />
        <Stat label="Open Appeals" value="1" variant="amber" icon="⚖️" />
        <Stat label="Auth. Expiring ≤30d" value="1" variant="amber" icon="⏳" />
      </StatGrid>
      <Tabs tabs={[{ id: "inspections", label: "Inspections" }, { id: "inspectors", label: "Inspectors" }, { id: "appeals", label: "Appeals" }]} active={tab} setActive={setTab} />
      {tab === "inspections" && <DataTable headers={["Inspection No.", "Type", "Equipment S/N", "Client", "Inspector", "Ruling"]} rows={INSPECTIONS} />}
      {tab === "inspectors" && <DataTable headers={["Inspector", "Scope", "Authorised By", "Renewal", "COI Expires", "Status"]} rows={INSPECTORS} />}
      {tab === "appeals" && <DataTable headers={["Inspection", "Grounds", "Due Date", "Status"]} rows={APPEALS} />}
    </Page>
  );
}
