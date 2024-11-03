"use client";

import { UpdateButton } from "../../../components/ui/buttons";

// This type is used to define the shape of our data.
//

export const columns = [
  {
    accessorKey: "_id",
    header: "TranId",
  },
  {
    accessorKey: "date",
    header: "Date",
  },
  {
    accessorKey: "SKU",
    header: "item",
  },

  {
    accessorKey: "transactionType",
    header: "TranType",
  },

  {
    accessorKey: "amount",
    header: "Amount(KES)",
  },

  //   {
  //     accessorKey: "_id",
  //     header: "",
  //     cell: ({ row }) => {
  //       let id = row.getValue("_id");

  //       return (
  //         <div className="flex justify-end gap-3">
  //           <UpdateButton path={`/dashboard/stocks/${id}/update`} />
  //         </div>
  //       );
  //     },
  //   },
];
