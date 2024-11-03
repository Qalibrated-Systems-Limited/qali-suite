import { columns } from "./columns";
import { DataTable } from "../../../components/ui/data-table";

async function StockTxTable({ txs }) {
  return <DataTable columns={columns} data={txs ?? []}></DataTable>;
}

export default StockTxTable;
