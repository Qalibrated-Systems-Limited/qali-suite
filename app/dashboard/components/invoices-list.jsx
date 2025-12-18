import Link from "next/link";

import { fetchLatestInvoices } from "../../mongodb/queries/queries";

const InvoicesList = async ({}) => {
  const invoices = await fetchLatestInvoices();

  return (
    <ul className="space-y-4">
      {invoices.map((invoice) => (
        <Link
          href={`/dashboard/invoices/${invoice._id}`}
          key={invoice._id}
          className="flex justify-between items-center p-4 bg-secondary rounded-lg cursor-pointer hover:bg-secondary-foreground"
        >
          <div>
            <p className="font-bold">{invoice.invoiceNumber}</p>
            <p className="text-sm">{invoice.customer}</p>
          </div>
          <p className="font-bold text-primary">{`KES ${invoice.amount.toFixed(
            2
          )}`}</p>
        </Link>
      ))}
    </ul>
  );
};

export default InvoicesList;

import React from "react";
import { Skeleton } from "../../../components/ui/skeleton";

export const InvoicesListSkeleton = () => {
  return Array.from({ length: 5 }).map((_, index) => (
    <div
      key={index}
      className="flex justify-between items-center p-4 bg-secondary rounded-lg"
    >
      <div>
        <Skeleton className="h-4 w-32 mb-2" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-20" />
    </div>
  ));
};
