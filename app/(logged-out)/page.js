import { Button } from "../../components/ui/button";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Receipt,
  Users,
  Wallet,
  Package,
  Shield,
  BookOpen,
  ClipboardCheck,
  FileText,
  CreditCard,
  Briefcase,
  FolderKanban,
  MapPin,
  Mail,
  Phone,
  ExternalLink,
  Check,
  ArrowUpRight,
  UserCog,
  Building2,
  Truck,
  Wrench,
  ShoppingBag,
  Landmark,
  Globe,
  Lock,
  CalendarCheck,
  ChevronRight,
} from "lucide-react";
import { QaliSuiteMark } from "@/components/qalisuite-logo";

const MODULES = [
  { icon: Package,        name: "Inventory",       desc: "Products, stock movements, goods receipts, adjustments" },
  { icon: Receipt,        name: "Sales",           desc: "Quotes, sales orders with stock reservation, invoices, credit notes" },
  { icon: Users,          name: "CRM",             desc: "Leads, sales pipeline, customer history & follow-ups" },
  { icon: Briefcase,      name: "Purchases",       desc: "Purchase orders, supplier bills, payments made" },
  { icon: Wallet,         name: "Accounting",      desc: "Double-entry ledger, chart of accounts, fiscal periods" },
  { icon: BookOpen,       name: "Banking",         desc: "Statement upload, payment allocation, reconciliation" },
  { icon: CreditCard,     name: "Expenses",        desc: "Staff advances, reimbursements, operating expenses" },
  { icon: ClipboardCheck, name: "Approvals",       desc: "Threshold-based approvals for prices, payments & write-offs" },
  { icon: BarChart3,      name: "Reports",         desc: "P&L, balance sheet, cash flow, AR/AP aging" },
  { icon: Shield,         name: "Tax",             desc: "VAT, WHT, KRA-ready iTax exports" },
  { icon: UserCog,        name: "HR & Payroll",    desc: "PAYE, NSSF, SHIF, AHL, payslips, P9 & P10" },
  { icon: CalendarCheck,  name: "Attendance",      desc: "Clock in/out, leave, overtime tracking" },
  { icon: FolderKanban,   name: "Projects",        desc: "Budgets, cost tracking, profitability per project" },
  { icon: FileText,       name: "Stock Requests",  desc: "Internal requisitions with approval flow" },
];

const STEPS = [
  {
    n: "01",
    icon: Package,
    title: "Set up your business",
    desc: "Add products, accounts, employees, and team. Invite staff with role-based access.",
  },
  {
    n: "02",
    icon: Receipt,
    title: "Run daily operations",
    desc: "Invoice, purchase, expense, claim — stock and ledger update automatically.",
  },
  {
    n: "03",
    icon: BarChart3,
    title: "See the full picture",
    desc: "P&L, balance sheets, payroll summaries, project profitability — one click.",
  },
];

const INDUSTRIES = [
  { icon: ShoppingBag, name: "Retail & Distribution",       desc: "Multi-location stock, sales, suppliers" },
  { icon: Building2,   name: "Construction & Engineering",  desc: "Project budgets, cost codes, subcontractors" },
  { icon: Wrench,      name: "Service Companies",           desc: "T&M billing, expenses, project profitability" },
  { icon: Truck,       name: "Logistics & Warehousing",     desc: "Stock movements, delivery notes, multi-warehouse" },
  { icon: Landmark,    name: "Professional Firms",          desc: "Client billing, reimbursements, payroll" },
  { icon: Globe,       name: "NGOs & SMEs",                 desc: "Budget tracking, donor reporting, compliance" },
];

const COMPLIANCE = [
  { label: "PAYE / P9A / P10", desc: "Auto-calculated brackets, annual certificates" },
  { label: "NSSF (Tier I & II)", desc: "Employee & employer contributions" },
  { label: "SHIF", desc: "Social Health Insurance Fund deductions" },
  { label: "AHL / Housing Levy", desc: "Affordable Housing Levy compliance" },
  { label: "VAT & WHT", desc: "Tax transaction tracking & returns" },
  { label: "KRA-ready exports", desc: "CSV exports for iTax filing" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/"><QaliSuiteMark size="sm" /></Link>
          <div className="hidden sm:flex items-center gap-6 text-[13px] text-muted-foreground">
            <a href="#modules" className="hover:text-foreground transition-colors">Modules</a>
            <a href="#industries" className="hover:text-foreground transition-colors">Industries</a>
            <a href="#compliance" className="hover:text-foreground transition-colors">Compliance</a>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" className="text-sm text-muted-foreground" asChild>
              <Link href="/login">Log in</Link>
            </Button>
            <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-8 px-4 text-sm" asChild>
              <Link href="/login">Get started <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.08),transparent)]" />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-14 sm:pt-32 pb-14 sm:pb-32 text-center">
          {/* Badge — plain and factual */}
          <div className="animate-[fadeInUp_0.5s_ease-out_both] inline-flex items-center px-3 py-1 rounded-full border border-border bg-muted/50 text-muted-foreground text-xs font-medium mb-8">
            Built for Kenyan businesses
          </div>

          {/* Headline */}
          <h1 className="animate-[fadeInUp_0.6s_ease-out_0.1s_both] text-[clamp(2rem,5vw,3.5rem)] font-bold tracking-tight leading-[1.08] mb-6 max-w-2xl mx-auto">
            Run your whole business{" "}
            <span className="text-primary">from one system.</span>
          </h1>

          {/* Subhead */}
          <p className="animate-[fadeInUp_0.6s_ease-out_0.2s_both] text-muted-foreground text-base sm:text-lg leading-relaxed mb-10 max-w-lg mx-auto">
            Stock, sales, purchases, payroll and accounts in one place.
            Enter things once — the books update themselves.
          </p>

          {/* CTA — stacked full-width on phones (side-by-side wrap looked
              crowded and off-centre), row from sm up */}
          <div className="animate-[fadeInUp_0.6s_ease-out_0.3s_both] mx-auto mb-8 flex w-full max-w-xs flex-col justify-center gap-3 sm:max-w-none sm:flex-row">
            <Button
              size="lg"
              className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-12 px-8 rounded-xl shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all"
              asChild
            >
              <Link href="/login">Start free <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
            </Button>
            <Button variant="outline" size="lg" className="w-full sm:w-auto h-12 px-7 rounded-xl font-medium hover:bg-muted/50 transition-all" asChild>
              <Link href="/login">Log in</Link>
            </Button>
          </div>

          {/* Trust line */}
          <div className="animate-[fadeInUp_0.6s_ease-out_0.4s_both] flex flex-wrap justify-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
            {["No credit card", "5-minute setup", "Free tier available"].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Connected flow strip ── */}
      <section className="border-y border-border bg-muted/30 py-10 sm:py-14 px-4 sm:px-6 overflow-hidden">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-8">One action. Multiple updates.</p>
          {/* Wraps into rows on phones instead of one tall column */}
          <div className="flex flex-row flex-wrap items-start justify-center gap-x-6 gap-y-5 sm:flex-nowrap sm:items-center sm:gap-0">
            {[
              { icon: Receipt,       label: "Invoice created" },
              { icon: Package,       label: "Stock committed" },
              { icon: Wallet,        label: "Ledger posted" },
              { icon: FolderKanban,  label: "Project updated" },
              { icon: Shield,        label: "Tax recorded" },
            ].map((step, i) => (
              <div key={step.label} className="flex items-center gap-3 sm:gap-0" style={{ animationDelay: `${0.1 * i}s` }}>
                <div className="flex flex-col items-center gap-2 animate-[fadeInUp_0.5s_ease-out_both]" style={{ animationDelay: `${0.1 * i + 0.5}s` }}>
                  <div className="w-11 h-11 rounded-xl bg-card border border-border flex items-center justify-center shadow-sm hover:border-primary/40 hover:shadow-md transition-all">
                    <step.icon className="w-4.5 h-4.5 text-primary" />
                  </div>
                  <span className="text-[11px] text-muted-foreground font-medium whitespace-nowrap">{step.label}</span>
                </div>
                {i < 4 && (
                  <ChevronRight className="hidden sm:block w-4 h-4 text-border mx-4 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Modules grid ── */}
      <section id="modules" className="py-20 sm:py-28 px-4 sm:px-6 scroll-mt-16">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">Modules</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
              What&apos;s inside
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-lg mx-auto">
              Fourteen modules that share one database. A sale reserves stock,
              posts the ledger entries and shows up in your reports — without
              re-entering anything.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
            {MODULES.map((m, i) => (
              <div
                key={m.name}
                className="group p-3 sm:p-5 rounded-xl bg-card border border-border hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/15 group-hover:scale-105 transition-all duration-200">
                  <m.icon className="w-4 h-4 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1">{m.name}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="py-20 sm:py-28 px-4 sm:px-6 border-y border-border bg-muted/20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">How it works</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Getting started
            </h2>
          </div>

          <div className="grid sm:grid-cols-3 gap-5">
            {STEPS.map((step, i) => (
              <div key={step.n} className="relative group">
                <div className="rounded-xl border border-border bg-card p-6 h-full hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0 group-hover:scale-105 transition-transform duration-200">
                      {step.n}
                    </div>
                    <div className="h-px flex-1 bg-border" />
                    <step.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Industries ── */}
      <section id="industries" className="py-20 sm:py-28 px-4 sm:px-6 scroll-mt-16">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">Industries</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
              Who uses it
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-lg mx-auto">
              Businesses that hold stock, run projects, or bill for their
              time — and need the books to keep up.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {INDUSTRIES.map((ind) => (
              <div key={ind.name} className="group flex items-start gap-4 p-5 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 group-hover:scale-105 transition-all duration-200">
                  <ind.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-1">{ind.name}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{ind.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Kenya Compliance ── */}
      <section id="compliance" className="py-20 sm:py-28 px-4 sm:px-6 border-y border-border bg-muted/20 scroll-mt-16">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">Compliance</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
                Kenya statutory compliance,{" "}
                <span className="text-primary">built in.</span>
              </h2>
              <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-6 max-w-md">
                Stop calculating PAYE brackets in spreadsheets. All Kenyan statutory deductions, P9A certificates, and CSV exports ready for KRA iTax, NSSF, and SHIF portals.
              </p>
              <div className="flex flex-wrap gap-2">
                {["PAYE", "NSSF", "SHIF", "AHL", "VAT", "WHT"].map((tag) => (
                  <span key={tag} className="inline-flex items-center px-2.5 py-1 rounded-md bg-primary/10 text-primary text-xs font-semibold">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {COMPLIANCE.map((item, i) => (
                <div key={item.label} className="group flex items-start gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-sm transition-all duration-200">
                  <div className="mt-0.5">
                    <Lock className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 sm:py-28 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl bg-slate-900 dark:bg-zinc-900 p-8 sm:p-14 relative overflow-hidden">
            <div className="absolute -top-32 -right-32 w-80 h-80 rounded-full bg-primary/10 blur-[100px]" />
            <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-primary/5 blur-[80px]" />
            <div className="relative z-10 text-center max-w-lg mx-auto">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">Get started</p>
              <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-3 leading-tight">
                Try it with your own data.
              </h2>
              <p className="text-slate-400 text-sm sm:text-base mb-8 leading-relaxed">
                The free tier is enough to invoice, track stock and see your
                first reports. Upgrade when you need more.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button
                  size="lg"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-12 px-8 rounded-xl shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all"
                  asChild
                >
                  <Link href="/login">
                    Start free <ArrowUpRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" size="lg" className="h-12 px-7 rounded-xl font-medium border-white/40 text-white bg-white/10 hover:bg-white/20 hover:text-white transition-all" asChild>
                  <Link href="/login">Log in</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="py-10 sm:py-12 grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
            <div className="col-span-2 lg:col-span-1">
              <div className="mb-3">
                <QaliSuiteMark size="sm" subtitle="by Qalibrated Systems" />
              </div>
              <p className="text-[13px] text-muted-foreground leading-relaxed max-w-xs">
                Modern ERP for inventory, invoicing, accounting, HR, and project management.
              </p>
            </div>

            <div>
              <h4 className="text-[13px] font-semibold text-foreground mb-3">Product</h4>
              <ul className="space-y-2">
                {[
                  { label: "Log in",         href: "/login" },
                  { label: "Get started",    href: "/login" },
                  { label: "Privacy Policy", href: "/policy" },
                ].map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-[13px] font-semibold text-foreground mb-3">Company</h4>
              <ul className="space-y-2">
                <li>
                  <a href="https://www.qalibrated.com" target="_blank" rel="noopener noreferrer" className="text-[13px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
                    qalibrated.com <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
                <li><span className="text-[13px] text-muted-foreground">Qalibrated Systems Ltd</span></li>
              </ul>
            </div>

            <div>
              <h4 className="text-[13px] font-semibold text-foreground mb-3">Contact</h4>
              <ul className="space-y-2">
                <li className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <MapPin className="w-3.5 h-3.5 shrink-0 opacity-50" /> Nairobi, Kenya
                </li>
                <li>
                  <a href="mailto:info@qalibrated.com" className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                    <Mail className="w-3.5 h-3.5 shrink-0 opacity-50" /> info@qalibrated.com
                  </a>
                </li>
                <li>
                  <a href="tel:+254714999996" className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                    <Phone className="w-3.5 h-3.5 shrink-0 opacity-50" /> +254 714 999 996
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="py-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              &copy; {new Date().getFullYear()} Qalibrated Systems Ltd. All rights reserved.
            </p>
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <Link href="/policy" className="hover:text-foreground transition-colors">Privacy</Link>
              <a href="mailto:info@qalibrated.com" className="hover:text-foreground transition-colors">Support</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
