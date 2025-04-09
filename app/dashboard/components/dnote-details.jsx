import React from "react";
import { PrinterIcon, PlusIcon, TrashIcon } from "lucide-react";
import { Button } from "../../../components/ui/button";
import DeliveryNote from "../../models/dnote";
import { format } from "date-fns";
import Link from "next/link";
import dbConnect from "../../config/dbConnect";
import { DeleteDNoteItem } from "../invoices/[id]/columns";
import { Item } from "@radix-ui/react-select";
import { GenerateDNotePDF } from "../dnotes/download";

const DeliveryNoteDetail = async ({ id }) => {
  await dbConnect();
  let deliveryNote = await DeliveryNote.findOne({ _id: id }).lean();
  if (!deliveryNote) {
    return { notFound: true };
  }
  deliveryNote = {
    ...deliveryNote,
    date: format(new Date(deliveryNote.date), "dd-MM-yy"),
    _id: deliveryNote._id.toString(),
    items: deliveryNote.items.map((item) => ({
      ...item,
      _id: item._id.toString(),
    })),
  };

  return (
    <div className="bg-background text-foreground p-6 min-h-screen">
      <div className="max-w-4xl mx-auto shadow-lg rounded-lg p-6">
        <header className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              Delivery Note #{deliveryNote.deliveryNumber}
            </h1>
            <div className="text-sm">
              <p>Date: {deliveryNote.date}</p>
            </div>
          </div>
          <GenerateDNotePDF dnote={deliveryNote} />
        </header>
        <section className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Customer Details</h2>
          <div className="text-sm">
            <p>
              Name:{" "}
              <span className="font-bold">{deliveryNote.customer.name}</span>
            </p>
            <p>
              Address:{" "}
              <span className="font-bold">{deliveryNote.customer.address}</span>
            </p>
            <p>
              Phone:{" "}
              <span className="font-bold">{deliveryNote.customer.phone}</span>
            </p>
          </div>
        </section>
        <section className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Items</h2>
          <table className="min-w-full bg-white dark:bg-gray-800">
            <thead>
              <tr className="w-full bg-gray-200 dark:bg-gray-700">
                <th className="px-4 py-2 text-left">Description</th>

                <th className="px-4 py-2 text-left">Quantity</th>

                <th className="px-4 py-2 text-left">Unit Price</th>
                <th className="px-4 py-2 text-left"> Unit</th>
                <th className="px-4 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {deliveryNote.items.map((item) => (
                <tr key={item._id} className="border-t">
                  <td className="px-4 py-2">{item.name}</td>

                  <td className="px-4 py-2">{item.quantity}</td>
                  <td className="px-4 py-2">{item.unitPrice.toFixed(0)}</td>
                  <td className="px-4 py-2">{item.unit}</td>

                  <td className="px-4 py-2">
                    <DeleteDNoteItem id={Item.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link href={`/dashboard/dnotes/${deliveryNote._id}/add-item`}>
            <Button className="mt-4">
              <PlusIcon size={20} />
              <span className="ml-2">Add Item</span>
            </Button>
          </Link>
        </section>
        <section className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Notes</h2>
          <div className="text-sm">
            <p>{deliveryNote.notes || "No additional notes"}</p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default DeliveryNoteDetail;
