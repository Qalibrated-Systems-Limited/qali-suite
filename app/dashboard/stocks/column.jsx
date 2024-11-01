"use client";

import { UpdateButton } from "../../../components/ui/buttons";

// This type is used to define the shape of our data.
//

export const columns = [
  {
    accessorKey: "SKU",
    header: "SKU",
  },
  {
    accessorKey: "name",
    header: "Name",
  },
  {
    accessorKey: "price",
    header: "Unit price",
  },

  {
    accessorKey: "stock",
    header: "Quantity",
  },

  {
    accessorKey: "_id",
    header: "",
    cell: ({ row }) => {
      let id = row.getValue("_id");

      return (
        <div className="flex justify-end gap-3">
          <UpdateButton path={`/dashboard/stocks/${id}/update`} />
        </div>
      );
    },
  },
];
