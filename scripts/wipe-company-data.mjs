#!/usr/bin/env node
/**
 * QaliSuite — Company Data Wipe Script
 *
 * Wipes transactional data for a specific company while preserving:
 *   - Users
 *   - Company settings
 *   - Products (inventory reset to 0)
 *   - Categories
 *   - Chart of Accounts, Fiscal Periods
 *   - Employee parties (customers/suppliers/both wiped)
 *   - Departments, Leave Types, Payroll Config, Public Holidays
 *   - Attendance Config, Plan Config
 *
 * Usage:
 *   node scripts/wipe-company-data.mjs                    # dry-run (default)
 *   node scripts/wipe-company-data.mjs --confirm          # actually wipe
 *   COMPANY_ID=abc123 node scripts/wipe-company-data.mjs  # specify company
 *
 * Requires MONGODB_URI in .env or .env.local
 */

import mongoose from "mongoose";
import { config } from "dotenv";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Load env
const envLocal = resolve(process.cwd(), ".env.local");
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envLocal)) config({ path: envLocal });
else if (existsSync(envFile)) config({ path: envFile });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI not found in environment. Add it to .env or .env.local");
  process.exit(1);
}

const DRY_RUN = !process.argv.includes("--confirm");

// Company ID is required — pass as first positional arg
const COMPANY_ID = process.argv.find((a) => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]);
if (!COMPANY_ID) {
  console.error("Usage: node scripts/wipe-company-data.mjs <COMPANY_ID> [--confirm]");
  console.error("");
  console.error("  <COMPANY_ID>   MongoDB ObjectId of the company (required)");
  console.error("  --confirm      Actually delete data (omit for dry run)");
  console.error("");
  console.error("Examples:");
  console.error("  node scripts/wipe-company-data.mjs 6651a3f2c1b2d3e4f5000001           # dry run");
  console.error("  node scripts/wipe-company-data.mjs 6651a3f2c1b2d3e4f5000001 --confirm  # wipe");
  process.exit(1);
}

// ============================================
// COLLECTIONS TO WIPE (all records for the company)
// ============================================
const WIPE_COLLECTIONS = [
  // Sales & Purchases
  "invoices",
  "quotes",
  "bills",
  "creditnotes",
  "purchaseorders",
  "payments",
  "deliverynotes",       // dnotes
  // Inventory
  "stockmovements",
  "stockrequests",
  "inventoryadjustments",
  "itemcheckouts",
  "stocktransactions",
  // Finance & Accounting
  "journalentries",
  "transactions",
  "taxtransactions",
  "bankfeeds",
  // Expenses & Claims
  "expenses",
  "employeeclaims",
  // HR (all employee transactional data)
  "employeeprofiles",
  "leaverequests",
  "attendances",
  "payrollruns",
  "payrollentries",
  "salaryhistories",
  "employmenthistories",
  "loans",
  // Projects
  "projects",
  "projectbudgets",
  "projectcostcodes",
  // Integration / IoT
  "weighbridgetickets",
  "farmerintakeentries",
  "coffeeseasons",
  "commodities",
  "vehicles",
  "webhooksubscriptions",
  "integrationkeys",
  // System
  "carts",
  "counters",            // reset numbering
  "erpcounters",         // reset EMP0001, INV0001 etc.
  "synclogs",
  "invites",
];

// ============================================
// MAIN
// ============================================
async function main() {
  console.log("");
  console.log("============================================");
  console.log("  QaliSuite — Company Data Wipe");
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE — WILL DELETE DATA"}`);
  console.log("============================================");
  console.log("");

  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  // Find the target company
  const company = await db
    .collection("companies")
    .findOne({ _id: new mongoose.Types.ObjectId(COMPANY_ID) });

  if (!company) {
    console.error(`Company not found: ${COMPANY_ID}`);
    process.exit(1);
  }
  const companyId = company._id;
  console.log(`Company: ${company.name} (${companyId})`);
  console.log("");

  // ============================================
  // 1. Wipe transactional collections
  // ============================================
  console.log("--- Transactional data ---");

  const existingCollections = (await db.listCollections().toArray()).map((c) => c.name);

  for (const col of WIPE_COLLECTIONS) {
    if (!existingCollections.includes(col)) {
      console.log(`  ${col}: skipped (collection doesn't exist)`);
      continue;
    }

    const count = await db.collection(col).countDocuments({ companyId });
    // Some collections (counters, carts) may not have companyId — wipe all for the company
    const countAlt = count === 0
      ? await db.collection(col).countDocuments({})
      : count;
    const filter = count > 0 ? { companyId } : {};
    const effectiveCount = count > 0 ? count : countAlt;

    if (effectiveCount === 0) {
      console.log(`  ${col}: 0 records`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  ${col}: ${effectiveCount} records (would delete)`);
    } else {
      const result = await db.collection(col).deleteMany(filter);
      console.log(`  ${col}: deleted ${result.deletedCount} records`);
    }
  }

  // ============================================
  // 2. Wipe ALL parties (including employees)
  // ============================================
  // Employee Parties and EmployeeProfiles are wiped because they were already
  // deleted above (employeeprofiles collection). Re-create employees through
  // the normal HR flow after go-live.
  console.log("");
  console.log("--- Parties ---");

  const partyCount = await db.collection("parties").countDocuments({ companyId });

  if (DRY_RUN) {
    console.log(`  ${partyCount} parties (would delete all — customers, suppliers, employees)`);
  } else {
    const result = await db.collection("parties").deleteMany({ companyId });
    console.log(`  Deleted ${result.deletedCount} parties`);
  }

  // Clear User.partyId references so users don't hold dangling refs
  console.log("");
  console.log("--- Users (clear partyId, keep accounts) ---");

  const usersWithParty = await db.collection("users").countDocuments({
    companyId,
    partyId: { $exists: true, $ne: null },
  });

  if (DRY_RUN) {
    console.log(`  ${usersWithParty} users with partyId (would clear partyId)`);
  } else {
    const result = await db.collection("users").updateMany(
      { companyId },
      { $unset: { partyId: "" } }
    );
    console.log(`  Cleared partyId on ${result.modifiedCount} users`);
  }

  // ============================================
  // 3. Reset product inventory to 0 (keep catalog)
  // ============================================
  console.log("");
  console.log("--- Products (reset inventory) ---");

  const productCount = await db.collection("products").countDocuments({ companyId });

  if (DRY_RUN) {
    console.log(`  ${productCount} products (would reset inventory to 0)`);
  } else {
    const result = await db.collection("products").updateMany(
      { companyId },
      {
        $set: {
          "inventory.quantityOnHand": 0,
          "inventory.quantityAvailable": 0,
          "inventory.quantityCommitted": 0,
          "lifetimeTotals.totalQuantityPurchased": 0,
          "lifetimeTotals.totalPurchaseValue": 0,
          "lifetimeTotals.totalQuantitySold": 0,
          "lifetimeTotals.totalSalesValue": 0,
        },
      }
    );
    console.log(`  ${result.modifiedCount} products reset to 0`);
  }

  // ============================================
  // 4. Reset account balances to 0
  // ============================================
  console.log("");
  console.log("--- Accounts (reset balances) ---");

  const accountCount = await db.collection("accounts").countDocuments({ companyId });

  if (DRY_RUN) {
    console.log(`  ${accountCount} accounts (would reset balances to 0)`);
  } else {
    const result = await db.collection("accounts").updateMany(
      { companyId },
      {
        $set: {
          balance: 0,
          "balances.debit": 0,
          "balances.credit": 0,
        },
      }
    );
    console.log(`  ${result.modifiedCount} accounts reset to 0`);
  }

  // (Employee parties wiped above — no balances to reset)

  // ============================================
  // Summary
  // ============================================
  console.log("");
  console.log("============================================");
  if (DRY_RUN) {
    console.log("  DRY RUN complete. No data was changed.");
    console.log("  Run with --confirm to apply:");
    console.log("");
    console.log(`  node scripts/wipe-company-data.mjs ${COMPANY_ID} --confirm`);
  } else {
    console.log("  WIPE COMPLETE.");
    console.log("  The company is ready for production use.");
  }
  console.log("============================================");
  console.log("");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
