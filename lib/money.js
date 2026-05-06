// ============================================
// MONEY UTILITIES
// ============================================
// Single source of truth for currency arithmetic. JS floats lose
// precision on multiplication and division (`0.1 + 0.2 !== 0.3`),
// which silently drifts invoice / bill totals when accumulated across
// dozens of lines. Always round to 2 decimal places at *line-total*
// granularity — sums of already-rounded line totals are themselves
// 2dp-clean, so no further rounding needed at the document level.

/**
 * Round a value to 2 decimal places. Returns 0 for non-finite input.
 *
 * Industry standard for two-step calculations:
 *   1. Compute each line's tax / discount / total.
 *   2. roundCurrency() each line.
 *   3. Sum the rounded line totals — the result is exact.
 */
export function roundCurrency(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  // The Math.round(x * 100) / 100 form is the standard, robust approach
  // for KES (and most fiat currencies — 2dp). It tolerates negatives and
  // matches what every accounting engine expects.
  return Math.round(v * 100) / 100;
}

/**
 * Sum an array of currency values, rounding the result.
 *
 * The inputs are typically already rounded line totals — but accept
 * unrounded inputs and round defensively anyway. Cheap insurance.
 */
export function sumCurrency(values) {
  const total = (values || []).reduce(
    (s, v) => s + (Number.isFinite(Number(v)) ? Number(v) : 0),
    0,
  );
  return roundCurrency(total);
}

/**
 * Apply a percentage rate to a value and round.
 *   applyRate(100.50, 16) → 16.08   (16% VAT on a 100.50 line)
 *
 * Avoids the (a * b) / 100 → ugly-float pattern scattered across the
 * codebase.
 */
export function applyRate(value, ratePercent) {
  return roundCurrency((Number(value) || 0) * ((Number(ratePercent) || 0) / 100));
}
