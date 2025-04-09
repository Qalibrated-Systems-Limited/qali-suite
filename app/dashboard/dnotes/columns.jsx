"use client";

import { EyeIcon, PlusIcon, TrashIcon } from "lucide-react";
import { deleteAccount } from "../../mongodb/actions";
import { Badge } from "../../../components/ui/badge";
import { ReturnDnoteItems, UpdateButton } from "../../../components/ui/buttons";
import Link from "next/link";

// This type is used to define the shape of our data.
//

export const getColumns = (dnotes = []) => [
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
      const dNote = dnotes.find((item) => item._id === id);

      const shouldBeReturned = dNote.shouldBeReturned;
      const reason = dNote.reason;
      let modAction = (
        <Badge variant={"outline"} className={"my-2"}>
          Sold
        </Badge>
      );
      if (shouldBeReturned && reason !== "Selling") {
        modAction = <ReturnDnoteItems id={id} />;
      }
      if (!shouldBeReturned && reason !== "Selling") {
        modAction = (
          <Badge variant={"outline"} className={"my-2"}>
            Returned
          </Badge>
        );
      }

      return (
        <div className="flex justify-end gap-3">
          <UpdateButton path={`/dashboard/dnotes/${id}/update`} />

          <ViewButton path={`/dashboard/dnotes/${id}`} />
          {modAction}
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
