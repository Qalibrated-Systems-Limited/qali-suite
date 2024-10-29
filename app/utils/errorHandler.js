class ErrorHandler extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

export default ErrorHandler;

// Error handling middleware
export const errorHandlers = (err) => {
  // Mongoose validation error
  console.log(err.name, err.message, "name");

  if (err.name === "ValidationError") {
    const errors = {};
    for (let field in err.errors) {
      errors[field] = err.errors[field].message;
    }

    const errorsWithMessage = {
      ...errors,
      message: "Validation errors! Some required fields are missing",
    };
    return new Response(JSON.stringify(errorsWithMessage), { status: 400 });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    const message = `Duplicate ${field}`;
    return new Response(JSON.stringify({ message }), { status: 409 });
  }

  // Generic error
  return new Response(JSON.stringify({ message: "An error ocurred" }), {
    status: 500,
  });
};
