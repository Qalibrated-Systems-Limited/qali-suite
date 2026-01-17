import mongoose from "mongoose";

const dbConnect = async () => {
  // Check if already connected
  if (mongoose.connection.readyState >= 1) {
    return;
  }

  // Validate environment variable
  // if (!process.env.DB_LOCAL_URI) {
  //   throw new Error("DB_LOCAL_URI environment variable is not defined");
  // }

  try {
    await mongoose.connect(process.env.DB_LOCAL_URI, {
      // Connection pool configuration for production
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4, // Use IPv4
    });

    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    throw error;
  }
};

export default dbConnect;
export { dbConnect };
