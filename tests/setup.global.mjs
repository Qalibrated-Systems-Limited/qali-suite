/**
 * Global test setup — runs ONCE per Vitest worker, before any test file.
 *
 * Spawns an in-memory MongoDB REPLICA SET (single node) and exposes its
 * URI via `process.env.MONGODB_URI` so the existing
 * `app/config/dbConnect.js` picks it up unchanged.
 *
 * Why a replica set and not a standalone server: the money paths use
 * multi-document transactions (invoice.complete, payment.confirm,
 * adjustment.approve, lead conversion…), and Mongo only allows
 * transactions on replica sets / mongos — exactly what prod (Atlas) is.
 * A standalone memory server made every transactional test fail with
 * "Transaction numbers are only allowed on a replica set member".
 *
 * Returns a teardown function — Vitest calls it after the last test.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";

let replSet;

export async function setup() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1 }, // single node is enough for transaction support
    binary: {
      // Match a recent prod-style version. Atlas defaults to 7.x; pinning
      // here keeps test behavior deterministic across dev machines.
      // NOTE: the CI cache key in .github/workflows/test.yml embeds this
      // version — bump both together.
      version: "7.0.14",
    },
  });
  process.env.MONGODB_URI = replSet.getUri();
  // Disable the runtime warning some Mongoose plugins emit when no
  // explicit "global cluster" feature is in use.
  process.env.MONGOMS_DISABLE_POSTINSTALL = "1";
}

export async function teardown() {
  if (replSet) {
    await replSet.stop();
    replSet = undefined;
  }
}
