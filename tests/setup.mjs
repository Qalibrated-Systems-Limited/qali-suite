/**
 * Per-test-file setup — runs before each test file.
 *
 * - Connects Mongoose to the in-memory cluster booted in setup.global.mjs
 *   (idempotent — first test file pays the connect cost, subsequent ones
 *   reuse the same connection).
 * - Truncates every collection between tests so each test starts from a
 *   known empty DB. This is faster than dropping/recreating the DB and
 *   preserves model registrations + indexes.
 * - Closes the connection in `afterAll` so the Vitest worker exits cleanly.
 *
 * Tests should NEVER call `dbConnect()` themselves before doing work —
 * the connection is already up by the time the test body runs.
 */
import { beforeAll, afterEach, afterAll } from "vitest";
import mongoose from "mongoose";

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI, {
      // Same opts as production dbConnect, minus the timeouts that
      // matter only for cold-start serverless.
      maxPoolSize: 5,
      family: 4,
      bufferCommands: true,
    });
  }
});

afterEach(async () => {
  // Truncate all collections. Faster than dropDatabase() because it
  // doesn't drop indexes / model metadata.
  const collections = mongoose.connection.collections;
  await Promise.all(
    Object.values(collections).map((c) => c.deleteMany({})),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
});
