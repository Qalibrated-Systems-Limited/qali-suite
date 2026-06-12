// ============================================
// COMPANY TRANSACTIONAL-DATA RESET — shared engine
// ============================================
// Used by BOTH the SuperAdmin server action (danger zone UI) and
// scripts/wipe-company-data.mjs (CLI with dry-run). One implementation,
// one keep-policy — the previous hand-listed script had drifted (missing
// salesorders/leads/opportunities/notifications/approvals) and carried a
// cross-tenant bug (empty-match fallback deleted OTHER tenants' data).
//
// Strategy: discover collections at runtime and wipe everything carrying
// this companyId EXCEPT the explicit keep-list — new transactional models
// are covered automatically. Counters are cleared by _id prefix so
// numbering restarts. Derived numbers on kept masters are zeroed.
//
// NOTE: plain JS, no "server-only" — must be importable from CLI scripts.

import mongoose from "mongoose";

// Master/config data that survives a reset.
export const RESET_KEEP_COLLECTIONS = new Set([
  "companies",
  "users",
  "invites",
  "accounts", // chart of accounts (balances zeroed)
  "parties", // optional wipe via { wipeParties: true }
  "products", // catalog kept, quantities zeroed
  "categories",
  "employeeprofiles", // HR master (kept unless wipeParties)
  "departments",
  "leavetypes",
  "publicholidays",
  "fiscalperiods",
  "kpis",
  "bridgeconfigs",
  "webhookendpoints",
  "plans",
]);

// Counter collections cleared by `${companyId}-` _id prefix, never by {}.
const COUNTER_COLLECTIONS = ["erpcounters", "counters"];

/**
 * Reset a company's transactional data.
 * @param {import("mongodb").Db} db - connected native db handle
 * @param {string} companyId
 * @param {object} opts
 * @param {boolean} opts.dryRun - count only, delete nothing
 * @param {boolean} opts.wipeParties - ALSO delete customers/suppliers/
 *   employees (parties + employeeprofiles) and clear User.partyId refs
 * @returns {{ summary: Record<string, number>, totalDeleted: number }}
 */
export async function resetCompanyData(db, companyId, opts = {}) {
  const { dryRun = false, wipeParties = false } = opts;
  const oid = new mongoose.Types.ObjectId(companyId);
  const idStr = companyId.toString();
  // companyId is ObjectId in most schemas, string in a few legacy spots.
  const tenantMatch = { companyId: { $in: [oid, idStr] } };

  const keep = new Set(RESET_KEEP_COLLECTIONS);
  if (wipeParties) {
    keep.delete("parties");
    keep.delete("employeeprofiles");
  }

  const collections = (await db.listCollections().toArray()).map((c) => c.name);
  const summary = {};

  for (const name of collections) {
    if (name.startsWith("system.")) continue;

    if (COUNTER_COLLECTIONS.includes(name)) {
      const filter = { _id: { $regex: `^${idStr}-` } };
      const n = dryRun
        ? await db.collection(name).countDocuments(filter)
        : (await db.collection(name).deleteMany(filter)).deletedCount;
      if (n) summary[name] = n;
      continue;
    }

    if (keep.has(name)) continue;

    // ALWAYS tenant-scoped — never fall back to {} (the old script's
    // cross-tenant data-loss bug).
    const n = dryRun
      ? await db.collection(name).countDocuments(tenantMatch)
      : (await db.collection(name).deleteMany(tenantMatch)).deletedCount;
    if (n) summary[name] = n;
  }

  if (!dryRun) {
    // Zero derived numbers on kept masters — their sources are gone.
    await db.collection("accounts").updateMany(tenantMatch, {
      $set: { cachedBalance: 0, balance: 0, balanceUpdatedAt: new Date() },
    });
    await db.collection("products").updateMany(tenantMatch, {
      $set: {
        "inventory.quantityOnHand": 0,
        "inventory.quantityCommitted": 0,
        "inventory.quantityOnHold": 0,
        "inventory.quantityAvailable": 0,
        "lifetimeTotals.totalQuantityPurchased": 0,
        "lifetimeTotals.totalPurchaseValue": 0,
        "lifetimeTotals.totalQuantitySold": 0,
        "lifetimeTotals.totalSalesValue": 0,
      },
    });
    if (wipeParties) {
      await db
        .collection("users")
        .updateMany(tenantMatch, { $unset: { partyId: "" } });
    } else {
      await db.collection("parties").updateMany(tenantMatch, {
        $set: { cachedBalance: 0, balanceUpdatedAt: new Date() },
      });
    }
  }

  const totalDeleted = Object.values(summary).reduce((a, b) => a + b, 0);
  return { summary, totalDeleted };
}
