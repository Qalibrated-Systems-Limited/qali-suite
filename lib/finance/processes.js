/**
 * The money processes, step by step, in the order they happen. Each step
 * names the screen where it is done and a `count` key the server fills with
 * what is waiting there. Shared by the Processes page and the sidebar order.
 */
export const FINANCE_PROCESSES = Object.freeze([
  {
    id: "order-to-cash",
    title: "Order to cash",
    blurb: "Selling: from a quote to money in the bank.",
    steps: [
      { label: "Quote", href: "/dashboard/quotes", count: "quotesOpen", hint: "quotes sent, awaiting the customer" },
      { label: "Sales order", href: "/dashboard/sales-orders", count: "ordersToInvoice", hint: "confirmed orders not yet invoiced" },
      { label: "Invoice", href: "/dashboard/invoices", count: "invoicesDraft", hint: "draft invoices to send" },
      { label: "Payment received", href: "/dashboard/payments/received", count: "invoicesUnpaid", hint: "invoices awaiting payment" },
      { label: "Credit note (if needed)", href: "/dashboard/credit-notes", count: "creditNotesDraft", hint: "draft credit notes" },
    ],
  },
  {
    id: "procure-to-pay",
    title: "Procure to pay",
    blurb: "Buying: from an order to the supplier paid.",
    steps: [
      { label: "Purchase order", href: "/dashboard/purchase-orders", count: "posOpen", hint: "orders sent, goods not all in" },
      { label: "Goods receipt", href: "/dashboard/grn", count: "grnsPending", hint: "receipts awaiting acceptance" },
      { label: "Supplier bill", href: "/dashboard/bills", count: "billsToApprove", hint: "bills awaiting approval" },
      { label: "Payment made", href: "/dashboard/payments/made", count: "billsUnpaid", hint: "approved bills unpaid" },
      { label: "GR/IR check", href: "/dashboard/gr-ir", count: "grirOpen", hint: "receipts not yet billed" },
    ],
  },
  {
    id: "expenses",
    title: "Advances and expenses",
    blurb: "Staff money, and costs from fleet, training and elsewhere.",
    steps: [
      { label: "Request or claim", href: "/dashboard/claims", count: "claimsToApprove", hint: "advances and claims to approve" },
      { label: "Pay out", href: "/dashboard/claims", count: "claimsToPay", hint: "approved, awaiting payment" },
      { label: "Account for the advance", href: "/dashboard/claims", count: "advancesToReturn", hint: "advances awaiting receipts or change" },
      { label: "Post the expense", href: "/dashboard/expenses", count: "expensesDraft", hint: "draft expenses — fleet, training, other" },
    ],
  },
  {
    id: "stock",
    title: "Stock to the books",
    blurb: "Every stock change is approved before it posts.",
    steps: [
      { label: "Count or adjust", href: "/dashboard/stock-counts", count: "countsInReview", hint: "counts in review" },
      { label: "Approve (three steps)", href: "/dashboard/approvals", count: "stockApprovals", hint: "stock changes awaiting approval" },
      { label: "Resolve NCRs", href: "/dashboard/ncr", count: "ncrsOpen", hint: "NCRs not yet closed" },
    ],
  },
  {
    id: "services",
    title: "Technical services to cash",
    blurb: "Finished jobs become invoices.",
    steps: [
      { label: "Job done and approved", href: "/dashboard/calibration", count: "jobsToBill", hint: "approved jobs not yet invoiced" },
      { label: "Invoice", href: "/dashboard/invoices", count: "invoicesDraft", hint: "draft invoices to send" },
      { label: "Web-shop orders", href: "/dashboard/shop", count: "shopToInvoice", hint: "paid orders not invoiced" },
    ],
  },
  {
    id: "projects",
    title: "Project cash",
    blurb: "Site money against a project budget.",
    steps: [
      { label: "Cash requisition", href: "/dashboard/projects/cash-requisitions", count: "cashReqToDecide", hint: "submitted, awaiting a decision" },
      { label: "Fund it", href: "/dashboard/projects/cash-requisitions", count: "cashReqToFund", hint: "approved, awaiting funds" },
      { label: "Cost to the project", href: "/dashboard/expenses", count: null, hint: "claims and expenses tagged to the project" },
    ],
  },
  {
    id: "payroll",
    title: "Payroll",
    blurb: "From a run to salaries paid.",
    steps: [
      { label: "Prepare the run", href: "/dashboard/hr/payroll", count: "payrollDraft", hint: "runs being prepared" },
      { label: "Review and approve", href: "/dashboard/hr/payroll", count: "payrollReview", hint: "runs in review" },
      { label: "Pay", href: "/dashboard/hr/payroll", count: "payrollApproved", hint: "approved, not yet paid" },
    ],
  },
  {
    id: "month-end",
    title: "Month end",
    blurb: "Close the period once everything above is in.",
    steps: [
      { label: "Reconcile the bank", href: "/dashboard/banking", count: "bankUnallocated", hint: "bank lines not yet allocated" },
      { label: "Journals and accruals", href: "/dashboard/journal", count: null, hint: "adjustments by journal" },
      { label: "Trial balance", href: "/dashboard/reports/trial-balance", count: null, hint: "check it balances" },
      { label: "Close the period", href: "/dashboard/settings/fiscal-periods", count: "periodsOpen", hint: "past periods still open" },
    ],
  },
]);
