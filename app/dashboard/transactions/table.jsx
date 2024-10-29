import { columns } from "./column";
import { DataTable } from "../../../components/ui/data-table";

async function TransactionTable({ transactions }) {
  return <DataTable columns={columns} data={transactions}></DataTable>;
}

export default TransactionTable;
