"use server";
import { renderToFile } from "@react-pdf/renderer";

import {
  validateAccount,
  validateInvoice,
  validateInvoiceItem,
  validateInvoiceUpdate,
  validateNewUser,
  validateSettings,
  ValidateStock,
  validateUpdateAccount,
  validateUpdateUser,
} from "./validators";
import { AuthError } from "next-auth";
import { signIn, signOut } from "../../auth";
import Account from "../models/account";
import { auth } from "../../auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import User from "../models/user";
import BridgeConfig from "../models/bridgeConfigs";
import { toTitle } from "../utils/validators";
import Product from "../models/product";
import { Delius_Unicase } from "next/font/google";
import Invoice from "../models/invoice";
import Counter from "../models/counter";
import StockTransaction from "../models/stockTransaction";
import { number } from "zod";
import { ST } from "next/dist/shared/lib/utils";

export async function logout(params) {
  return await signOut();
}
export async function authenticate(prevState, formData) {
  try {
    await signIn("credentials", formData);
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
  try {
    const sesssion = await auth();
    const user = sesssion && sesssion.user;
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

export async function addStock(state, formData) {
  try {
    const sesssion = await auth();
    const user = sesssion && sesssion.user;
    const rawFormData = Object.fromEntries(formData.entries());

    const validatedFields = ValidateStock(rawFormData);

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: "Missing Fields. Failed to add stock.",
      };
    }

    const data = validatedFields.data;

    const result = await Product.create({
      name: toTitle(data.name),
      price: data.price,
      SKU: data.SKU,
      description: data.description,
      category: data.category,
      stock: data.stock,
    });

    const amount = Number(data.stock) * Number(data.price);

    if (result) {
      await StockTransaction.create({
        SKU: data.SKU,
        amount: amount,
        transactionType: "Purchase",
        quantity: data.stock,
      });
    }
  } catch (e) {
    console.log(e);
    return { message: "Database error: failed to add stock" };
  }
  revalidatePath("/dashboard/stocks");
  redirect("/dashboard/stocks");
}

export async function updateAccount(id, prevState, formData) {
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

export async function updateStock(id, prevState, formData) {
  const rawFormData = Object.fromEntries(formData.entries());
  const validatedFields = ValidateStock(rawFormData);
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing Fields. Failed to update stock.",
    };
  }

  try {
    const product = await Product.findById(id);
    const oldStock = product.stock;
    if (product) {
      product.name = toTitle(validatedFields.data.name);
      product.SKU = validatedFields.data.SKU;
      product.price = validatedFields.data.price;
      product.stock = validatedFields.data.stock;
      product.category = validatedFields.data.category;
      product.description = validatedFields.data.description;
      const result = await product.save();
      if (result) {
        const addedProducts = Number(validatedFields.data.stock) - oldStock;
        if (addedProducts > 0) {
          const amount = Number(validatedFields.data.price) * addedProducts;
          await StockTransaction.create({
            SKU: validatedFields.data.SKU,
            amount: amount,
            transactionType: "Purchase",
            quantity: addedProducts,
          });
        }
      }
    }
  } catch (e) {
    return { message: "Database Error: Failed to Update stock." };
  }
  revalidatePath("/dashboard/stocks");
  redirect("/dashboard/stocks");
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
  try {
    const sesssion = await auth();
    const user = sesssion && sesssion.user;
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

    const account = await Account.findById(data.customerId);
    let invoiceNumber = "1";

    if (!account) {
      return { message: "No customer was found" };
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // e.g., 20241031
    const counter = await Counter.findOneAndUpdate(
      { name: `invoiceNumber-${today}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    invoiceNumber = `INV-${today}-${counter.seq.toString().padStart(4, "0")}`; // e.g., 20241031-0001
    const customer = {
      name: account.name,
      address: account.address,

      id: account._id.toString(),
      email: account.email,
      phone: account.phone,
    };
    const invoice = Invoice({
      description: data.description,
      taxRate: data.taxRate,
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
  const rawFormData = Object.fromEntries(formData.entries());

  const validatedFields = validateInvoiceUpdate(rawFormData);

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing Fields. Failed to add invoices.",
    };
  }

  const data = validatedFields.data;
  try {
    const account = await Account.findById(data.customerId);

    if (!account) {
      return { message: "No customer was found" };
    }

    const customer = {
      name: account.name,
      address: account.address,

      id: account._id.toString(),
      email: account.email,
      phone: account.phone,
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
          { $inc: { stock: deletedItem.quantity } }
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
