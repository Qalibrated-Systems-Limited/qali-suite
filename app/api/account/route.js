import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import Account from "../../models/account";
import { authErrorResponse, okResponse } from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";
import { toTitle } from "../../utils/validators";

export async function POST(req) {
  isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    dbConnect();

    const creator = { id: req.userId, name: req.userName };
    const { name, nationalId, phoneNumber, address, email, accountType } =
      await req.json();
    const modName = toTitle(name);

    const account = new Account({
      name: modName,
      nationalId,
      phoneNumber,
      address,
      email,
      accountType,
      creator,
    });

    const result = await account.save();

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function PUT(req) {
  isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    dbConnect();

    const creator = { id: req.userId, name: req.userName };
    const {
      name,
      nationalId,
      phoneNumber,
      address,
      email,
      accountType,
      accountId,
    } = await req.json();

    const modName = toTitle(name);

    const result = await Account.findByIdAndUpdate(accountId, {
      name: modName,
      nationalId,
      phoneNumber,
      address,
      email,
      accountType,
      creator,
    });

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function DELETE(req) {
  isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    dbConnect();

    const { accountId } = await req.json();

    const result = await Account.findByIdAndDelete(accountId);

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
}
