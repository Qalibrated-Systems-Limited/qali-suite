"use client";

import { TrashIcon } from "lucide-react";
import { deleteAccount } from "../../mongodb/actions";
import { UpdateButton } from "../../../components/buttons";

// This type is used to define the shape of our data.
//

export const columns = [
  {
    accessorKey: "name",
    header: "Name",
  },
  {
    accessorKey: "address",
    header: "Address",
  },

  {
    accessorKey: "email",
    header: "Email",
  },
  {
    accessorKey: "phoneNumber",
    header: "Phone",
  },

  {
    accessorKey: "_id",
    header: "",

    cell: ({ row }) => {
      let id = row.getValue("_id");

      return (
        <div className="flex justify-end gap-3">
          <UpdateButton path={`/dashboard/customers/${id}/update`} />
          <DeleteAccount id={id} />
        </div>
      );
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
