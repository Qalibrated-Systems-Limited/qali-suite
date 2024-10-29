import ErrorHandler from "../utils/errorHandler";
const errors = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  let error = { ...err };
  error.message = err.message;
  //Wrong Mongoose Object ID error
  if (err.name === "CastError") {
    const message = `Resources not found invalid : ${err.path} `;
    error = new ErrorHandler(message, 400);
  }

  //Hanling mongoose Validation error
  if (err.name === "ValidationError") {
    const messege = Object.values(err.errors).map((value) => value.message);
    error = new ErrorHandler(messege, 400);
  }

  res.status(err.statusCode).json({
    success: false,
    error,
    message: error.message,
    stack: error.stack,
  });
};

export default errors;
