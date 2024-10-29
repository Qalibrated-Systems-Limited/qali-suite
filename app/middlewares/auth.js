import jwt from "jsonwebtoken";
import { headers } from "next/headers";

import ErrorHandler from "../utils/errorHandler";

export const isAdmin = (req, res, next) => {
  if (req.isAdmin) {
    next();
  } else {
    const error = new ErrorHandler(
      "Not permitted to carry out this operation",
      403
    );

    return next(error);
  }
};
export const isAfarmer = (req, res, next) => {
  if (req.isAfarmer) {
    next();
  } else {
    const error = new ErrorHandler(
      "Not permitted to carry out this operation",
      403
    );

    return next(error);
  }
};
export const isSuperAdmin = (req, res, next) => {
  if (req.isSuperAdmin) {
    return next();
  }
  const error = new ErrorHandler(
    "Not permitted to carry out this operation",
    403
  );

  return next(error);
};

export const isCoopHead = (req, res, next) => {
  if (req.isCoopHead || req.isSuperAdmin) {
    return next();
  }
  const error = new ErrorHandler(
    "Not permitted to carry out this operation",
    403
  );

  return next(error);
};

export const isOperator = (req, res, next) => {
  if (req.isOperator || req.isSuperAdmin || req.isCoopHead) {
    next();
  } else {
    const error = new ErrorHandler(
      "Not permitted to carry out this operation",
      403
    );

    return next(error);
  }
};

const isAuth = async (req) => {
  const authHeader = (await headers()).get("authorization");

  if (!authHeader) {
    req.isAuth = false;
    return new Response(JSON.stringify({ message: "Not authenticated" }), {
      status: 403,
    });
  }
  const token = authHeader.split(" ")[1];
  let decodedToken;
  try {
    decodedToken = jwt.verify(token, "SFGGDGDG788DFF244255TYY_90");
  } catch (err) {
    console.log(err);
    req.isAuth = false;
    return new Response(
      JSON.stringify({
        message: "An error ocurred while veryfying your details",
      }),
      { status: 500 }
    );
  }

  if (!decodedToken) {
    req.isAuth = false;
    return new Response(
      JSON.stringify({
        message: "An error ocurred while veryfying your details",
      }),
      { status: 500 }
    );
  }

  req.role = decodedToken.role;
  req.userId = decodedToken.userId;
  req.userName = decodedToken.userName;
  req.email = decodedToken.email;

  req.isAuth = true;

  return req;
};

const isFarmer = (req, res, next) => {
  const authHeader = req.headers.authorization;

  console.log(authHeader);

  if (!authHeader) {
    req.isAuth = false;
    const error = new Error("Not authenticated");
    error.statusCode = 403;
    return next(error);
  }
  const token = authHeader.split(" ")[1];

  let decodedToken;
  try {
    decodedToken = jwt.verify(token, "supersecretsssecrrtt");
  } catch (err) {
    req.isAuth = false;
    const error = new Error("Error occurred while verying your details");
    error.statusCode = 403;
    return next(error);
  }

  if (!decodedToken) {
    req.isAuth = false;
    const error = new Error("Error occurred while verying your details");
    error.statusCode = 403;
    return next(error);
  }

  if (decodedToken.role === "Farmer") {
    req.role = decodedToken.role;
    req.userId = decodedToken.userId;
    req.userName = decodedToken.userName;
    req.seasonName = decodedToken.seasonName;
    req.farmerNumber = decodedToken.number;
    req.branchCode = decodedToken.branchCode;
    req.branchName = decodedToken.branchName;
    req.societyName = decodedToken.societyName;
    req.societyCode = decodedToken.societyCode;

    return next();
  }
};

export { isAuth, isFarmer };
