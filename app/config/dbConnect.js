import mongoose from "mongoose";

// Global cache for serverless environments (Vercel)
// This prevents multiple connections during hot reloads and across invocations
const globalWithMongo = global;

if (!globalWithMongo.mongoose) {
  globalWithMongo.mongoose = { conn: null, promise: null };
}

const cached = globalWithMongo.mongoose;

const dbConnect = async () => {
  // Return cached connection if available
  if (cached.conn && mongoose.connection.readyState >= 1) {
    return cached.conn;
  }

  // Validate environment variable
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI environment variable is not defined. " +
        "Please add it to your .env.local file.",
    );
  }

  // If connection is in progress, wait for it
  if (!cached.promise) {
    const opts = {
      // Optimized for serverless (Vercel Hobby plan - 10s timeout)
      maxPoolSize: 5,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
      connectTimeoutMS: 5000,
      family: 4, // Use IPv4
      bufferCommands: true, // Buffer commands until connection is ready
      // Index management. Defaults ON (keeps dev/preview indexes in sync as
      // schemas evolve). In production set MONGO_AUTOINDEX=false to avoid the
      // boot-time index-build storm across the ~250 schema indexes, and build
      // them out-of-band instead (e.g. `node scripts/sync-indexes.mjs` at
      // deploy time, or mongosh createIndex). Disabling without a build step
      // means new indexes won't exist — so only flip it once that step runs.
      autoIndex: process.env.MONGO_AUTOINDEX !== "false",
    };

    cached.promise = mongoose.connect(uri, opts).then((mongoose) => {
      console.log("MongoDB connected successfully");
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    // Reset promise on failure so next call can retry
    cached.promise = null;
    console.error("MongoDB connection error:", error.message);
    throw error;
  }

  return cached.conn;
};

export default dbConnect;
export { dbConnect };
