"use client";
import { useState } from "react";
import { Page, SectionHeader, StatGrid, Stat, Tabs, DataTable, Badge, Btn } from "@/components/erp-ui";

// Dummy-data adaptation of ERP's SOP Library module.
const SOPS = [
  ["SOP-001", "Goods Receiving & Inspection", "Stores", "Operations", "v3", "12 Jan 2025", "12 Jan 2026", <Badge variant="green">Approved</Badge>],
  ["SOP-007", "Mass Calibration Procedure", "Technical", "Calibration", "v5", "02 Feb 2025", "02 Feb 2026", <Badge variant="green">Approved</Badge>],
  ["SOP-014", "Non-Conformance Handling", "Quality", "QMS", "v2", "20 Mar 2025", "20 Sep 2025", <Badge variant="amber">Review due</Badge>],
  ["SOP-021", "Payroll Processing", "HR", "Finance", "v1", "10 Jun 2025", "10 Jun 2026", <Badge variant="green">Approved</Badge>],
  ["SOP-025", "Incident Reporting", "HSE", "Safety", "v2", "01 Apr 2025", "01 Apr 2026", <Badge variant="blue">Draft</Badge>],
];
const PENDING = [
  ["SOP-014", "Non-Conformance Handling", "Quality", "Awaiting Tech. Manager sign-off", <Badge variant="amber">In review</Badge>],
  ["SOP-025", "Incident Reporting", "HSE", "Drafting v2 changes", <Badge variant="blue">Draft</Badge>],
];

export default function SOPsPage() {
  const [tab, setTab] = useState("library");
  return (
    <Page>
      <SectionHeader title="SOP Library" sub="Controlled documents & review schedule" action={<Btn variant="gold">+ New SOP</Btn>} />
      <StatGrid>
        <Stat label="Total SOPs" value="46" icon="📚" />
        <Stat label="Approved" value="41" variant="green" icon="✅" />
        <Stat label="Review Due" value="3" variant="amber" icon="🔁" />
        <Stat label="Drafts" value="2" variant="blue" icon="✍️" />
      </StatGrid>
      <Tabs tabs={[{ id: "library", label: "Library" }, { id: "pending", label: "Pending Review" }]} active={tab} setActive={setTab} />
      {tab === "library" && <DataTable headers={["Code", "Title", "Department", "Category", "Version", "Last Reviewed", "Next Review", "Status"]} rows={SOPS} searchable />}
      {tab === "pending" && <DataTable headers={["Code", "Title", "Department", "Note", "Status"]} rows={PENDING} />}
    </Page>
  );
}
