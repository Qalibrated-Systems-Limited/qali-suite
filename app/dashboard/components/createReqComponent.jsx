import Account from "@/app/models/account";
import User from "@/app/models/user";
import { auth } from "@/auth";

import React from "react";
import { CreateRequestFromCartForm } from "./createRequestForm";

async function CreateReqComponent() {
  const sesssion = await auth();
  const user = sesssion && sesssion.user;

  const userWithCart = await User.findById(user.id).lean();

  let cart = userWithCart?.cart ?? [];
  if (cart.length > 0) {
    cart = cart.map((item) => ({
      ...item,
      _id: item._id.toString(),
    }));
  }

  let customers = await Account.find({}).lean();
  if (customers) {
    customers = customers.map((account) => ({
      name: account.name,
      _id: account._id.toString(),
    }));
  } else {
    return <h1>No customers found. Please create a customer first.</h1>;
  }
  const cartTotal = cart.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  return (
    <CreateRequestFromCartForm
      cartItems={cart}
      cartTotal={cartTotal}
      customers={customers}
    />
  );
}

export default CreateReqComponent;
