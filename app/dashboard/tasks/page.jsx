"use client";
import { useState } from "react";
import { Page, SectionHeader, StatGrid, Stat, Tabs, DataTable, Badge, Btn } from "@/components/erp-ui";

// Dummy-data adaptation of ERP's Tasks module.
const prio = (p) => ({ Critical: "red", High: "amber", Medium: "blue", Low: "default" }[p] || "default");
const OPEN = [
  ["Reconcile August bank feed", "Accounts", "A. Mwangi", "18 Aug 2025", <Badge variant={prio("High")}>High</Badge>, <Badge variant="amber">In progress</Badge>],
  ["Prepare KRA VAT return", "Finance", "P. Wanjiru", "20 Aug 2025", <Badge variant={prio("Critical")}>Critical</Badge>, <Badge variant="blue">Open</Badge>],
  ["Calibrate reference mass set", "Technical", "S. Kamau", "16 Aug 2025", <Badge variant={prio("Medium")}>Medium</Badge>, <Badge variant="amber">In progress</Badge>],
  ["Update SOP-014 revision", "Quality", "J. Otieno", "25 Aug 2025", <Badge variant={prio("Low")}>Low</Badge>, <Badge variant="blue">Open</Badge>],
];
const OVERDUE = [
  ["Follow up on debtor QSL-0042", "Sales", "A. Mwangi", "05 Aug 2025", <Badge variant={prio("High")}>High</Badge>, <Badge variant="red">Overdue</Badge>],
  ["Submit fleet insurance renewal", "Admin", "P. Wanjiru", "01 Aug 2025", <Badge variant={prio("Critical")}>Critical</Badge>, <Badge variant="red">Overdue</Badge>],
];
const DONE = [
  ["Post July payroll", "HR", "HR Team", "31 Jul 2025", <Badge variant={prio("High")}>High</Badge>, <Badge variant="green">Completed</Badge>],
  ["Stock count — Main store", "Stores", "S. Kamau", "28 Jul 2025", <Badge variant={prio("Medium")}>Medium</Badge>, <Badge variant="green">Completed</Badge>],
];

export default function TasksPage() {
  const [tab, setTab] = useState("open");
  return (
    <Page>
      <SectionHeader title="Tasks" sub="Assignments across every department" action={<Btn variant="gold">+ New Task</Btn>} />
      <StatGrid>
        <Stat label="Total" value="34" icon="☑️" />
        <Stat label="Overdue" value="2" variant="red" icon="⏰" />
        <Stat label="Critical" value="3" variant="amber" icon="⚠️" />
        <Stat label="Completed" value="18" variant="green" icon="✅" />
      </StatGrid>
      <Tabs tabs={[{ id: "open", label: "Open" }, { id: "overdue", label: "Overdue" }, { id: "done", label: "Completed" }]} active={tab} setActive={setTab} />
      {tab === "open" && <DataTable headers={["Title", "Department", "Assigned To", "Due Date", "Priority", "Status"]} rows={OPEN} />}
      {tab === "overdue" && <DataTable headers={["Title", "Department", "Assigned To", "Due Date", "Priority", "Status"]} rows={OVERDUE} />}
      {tab === "done" && <DataTable headers={["Title", "Department", "Assigned To", "Completed", "Priority", "Status"]} rows={DONE} />}
    </Page>
  );
}
