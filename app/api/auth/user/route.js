import dbConnect from "../../../config/dbConnect";
import { isAuth } from "../../../middlewares/auth";
import User from "../../../models/user";
import {
  clientSideErrorResponse,
  okResponse,
  failedResponse,
  authErrorResponse,
} from "../../../utils/customres";

import { errorHandlers } from "../../../utils/errorHandler";
import { toTitle, validateEmail } from "../../../utils/validators";

export async function POST(req) {
  isAuth(req);

  if (req.role !== "Admin") {
    return authErrorResponse("Not allowed");
  }
  const { name, email, password, role } = await req.json();

  let modName = toTitle(name);
  const emailIsValid = validateEmail(email);
  if (!emailIsValid) {
    return new Response(
      JSON.stringify({ message: "Provide a valid email address" }),
      { status: 422 }
    );
  }

  const creator = { name: req.userName, id: req.userId };

  try {
    dbConnect();

    const user = await User.findByEmail(email);

    if (user) {
      return clientSideErrorResponse("User with that email already exist");
    }

    const result = await User.insertUser(
      modName,
      email,
      password,
      creator,
      role
    );

    if (result) {
      return okResponse(result);
    } else {
      return failedResponse();
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function PUT(req) {
  isAuth(req);

  if (req.role !== "Admin") {
    return authErrorResponse("Not allowed");
  }
  const { role, name, email } = await req.json();
  const modName = toTitle(name);

  try {
    dbConnect();
    const result = await User.findOneAndUpdate(
      { email },
      { name: modName, role }
    );

    if (result) {
      return okResponse(result);
    }

    return failedResponse();
  } catch (e) {
    console.log(e);
    return errorHandlers(e);
  }
}

export async function PATCH(req) {
  isAuth(req);

  if (req.role !== "Admin") {
    return authErrorResponse("Not allowed");
  }
  const { password } = await req.json();

  try {
    dbConnect();
    const result = await User.findOneAndUpdate({ email }, { password });

    if (result) {
      return okResponse(result);
    }

    return failedResponse();
  } catch (e) {
    console.log(e);
    return errorHandlers(e);
  }
}

//Get admin users
