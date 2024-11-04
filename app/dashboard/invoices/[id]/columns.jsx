"use client";

import { DeleteIcon, EyeIcon, PlusIcon, TrashIcon } from "lucide-react";

import Link from "next/link";
import { deleteInvoiceItem } from "../../../mongodb/actions";
import { useParams } from "next/navigation";

// This type is used to define the shape of our data.
//

export const columns = [
  {
    accessorKey: "name",
    header: "Ref",
  },
  {
    accessorKey: "quantity",
    header: "Quantity",
  },

  {
    accessorKey: "unitPrice",
    header: "Unit Cost",
  },

  {
    accessorKey: "unit",
    header: "Unit",
  },
  {
    accessorKey: "totalAmount",
    header: "Amount",
  },

  {
    accessorKey: "_id",
    header: "",

    cell: ({ row }) => {
      //   let id = row.getValue("_id");
      //   const params = useParams();
      //   const invoiceId = params.id;

      return (
        <div className="flex justify-end gap-3">
          {/* <AddItemButton path={`/dashboard/invoices/${invoiceId}/add-item`} />
          <DeleteInvoiceItem id={id} /> */}
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

export function DeleteInvoiceItem({ id }) {
  const params = useParams();
  const invoiceId = params.id;

  const deleteInvoiceWithId = deleteInvoiceItem.bind(null, id, invoiceId);
  return (
    <form action={deleteInvoiceWithId}>
      <button className="rounded-md border p-2 hover:bg-gray-100">
        <span className="sr-only">Delete</span>
        <DeleteIcon className="w-5" />
      </button>
    </form>
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
