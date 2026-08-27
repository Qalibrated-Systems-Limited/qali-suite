"use client";
import { useState } from "react";
import { Page, SectionHeader, StatGrid, Stat, Tabs, DataTable, Badge, Btn, Alert } from "@/components/erp-ui";

// Dummy-data adaptation of ERP's Calibration (Technical Department, ISO 17025) module.
const CERTS = [
  ["CERT-2025-0412", "Kenafric Ind.", "Mass (M1)", "Nairobi Lab", "10 Aug 2025", <Badge variant="green">Passed</Badge>],
  ["CERT-2025-0411", "Bidco Africa", "Temperature", "Client Site", "09 Aug 2025", <Badge variant="green">Passed</Badge>],
  ["CERT-2025-0410", "Devki Steel", "Pressure", "Nairobi Lab", "08 Aug 2025", <Badge variant="red">Failed</Badge>],
  ["CERT-2025-0409", "EABL", "Volume", "Client Site", "07 Aug 2025", <Badge variant="green">Passed</Badge>],
];
const STANDARDS = [
  ["Reference Mass Set E2", "KEBS → BIPM", "02 Feb 2025", "02 Feb 2026", "± 0.05 mg", <Badge variant="green">Valid</Badge>],
  ["Platinum RTD", "KEBS", "18 Jun 2025", "18 Jun 2026", "± 0.03 °C", <Badge variant="green">Valid</Badge>],
  ["Pressure Dead-weight", "NPL UK", "12 Sep 2024", "12 Sep 2025", "± 0.008 %", <Badge variant="amber">Expiring</Badge>],
];
const JOBS = [
  ["JOB-3391", "Kenafric Ind.", "Industrial Area", "15 Aug 2025", "S. Kamau", <Badge variant="amber">Scheduled</Badge>, <Badge variant="default">Pending</Badge>],
  ["JOB-3390", "Bidco Africa", "Thika", "14 Aug 2025", "J. Otieno", <Badge variant="blue">In progress</Badge>, <Badge variant="default">Pending</Badge>],
  ["JOB-3389", "Devki Steel", "Ruiru", "12 Aug 2025", "S. Kamau", <Badge variant="green">Completed</Badge>, <Badge variant="green">Invoiced</Badge>],
];

export default function CalibrationPage() {
  const [tab, setTab] = useState("certs");
  return (
    <Page>
      <SectionHeader title="Technical Department" sub="ISO/IEC 17025 calibration — certificates, standards & jobs" action={<Btn variant="gold">+ New Cal Job</Btn>} />
      <Alert type="warning">1 reference standard (Pressure Dead-weight) is due for re-calibration within 60 days.</Alert>
      <StatGrid>
        <Stat label="Certs Issued" value="412" icon="📜" />
        <Stat label="Passed" value="389" variant="green" icon="✅" />
        <Stat label="Reference Standards" value="18" variant="blue" icon="⚖️" />
        <Stat label="Expiring ≤60 days" value="1" variant="amber" icon="⏳" />
      </StatGrid>
      <Tabs tabs={[{ id: "certs", label: "Certificates" }, { id: "standards", label: "Reference Standards" }, { id: "jobs", label: "Cal Jobs" }]} active={tab} setActive={setTab} />
      {tab === "certs" && <DataTable headers={["Cert No", "Customer", "Service Type", "Location", "Issued", "Result"]} rows={CERTS} />}
      {tab === "standards" && <DataTable headers={["Standard", "Traceability", "Last Cal", "Next Cal", "Uncertainty", "Status"]} rows={STANDARDS} />}
      {tab === "jobs" && <DataTable headers={["Job No", "Client", "Site", "Scheduled", "Technician", "Status", "Billing"]} rows={JOBS} />}
    </Page>
  );
}
