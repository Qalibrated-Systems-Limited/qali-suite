import "server-only";

// ============================================
// CHART-OF-ACCOUNTS CODE SUGGESTION
// ============================================
// The app's numbering convention (matches the seeded chart and the
// validation in quickCreateExpenseAccount):
//   1xxx assets · 2xxx liabilities · 3xxx equity · 4xxx revenue
//   5xxx direct costs / COGS · 6xxx operating & other expenses
// Suggestions take the highest existing numeric code in the range and
// step +10 (the seed's spacing), starting at base+100 for an empty range.

export const COA_RANGES = {
  asset: [1000, 1999],
  liability: [2000, 2999],
  equity: [3000, 3999],
  revenue: [4000, 4999],
  direct_cost: [5000, 5999],
  expense: [6000, 6999], // operating & other expenses
};

// Expense subtypes that book to the 5xxx (cost-of-sales) range.
export const DIRECT_COST_SUBTYPES = new Set([
  "cogs",
  "direct_cost",
  "adjustment",
  "inventory_adjustment",
]);

/**
 * Next suggested code within [lo, hi], given existing code strings.
 * Steps +10 from the highest in range; falls back to first free +1 slot
 * when the range tops out.
 */
export function nextCodeInRange(codes, [lo, hi]) {
  const nums = codes
    .map((c) => parseInt(c, 10))
    .filter((n) => Number.isFinite(n) && n >= lo && n <= hi)
    .sort((a, b) => a - b);

  if (nums.length === 0) return String(lo + 100);

  const taken = new Set(nums);
  let candidate = nums[nums.length - 1] + 10;
  if (candidate <= hi) return String(candidate);

  // Range nearly full — find the first gap.
  for (let n = lo + 1; n <= hi; n++) {
    if (!taken.has(n)) return String(n);
  }
  return ""; // truly full; caller leaves the field manual
}

/**
 * Suggestions for every range from one list of account codes.
 * Shape: { asset, liability, equity, revenue, direct_cost, expense }
 */
export function suggestCodes(codes) {
  const out = {};
  for (const [key, range] of Object.entries(COA_RANGES)) {
    out[key] = nextCodeInRange(codes, range);
  }
  return out;
}
