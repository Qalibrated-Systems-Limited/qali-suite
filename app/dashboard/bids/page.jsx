"use client";
import { useState } from "react";
import { Page, SectionHeader, StatGrid, Stat, Tabs, DataTable, Badge, Btn } from "@/components/erp-ui";

// Dummy-data adaptation of ERP's Bids & Pre-Sales module.
const BIDS = [
  ["BID-2025-041", "Supply of Weighing Equipment", "Ministry of Health", "Kshs 4,200,000", <Badge variant="blue">Stage 2B</Badge>, <Badge variant="green">Compliant</Badge>, "22 Aug 2025"],
  ["BID-2025-040", "Calibration Services Framework", "KenGen", "Kshs 8,500,000", <Badge variant="amber">Evaluation</Badge>, <Badge variant="green">Compliant</Badge>, "18 Aug 2025"],
  ["BID-2025-039", "Lab Refurbishment", "KEBS", "Kshs 12,000,000", <Badge variant="purple">Awarded</Badge>, <Badge variant="green">Compliant</Badge>, "01 Aug 2025"],
  ["BID-2025-038", "Inspection Retainer", "Bamburi Cement", "Kshs 3,100,000", <Badge variant="red">Stopped</Badge>, <Badge variant="red">Non-compliant</Badge>, "25 Jul 2025"],
];
const PIPELINE = [
  ["Supply of Weighing Equipment", "Ministry of Health", "Kshs 4,200,000", "60%"],
  ["Calibration Services Framework", "KenGen", "Kshs 8,500,000", "45%"],
  ["Metrology Training", "Private", "Kshs 1,800,000", "30%"],
];

export default function BidsPage() {
  const [tab, setTab] = useState("bids");
  return (
    <Page>
      <SectionHeader title="Bids & Pre-Sales" sub="Tenders, compliance & pipeline" action={<Btn variant="gold">+ New Bid</Btn>} />
      <StatGrid>
        <Stat label="Total Bids" value="41" icon="📋" />
        <Stat label="Pipeline Value" value="Kshs 14.5M" variant="blue" icon="📈" />
        <Stat label="Stage 2B Clear" value="7" variant="green" icon="✅" />
        <Stat label="Stopped" value="3" variant="red" icon="🛑" />
      </StatGrid>
      <Tabs tabs={[{ id: "bids", label: "Bids" }, { id: "pipeline", label: "Pipeline" }]} active={tab} setActive={setTab} />
      {tab === "bids" && <DataTable headers={["Ref", "Bid Name", "Procuring Entity", "Value", "Stage", "Compliance", "Deadline"]} rows={BIDS} />}
      {tab === "pipeline" && <DataTable headers={["Bid Name", "Procuring Entity", "Estimated Value (Kshs)", "Win Probability"]} rows={PIPELINE} />}
    </Page>
  );
}
