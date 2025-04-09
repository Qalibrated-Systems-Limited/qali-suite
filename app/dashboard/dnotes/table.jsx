"use client";
import { getColumns } from "./columns";
import { DataTable } from "../../../components/ui/data-table";

function DNoteTable({ invoices }) {
  return (
    <DataTable columns={getColumns(invoices)} data={invoices ?? []}></DataTable>
  );
}

export default DNoteTable;
