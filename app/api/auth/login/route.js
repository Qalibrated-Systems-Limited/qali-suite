import dbConnect from "../../../config/dbConnect";
import BridgeConfig from "../../../models/bridgeConfigs";
import User from "../../../models/user";
import {
  authErrorResponse,
  clientSideErrorResponse,
  failedResponse,
  okResponse,
} from "../../../utils/customres";
import { errorHandlers } from "../../../utils/errorHandler";
import jsonwebtoken from "jsonwebtoken";

export async function POST(req) {
  console.log("ok");
  const { email, password } = await req.json();

  try {
    dbConnect();

    const user = await User.findOne({ email: email }).select("+password");

    if (!user) {
      return clientSideErrorResponse("Wrong email or password");
    }

    const isEqual = await user.comparePassword(password);
    if (!isEqual) {
      return clientSideErrorResponse("Wrong email or password");
    }
    const token = jsonwebtoken.sign(
      {
        email: user.email,
        role: user.role,

        userId: user._id.toString(),
        userName: user.name,
      },
      process.env.JWT_KEY,
      { expiresIn: "12h" }
    );

    const result = {
      token: token,

      userId: user._id,
      userName: user.name,
      role: user.role,
      email: user.email,
    };

    return okResponse(result);
  } catch (e) {
    return errorHandlers(e);
  }
}
