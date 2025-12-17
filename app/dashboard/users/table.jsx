import { columns } from "./column";
import { DataTable } from "@/components/ui/data-table";

async function UserTable({ accounts }) {
  return <DataTable columns={columns} data={accounts}></DataTable>;
}

export default UserTable;
