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
  ChevronRight,
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
} from "lucide-react";
import { QaliSuiteIcon, QaliSuiteMark } from "@/components/qalisuite-logo";

const MODULES = [
  { icon: Package, name: "Inventory", desc: "Stock tracking, reorder alerts, multi-location" },
  { icon: Receipt, name: "Invoicing", desc: "Quotes, invoices, credit notes, delivery notes" },
  { icon: Wallet, name: "Accounting", desc: "Double-entry ledger, chart of accounts, journals" },
  { icon: Users, name: "CRM", desc: "Customer & supplier management, transaction history" },
  { icon: CreditCard, name: "Expenses", desc: "Advances, petty cash, claims with receipt uploads" },
  { icon: BarChart3, name: "Reports", desc: "P&L, balance sheet, cash flow, sales analytics" },
  { icon: Briefcase, name: "Purchases", desc: "Purchase orders, bills, supplier reconciliation" },
  { icon: Shield, name: "Tax", desc: "VAT returns, WHT reports, KRA compliance" },
  { icon: FileText, name: "Requests", desc: "Stock request workflows with approval chains" },
  { icon: ClipboardCheck, name: "Claims", desc: "Expense reimbursements with approval workflows" },
  { icon: BookOpen, name: "Finance", desc: "Bank feeds, fiscal periods, full audit trail" },
  { icon: FolderKanban, name: "Projects", desc: "Project tracking & resource management", soon: true },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/">
            <QaliSuiteMark size="sm" />
          </Link>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" className="text-sm text-muted-foreground" asChild>
              <Link href="/login">Log in</Link>
            </Button>
            <Button size="sm" className="text-sm bg-yellow-500 hover:bg-yellow-600 text-black font-medium h-8 px-4" asChild>
              <Link href="/login">Get Started <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="absolute top-0 right-0 w-125 h-125 rounded-full bg-yellow-500/4 blur-[120px] pointer-events-none" />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-0">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
            {/* Left: copy */}
            <div className="pt-2 sm:pt-6">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 text-xs font-medium mb-5">
                <Zap className="w-3 h-3" />
                All-in-one ERP for growing businesses
              </div>

              <h1 className="text-[clamp(2rem,5vw,3.5rem)] font-bold tracking-tight leading-[1.08] mb-4">
                Inventory, finance
                <br className="hidden sm:block" />
                & operations —{" "}
                <span className="text-yellow-500">unified.</span>
              </h1>

              <p className="text-muted-foreground text-base sm:text-lg leading-relaxed mb-6 max-w-lg">
                Replace disconnected spreadsheets and tools with one platform.
                Track stock, send invoices, manage accounts, and run reports — all connected.
              </p>

              <div className="flex flex-wrap gap-2.5 mb-6">
                <Button size="lg" className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold h-11 px-7 rounded-lg" asChild>
                  <Link href="/login">Start free <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
                </Button>
                <Button variant="outline" size="lg" className="h-11 px-6 rounded-lg" asChild>
                  <Link href="/login">View demo</Link>
                </Button>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                {["No credit card", "5-minute setup", "Free tier"].map((t) => (
                  <span key={t} className="flex items-center gap-1">
                    <Check className="w-3.5 h-3.5 text-yellow-500" />
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Right: stats + quick features */}
            <div className="hidden lg:block pt-4">
              {/* Stats row */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                {[
                  { val: "99.9%", label: "Uptime" },
                  { val: "10x", label: "Faster ops" },
                  { val: "50+", label: "Hours saved/mo" },
                ].map((s) => (
                  <div key={s.label} className="p-4 rounded-xl bg-card border border-border text-center">
                    <div className="text-2xl font-bold text-foreground">{s.val}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
              {/* Quick feature list */}
              <div className="rounded-xl bg-card border border-border divide-y divide-border">
                {[
                  { icon: Package, text: "Real-time inventory across locations" },
                  { icon: Receipt, text: "Auto-commit stock when you invoice" },
                  { icon: Wallet, text: "Every transaction auto-posts to ledger" },
                  { icon: BarChart3, text: "Financial reports in one click" },
                ].map((f) => (
                  <div key={f.text} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-7 h-7 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0">
                      <f.icon className="w-3.5 h-3.5 text-yellow-500" />
                    </div>
                    <span className="text-sm text-foreground">{f.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Screenshot — browser chrome */}
          <div className="mt-12 sm:mt-16 relative">
            {/* Desktop */}
            <div className="hidden sm:block rounded-t-xl border border-b-0 border-border bg-card overflow-hidden shadow-xl dark:shadow-black/40">
              <div className="flex items-center gap-1.5 px-4 py-2 bg-muted/60 border-b border-border">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
                </div>
                <div className="ml-3 flex-1 max-w-xs">
                  <div className="h-4 rounded bg-border/60 w-40" />
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
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-linear-to-t from-background to-transparent pointer-events-none" />
          </div>
        </div>
      </section>

      {/* ── Modules grid ── */}
      <section className="py-16 sm:py-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Everything you need.
                <span className="text-muted-foreground"> Nothing you don&apos;t.</span>
              </h2>
              <p className="text-muted-foreground text-sm mt-2 max-w-lg">
                Each module works standalone or together — inventory feeds invoicing, invoicing posts to accounting, expenses reconcile automatically.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {MODULES.map((m) => (
              <div
                key={m.name}
                className={`group relative p-4 rounded-xl bg-card border border-border hover:border-yellow-500/40 transition-colors ${m.soon ? "opacity-50" : ""}`}
              >
                <div className="flex items-start justify-between mb-2.5">
                  <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center group-hover:bg-yellow-500/15 transition-colors">
                    <m.icon className="w-4 h-4 text-yellow-500" />
                  </div>
                  {m.soon && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Soon</span>
                  )}
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-0.5">{m.name}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it flows ── */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 border-y border-border bg-muted/20">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-10">
            How it works
          </h2>

          <div className="grid sm:grid-cols-3 gap-px bg-border rounded-xl overflow-hidden border border-border">
            {[
              {
                n: "1",
                title: "Track your stock",
                desc: "Add products, set reorder points, manage across locations. Every movement is auto-logged with full audit trail.",
                icon: Package,
              },
              {
                n: "2",
                title: "Invoice & collect",
                desc: "Create quotes, convert to invoices, record payments. Stock commits automatically when you invoice — no manual adjustments.",
                icon: Receipt,
              },
              {
                n: "3",
                title: "See the full picture",
                desc: "Every transaction auto-posts to your ledger. Pull P&L, balance sheets, tax reports, and analytics instantly.",
                icon: BarChart3,
              },
            ].map((step) => (
              <div key={step.n} className="bg-card p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-yellow-500 text-black flex items-center justify-center text-sm font-bold shrink-0">
                    {step.n}
                  </div>
                  <step.icon className="w-5 h-5 text-muted-foreground" />
                </div>
                <h3 className="text-base font-semibold text-foreground mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-16 sm:py-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="rounded-2xl bg-zinc-950 dark:bg-zinc-900 p-8 sm:p-12 relative overflow-hidden">
            <div className="absolute -bottom-20 -right-20 w-72 h-72 rounded-full bg-yellow-500/6 blur-[80px]" />

            <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2">
                  Ready to get started?
                </h2>
                <p className="text-zinc-400 text-sm max-w-md">
                  Free to start. No credit card required. Set up in minutes.
                </p>
              </div>
              <Button
                size="lg"
                className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold h-11 px-8 rounded-lg shrink-0 w-fit"
                asChild
              >
                <Link href="/login">
                  Start free
                  <ArrowUpRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
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
              <h4 className="text-[13px] font-medium text-foreground mb-3">Product</h4>
              <ul className="space-y-2">
                {[
                  { label: "Log in", href: "/login" },
                  { label: "Get Started", href: "/login" },
                  { label: "Privacy Policy", href: "/policy" },
                ].map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-[13px] font-medium text-foreground mb-3">Company</h4>
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
              <h4 className="text-[13px] font-medium text-foreground mb-3">Contact</h4>
              <ul className="space-y-2">
                <li className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <MapPin className="w-3.5 h-3.5 shrink-0 opacity-50" />
                  Nairobi, Kenya
                </li>
                <li>
                  <a href="mailto:info@qalibrated.com" className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                    <Mail className="w-3.5 h-3.5 shrink-0 opacity-50" />
                    info@qalibrated.com
                  </a>
                </li>
                <li>
                  <a href="tel:+254714999996" className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                    <Phone className="w-3.5 h-3.5 shrink-0 opacity-50" />
                    +254 714 999 996
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
