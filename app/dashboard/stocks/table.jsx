import { columns } from "./column";
import { DataTable } from "../../../components/ui/data-table";

async function StockTable({ stock }) {
  return <DataTable columns={columns} data={stock}></DataTable>;
}

export default StockTable;
