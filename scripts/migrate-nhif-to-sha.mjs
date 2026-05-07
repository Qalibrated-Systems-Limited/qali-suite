#!/usr/bin/env node
// ============================================
// NHIF → SHA / SHIF MIGRATION
// ============================================
// Run after merging the NHIF-rename code (Oct 2024 Kenya statutory change).
// Idempotent: re-runs are safe.
//
//   1. EmployeeProfile.personalInfo.nhifNumber → personalInfo.shaNumber
//   2. Account.systemAccount "nhif_payable" → "shif_payable"
//      + accountName "NHIF Payable" → "SHIF Payable"
//   3. (Reports counts, does NOT alter) any TaxTransaction docs with
//      taxType "nhif" — these are historical and stay; the enum still
//      includes "nhif" for legacy validation.
//
// Usage:
//   MONGODB_URI="mongodb://..." node scripts/migrate-nhif-to-sha.mjs
//
// Optional flags:
//   --dry-run    Print counts but do not write
//   --tenant=<companyId>   Restrict to one company
// ============================================

import mongoose from "mongoose";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env if MONGODB_URI is not already set in the environment.
if (!process.env.MONGODB_URI) {
  try {
    const envPath = pathResolve(
      fileURLToPath(import.meta.url),
      "../../.env",
    );
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

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const tenantArg = process.argv.find((a) => a.startsWith("--tenant="));
const tenantId = tenantArg ? tenantArg.split("=")[1] : null;

console.log(
  `\n=== NHIF → SHA / SHIF migration ${DRY_RUN ? "(DRY RUN)" : "(WRITE MODE)"} ===`,
);
if (tenantId) console.log(`Restricted to companyId=${tenantId}\n`);

await mongoose.connect(URI);
const db = mongoose.connection.db;

const tenantFilter = tenantId
  ? { companyId: new mongoose.Types.ObjectId(tenantId) }
  : {};

// ──────────────────────────────────────────
// 1. EmployeeProfile.personalInfo.nhifNumber → shaNumber
// ──────────────────────────────────────────
{
  const filter = {
    ...tenantFilter,
    "personalInfo.nhifNumber": { $exists: true },
  };
  const count = await db.collection("employeeprofiles").countDocuments(filter);
  console.log(`EmployeeProfile docs with legacy nhifNumber: ${count}`);

  if (!DRY_RUN && count > 0) {
    const result = await db.collection("employeeprofiles").updateMany(filter, [
      {
        $set: {
          "personalInfo.shaNumber": {
            $ifNull: [
              "$personalInfo.shaNumber",
              "$personalInfo.nhifNumber",
            ],
          },
        },
      },
      { $unset: "personalInfo.nhifNumber" },
    ]);
    console.log(`  → migrated ${result.modifiedCount} profile(s)`);
  }
}

// ──────────────────────────────────────────
// 2. Account.systemAccount nhif_payable → shif_payable
// ──────────────────────────────────────────
{
  const filter = { ...tenantFilter, systemAccount: "nhif_payable" };
  const count = await db.collection("accounts").countDocuments(filter);
  console.log(`Account docs with systemAccount=nhif_payable: ${count}`);

  if (!DRY_RUN && count > 0) {
    const result = await db.collection("accounts").updateMany(filter, {
      $set: {
        systemAccount: "shif_payable",
        accountName: "SHIF Payable",
      },
    });
    console.log(`  → migrated ${result.modifiedCount} account(s)`);
  }
}

// ──────────────────────────────────────────
// 3. TaxTransaction docs with legacy taxType=nhif (REPORT ONLY)
// ──────────────────────────────────────────
{
  const filter = { ...tenantFilter, taxType: "nhif" };
  const count = await db.collection("taxtransactions").countDocuments(filter);
  if (count > 0) {
    console.log(
      `TaxTransaction docs with legacy taxType="nhif": ${count} (kept as-is — historical)`,
    );
  }
}

await mongoose.disconnect();

console.log(`\nDone${DRY_RUN ? " (dry run — no changes written)" : ""}.`);
console.log(
  "Once migrated cleanly, you can also remove the back-compat fallbacks:\n" +
    "  - lib/utils.js: legacy entry \"nhif_payable\" in systemAccount enum\n" +
    "  - app/mongodb/queries/hr-queries.js: shaNumber || nhifNumber fallbacks\n" +
    "  - app/api/hr/payroll/[id]/shif-export/route.js: same fallbacks\n",
);
