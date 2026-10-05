/**
 * The Project Control workspace — the 27 screens of the QSL template, grouped
 * exactly as its sidebar groups them (0124).
 *
 * `href` points at the qali-suite screen that covers the function. Screens the
 * app already has as their own module (approvals, procurement, expenses,
 * compliance, quality, tenders, people, the cash/GL views) are marked
 * `external` — the sidebar links out to them. `project` screens read the
 * selected project from `?project=`, so the nav carries it across.
 *
 * SuperAdmin sees every screen. Per-person screen grants (the template's
 * "27 screens you have been granted") layer on top later, via role_permissions.
 */
export const PC_GROUPS = [
  ["Overview", [
    { key: "dashboard", label: "Dashboard", href: "/dashboard/projects", exact: true },
    { key: "about", label: "What this is", href: "/dashboard/projects/about" },
  ]],
  ["Projects", [
    { key: "archive", label: "Completed work", href: "/dashboard/projects/archive" },
    { key: "gate", label: "Start a project", href: "/dashboard/projects/create" },
    { key: "approvals", label: "Approvals", href: "/dashboard/approvals", external: true },
    { key: "budgets", label: "Budgets", href: "/dashboard/projects/sealed-budgets" },
    { key: "programme", label: "Programme and progress", href: "/dashboard/projects/programme", project: true },
    { key: "diary", label: "Daily site diary", href: "/dashboard/projects/diary", project: true },
  ]],
  ["Money out", [
    { key: "requisitions", label: "Requests for money", href: "/dashboard/projects/cash-requisitions", project: true },
    { key: "procurement", label: "Procurement", href: "/dashboard/purchase-orders", external: true },
    { key: "payments", label: "Payments and floats", href: "/dashboard/payments", external: true },
    { key: "expenses", label: "Expenses", href: "/dashboard/expenses", external: true },
  ]],
  ["Money in", [
    { key: "certificates", label: "Certificates and retention", href: "/dashboard/projects/ipc", project: true },
    { key: "variations", label: "Variations and claims", href: "/dashboard/projects/variations", project: true },
  ]],
  ["Contract", [
    { key: "contract", label: "Contract administration", href: "/dashboard/projects/contract", project: true },
    { key: "compliance", label: "Compliance and safety", href: "/dashboard/compliance", external: true },
    { key: "quality", label: "Quality and risk", href: "/dashboard/qms", external: true },
  ]],
  ["Reporting", [
    { key: "commercial", label: "Contract value and margin", href: "/dashboard/projects/sealed-budgets" },
    { key: "costs", label: "Cost lines", href: "/dashboard/projects/costs" },
    { key: "cash", label: "Cash and bank position", href: "/dashboard/banking", external: true },
    { key: "findings", label: "Findings", href: "/dashboard/projects/findings" },
    { key: "tenders", label: "Tender register", href: "/dashboard/bids", external: true },
  ]],
  ["Running it", [
    { key: "masters", label: "Standing lists", href: "/dashboard/parties", external: true },
    { key: "people", label: "People and access", href: "/dashboard/users", external: true },
    { key: "audit", label: "Audit trail", href: "/dashboard/projects/audit" },
    { key: "data", label: "Data and posting", href: "/dashboard/journal", external: true },
    { key: "diagnostics", label: "Diagnostics", href: "/dashboard/projects/diagnostics" },
  ]],
];

/** Flat list of every screen, for lookups. */
export const PC_SCREENS = PC_GROUPS.flatMap(([, items]) => items);
