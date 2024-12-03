import { columns } from "./columns";
import { DataTable } from "../../../components/ui/data-table";

async function DNoteTable({ invoices }) {
  return <DataTable columns={columns} data={invoices ?? []}></DataTable>;
}

export default DNoteTable;
