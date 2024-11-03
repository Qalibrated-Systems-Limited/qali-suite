import Link from "next/link";

import { fetchLatestInvoices } from "../../mongodb/queries";

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

export const InvoicesListSkeleton = () => {
  return (
    <ul className="space-y-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <li
          key={index}
          className="flex justify-between items-center p-4 bg-secondary rounded-lg animate-pulse"
        >
          <div>
            <div className="h-4 bg-gray-300 rounded w-32 mb-2"></div>
            <div className="h-4 bg-gray-300 rounded w-24"></div>
          </div>
          <div className="h-4 bg-gray-300 rounded w-16"></div>
        </li>
      ))}
    </ul>
  );
};
