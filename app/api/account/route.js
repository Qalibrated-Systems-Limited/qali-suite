import { isAuth } from "../../middlewares/auth";
import dbConnect from "../../config/dbConnect";
import Account from "../../models/account";
import { authErrorResponse, okResponse } from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";
import { toTitle } from "../../utils/validators";

export async function POST(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    await dbConnect();
    const creator = { id: req.userId, name: req.userName };
    const { name, nationalId, phoneNumber, address, email, accountType } =
      await req.json();

    const account = new Account({
      name: toTitle(name),
      nationalId,
      phoneNumber,
      address,
      email,
      accountType,
      creator,
    });

    const result = await account.save();
    return result ? okResponse(result) : errorHandlers(new Error("Failed to create"));
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function PUT(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    await dbConnect();
    const { name, nationalId, phoneNumber, address, email, accountType, accountId } =
      await req.json();

    const result = await Account.findByIdAndUpdate(accountId, {
      name: toTitle(name),
      nationalId,
      phoneNumber,
      address,
      email,
      accountType,
    });

    return result ? okResponse(result) : errorHandlers(new Error("Not found"));
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function DELETE(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    await dbConnect();
    const { accountId } = await req.json();
    const result = await Account.findByIdAndDelete(accountId);
    return result ? okResponse(result) : errorHandlers(new Error("Not found"));
  } catch (e) {
    return errorHandlers(e);
  }
}
