import React from "react";
import { PrinterIcon, PlusIcon, TrashIcon } from "lucide-react";
import { Button } from "../../../components/ui/button";
import Invoice from "../../models/invoice";
import { format } from "date-fns";
import Link from "next/link";
import { GeneratePdf } from "../invoices/[id]/download";
import { DeleteInvoiceItem } from "../invoices/[id]/columns";
import dbConnect from "../../config/dbConnect";
import { notFound } from "next/navigation";

const InvoiceDetail = async ({ id }) => {
  dbConnect();
  let invoice = await Invoice.findOne({ _id: id }).lean();
  if (!invoice) {
    return notFound();
  }
  invoice = {
    ...invoice,
    createdAt: invoice.createdAt.toISOString(), // Convert Date to string
    updatedAt: invoice.updatedAt.toISOString(),
    _id: invoice._id.toString(),
    items: invoice.items.map((item) => {
      return { ...item, _id: item._id.toString() };
    }),
  };
  const formattedDate = format(new Date(invoice.createdAt), "dd-MM-yy");
  invoice.date = formattedDate;

  let items = invoice.items ?? [];
  if (items.length > 0) {
    items = items.map((item) => {
      const amount = item.quantity * item.unitPrice;
      return {
        ...item,
        _id: item._id.toString(),
        totalAmount: amount,
      };
    });
  }

  let totalAmount = 0;
  for (var item of items) {
    totalAmount += item.totalAmount;
  }
  const showSubTitle = invoice.taxRate > 0 || invoice.discount > 0;
  const subTotal = totalAmount.toFixed(2);

  if (invoice.discount > 0) {
    const perCentageRemaining = (100 - invoice.discount) / 100;
    totalAmount = totalAmount * perCentageRemaining;
  }

  if (invoice.taxRate > 0) {
    const plusVatPercent = (100 + invoice.taxRate) / 100;
    totalAmount = totalAmount * plusVatPercent;
  }

  totalAmount = totalAmount.toFixed(2);

  const calculateTotal = () => {
    const subTotal = items.reduce(
      (total, item) =>
        total + item.quantity.$numberInt * item.unitPrice.$numberInt,
      0
    );
    const discountAmount = (subTotal * discount.$numberInt) / 100;
    const taxAmount = ((subTotal - discountAmount) * taxRate.$numberInt) / 100;
    return subTotal - discountAmount + taxAmount;
  };

  return (
    <div className="bg-background text-foreground p-6 min-h-screen">
      <div className="max-w-4xl mx-auto shadow-lg rounded-lg p-6">
        <header className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              Invoice #{invoice.invoiceNumber}
            </h1>
            <div className="text-sm">
              <p>
                Status: <span className="font-bold">{invoice.status}</span>
              </p>
              <p>Date Issued: {invoice.date}</p>
            </div>
          </div>
          <GeneratePdf
            discount={invoice.discount}
            invoice={invoice}
            items={items}
            shoudShowSub={showSubTitle}
            subTotal={subTotal}
            taxRate={invoice.taxRate}
            total={totalAmount}
          />
        </header>
        <section className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Customer Details</h2>
          <div className="text-sm">
            <p>
              Name: <span className="font-bold">{invoice.customer.name}</span>
            </p>
            <p>
              Address:{" "}
              <span className="font-bold">{invoice.customer.address}</span>
            </p>
            <p>
              Email: <span className="font-bold">{invoice.customer.email}</span>
            </p>
          </div>
        </section>
        <section className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Invoice Details</h2>
          <p>{invoice.description}</p>
        </section>
        <section className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Items</h2>
          <table className="min-w-full bg-white dark:bg-gray-800">
            <thead>
              <tr className="w-full bg-gray-200 dark:bg-gray-700">
                <th className="px-4 py-2 text-left">Item Name</th>
                <th className="px-4 py-2 text-left">Quantity</th>
                <th className="px-4 py-2 text-left">Unit Price</th>
                <th className="px-4 py-2 text-left">Total</th>
                <th className="px-4 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item._id} className="border-t">
                  <td className="px-4 py-2">{item.name}</td>
                  <td className="px-4 py-2">
                    {item.quantity.$numberInt} {item.unit}
                  </td>
                  <td className="px-4 py-2">
                    {invoice.currency} {item.unitPrice}
                  </td>
                  <td className="px-4 py-2">
                    {invoice.currency}{" "}
                    {(item.quantity * item.unitPrice).toFixed(2)}
                  </td>
                  <td className="px-4 py-2">
                    <DeleteInvoiceItem id={item._id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link href={`/dashboard/invoices/${invoice._id}/add-item`}>
            <Button className="mt-4">
              <PlusIcon size={20} />
              <span className="ml-2">Add Item</span>
            </Button>
          </Link>
        </section>
        <section className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Summary</h2>
          <div className="text-sm">
            {showSubTitle && (
              <p>
                Subtotal: {invoice.currency} {subTotal}
              </p>
            )}
            {invoice.discount > 0 && <p>Discount: {invoice.discount}%</p>}
            {invoice.taxRate > 0 && <p>Tax Rate: {invoice.taxRate}%</p>}
            <p>
              Total Amount:
              <span className="font-bold">
                {invoice.currency} {totalAmount}
              </span>
            </p>
            <p>
              Payment Method:{" "}
              <span className="font-bold">{invoice.paymentMethod}</span>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default InvoiceDetail;
