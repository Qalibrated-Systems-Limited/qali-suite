#!/usr/bin/env node
/**
 * QaliSuite — Company Data Wipe Script (CLI for lib/company-reset.js)
 *
 * Wipes a company's TRANSACTIONAL data while preserving master data:
 * users, company settings, chart of accounts (zeroed), products
 * (quantities zeroed), categories, fiscal periods, HR config. Counters
 * cleared so numbering restarts at 1.
 *
 * Collections are discovered at RUNTIME (everything carrying the
 * companyId except the keep-list) — no hand-list to drift. Every delete
 * is tenant-scoped; the old empty-filter fallback (which could wipe
 * OTHER tenants' collections) is gone.
 *
 * Usage:
 *   node scripts/wipe-company-data.mjs <COMPANY_ID>                  # dry run
 *   node scripts/wipe-company-data.mjs <COMPANY_ID> --confirm        # wipe
 *   node scripts/wipe-company-data.mjs <COMPANY_ID> --confirm --wipe-parties
 *       (ALSO deletes customers/suppliers/employees + employee profiles)
 *
 * Requires MONGODB_URI in .env or .env.local
 * The same engine powers the SuperAdmin danger zone in the UI.
 */

import mongoose from "mongoose";
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";
import { resetCompanyData } from "../lib/company-reset.js";

const envLocal = resolve(process.cwd(), ".env.local");
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envLocal)) config({ path: envLocal });
else if (existsSync(envFile)) config({ path: envFile });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI not found. Add it to .env or .env.local");
  process.exit(1);
}

const DRY_RUN = !process.argv.includes("--confirm");
const WIPE_PARTIES = process.argv.includes("--wipe-parties");
const COMPANY_ID = process.argv
  .slice(2)
  .find((a) => !a.startsWith("-"));

if (!COMPANY_ID || !mongoose.Types.ObjectId.isValid(COMPANY_ID)) {
  console.error("Usage: node scripts/wipe-company-data.mjs <COMPANY_ID> [--confirm] [--wipe-parties]");
  process.exit(1);
}

async function main() {
  console.log("\n============================================");
  console.log("  QaliSuite — Company Data Wipe");
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE — WILL DELETE DATA"}`);
  console.log(`  Parties: ${WIPE_PARTIES ? "WIPED (customers/suppliers/employees)" : "kept (balances zeroed)"}`);
  console.log("============================================\n");

  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  const company = await db
    .collection("companies")
    .findOne({ _id: new mongoose.Types.ObjectId(COMPANY_ID) });
  if (!company) {
    console.error(`Company not found: ${COMPANY_ID}`);
    process.exit(1);
  }
  console.log(`Company: ${company.name} (${company._id})\n`);

  const { summary, totalDeleted } = await resetCompanyData(db, COMPANY_ID, {
    dryRun: DRY_RUN,
    wipeParties: WIPE_PARTIES,
  });

  const verb = DRY_RUN ? "would delete" : "deleted";
  for (const [col, n] of Object.entries(summary).sort()) {
    console.log(`  ${col}: ${verb} ${n}`);
  }
  console.log(`\n  TOTAL: ${verb} ${totalDeleted} documents across ${Object.keys(summary).length} collections`);

  console.log("\n============================================");
  if (DRY_RUN) {
    console.log("  DRY RUN complete. Apply with:");
    console.log(`  node scripts/wipe-company-data.mjs ${COMPANY_ID} --confirm${WIPE_PARTIES ? " --wipe-parties" : ""}`);
  } else {
    console.log("  WIPE COMPLETE — masters kept, balances/stock zeroed, numbering restarts at 1.");
  }
  console.log("============================================\n");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
