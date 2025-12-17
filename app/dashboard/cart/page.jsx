import User from "../../models/user";
import { CartComp } from "./Cart";
import { auth } from "../../../auth";

export default async function page({}) {
  const sesssion = await auth();
  const user = sesssion && sesssion.user;

  const userWithCart = await User.findById(user.id);

  const cart = userWithCart?.cart ?? [];

  return <CartComp cart={cart} />;
}
