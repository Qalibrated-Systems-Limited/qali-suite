import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import User from "../../models/user";
import { authErrorResponse, okResponse } from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";

//Get admin users

export async function GET(req) {
  isAuth(req);

  if (req.role !== "Admin") {
    return authErrorResponse("Not allowed");
  }
  const matchStage = {
    $match: {
      status: "Active",
    },
  };

  const projectStage = {
    $project: {
      name: 1,
      email: 1,
      role: 1,
    },
  };

  const pipeline = [matchStage, projectStage];
  try {
    dbConnect();

    const users = await User.aggregate(pipeline);

    if (users) {
      return okResponse(users);
    }
  } catch (e) {
    return errorHandlers(e);
  }
}
