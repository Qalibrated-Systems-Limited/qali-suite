/**
 * Why a nonconformance was raised. Mirrors `nonconformances_reason_valid`.
 * Shared by the raise form, the detail page, the supplier notice and reports.
 */
export const NCR_REASONS = Object.freeze([
  { value: "short_delivery", label: "Short delivery", hint: "Fewer received than ordered or invoiced", supplier: true },
  { value: "over_delivery", label: "Over delivery", hint: "More received than ordered", supplier: true },
  { value: "wrong_item", label: "Wrong item or specification", hint: "Not what was ordered", supplier: true },
  { value: "damaged_in_transit", label: "Damaged in transit", hint: "Goods arrived broken or defective", supplier: true },
  { value: "packaging_damaged", label: "Packaging damaged", hint: "Goods may be fine, packaging is not", supplier: true },
  { value: "expired_or_short_dated", label: "Expired or short-dated", hint: "Past or near its expiry", supplier: true },
  { value: "quality_failure", label: "Failed quality check", hint: "Does not meet the specification or test", supplier: true },
  { value: "missing_documents", label: "Missing documents or certificates", hint: "No delivery note, CoC or calibration certificate", supplier: true },
  { value: "count_shortage", label: "Stock count shortage", hint: "Fewer on the shelf than the book says", supplier: false },
  { value: "count_surplus", label: "Stock count surplus", hint: "More on the shelf than the book says", supplier: false },
  { value: "deterioration_in_store", label: "Deteriorated in store", hint: "Spoiled, rusted or aged while held", supplier: false },
  { value: "tool_damage", label: "Tool or equipment damage", hint: "Returned damaged or not working", supplier: false },
  { value: "other", label: "Other", hint: "Describe it in full", supplier: false },
]);

export const NCR_REASON_VALUES = NCR_REASONS.map((r) => r.value);

export const ncrReasonLabel = (value) => NCR_REASONS.find((r) => r.value === value)?.label ?? "Other";

/** The category the existing workflow keys on, from the reason. */
export const categoryForReason = (value) =>
  ({
    short_delivery: "received_qty_variance",
    over_delivery: "received_qty_variance",
    wrong_item: "received_qty_variance",
    damaged_in_transit: "received_damaged",
    packaging_damaged: "received_damaged",
    expired_or_short_dated: "received_damaged",
    quality_failure: "received_damaged",
    missing_documents: "other",
    count_shortage: "stock_count_variance",
    count_surplus: "stock_count_variance",
    deterioration_in_store: "stock_deterioration",
    tool_damage: "tool_damage",
  })[value] ?? "other";
