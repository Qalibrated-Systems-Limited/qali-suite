/**
 * Global test setup — runs ONCE per Vitest worker, before any test file.
 *
 * Spawns an in-memory MongoDB instance (downloads the binary on first
 * run, then caches it under `node_modules/.cache/mongodb-memory-server`)
 * and exposes its URI via `process.env.MONGODB_URI` so the existing
 * `app/config/dbConnect.js` picks it up unchanged.
 *
 * Returns a teardown function — Vitest calls it after the last test.
 */
import { MongoMemoryServer } from "mongodb-memory-server";

let server;

export async function setup() {
  server = await MongoMemoryServer.create({
    binary: {
      // Match a recent prod-style version. Atlas defaults to 7.x; pinning
      // here keeps test behavior deterministic across dev machines.
      version: "7.0.14",
    },
  });
  process.env.MONGODB_URI = server.getUri();
  // Disable the runtime warning some Mongoose plugins emit when no
  // explicit "global cluster" feature is in use.
  process.env.MONGOMS_DISABLE_POSTINSTALL = "1";
}

export async function teardown() {
  if (server) {
    await server.stop();
    server = undefined;
  }
}
