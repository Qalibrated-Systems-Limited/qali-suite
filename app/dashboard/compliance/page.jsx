"use client";
import { useState } from "react";
import { Page, SectionHeader, StatGrid, Stat, Tabs, DataTable, Badge, Btn, Alert } from "@/components/erp-ui";

// Dummy-data adaptation of ERP's Compliance module.
const CERTS = [
  ["KENAS Accreditation CL/059", "Tech. Manager", "31 Dec 2025", "140 days", <Badge variant="green">Current</Badge>, ""],
  ["Business Permit — NCC", "Admin", "31 Jan 2026", "171 days", <Badge variant="green">Current</Badge>, ""],
  ["Fire Safety Certificate", "HSE Officer", "15 Sep 2025", "33 days", <Badge variant="amber">Expiring</Badge>, ""],
  ["NEMA Licence", "HSE Officer", "05 Aug 2025", "-8 days", <Badge variant="red">Expired</Badge>, ""],
];
const OBLIGATIONS = [
  ["VAT Return", "KRA", "20 Sep 2025", "Monthly", "1.5% / month"],
  ["PAYE", "KRA", "09 Sep 2025", "Monthly", "25% penalty"],
  ["NSSF", "NSSF", "15 Sep 2025", "Monthly", "5% penalty"],
  ["Annual Returns", "eCitizen (BRS)", "30 Nov 2025", "Annual", "Kshs 20,000"],
];
const TASKS = [
  ["Renew NEMA licence", "HSE Officer", "18 Aug 2025", <Badge variant="red">Overdue</Badge>],
  ["Schedule fire cert inspection", "Admin", "25 Aug 2025", <Badge variant="amber">Due soon</Badge>],
  ["File Q3 KENAS surveillance docs", "Tech. Manager", "10 Oct 2025", <Badge variant="blue">Open</Badge>],
];

export default function CompliancePage() {
  const [tab, setTab] = useState("certs");
  return (
    <Page>
      <SectionHeader title="Compliance" sub="Certificates, statutory obligations & tasks" action={<Btn variant="gold">+ Add Certificate</Btn>} />
      <Alert type="error">NEMA Licence has expired — renewal task is overdue.</Alert>
      <StatGrid>
        <Stat label="Certificates" value="12" icon="✅" />
        <Stat label="Current" value="9" variant="green" icon="🟢" />
        <Stat label="Expiring ≤60 Days" value="2" variant="amber" icon="⏳" />
        <Stat label="Open Tasks" value="3" variant="red" icon="📝" />
      </StatGrid>
      <Tabs tabs={[{ id: "certs", label: "Certificates" }, { id: "obligations", label: "Statutory Obligations" }, { id: "tasks", label: "Tasks" }]} active={tab} setActive={setTab} />
      {tab === "certs" && <DataTable headers={["Certificate", "Responsible", "Expiry", "Days Left", "Status", "Action"]} rows={CERTS} />}
      {tab === "obligations" && <DataTable headers={["Obligation", "Agency", "Next Due", "Frequency", "Penalty"]} rows={OBLIGATIONS} />}
      {tab === "tasks" && <DataTable headers={["Task Title", "Assigned To", "Due Date", "Status"]} rows={TASKS} />}
    </Page>
  );
}
