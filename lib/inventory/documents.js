/**
 * What can be attached to which inventory record, and the kinds of document
 * each one usually needs. Shared by the attachment panel and its actions.
 */
export const INVENTORY_DOC_ENTITIES = Object.freeze({
  product: {
    label: "Product",
    table: "products",
    categories: [
      ["datasheet", "Data sheet / specification"],
      ["sds", "Safety data sheet (SDS/MSDS)"],
      ["certificate", "Certificate (CoC, calibration, test)"],
      ["warranty", "Warranty"],
      ["manual", "Manual / instructions"],
      ["photo", "Photo"],
      ["other", "Other"],
    ],
  },
  goods_receipt: {
    label: "Goods receipt",
    table: "goods_receipts",
    categories: [
      ["delivery_note", "Delivery note"],
      ["supplier_invoice", "Supplier invoice"],
      ["certificate", "Certificate (CoC, calibration, test)"],
      ["inspection", "Inspection report"],
      ["photo", "Photo of goods / damage"],
      ["other", "Other"],
    ],
  },
  stock_adjustment: {
    label: "Stock adjustment",
    table: "stock_adjustments",
    categories: [
      ["evidence_photo", "Photo evidence"],
      ["damage_report", "Damage / incident report"],
      ["police_abstract", "Police abstract (theft)"],
      ["disposal_certificate", "Disposal / destruction certificate"],
      ["count_sheet", "Signed count sheet"],
      ["other", "Other"],
    ],
  },
  stock_count: {
    label: "Stock count",
    table: "stock_counts",
    categories: [
      ["count_sheet", "Signed count sheet"],
      ["photo", "Photo"],
      ["reconciliation", "Reconciliation notes"],
      ["other", "Other"],
    ],
  },
  nonconformance: {
    label: "NCR",
    table: "nonconformances",
    categories: [
      ["evidence_photo", "Photo evidence"],
      ["supplier_correspondence", "Supplier correspondence"],
      ["credit_note", "Supplier credit note"],
      ["inspection", "Inspection / test report"],
      ["return_note", "Return note / waybill"],
      ["other", "Other"],
    ],
  },
  stock_request: {
    label: "Requisition",
    table: "stock_requests",
    categories: [
      ["quotation", "Quotation"],
      ["approval", "Signed approval"],
      ["specification", "Specification"],
      ["photo", "Photo"],
      ["other", "Other"],
    ],
  },
});

export const docCategoryLabel = (entityType, category) =>
  INVENTORY_DOC_ENTITIES[entityType]?.categories.find(([v]) => v === category)?.[1] ?? "Other";
