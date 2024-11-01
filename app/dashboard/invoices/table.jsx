import { columns } from "./column";
import { DataTable } from "../../../components/ui/data-table";

async function InvoiceTable({ invoices }) {
  return <DataTable columns={columns} data={invoices ?? []}></DataTable>;
}

export default InvoiceTable;
