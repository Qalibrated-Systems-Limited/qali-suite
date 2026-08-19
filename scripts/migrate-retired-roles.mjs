#!/usr/bin/env node
// ============================================
// RETIRED ROLES MIGRATION (Mongo side of 0039)
// ============================================
// Migration 0039 retired four role values in Postgres and rewrote the rows
// there. Mongo was left holding the old values, and mongoose validates enums on
// SAVE, not on read — so a legacy-role document loads fine and then throws
// "`HR` is not a valid enum value for path `role`" the next time anything saves
// it, including a save that only touched an unrelated field. That breaks the
// Google sign-in avatar update (auth.ts), admin edits and password resets for
// those users, and it makes syncUserToPostgres fail the CHECK silently.
//
// What each retired value becomes, and why (app/models/user.js):
//
//   Technician → Employee     A job title, not a level of authority. It lives
//                             on EmployeeProfile.employment.designation.
//   CEO        → Viewer       Its own comment said "read access, no operational
//                             writes", which is what Viewer means.
//   User       → Employee     The legacy generic, and the old DEFAULT.
//   HR         → HR Manager   Authority, rather than the department someone
//                             sits in — `department` already records that.
//
// Two collections carry a role, both off the same enum: users and invites. A
// pending invite is migrated too, or accepting it would mint a fresh user on a
// value the schema no longer accepts.
//
// Uses the raw driver rather than the models, deliberately: the models are the
// thing rejecting these documents, so writing through them cannot fix them.
//
// Idempotent: re-runs match nothing and report zero.
//
// Usage:
//   node scripts/migrate-retired-roles.mjs [--dry-run] [--tenant=<companyId>]
// ============================================

import mongoose from "mongoose";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

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

// Kept in step with RETIRED_ROLES in app/models/user.js and with the UPDATEs in
// app/db/migrations/0039_roles_are_authority_not_job_title.sql.
const RETIRED_ROLES = {
  Technician: "Employee",
  CEO: "Viewer",
  User: "Employee",
  HR: "HR Manager",
};

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const tenantArg = process.argv.find((a) => a.startsWith("--tenant="));
const tenantId = tenantArg ? tenantArg.split("=")[1] : null;

console.log(
  `\n=== Retired roles migration ${DRY_RUN ? "(DRY RUN)" : "(WRITE MODE)"} ===`,
);
if (tenantId) console.log(`Restricted to companyId=${tenantId}`);

await mongoose.connect(URI);
const db = mongoose.connection.db;

const tenantFilter = tenantId
  ? { companyId: new mongoose.Types.ObjectId(tenantId) }
  : {};

let total = 0;

for (const collection of ["users", "invites"]) {
  console.log(`\n${collection}:`);
  let touched = 0;

  for (const [from, to] of Object.entries(RETIRED_ROLES)) {
    const filter = { ...tenantFilter, role: from };
    const count = await db.collection(collection).countDocuments(filter);
    if (count === 0) continue;

    touched += count;
    if (DRY_RUN) {
      console.log(`  ${from} → ${to}: ${count} document(s) would be rewritten`);
      continue;
    }

    const res = await db
      .collection(collection)
      .updateMany(filter, { $set: { role: to } });
    console.log(`  ${from} → ${to}: ${res.modifiedCount} document(s) rewritten`);
  }

  if (touched === 0) console.log("  nothing to migrate");
  total += touched;
}

// Read the data back rather than trusting the writes — a value outside both the
// retired map and the current enum would pass through here unnoticed otherwise,
// and it is the one thing this script cannot fix on its own.
if (!DRY_RUN) {
  const { userRoles } = await import("../app/models/user.js");
  for (const collection of ["users", "invites"]) {
    const stray = await db
      .collection(collection)
      .aggregate([
        { $match: { ...tenantFilter, role: { $nin: [...userRoles, null] } } },
        { $group: { _id: "$role", n: { $sum: 1 } } },
      ])
      .toArray();
    for (const s of stray) {
      console.log(
        `\n  WARNING: ${collection} still holds ${s.n} document(s) with an ` +
          `unrecognised role "${s._id}" — not in the enum and not a known ` +
          `retired value. These need a decision, not a default.`,
      );
    }
  }
}

await mongoose.disconnect();

console.log(
  `\n${total} document(s) ${DRY_RUN ? "would be" : ""} migrated${
    DRY_RUN ? " (dry run — no changes written)" : ""
  }.`,
);
if (!DRY_RUN && total > 0) {
  console.log(
    "Postgres already holds the new values (0039). Affected logins re-mirror\n" +
      "on their next write via syncUserToPostgres.\n",
  );
}
