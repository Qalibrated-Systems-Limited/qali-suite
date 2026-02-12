import mongoose from "mongoose";

const dbConnect = async () => {
  // Check if already connected
  if (mongoose.connection.readyState >= 1) {
    return;
  }

  // Validate environment variable
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI environment variable is not defined. " +
        "Please add it to your .env.local file."
    );
  }

  try {
    await mongoose.connect(uri, {
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
