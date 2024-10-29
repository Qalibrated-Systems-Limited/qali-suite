"use client";

import { UpdateButton } from "../../../components/ui/buttons";

import { ColumnDef } from "@tanstack/react-table";

// This type is used to define the shape of our data.
//

export const columns = [
  {
    accessorKey: "_id",
    header: "TranId",
  },
  {
    accessorKey: "vehRegNo",
    header: "Vehicle",
  },
  {
    accessorKey: "customer",
    header: "Customer",
  },
  {
    accessorKey: "commodity",
    header: "Commodity",
  },
  {
    accessorKey: "date",
    header: "Timestamp",
  },
  {
    accessorKey: "firstWeight",
    header: "Weight1",
  },
  {
    accessorKey: "secondWeight",
    header: "Weight2",
  },
  {
    accessorKey: "netWeight",
    header: "NetWeight",
  },

  // {
  //   accessorKey: "_id",
  //   header: "",
  //   cell: ({ row }) => {
  //     let id = row.getValue("_id");

  //     return (
  //       <div className="flex justify-end gap-3">
  //         <UpdateButton path={`/dashboard/stations/${id}/update`} />
  //       </div>
  //     );
  //   },
  // },
];
