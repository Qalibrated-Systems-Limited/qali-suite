"use client";

import { EyeIcon, PlusIcon, TrashIcon } from "lucide-react";
import { deleteAccount } from "../../mongodb/actions";
import { UpdateButton } from "../../../components/ui/buttons";
import Link from "next/link";

// This type is used to define the shape of our data.
//

export const columns = [
  {
    accessorKey: "deliveryNumber",
    header: "No",
  },
  {
    accessorKey: "date",
    header: "Date",
  },

  {
    accessorKey: "customerName",
    header: "Customer",
  },
  {
    accessorKey: "notes",
    header: "Description",
  },

  {
    accessorKey: "_id",
    header: "",

    cell: ({ row }) => {
      let id = row.getValue("_id");

      return (
        <div className="flex justify-end gap-3">
          <UpdateButton path={`/dashboard/dnotes/${id}/update`} />

          <ViewButton path={`/dashboard/invoices/${id}`} />
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

export function ViewButton({ path }) {
  return (
    <Link href={path} className="rounded-md border p-2 hover:bg-gray-100">
      <EyeIcon className="w-5" />
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
