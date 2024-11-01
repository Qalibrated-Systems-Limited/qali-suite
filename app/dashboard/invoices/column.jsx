"use client";

import { PlusIcon, TrashIcon } from "lucide-react";
import { deleteAccount } from "../../mongodb/actions";
import { UpdateButton } from "../../../components/ui/buttons";
import Link from "next/link";

// This type is used to define the shape of our data.
//

export const columns = [
  {
    accessorKey: "invoiceNumber",
    header: "No",
  },
  {
    accessorKey: "customer",
    header: "Customer",
  },

  {
    accessorKey: "totalAmount",
    header: "Amount",
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
          <UpdateButton path={`/dashboard/invoices/${id}/update`} />
          <AddItemButton path={`/dashboard/invoices/${id}/add-item`} />
        </div>
      );
    },
  },
];

export function AddItemButton({ path }) {
  return (
    <Link href={path} className="rounded-md border p-2 hover:bg-gray-100">
      <PlusIcon className="w-5" />
    </Link>
  );
}

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
