"use client";

import { DeleteIcon } from "lucide-react";
import { TrashIcon } from "lucide-react";
import { deleteAccount } from "../../mongodb/actions";
import { UpdateButton } from "../../../components/ui/buttons";

// This type is used to define the shape of our data.
//

export const columns = [
  {
    accessorKey: "name",
    header: "Name",
  },
  {
    accessorKey: "accountType",
    header: "Type",
  },

  {
    accessorKey: "status",
    header: "Status",
  },

  {
    accessorKey: "_id",
    header: "",
    cell: ({ row }) => {
      let id = row.getValue("_id");

      return (
        <div className="flex justify-end gap-3">
          <UpdateButton path={`/dashboard/customers/${id}/update`} />
        </div>
      );
    },
  },

  {
    accessorKey: "_id",
    header: "",
    cell: ({ row }) => {
      let id = row.getValue("_id");

      return <DeleteAccount id={id} />;
    },
  },
];

export function DeleteAccount({ id }) {
  const deleteInvoiceWithId = deleteAccount.bind(null, id);
  return (
    <form action={deleteInvoiceWithId}>
      <button className="rounded-md border p-2 hover:bg-gray-100">
        <span className="sr-only">Delete</span>
        <TrashIcon className="w-5" />
      </button>
    </form>
  );
}
