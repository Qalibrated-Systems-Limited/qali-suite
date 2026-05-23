"use server";
import { renderToFile } from "@react-pdf/renderer";

import {
  validateAccount,
  validateDNote,
  validateDnoteItem,
  validateInvoice,
  validateInvoiceItem,
  validateInvoiceUpdate,
  validateNewUser,
  validateSettings,
  validateUpdateAccount,
  validateUpdateUser,
} from "./validators";
import { AuthError } from "next-auth";
import { signIn, signOut } from "../../auth";
import Account from "../models/account";
import Party from "../models/parties";
import { auth } from "../../auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import User from "../models/user";
import BridgeConfig from "../models/bridgeConfigs";
import { toTitle } from "../utils/validators";
import Product from "../models/product";

import Invoice from "../models/invoice";
import DeliveryNote from "../models/dnote";
import Counter from "../models/counter";
import StockTransaction from "../models/stockTransaction";
import { StockRequest } from "../models/requests";
import mongoose from "mongoose";
import { format } from "date-fns";
import dbConnect from "../config/dbConnect";

export async function logout(params) {
  return await signOut({ redirectTo: "/" });
}
export async function authenticate(prevState, formData) {
  try {
    await signIn("credentials", formData, { redirectTo: "/dashboard" });
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CallbackRouteError" || "CredentialsSignin":
          return "Invalid credentials.";
        default:
          return "Something went wrong.";
      }
    }
    throw error;
  }
}
//ccounts

export async function createAccount(state, formData) {
  await dbConnect();
  try {
    const session = await auth();
    const user = session && session.user;
    const rawFormData = Object.fromEntries(formData.entries());

    const validatedFields = validateAccount(rawFormData);

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: "Missing Fields. Failed to Create Account.",
      };
    }

    const data = validatedFields.data;

    await Account.create({
      name: toTitle(validatedFields.data.name),
      address: data.address,
      email: data.email,
      phoneNumber: data.phoneNumber,
      status: "Active",

      creator: {
        name: user.name,
        id: user.id,
      },
    });
  } catch (e) {
    return { message: "Database error: failed to create account" };
  }
  revalidatePath("/dashboard/customers");
  redirect("/dashboard/customers");
}

export async function updateAccount(id, prevState, formData) {
  await dbConnect();
  const rawFormData = Object.fromEntries(formData.entries());
  const validatedFields = validateUpdateAccount(rawFormData);
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing Fields. Failed to Create User.",
    };
  }

  try {
    const data = validatedFields.data;
    await Account.updateOne(
      { _id: id },
      {
        $set: {
          name: toTitle(validatedFields.data.name),
          status: validatedFields.data.status,
          address: data.address,
          phoneNumber: data.phoneNumber,
          email: data.email,
        },
      }
    );
  } catch (e) {
    return { message: "Database Error: Failed to Update account." };
  }
  revalidatePath("/dashboard/customers");
  redirect("/dashboard/customers");
}

export const deleteAccount = async (id) => {
  try {
    await Account.findByIdAndDelete(id);
  } catch (e) {
    throw new Error("Could not delete account");
  }
  revalidatePath("/dashboard/customers");
  redirect("/dashboard/customers");
};

//User action

export async function createUser(state, formData) {
  await dbConnect();
  try {
    const session = await auth();
    const user = session && session.user;
    const rawFormData = Object.fromEntries(formData.entries());

    const validatedFields = validateNewUser(rawFormData);

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: "Missing Fields. Failed to Create Account.",
      };
    }

    const creator = { name: user.name, id: user.id };

    const data = validatedFields.data;

    const res = await User.create({
      name: toTitle(data.name),
      email: data.email,
      password: data.password,
      role: data.role,
      creator: creator,
    });
    console.log(res);
  } catch (e) {
    console.error(e);
    return { message: "Database error: failed to create user" };
  }
  revalidatePath("/dashboard/users");
  redirect("/dashboard/users");
}

export async function updateUser(id, prevState, formData) {
  await dbConnect();
  const rawFormData = Object.fromEntries(formData.entries());
  const validatedFields = validateUpdateUser(rawFormData);
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing Fields. Failed to Create User.",
    };
  }

  try {
    await User.updateOne(
      { _id: id },
      {
        $set: {
          name: toTitle(validatedFields.data.name),
          status: validatedFields.data.status,
          role: validatedFields.data.role,
          email: validatedFields.data.email,
        },
      }
    );
  } catch (e) {
    return { message: "Database Error: Failed to Update user." };
  }
  revalidatePath("/dashboard/users");
  redirect("/dashboard/users");
}

export async function createSettings(state, formData) {
  await dbConnect();
  try {
    const rawFormData = Object.fromEntries(formData.entries());

    const validatedFields = validateSettings(rawFormData);

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: "Missing Fields. Failed to Create Account.",
      };
    }

    const data = validatedFields.data;

    await BridgeConfig.create({
      isLocked: data.isLocked,
      division: data.division,
      maxCapacity: data.maxCapacity,
      minCapacity: data.minCapacity,
      weigherId: data.weigherId,
    });
  } catch (e) {
    console.error(e);
    return { message: "Database error: failed to create configs" };
  }
  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings");
}

export async function updateSettings(id, prevState, formData) {
  await dbConnect();
  const rawFormData = Object.fromEntries(formData.entries());
  const validatedFields = validateSettings(rawFormData);
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing Fields. Failed to Create User.",
    };
  }

  try {
    await BridgeConfig.updateOne(
      { weigherId: id },
      {
        $set: {
          division: validatedFields.data.division,
          isLocked: validatedFields.data.isLocked,
          maxCapacity: validatedFields.data.maxCapacity,

          minCapacity: validatedFields.data.minCapacity,
        },
      }
    );
  } catch (e) {
    return { message: "Database Error: Failed to Update configs." };
  }
  revalidatePath("/dashboard/transaction");
  redirect("/dashboard/transactions");
}

//Invoices

export async function createInvoice(state, formData) {
  await dbConnect();
  try {
    const rawFormData = Object.fromEntries(formData.entries());

    const validatedFields = validateInvoice(rawFormData);

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: "Missing Fields. Failed to add invoices.",
      };
    }

    const data = validatedFields.data;

    const party = await Party.findById(data.customerId);
    let invoiceNumber = "1";

    if (!party) {
      return { message: "No customer was found" };
    }

    // Verify it's a customer
    if (party.type !== "customer" && party.type !== "both") {
      return { message: "Selected party is not a customer" };
    }

    // Format address from Party model
    const formatAddress = (address) => {
      if (!address) return "";
      const parts = [
        address.line1,
        address.line2,
        address.city,
        address.postalCode,
        address.country,
      ].filter(Boolean);
      return parts.join(", ");
    };

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // e.g., 20241031
    const counter = await Counter.findOneAndUpdate(
      { name: `invoiceNumber-${today}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    invoiceNumber = `INV-${today}-${counter.seq.toString().padStart(4, "0")}`; // e.g., 20241031-0001
    const customer = {
      name: party.displayName || party.name,
      address: formatAddress(party.address),
      id: party._id.toString(),
      email: party.email,
      phone: party.phone,
      taxPin: party.taxPin || "",
    };
    const invoice = Invoice({
      description: data.description,
      taxRate: data.taxRate,
      dNoteNumber: data.dNoteNumber,
      customer,
      items: [],
      invoiceNumber,
      status: data.status,
    });
    await invoice.save();
  } catch (e) {
    console.log(e);
    return { message: "Database error: failed to add invoice" };
  }
  revalidatePath("/dashboard/invoices");
  redirect("/dashboard/invoices");
}

export async function addInvoiceItem(id, state, formData) {
  await dbConnect();
  try {
    const rawFormData = Object.fromEntries(formData.entries());

    const validatedFields = validateInvoiceItem(rawFormData);

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: "Missing Fields. Failed to add item.",
      };
    }

    const data = validatedFields.data;
    console.log(data);

    const invoice = await Invoice.findById(id);
    if (!invoice) {
      return { message: "No invoice found" };
    }
    const items = invoice.items ?? [];
    let item = {
      name: toTitle(data.name),

      quantity: data.quantity,
      unitPrice: data.unitPrice,
      unit: data.unit,
      type: data.type,
    };

    if (data.type === "Service") {
      if (items.length > 0) {
        const existingItem = items.find(
          (item) => item.name === toTitle(data.name)
        );

        if (existingItem) {
          return { message: "This item is already added" };
        }
      }

      await Invoice.findOneAndUpdate(
        { _id: id },
        {
          $push: {
            items: {
              name: toTitle(data.name),

              quantity: data.quantity,
              unitPrice: data.unitPrice,
              unit: data.unit,
              type: data.type,
            },
          },
        }
      );
    } else {
      const stock = await Product.findOne({
        SKU: data.name,
        stock: { $gt: 0 },
      });
      if (!stock) {
        return { message: "No stock, Item found" };
      }

      const remainingStock = stock.stock;

      if (Number(data.quantity) > remainingStock) {
        return { message: "Insufficient stock" };
      }

      const existingItem = items.find((item) => item.name === stock.SKU);

      if (existingItem) {
        return { message: "This item is already added" };
      }

      item = {
        id: stock._id.toString(),
        quantity: Number(data.quantity),
        unitPrice: Number(data.unitPrice),
        type: "Stock",
        unit: data.unit.toString(),
        name: stock.SKU.toString(),
        serialNo: data.serialNo,
      };

      const invoice = await Invoice.findOneAndUpdate(
        { _id: id },
        { $push: { items: item } }
      );
      const newStock = remainingStock - Number(data.quantity);
      stock.stock = newStock;
      await stock.save();

      const amount = Number(data.quantity) * Number(data.unitPrice);

      await StockTransaction.create({
        SKU: stock.SKU,
        amount,
        ref: invoice.invoiceNumber,
        transactionType: "Sale",
        quantity: data.quantity,
      });
    }
  } catch (e) {
    console.error(e);
    return { message: "Database error: failed to add Invoice item" };
  }
  revalidatePath(`/dashboard/invoices/${id}`);
  redirect(`/dashboard/invoices/${id}`);
}

export async function updateInvoice(id, prevState, formData) {
  await dbConnect();
  const rawFormData = Object.fromEntries(formData.entries());
  try {
    const validatedFields = validateInvoiceUpdate(rawFormData);
    console.log(validatedFields.error);

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: "Missing Fields. Failed to add invoices.",
      };
    }

    const data = validatedFields.data;

    const party = await Party.findById(data.customerId);

    if (!party) {
      return { message: "No customer was found" };
    }

    // Verify it's a customer
    if (party.type !== "customer" && party.type !== "both") {
      return { message: "Selected party is not a customer" };
    }

    // Format address from Party model
    const formatAddress = (address) => {
      if (!address) return "";
      const parts = [
        address.line1,
        address.line2,
        address.city,
        address.postalCode,
        address.country,
      ].filter(Boolean);
      return parts.join(", ");
    };

    const customer = {
      name: party.displayName || party.name,
      address: formatAddress(party.address),
      id: party._id.toString(),
      email: party.email,
      phone: party.phone,
      taxPin: party.taxPin || "",
    };

    const invoice = await Invoice.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          customer: customer,
          discount: data.discount,
          description: data.description,
          status: data.status,
          taxRate: data.taxRate,
          dNoteNumber: data.dNoteNumber,
        },
      }
    );
    if (!invoice) {
      return { message: "No invoice found with this id" };
    }
  } catch (e) {
    console.log(e);
    return { message: "Database Error: Failed to Update  invoice." };
  }
  revalidatePath("/dashboard/invoices");
  redirect("/dashboard/invoices");
}

export const deleteInvoiceItem = async (itemId, invoiceId) => {
  try {
    const res = await Invoice.findOneAndUpdate(
      { _id: invoiceId },
      { $pull: { items: { _id: itemId } } }
    );
    if (res) {
      const deletedItem = res.items.find((item) => item._id == itemId);
      if (deletedItem) {
        console.log(deletedItem);
        const result = await StockTransaction.deleteOne({
          SKU: deletedItem.name,
          ref: res.invoiceNumber,
        });

        console.log(result);
        const res2 = await Product.updateOne(
          { SKU: deletedItem.name },
          { $inc: { "inventory.quantityOnHand": deletedItem.quantity, "inventory.quantityAvailable": deletedItem.quantity } }
        );

        console.log(res2);
      }
    }
  } catch (e) {
    return { message: "Could not remove item" };
  }

  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  redirect(`/dashboard/invoices/${invoiceId}`);
};

export const downloadFile = async (Doc) => {
  await renderToFile(!!Doc, `${__dirname}/my-doc.pdf`);
};

export async function returnDNoteItems(id) {
  await dbConnect();
  const mongodbSession = await mongoose.startSession();
  try {
    const session = await auth();
    const user = session && session.user;

    mongodbSession.startTransaction();
    const dNote = await DeliveryNote.findById(id).session(mongodbSession);
    console.log(dNote);
    if (!dNote) {
      return { message: "Could not get the D note" };
    }
    if (user.role !== "Store Manager") {
      return { message: "Insufficient permisions" };
    }

    const items = dNote.items;

    for (const item of items) {
      await Product.findOneAndUpdate(
        { SKU: item.id },
        { $inc: { "inventory.quantityOnHand": item.quantity, "inventory.quantityAvailable": item.quantity } },
        { session: mongodbSession }
      );
    }
    dNote.shouldBeReturned = false;
    await dNote.save({ session: mongodbSession });
    await mongodbSession.commitTransaction();
  } catch (e) {
    await mongodbSession.abortTransaction();
    console.log(e);
    return { message: "Could not return D note items" };
  }
  mongodbSession.endSession();
  revalidatePath("/dashboard/stocks");
}

