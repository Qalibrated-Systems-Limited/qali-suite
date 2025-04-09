import { DialogDnote } from "../components/addDNoteModal";
import {
  AddSingleCartVersion,
  RemoveCartItem,
  RemoveSingleCartVersion,
} from "../stocks/addToCartForm";

export function CartComp({ cart }) {
  return cart.length === 0 ? (
    <p className="text-gray-600 dark:text-gray-300">Your cart is empty.</p>
  ) : (
    <>
      <div className="overflow-x-auto rounded-lg border dark:border-gray-700">
        <table className="w-full text-sm text-left text-gray-600 dark:text-gray-300">
          <thead className="text-xs uppercase bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Unit Price</th>
              <th className="px-4 py-3">Quantity</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cart.map((item) => (
              <tr
                key={item._id}
                className="bg-white dark:bg-gray-900 border-b dark:border-gray-700"
              >
                <td className="px-4 py-2">{item.id}</td>
                <td className="px-4 py-2">{item.name}</td>
                <td className="px-4 py-2">Ksh {item.unitPrice}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <RemoveSingleCartVersion id={item.id} />
                    <span className="px-2 font-semibold">{item.quantity}</span>
                    <AddSingleCartVersion id={item.id} />
                  </div>
                </td>
                <td className="px-4 py-2">
                  Ksh {item.unitPrice * item.quantity}
                </td>
                <td className="px-4 py-2 text-right">
                  <RemoveCartItem id={item.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row justify-between items-center gap-4">
        <DialogDnote />
      </div>
    </>
  );
}
