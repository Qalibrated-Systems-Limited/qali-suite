"use server";

import {
  validateAccount,
  validateNewUser,
  validateSettings,
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

const sesssion = await auth();
const user = sesssion && sesssion.user;

export async function logout(params) {
  await signOut();
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
    const rawFormData = Object.fromEntries(formData.entries());

    const validatedFields = validateAccount(rawFormData);

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: "Missing Fields. Failed to Create Account.",
      };
    }

    await Account.create({
      name: toTitle(validatedFields.data.name),
      accountType: validatedFields.data.accountType,
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
  const rawFormData = Object.fromEntries(formData.entries());
  const validatedFields = validateUpdateAccount(rawFormData);
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing Fields. Failed to Create User.",
    };
  }

  try {
    await Account.updateOne(
      { _id: id },
      {
        $set: {
          name: toTitle(validatedFields.data.name),
          status: validatedFields.data.status,
          accountType: validatedFields.data.accountType,
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
  try {
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
