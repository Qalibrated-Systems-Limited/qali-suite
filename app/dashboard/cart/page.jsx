import User from "../../models/user";
import { CartComp } from "./Cart";
import { auth } from "../../../auth";

export default async function page({}) {
  const sesssion = await auth();
  const user = sesssion && sesssion.user;

  const userWithCart = await User.findById(user.id);
  const cart = userWithCart.cart;

  return (
    <div className="bg-white dark:bg-gray-900 shadow-md rounded-2xl p-4 w-full max-w-5xl mx-auto mt-6">
      <h2 className="text-3xl font-bold mb-6 text-pink-500 dark:text-pink-400">
        Inventory Cart
      </h2>
      <CartComp cart={cart} />
    </div>
  );
}
