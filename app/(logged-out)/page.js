import { Button } from "../../components/ui/button";
import Link from "next/link";
import Image from "next/image";
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
  Zap,
  ArrowUpRight,
  TrendingUp,
  Clock,
} from "lucide-react";
import { QaliSuiteMark } from "@/components/qalisuite-logo";

const MODULES = [
  { icon: Package,       name: "Inventory",   desc: "Stock tracking, reorder alerts, multi-location" },
  { icon: Receipt,       name: "Invoicing",   desc: "Quotes, invoices, credit notes, delivery notes" },
  { icon: Wallet,        name: "Accounting",  desc: "Double-entry ledger, chart of accounts, journals" },
  { icon: Users,         name: "CRM",         desc: "Customer & supplier management, transaction history" },
  { icon: CreditCard,    name: "Expenses",    desc: "Advances, petty cash, claims with receipt uploads" },
  { icon: BarChart3,     name: "Reports",     desc: "P&L, balance sheet, cash flow, sales analytics" },
  { icon: Briefcase,     name: "Purchases",   desc: "Purchase orders, bills, supplier reconciliation" },
  { icon: Shield,        name: "Tax",         desc: "VAT returns, WHT reports, KRA compliance" },
  { icon: FileText,      name: "Requests",    desc: "Stock request workflows with approval chains" },
  { icon: ClipboardCheck,name: "Claims",      desc: "Expense reimbursements with approval workflows" },
  { icon: BookOpen,      name: "Finance",     desc: "Bank feeds, fiscal periods, full audit trail" },
  { icon: FolderKanban,  name: "Projects",    desc: "Project tracking & resource management", soon: true },
];

const STEPS = [
  {
    n: "01",
    icon: Package,
    title: "Track your stock",
    desc: "Add products, set reorder points, manage across locations. Every movement is auto-logged with full audit trail.",
  },
  {
    n: "02",
    icon: Receipt,
    title: "Invoice & collect",
    desc: "Create quotes, convert to invoices, record payments. Stock commits automatically when you invoice.",
  },
  {
    n: "03",
    icon: BarChart3,
    title: "See the full picture",
    desc: "Every transaction auto-posts to your ledger. Pull P&L, balance sheets, tax reports, and analytics instantly.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/"><QaliSuiteMark size="sm" /></Link>
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
        {/* Background atmosphere */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.08),transparent)]" />
        <div className="absolute top-0 right-0 w-[600px] h-[500px] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
        <div className="absolute top-1/3 left-0 w-[300px] h-[300px] rounded-full bg-primary/3 blur-[100px] pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-0">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-start">

            {/* Left: copy */}
            <div className="pt-2 sm:pt-4">
              {/* Badge */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-primary/30 bg-primary/8 text-primary dark:text-primary text-xs font-medium mb-6">
                <Zap className="w-3 h-3" />
                All-in-one ERP for growing businesses
              </div>

              <h1 className="text-[clamp(2.2rem,5.5vw,3.75rem)] font-bold tracking-tight leading-[1.06] mb-5">
                Inventory, finance
                <br />
                &amp; operations —{" "}
                <span className="text-primary">unified.</span>
              </h1>

              <p className="text-muted-foreground text-base sm:text-lg leading-relaxed mb-8 max-w-md">
                Replace disconnected spreadsheets with one platform.
                Track stock, send invoices, manage accounts, and run reports — all connected.
              </p>

              <div className="flex flex-wrap gap-3 mb-7">
                <Button
                  size="lg"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-11 px-7 rounded-lg"
                  asChild
                >
                  <Link href="/login">Start free <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
                </Button>
                <Button variant="outline" size="lg" className="h-11 px-6 rounded-lg font-medium" asChild>
                  <Link href="/login">View demo</Link>
                </Button>
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted-foreground">
                {["No credit card", "5-minute setup", "Free tier available"].map((t) => (
                  <span key={t} className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Right: social proof + feature highlights */}
            <div className="hidden lg:flex flex-col gap-4 pt-2">
              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { val: "99.9%", label: "Uptime SLA",      icon: TrendingUp },
                  { val: "10×",   label: "Faster ops",       icon: Zap },
                  { val: "50+",   label: "Hours saved / mo", icon: Clock },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-border bg-card p-4 text-center">
                    <s.icon className="w-4 h-4 text-primary mx-auto mb-1.5 opacity-70" />
                    <div className="text-2xl font-bold tracking-tight text-foreground">{s.val}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Feature list */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border bg-muted/30">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Core capabilities</p>
                </div>
                {[
                  { icon: Package,  text: "Real-time inventory across locations" },
                  { icon: Receipt,  text: "Auto-commit stock when you invoice" },
                  { icon: Wallet,   text: "Every transaction posts to ledger automatically" },
                  { icon: BarChart3,text: "Financial reports in one click" },
                ].map((f, i) => (
                  <div key={f.text} className={`flex items-center gap-3 px-4 py-3 ${i < 3 ? "border-b border-border" : ""}`}>
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <f.icon className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <span className="text-sm text-foreground">{f.text}</span>
                    <Check className="w-4 h-4 text-primary ml-auto shrink-0 opacity-60" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Screenshot — browser chrome */}
          <div className="mt-14 sm:mt-20 relative">
            <div className="hidden sm:block rounded-t-2xl border border-b-0 border-border bg-card overflow-hidden shadow-2xl shadow-black/10 dark:shadow-black/50">
              <div className="flex items-center gap-1.5 px-4 py-3 bg-muted/60 border-b border-border">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
                </div>
                <div className="ml-3 flex-1 max-w-xs">
                  <div className="h-4 rounded-md bg-border/60 w-44" />
                </div>
              </div>
              <div className="hidden dark:block">
                <Image src="/screenshots/dark-mode-cropped.png" alt="QaliSuite Dashboard" width={1920} height={1080} className="w-full h-auto" priority />
              </div>
              <div className="block dark:hidden">
                <Image src="/screenshots/light-mode-cropped.png" alt="QaliSuite Dashboard" width={1920} height={1080} className="w-full h-auto" priority />
              </div>
            </div>
            {/* Mobile */}
            <div className="sm:hidden flex justify-center">
              <div className="relative w-60 rounded-[2rem] border-[5px] border-zinc-800 dark:border-zinc-600 bg-black shadow-2xl overflow-hidden">
                <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-14 h-3.5 bg-black rounded-full z-10" />
                <div className="hidden dark:block">
                  <Image src="/screenshots/mobile-dark.jpeg" alt="QaliSuite Mobile" width={750} height={1334} className="w-full h-auto" priority />
                </div>
                <div className="block dark:hidden">
                  <Image src="/screenshots/mobile-light.jpeg" alt="QaliSuite Mobile" width={750} height={1334} className="w-full h-auto" priority />
                </div>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent pointer-events-none" />
          </div>
        </div>
      </section>

      {/* ── Modules grid ── */}
      <section className="py-20 sm:py-28 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">Modules</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
              Everything you need.{" "}
              <span className="text-muted-foreground">Nothing you don&apos;t.</span>
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-xl">
              Each module works standalone or together — inventory feeds invoicing,
              invoicing posts to accounting, expenses reconcile automatically.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {MODULES.map((m) => (
              <div
                key={m.name}
                className={`group relative p-4 sm:p-5 rounded-xl bg-card border border-border hover:border-primary/40 hover:shadow-sm transition-all ${m.soon ? "opacity-50" : ""}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                    <m.icon className="w-4 h-4 text-primary" />
                  </div>
                  {m.soon && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground tracking-wide">SOON</span>
                  )}
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
        <div className="max-w-6xl mx-auto">
          <div className="mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">How it works</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Three steps to clarity.
            </h2>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            {STEPS.map((step, i) => (
              <div key={step.n} className="relative">
                {/* Connector line between steps (desktop) */}
                {i < STEPS.length - 1 && (
                  <div className="hidden sm:block absolute top-7 left-[calc(100%+0.75rem)] w-6 h-px bg-border -translate-y-1/2 z-10" />
                )}
                <div className="rounded-xl border border-border bg-card p-6 h-full">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
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

      {/* ── CTA ── */}
      <section className="py-20 sm:py-28 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="rounded-2xl bg-slate-900 dark:bg-zinc-900 p-8 sm:p-14 relative overflow-hidden">
            <div className="absolute -top-32 -right-32 w-80 h-80 rounded-full bg-primary/10 blur-[100px]" />
            <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-primary/5 blur-[80px]" />
            <div className="relative z-10 max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">Get started</p>
              <h2 className="text-2xl sm:text-4xl font-bold text-white tracking-tight mb-3 leading-tight">
                Ready to run your business smarter?
              </h2>
              <p className="text-slate-400 text-sm sm:text-base mb-8 leading-relaxed">
                Free to start. No credit card required. Set up in minutes.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  size="lg"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-11 px-8 rounded-lg"
                  asChild
                >
                  <Link href="/login">
                    Start free <ArrowUpRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" size="lg" className="h-11 px-6 rounded-lg font-medium border-white/20 text-white hover:bg-white/10 hover:text-white" asChild>
                  <Link href="/login">Log in</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="py-10 sm:py-12 grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
            <div className="col-span-2 lg:col-span-1">
              <div className="mb-3">
                <QaliSuiteMark size="sm" subtitle="by Qalibrated Systems" />
              </div>
              <p className="text-[13px] text-muted-foreground leading-relaxed max-w-xs">
                Modern ERP for inventory, invoicing, accounting, and operations.
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
