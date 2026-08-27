"use client";
import { useState } from "react";
import { Page, SectionHeader, StatGrid, Stat, Tabs, DataTable, Badge, Btn } from "@/components/erp-ui";

// Dummy-data adaptation of ERP's My Workspace module — a personal home rolling
// up the signed-in user's tasks, approvals, leave and notifications.
const MYTASKS = [
  ["Reconcile August bank feed", "Accounts", "18 Aug 2025", <Badge variant="amber">In progress</Badge>],
  ["Follow up debtor QSL-0042", "Sales", "05 Aug 2025", <Badge variant="red">Overdue</Badge>],
  ["Review SOP-014", "Quality", "25 Aug 2025", <Badge variant="blue">Open</Badge>],
];
const APPROVALS = [
  ["Purchase Requisition PR-0231", "Kshs 220,000", "S. Kamau", <Badge variant="amber">Pending you</Badge>],
  ["Leave — A. Mwangi", "3 days", "A. Mwangi", <Badge variant="amber">Pending you</Badge>],
  ["Expense Claim EXP-0119", "Kshs 14,800", "J. Otieno", <Badge variant="amber">Pending you</Badge>],
];
const LEAVE = [
  ["Annual", "22 Aug – 26 Aug 2025", "5 days", <Badge variant="blue">Requested</Badge>],
  ["Sick", "18 Jul 2025", "1 day", <Badge variant="green">Approved</Badge>],
];

export default function WorkspacePage() {
  const [tab, setTab] = useState("tasks");
  return (
    <Page>
      <SectionHeader title="My Workspace" sub="Your tasks, approvals & requests at a glance" action={<Btn variant="gold">+ Quick Task</Btn>} />
      <StatGrid>
        <Stat label="My Open Tasks" value="5" icon="🙋" />
        <Stat label="Awaiting My Approval" value="3" variant="amber" icon="📝" />
        <Stat label="Leave Balance" value="12 days" variant="green" icon="🌴" />
        <Stat label="Unread Notifications" value="4" variant="blue" icon="🔔" />
      </StatGrid>
      <Tabs tabs={[{ id: "tasks", label: "My Tasks" }, { id: "approvals", label: "My Approvals" }, { id: "leave", label: "My Leave" }]} active={tab} setActive={setTab} />
      {tab === "tasks" && <DataTable headers={["Task", "Department", "Due Date", "Status"]} rows={MYTASKS} />}
      {tab === "approvals" && <DataTable headers={["Item", "Amount / Detail", "Raised By", "Status"]} rows={APPROVALS} />}
      {tab === "leave" && <DataTable headers={["Type", "Dates", "Days", "Status"]} rows={LEAVE} />}
    </Page>
  );
}
