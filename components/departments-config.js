import {
  FolderKanban,
  DollarSign,
  FlaskConical,
  Briefcase,
  ShieldCheck,
  Activity,
  Users,
} from "lucide-react";

/**
 * Department metadata — the display order, heading, icon and blurb for each
 * department, plus which top-level nav group belongs to which department.
 *
 * THIS MODULE IS DELIBERATELY NOT "use client". It holds plain data (lucide
 * icon components are safe in both server and client graphs), so a Server
 * Component — the department landing page — can import `DEPARTMENTS` and get the
 * real array. Exporting it from the client sidebar module instead handed the
 * server a client-reference proxy, and `DEPARTMENTS.find` was "not a function".
 * The client sidebar and the dashboard both import from here.
 */
export const DEPARTMENTS = [
  { slug: "projects", label: "Projects", icon: FolderKanban, blurb: "Project control — bills, budgets, certificates and cost." },
  { slug: "finance", label: "Finance", icon: DollarSign, blurb: "The books — ledger, banking, tax, expenses and the financial reports." },
  { slug: "technical", label: "Technical", icon: FlaskConical, blurb: "Calibration and inspection to ISO/IEC 17025 and 17020." },
  { slug: "business-dev", label: "Business Dev & Sales", icon: Briefcase, blurb: "The pipeline — leads, quotes, orders, bids and the shop." },
  { slug: "ict-quality", label: "ICT, Quality & Compliance", icon: ShieldCheck, blurb: "Quality, compliance, HSE, the service desk and integrations." },
  { slug: "general-ops", label: "General Operations", icon: Activity, blurb: "Stores, procurement, the fleet and the task spine." },
  { slug: "hr-admin", label: "HR & Admin", icon: Users, blurb: "People, payroll, users, the company record and settings." },
];

const DEPARTMENT_OF = {
  projects: "projects",
  finance: "finance",
  tax: "finance",
  reports: "finance",
  expenses: "finance",
  technical: "technical",
  crm: "business-dev",
  sales: "business-dev",
  presales: "business-dev",
  quality: "ict-quality",
  "it-service": "ict-quality",
  inventory: "general-ops",
  purchases: "general-ops",
  operations: "general-ops",
  hr: "hr-admin",
  people: "hr-admin",
  company: "hr-admin",
  licensing: "hr-admin",
  settings: "hr-admin",
};

export const departmentOf = (id) => DEPARTMENT_OF[id] ?? null;
