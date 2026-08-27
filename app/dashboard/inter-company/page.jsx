"use client";
import { useState } from "react";
import { Page, SectionHeader, StatGrid, Stat, Tabs, DataTable, Badge, Btn } from "@/components/erp-ui";

// Dummy-data adaptation of ERP's Inter-Company (IC) module.
const CONTRACTS = [
  ["Qalibrated Labs Ltd", "Mgmt Fee", "Kshs 6,000,000", "Kshs 900,000", "Kshs 750,000", "Kshs 900,000", "Kshs 0", <Badge variant="green">Settled</Badge>],
  ["QSL Instruments Ltd", "Shared Services", "Kshs 3,200,000", "Kshs 480,000", "Kshs 400,000", "Kshs 300,000", "Kshs 180,000", <Badge variant="amber">Partial</Badge>],
  ["Metrology Africa Ltd", "Royalty", "Kshs 2,100,000", "Kshs 315,000", "Kshs 300,000", "Kshs 0", "Kshs 315,000", <Badge variant="red">Outstanding</Badge>],
];
const TRANSACTIONS = [
  ["01 Aug 2025", "Qalibrated Labs Ltd", "Mgmt Fee", "Kshs 75,000", <Badge variant="green">Collected</Badge>],
  ["01 Aug 2025", "QSL Instruments Ltd", "Shared Services", "Kshs 40,000", <Badge variant="amber">Invoiced</Badge>],
  ["01 Aug 2025", "Metrology Africa Ltd", "Royalty", "Kshs 26,250", <Badge variant="red">Overdue</Badge>],
];

export default function InterCompanyPage() {
  const [tab, setTab] = useState("contracts");
  return (
    <Page>
      <SectionHeader title="Inter-Company" sub="Sister-company contracts, fees & eliminations" action={<Btn variant="gold">+ New Contract</Btn>} />
      <StatGrid>
        <Stat label="Total IC Fees" value="Kshs 1.70M" icon="🔗" />
        <Stat label="Collected" value="Kshs 1.05M" variant="green" icon="✅" />
        <Stat label="Outstanding" value="Kshs 0.65M" variant="red" icon="⏳" />
        <Stat label="Transactions" value="36" variant="blue" icon="📊" />
      </StatGrid>
      <Tabs tabs={[{ id: "contracts", label: "Contracts" }, { id: "transactions", label: "Transactions" }]} active={tab} setActive={setTab} />
      {tab === "contracts" && <DataTable headers={["Sister Company", "Type", "Contract Value", "QSL Fee", "Min Required", "Collected", "Outstanding", "Status"]} rows={CONTRACTS} />}
      {tab === "transactions" && <DataTable headers={["Date", "Sister Company", "Transaction Type", "Amount", "Status"]} rows={TRANSACTIONS} />}
    </Page>
  );
}
