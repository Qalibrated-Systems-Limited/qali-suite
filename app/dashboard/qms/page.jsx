"use client";
import { useState } from "react";
import { Page, SectionHeader, StatGrid, Stat, Tabs, DataTable, Badge, Btn } from "@/components/erp-ui";

// Dummy-data adaptation of ERP's QMS (Quality Management System, ISO 9001/17025) module.
const NCS = [
  ["NC-2025-034", "Internal Audit", "Process", "Calibration record incomplete", "7.5", "CAPA-018", <Badge variant="amber">Open</Badge>, "10 Aug 2025"],
  ["NC-2025-033", "Customer Complaint", "Product", "Late certificate delivery", "8.2", "CAPA-017", <Badge variant="blue">CAPA in progress</Badge>, "05 Aug 2025"],
  ["NC-2025-032", "Supplier", "External", "Out-of-tolerance reference weight", "6.1", "CAPA-016", <Badge variant="green">Closed</Badge>, "28 Jul 2025"],
];
const AUDITS = [
  ["AUD-2025-06", "Internal Audit — Technical", "ISO 17025", "J. Otieno", "Technical", "20 Sep 2025", "—", <Badge variant="blue">Planned</Badge>],
  ["AUD-2025-05", "Internal Audit — Stores", "ISO 9001", "A. Mwangi", "Stores", "12 Aug 2025", "2 minor", <Badge variant="green">Closed</Badge>],
];
const REVIEWS = [
  ["MR-2025-02", "12 Sep 2025", "Managing Director", "All HODs", <Badge variant="blue">Scheduled</Badge>, "—"],
  ["MR-2025-01", "10 Mar 2025", "Managing Director", "All HODs", <Badge variant="green">Held</Badge>, "8 actions"],
];

export default function QMSPage() {
  const [tab, setTab] = useState("ncs");
  return (
    <Page>
      <SectionHeader title="Quality (QMS)" sub="Non-conformances, CAPA, audits & management review" action={<Btn variant="gold">+ Raise NC</Btn>} />
      <StatGrid>
        <Stat label="Open NCs" value="6" variant="amber" icon="🎯" />
        <Stat label="Overdue CAPA Actions" value="2" variant="red" icon="⏰" />
        <Stat label="Awaiting Effectiveness Check" value="3" variant="blue" icon="🔬" />
        <Stat label="Audits Planned" value="4" variant="green" icon="📋" />
      </StatGrid>
      <Tabs tabs={[{ id: "ncs", label: "Non-Conformances" }, { id: "audits", label: "Audits" }, { id: "reviews", label: "Management Review" }]} active={tab} setActive={setTab} />
      {tab === "ncs" && <DataTable headers={["NC No", "Source", "Category", "Description", "Clause", "CAPA", "Status", "Raised"]} rows={NCS} />}
      {tab === "audits" && <DataTable headers={["Audit No", "Title", "Standard", "Auditor", "Dept", "Planned", "Findings", "Status"]} rows={AUDITS} />}
      {tab === "reviews" && <DataTable headers={["Review No", "Date", "Chaired By", "Attendees", "Status", "Decisions"]} rows={REVIEWS} />}
    </Page>
  );
}
