import { columns } from "./columns";
import { DataTable } from "../../../../components/ui/data-table";

async function ItemsTable({ items }) {
  return <DataTable columns={columns} data={items}></DataTable>;
}

export default ItemsTable;
