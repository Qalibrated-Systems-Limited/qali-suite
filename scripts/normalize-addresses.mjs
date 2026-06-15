#!/usr/bin/env node
/**
 * One-time cleanup: normalize document-snapshot addresses that were saved
 * as stringified objects (e.g. the literal "{ country: 'Kenya' }") into a
 * clean "line1, city, country" string. Write-time normalization
 * (lib/format-address.js, wired into the snapshot actions) prevents new
 * ones; this fixes the existing rows.
 *
 * Only touches string fields that look like a serialized object — clean
 * strings and proper objects are left alone.
 *
 * Usage:
 *   node scripts/normalize-addresses.mjs             # dry run (default)
 *   node scripts/normalize-addresses.mjs --confirm   # apply
 *
 * Requires MONGODB_URI in .env / .env.local
 */
import mongoose from "mongoose";
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";
import { formatAddress } from "../lib/format-address.js";

const envLocal = resolve(process.cwd(), ".env.local");
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envLocal)) config({ path: envLocal });
else if (existsSync(envFile)) config({ path: envFile });

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI not found. Add it to .env or .env.local");
  process.exit(1);
}

const DRY_RUN = !process.argv.includes("--confirm");

// collection → the dotted snapshot address paths to inspect.
const TARGETS = [
  ["invoices", ["customer.address"]],
  ["quotes", ["customer.address"]],
  ["salesorders", ["customer.address"]],
  ["creditnotes", ["customer.address"]],
  ["bills", ["supplier.address"]],
  ["purchaseorders", ["supplier.address"]],
];

// A string that looks like a serialized object — the only thing we touch.
const looksStringified = (v) =>
  typeof v === "string" && v.trim().startsWith("{") && v.trim().endsWith("}");

function getPath(doc, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), doc);
}

async function main() {
  console.log(`\n  Normalize addresses — ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  let totalFixed = 0;
  for (const [collection, paths] of TARGETS) {
    const exists = await db.listCollections({ name: collection }).hasNext();
    if (!exists) continue;

    let fixed = 0;
    for (const path of paths) {
      const cursor = db
        .collection(collection)
        .find({ [path]: { $regex: "^\\s*\\{.*\\}\\s*$" } }, { projection: { [path]: 1 } });

      for await (const doc of cursor) {
        const raw = getPath(doc, path);
        if (!looksStringified(raw)) continue;
        const clean = formatAddress(raw);
        if (clean === raw) continue; // unparseable — leave it
        fixed++;
        if (!DRY_RUN) {
          await db
            .collection(collection)
            .updateOne({ _id: doc._id }, { $set: { [path]: clean } });
        } else if (fixed <= 3) {
          console.log(`    ${collection}.${path}: ${JSON.stringify(raw)} -> ${JSON.stringify(clean)}`);
        }
      }
    }
    if (fixed) console.log(`  ${collection}: ${DRY_RUN ? "would fix" : "fixed"} ${fixed}`);
    totalFixed += fixed;
  }

  console.log(`\n  TOTAL: ${DRY_RUN ? "would fix" : "fixed"} ${totalFixed}`);
  if (DRY_RUN) console.log("  Re-run with --confirm to apply.\n");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
