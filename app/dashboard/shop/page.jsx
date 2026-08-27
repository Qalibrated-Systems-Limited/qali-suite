"use client";
import { useState } from "react";
import { Page, SectionHeader, StatGrid, Stat, Tabs, DataTable, Badge, Btn } from "@/components/erp-ui";

// Dummy-data adaptation of ERP's Online Shop module.
const ORDERS = [
  ["ORD-2025-208", "Jane Doe", "3", "Kshs 14,500", <Badge variant="amber">Awaiting Payment</Badge>, "12 Aug 2025"],
  ["ORD-2025-207", "Acme Traders", "1", "Kshs 62,000", <Badge variant="green">Paid</Badge>, "11 Aug 2025"],
  ["ORD-2025-206", "M. Kariuki", "5", "Kshs 8,900", <Badge variant="blue">Shipped</Badge>, "10 Aug 2025"],
  ["ORD-2025-205", "Summit Ltd", "2", "Kshs 33,200", <Badge variant="green">Delivered</Badge>, "08 Aug 2025"],
];
const CATALOG = [
  ["PRD-1001", "Digital Bench Scale 30kg", "Weighing", "24", "Kshs 18,500", "In-house", <Badge variant="green">Listed</Badge>],
  ["PRD-1002", "Thermohygrometer", "Instruments", "11", "Kshs 9,200", "Import", <Badge variant="green">Listed</Badge>],
  ["PRD-1003", "Calibration Weight Set F1", "Standards", "6", "Kshs 47,000", "Import", <Badge variant="amber">Unlisted</Badge>],
  ["PRD-1004", "Pressure Gauge 0–10 bar", "Instruments", "0", "Kshs 5,400", "In-house", <Badge variant="red">Out of stock</Badge>],
];

export default function ShopPage() {
  const [tab, setTab] = useState("orders");
  return (
    <Page>
      <SectionHeader title="Online Shop" sub="Storefront orders & catalog" action={<Btn variant="gold">+ List Product</Btn>} />
      <StatGrid>
        <Stat label="Total Orders" value="208" icon="🛒" />
        <Stat label="Awaiting Payment" value="6" variant="amber" icon="⏳" />
        <Stat label="Listed Products" value="88" variant="green" icon="🏷️" />
        <Stat label="Total Catalog Items" value="132" variant="blue" icon="📦" />
      </StatGrid>
      <Tabs tabs={[{ id: "orders", label: "Orders" }, { id: "catalog", label: "Catalog" }]} active={tab} setActive={setTab} />
      {tab === "orders" && <DataTable headers={["Order No", "Customer", "Items", "Total (Kshs)", "Status", "Placed"]} rows={ORDERS} />}
      {tab === "catalog" && <DataTable headers={["Code", "Item", "Category", "Stock", "Price (Kshs)", "Source", "Listed?"]} rows={CATALOG} searchable />}
    </Page>
  );
}
