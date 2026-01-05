import User from "../../models/user";
import { CartComp } from "./Cart";
import { auth } from "../../../auth";

export default async function page({}) {
  const sesssion = await auth();
  const user = sesssion && sesssion.user;

  const userWithCart = await User.findById(user.id);

  // Serialize cart data for client component
  const cart = userWithCart?.cart?.map((item) => ({
    ...item.toObject(),
    _id: item._id?.toString(),
    productId: item.productId?.toString(),
  })) ?? [];

  return <CartComp cart={cart} />;
}
