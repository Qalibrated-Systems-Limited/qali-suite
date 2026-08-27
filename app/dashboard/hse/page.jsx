"use client";
import { useState } from "react";
import { Page, SectionHeader, StatGrid, Stat, Tabs, DataTable, Badge, Btn, Alert } from "@/components/erp-ui";

// Dummy-data adaptation of ERP's HSE (Health, Safety & Environment) module.
const INCIDENTS = [
  ["HSE-2025-021", "Near-miss", "Main Store", "Forklift near pedestrian", "12 Aug 2025", <Badge variant="amber">Investigating</Badge>],
  ["HSE-2025-020", "Injury", "Workshop", "Minor hand laceration", "08 Aug 2025", <Badge variant="green">Closed</Badge>],
  ["HSE-2025-019", "Environmental", "Yard", "Oil spill contained", "02 Aug 2025", <Badge variant="green">Closed</Badge>],
  ["HSE-2025-018", "Property", "Fleet", "Reversing damage to gate", "28 Jul 2025", <Badge variant="green">Closed</Badge>],
];
const INSPECTIONS = [
  ["Fire extinguishers", "Whole site", "A. Mwangi", "05 Aug 2025", <Badge variant="green">Compliant</Badge>],
  ["PPE compliance", "Workshop", "S. Kamau", "01 Aug 2025", <Badge variant="amber">2 findings</Badge>],
  ["First-aid kits", "All floors", "HR Team", "22 Jul 2025", <Badge variant="green">Compliant</Badge>],
];
const TRAINING = [
  ["Fire marshal refresher", "12 staff", "15 Sep 2025", <Badge variant="blue">Scheduled</Badge>],
  ["First aid certification", "6 staff", "20 Jul 2025", <Badge variant="green">Completed</Badge>],
  ["Manual handling", "All warehouse", "30 Aug 2025", <Badge variant="amber">Due</Badge>],
];

export default function HSEPage() {
  const [tab, setTab] = useState("incidents");
  return (
    <Page>
      <SectionHeader title="HSE" sub="Health, safety & environment" action={<Btn variant="gold">+ Report Incident</Btn>} />
      <Alert type="success">142 days since last lost-time injury.</Alert>
      <StatGrid>
        <Stat label="Open Incidents" value="1" variant="amber" icon="🦺" />
        <Stat label="LTI (YTD)" value="1" variant="red" icon="🩹" />
        <Stat label="Inspections (Mo)" value="3" variant="blue" icon="📋" />
        <Stat label="Training Due" value="2" variant="amber" icon="🎓" />
      </StatGrid>
      <Tabs tabs={[{ id: "incidents", label: "Incidents" }, { id: "inspections", label: "Safety Inspections" }, { id: "training", label: "Training" }]} active={tab} setActive={setTab} />
      {tab === "incidents" && <DataTable headers={["Ref", "Type", "Location", "Description", "Reported", "Status"]} rows={INCIDENTS} />}
      {tab === "inspections" && <DataTable headers={["Inspection", "Area", "Officer", "Date", "Result"]} rows={INSPECTIONS} />}
      {tab === "training" && <DataTable headers={["Programme", "Attendees", "Date", "Status"]} rows={TRAINING} />}
    </Page>
  );
}
