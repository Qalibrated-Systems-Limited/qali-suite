import { Plus, Minus, Pencil } from "lucide-react";
import {
  AddSingleItem,
  AddToCartButton,
  RemoveSingleItem,
} from "./addToCartForm";
import { ca } from "date-fns/locale";
import Link from "next/link";

const mockData = [
  {
    _id: "1",
    SKU: "ABC123",
    name: "Product A",
    price: 100,
    stock: 20,
  },
  {
    _id: "2",
    SKU: "XYZ789",
    name: "Product B",
    price: 150,
    stock: 35,
  },
];

export function InventoryTable({ cart = [], stock }) {
  return (
    <div className="overflow-x-auto p-4">
      <table className="min-w-full border dark:border-zinc-700">
        <thead className="bg-pink-100 dark:bg-zinc-800">
          <tr>
            <th className="text-left px-4 py-2">SKU</th>
            <th className="text-left px-4 py-2">Name</th>
            <th className="text-left px-4 py-2">Unit Price</th>
            <th className="text-left px-4 py-2">Quantity</th>
            <th className="text-left px-4 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {stock.map((item) => {
            const cartItem = cart.find((cartItem) => cartItem.id === item.SKU);

            return (
              <tr
                key={item._id}
                className="border-t dark:border-zinc-700 hover:bg-pink-50 dark:hover:bg-zinc-800"
              >
                <td className="px-4 py-2">{item.SKU}</td>
                <td className="px-4 py-2">{item.name}</td>
                <td className="px-4 py-2">Ksh {item.price}</td>
                <td className="px-4 py-2">{item.stock}</td>
                <td className="px-4 py-2 flex items-center gap-2 flex-wrap">
                  <Link
                    href={`/dashboard/stocks/${item._id}/update`}
                    className="p-2 rounded-full bg-pink-500 text-white hover:bg-pink-600"
                  >
                    <Pencil className="w-4 h-4" />
                  </Link>

                  {cartItem ? (
                    <div className="flex items-center gap-1 border rounded-xl px-2 py-1 dark:border-zinc-700">
                      <RemoveSingleItem id={item.SKU} />
                      <span className="text-pink-600 dark:text-pink-400 font-semibold">
                        {cartItem.quantity}
                      </span>
                      <AddSingleItem id={item.SKU} />
                    </div>
                  ) : (
                    <AddToCartButton id={item._id} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
