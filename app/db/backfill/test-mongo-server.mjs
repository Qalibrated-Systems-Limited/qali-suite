/**
 * Dev helper: starts a throwaway in-memory MongoDB and prints its URI, so the
 * backfill and reconciliation can be exercised without pointing at a real
 * tenant. Leave it running in one terminal; Ctrl-C to stop.
 *
 *   node app/db/backfill/test-mongo-server.mjs
 */
import { MongoMemoryServer } from "mongodb-memory-server";

const mongod = await MongoMemoryServer.create({ binary: { version: "7.0.14" } });
console.log(`${mongod.getUri()}stockvault`);
process.stdin.resume();
