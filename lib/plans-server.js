import "server-only";
import dbConnect from "@/app/config/dbConnect";
import PlanConfig from "@/app/models/PlanConfig";
import { setPlanCache, DEFAULT_PLANS } from "@/lib/plans";

// ============================================
// SERVER-ONLY PLAN OPERATIONS
// ============================================
// This file imports mongoose — never import from client components.
// Use plans.js for client-safe helpers.
// ============================================

let _lastLoaded = 0;
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Load plans from DB into the shared cache.
 * Safe to call multiple times — respects TTL.
 */
export async function warmPlanCache() {
  const now = Date.now();
  if (now - _lastLoaded < CACHE_TTL) return;

  try {
    await dbConnect();
    const dbPlans = await PlanConfig.find({ isActive: true })
      .sort({ sortOrder: 1 })
      .lean();

    if (dbPlans.length > 0) {
      setPlanCache(JSON.parse(JSON.stringify(dbPlans)));
    }
    _lastLoaded = now;
  } catch {
    // DB unavailable — plans.js uses DEFAULT_PLANS as fallback
  }
}

/**
 * Seed default plans into DB if none exist.
 */
export async function seedDefaultPlans() {
  try {
    await dbConnect();

    const existing = await PlanConfig.countDocuments();
    if (existing > 0) return { seeded: false, message: "Plans already exist" };

    await PlanConfig.insertMany(DEFAULT_PLANS);
    _lastLoaded = 0; // force refresh
    await warmPlanCache();
    return { seeded: true, message: `Seeded ${DEFAULT_PLANS.length} default plans` };
  } catch (error) {
    return { seeded: false, message: error.message };
  }
}

/**
 * Force cache invalidation. Call after editing plan configs.
 */
export function invalidatePlanCache() {
  _lastLoaded = 0;
  setPlanCache(null);
}

/**
 * Get all plan configs from DB (for admin pages).
 */
export async function getAllPlanConfigs() {
  await dbConnect();
  const plans = await PlanConfig.find().sort({ sortOrder: 1 }).lean();
  return JSON.parse(JSON.stringify(plans));
}
