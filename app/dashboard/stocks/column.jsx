"use client";

import { UpdateButton } from "@/components/buttons";

// This type is used to define the shape of our data.
//

export const getColumns = () => [
  {
    accessorKey: "SKU",
    header: "SKU",
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.getValue("SKU")}</span>
    ),
  },
  {
    accessorKey: "name",
    header: "Product Name",
    cell: ({ row }) => (
      <span className="font-medium">{row.getValue("name")}</span>
    ),
  },
  {
    accessorKey: "price",
    header: "Unit Price",
    cell: ({ row }) => {
      const price = parseFloat(row.getValue("price"));
      const formatted = new Intl.NumberFormat("en-KE", {
        style: "currency",
        currency: "KES",
        minimumFractionDigits: 0,
      }).format(price);
      return <span className="font-medium">{formatted}</span>;
    },
  },
  {
    accessorKey: "stock",
    header: "Stock",
    cell: ({ row }) => {
      const stock = row.getValue("stock");
      const isLowStock = stock < 10;
      const isOutOfStock = stock === 0;

      return (
        <div className="flex items-center gap-2">
          <span
            className={`font-medium ${
              isOutOfStock
                ? "text-destructive"
                : isLowStock
                ? "text-orange-500"
                : ""
            }`}
          >
            {stock}
          </span>
          {isOutOfStock && (
            <span className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded">
              Out
            </span>
          )}
          {isLowStock && !isOutOfStock && (
            <span className="text-xs bg-orange-500/10 text-orange-500 px-2 py-0.5 rounded">
              Low
            </span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "_id",
    header: "",
    cell: ({ row }) => {
      const id = row.getValue("_id");

      return (
        <div className="flex items-center justify-end gap-1">
          <UpdateButton path={`/dashboard/stocks/${id}/update`} />
        </div>
      );
    },
  },
];
