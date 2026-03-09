import jwt from "jsonwebtoken";
import { headers } from "next/headers";

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
    decodedToken = jwt.verify(token, process.env.JWT_KEY);
  } catch (err) {
    req.isAuth = false;
    return new Response(
      JSON.stringify({
        message: "An error occurred while verifying your details",
      }),
      { status: 500 }
    );
  }

  if (!decodedToken) {
    req.isAuth = false;
    return new Response(
      JSON.stringify({
        message: "An error occurred while verifying your details",
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

export { isAuth };
