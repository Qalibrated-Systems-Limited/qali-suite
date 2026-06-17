#!/usr/bin/env node
// ============================================
// BANK STATEMENT contentHash INDEX MIGRATION
// ============================================
// Run after merging the bank-feed contentHash fix.
//
// Problem it fixes:
//   The unique index { companyId: 1, contentHash: 1 } was declared `sparse`.
//   A sparse COMPOUND index still indexes a document that has companyId but
//   is missing contentHash — it records the key as { companyId, null }. The
//   import action never computed a hash, so every upload after the first one
//   collided:
//     E11000 dup key { companyId: ..., contentHash: null }
//
// Fix (two parts — code + this migration):
//   - code: importBankStatement now computes a sha256 contentHash.
//   - index: replace the sparse index with a partialFilterExpression that
//     only enforces uniqueness when contentHash is an actual string, so any
//     legacy/hashless rows are excluded from the constraint.
//
// This script drops the old sparse index and creates the partial one. It is
// idempotent — re-runs are safe.
//
// Usage:
//   MONGODB_URI="mongodb://..." node scripts/migrate-bankstatement-contenthash-index.mjs
//
// Optional flags:
//   --dry-run    Print what would change but do not write
// ============================================

import mongoose from "mongoose";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env if MONGODB_URI is not already set in the environment.
if (!process.env.MONGODB_URI) {
  try {
    const envPath = pathResolve(fileURLToPath(import.meta.url), "../../.env");
    const env = readFileSync(envPath, "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env optional
  }
}

const URI = process.env.MONGODB_URI;
if (!URI) {
  console.error("MONGODB_URI not set. Aborting.");
  process.exit(1);
}

const DRY_RUN = new Set(process.argv.slice(2)).has("--dry-run");
const OLD_NAME = "companyId_1_contentHash_1";

console.log(
  `\n=== bankstatements contentHash index migration ${DRY_RUN ? "(DRY RUN)" : "(WRITE MODE)"} ===\n`,
);

await mongoose.connect(URI);
const db = mongoose.connection.db;
const coll = db.collection("bankstatements");

const indexes = await coll.indexes();
const old = indexes.find((i) => i.name === OLD_NAME);

if (old) {
  const isPartial = !!old.partialFilterExpression;
  if (isPartial) {
    console.log(
      `Index "${OLD_NAME}" is already partial — nothing to do.\n`,
      JSON.stringify(old.partialFilterExpression),
    );
  } else {
    console.log(
      `Found legacy index "${OLD_NAME}" (sparse=${!!old.sparse}, unique=${!!old.unique}). Will drop and recreate as partial.`,
    );
    if (!DRY_RUN) {
      await coll.dropIndex(OLD_NAME);
      console.log(`  → dropped "${OLD_NAME}"`);
    }
  }
} else {
  console.log(`No legacy index "${OLD_NAME}" found.`);
}

// Recreate as a partial unique index (idempotent — createIndex is a no-op if
// an identical index already exists).
if (!DRY_RUN) {
  await coll.createIndex(
    { companyId: 1, contentHash: 1 },
    {
      unique: true,
      partialFilterExpression: { contentHash: { $type: "string" } },
      name: OLD_NAME,
    },
  );
  console.log(`  → ensured partial unique index "${OLD_NAME}"`);
}

await mongoose.disconnect();
console.log(`\nDone${DRY_RUN ? " (dry run — no changes written)" : ""}.\n`);
