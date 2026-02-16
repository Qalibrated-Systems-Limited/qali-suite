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
  Sparkles,
  Zap,
  Shield,
  Globe,
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
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Floating Particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[10%] left-[15%] w-2 h-2 bg-yellow-500/60 rounded-full animate-ping animation-duration-[3s]" />
        <div className="absolute top-[20%] right-[20%] w-1.5 h-1.5 bg-yellow-400/50 rounded-full animate-ping animation-duration-[4s] [animation-delay:1s]" />
        <div className="absolute top-[60%] left-[10%] w-1 h-1 bg-orange-500/40 rounded-full animate-ping animation-duration-[5s] [animation-delay:2s]" />
        <div className="absolute top-[80%] right-[15%] w-2 h-2 bg-yellow-500/30 rounded-full animate-ping animation-duration-[4s] [animation-delay:0.5s]" />
      </div>

      {/* ========== HERO ========== */}
      <section className="relative pt-10 sm:pt-20 pb-0 px-3 sm:px-6">
        {/* Gradient Orbs */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[min(800px,100vw)] h-[500px] bg-linear-to-br from-yellow-500/15 via-orange-500/8 to-transparent rounded-full blur-3xl animate-pulse" />

        {/* Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(234,179,8,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(234,179,8,0.03)_1px,transparent_1px)] bg-size-[clamp(20px,4vw,60px)_clamp(20px,4vw,60px)] mask-[radial-gradient(ellipse_60%_40%_at_50%_20%,black,transparent)]" />

        <div className="relative z-10 max-w-6xl mx-auto text-center">
          {/* Logo */}
          <div className="mb-3 sm:mb-6 inline-flex animate-[fadeInUp_0.6s_ease-out_forwards] opacity-0 [animation-delay:0.05s]">
            <div className="relative group">
              <div className="absolute -inset-3 bg-linear-to-r from-yellow-400 to-orange-500 rounded-2xl blur-xl opacity-30 group-hover:opacity-50 transition-opacity duration-700 animate-pulse" />
              <div className="relative w-10 h-10 sm:w-16 sm:h-16 bg-linear-to-br from-yellow-400 via-yellow-500 to-orange-500 rounded-lg sm:rounded-2xl flex items-center justify-center shadow-2xl shadow-yellow-500/25">
                <span className="text-lg sm:text-3xl font-black text-black">Q</span>
              </div>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-[clamp(1.85rem,7vw,5rem)] font-black tracking-tighter leading-[0.9] mb-2 sm:mb-4 animate-[fadeInUp_0.6s_ease-out_forwards] opacity-0 [animation-delay:0.15s]">
            <span className="text-foreground">Qali</span>
            <span className="bg-linear-to-r from-yellow-400 via-yellow-500 to-orange-500 bg-clip-text text-transparent">Suite</span>
          </h1>

          {/* Tagline */}
          <p className="text-[clamp(0.8rem,2.5vw,1.35rem)] text-muted-foreground font-medium mb-4 sm:mb-6 max-w-2xl mx-auto px-2 sm:px-0 animate-[fadeInUp_0.6s_ease-out_forwards] opacity-0 [animation-delay:0.3s]">
            Inventory, invoicing, accounting, and operations — all in one modern platform built for growing businesses
          </p>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3 mb-6 sm:mb-14 animate-[fadeInUp_0.6s_ease-out_forwards] opacity-0 [animation-delay:0.45s]">
            <Button
              size="lg"
              className="group w-full sm:w-auto bg-linear-to-r from-yellow-400 via-yellow-500 to-orange-500 hover:from-yellow-500 hover:to-orange-600 text-black font-bold px-6 sm:px-8 h-10 sm:h-13 rounded-xl sm:rounded-2xl shadow-xl shadow-yellow-500/20 hover:shadow-yellow-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 text-sm sm:text-base"
              asChild
            >
              <Link href="/login">
                Get Started Free
                <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="w-full sm:w-auto h-10 sm:h-13 px-6 rounded-xl sm:rounded-2xl text-muted-foreground hover:text-foreground hover:bg-card/50 transition-all duration-300 text-sm sm:text-base"
              asChild
            >
              <Link href="/login">
                <Sparkles className="mr-2 h-4 w-4 text-yellow-500" />
                See Demo
              </Link>
            </Button>
          </div>

          {/* ===== Hero Screenshot ===== */}
          <div className="relative animate-[fadeInUp_0.8s_ease-out_forwards] opacity-0 [animation-delay:0.6s]">
            {/* Glow */}
            <div className="absolute inset-x-4 -bottom-8 h-32 bg-linear-to-t from-yellow-500/20 via-yellow-500/5 to-transparent blur-2xl rounded-full" />

            {/* ---- MOBILE: Phone mockup ---- */}
            <div className="sm:hidden flex justify-center">
              <div className="relative mx-auto w-65">
                {/* Phone body */}
                <div className="relative rounded-[2.5rem] border-[6px] border-gray-800 dark:border-gray-600 bg-black shadow-2xl shadow-black/40 overflow-hidden">
                  {/* Notch / Dynamic Island */}
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-5 bg-black rounded-full z-20" />
                  {/* Screen content */}
                  <div className="relative">
                    {/* Dark mode */}
                    <div className="hidden dark:block">
                      <Image
                        src="/screenshots/mobile-dark.jpeg"
                        alt="QaliSuite Dashboard - Mobile"
                        width={750}
                        height={1334}
                        className="w-full h-auto"
                        priority
                      />
                    </div>
                    {/* Light mode */}
                    <div className="block dark:hidden">
                      <Image
                        src="/screenshots/mobile-light.jpeg"
                        alt="QaliSuite Dashboard - Mobile"
                        width={750}
                        height={1334}
                        className="w-full h-auto"
                        priority
                      />
                    </div>
                  </div>
                  {/* Home indicator */}
                  <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-24 h-1 bg-white/30 rounded-full z-20" />
                </div>
              </div>
            </div>

            {/* ---- DESKTOP: MacBook mockup ---- */}
            <div className="hidden sm:block relative mx-auto max-w-5xl">
              {/* Laptop screen */}
              <div className="relative rounded-t-xl border-[8px] border-gray-800 dark:border-gray-700 bg-gray-800 dark:bg-gray-700 shadow-2xl shadow-black/30 overflow-hidden">
                {/* Camera notch */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 -mt-[8px] z-20 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-600 dark:bg-gray-500 ring-1 ring-gray-700 dark:ring-gray-600" />
                </div>
                {/* Screen content */}
                <div className="hidden dark:block">
                  <Image
                    src="/screenshots/dark-mode-cropped.png"
                    alt="QaliSuite Dashboard"
                    width={1920}
                    height={1080}
                    className="w-full h-auto"
                    priority
                  />
                </div>
                <div className="block dark:hidden">
                  <Image
                    src="/screenshots/light-mode-cropped.png"
                    alt="QaliSuite Dashboard"
                    width={1920}
                    height={1080}
                    className="w-full h-auto"
                    priority
                  />
                </div>
              </div>
              {/* Laptop base / hinge */}
              <div className="relative mx-auto">
                {/* Hinge strip */}
                <div className="h-3 bg-gradient-to-b from-gray-700 to-gray-800 dark:from-gray-600 dark:to-gray-700 rounded-b-sm" />
                {/* Base / keyboard deck */}
                <div className="mx-auto w-[70%] h-4 bg-gradient-to-b from-gray-800 to-gray-900 dark:from-gray-700 dark:to-gray-800 rounded-b-2xl shadow-lg shadow-black/20" />
              </div>
            </div>

            {/* Bottom fade into page */}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-linear-to-t from-background to-transparent" />
          </div>
        </div>
      </section>

      {/* ========== TRUST STRIP ========== */}
      <section className="relative z-10 py-5 sm:py-10 px-3 sm:px-6">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-muted-foreground">
          {[
            { icon: Zap, label: "Lightning Fast" },
            { icon: Shield, label: "Bank-grade Security" },
            { icon: Globe, label: "Access Anywhere" },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs sm:text-sm">
              <item.icon className="w-4 h-4 text-yellow-500/70" />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ========== FEATURES OVERVIEW ========== */}
      <section className="relative py-8 sm:py-24 px-3 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-6 sm:mb-14">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 text-xs sm:text-sm font-medium mb-3 sm:mb-4">
              <Sparkles className="w-3.5 h-3.5" />
              Everything You Need
            </span>
            <h2 className="text-[clamp(1.5rem,4.5vw,2.75rem)] font-bold text-foreground leading-tight">
              One platform for your <span className="text-yellow-500">entire business</span>
            </h2>
          </div>

          {/* Feature Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-4">
            {[
              { icon: Package, title: "Inventory", desc: "Real-time stock tracking & reorder alerts" },
              { icon: Receipt, title: "Invoicing", desc: "Professional invoices, quotes & delivery notes" },
              { icon: Wallet, title: "Accounting", desc: "Double-entry ledger & chart of accounts" },
              { icon: BookOpen, title: "Journal Entries", desc: "Full audit trail with auto-posting" },
              { icon: Users, title: "Customers & Suppliers", desc: "Complete party management & history" },
              { icon: CreditCard, title: "Employee Advances", desc: "Petty cash & salary advance tracking" },
              { icon: ClipboardCheck, title: "Reimbursements", desc: "Expense claims with receipt uploads" },
              { icon: FileText, title: "Stock Requests", desc: "Request & approval workflows" },
              { icon: BarChart3, title: "Reports", desc: "P&L, balance sheet & sales analytics" },
              { icon: Briefcase, title: "Purchases", desc: "Purchase orders & supplier management" },
              { icon: Shield, title: "Tax Management", desc: "VAT, WHT & compliance ready" },
              { icon: FolderKanban, title: "Projects", desc: "Project management (coming soon)", coming: true },
            ].map((item, i) => (
              <div
                key={i}
                className={`group relative p-3 sm:p-5 rounded-lg sm:rounded-2xl bg-card border border-border/50 hover:border-yellow-500/30 hover:bg-yellow-500/5 transition-all duration-300 ${item.coming ? "opacity-60" : ""}`}
              >
                <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-md sm:rounded-lg bg-yellow-500/10 flex items-center justify-center mb-1.5 sm:mb-3 group-hover:bg-yellow-500/20 group-hover:scale-110 transition-all duration-300">
                  <item.icon className="w-3.5 h-3.5 sm:w-4.5 sm:h-4.5 text-yellow-500" />
                </div>
                <h3 className="text-xs sm:text-base font-semibold text-foreground mb-0.5 group-hover:text-yellow-500 transition-colors">
                  {item.title}
                </h3>
                <p className="text-[10px] sm:text-xs text-muted-foreground leading-snug sm:leading-relaxed">
                  {item.desc}
                </p>
                {item.coming && (
                  <span className="absolute top-2 right-2 sm:top-3 sm:right-3 text-[8px] sm:text-[10px] font-medium px-1 sm:px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500">
                    Soon
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== HR & OPERATIONS ========== */}
      <section className="py-8 sm:py-24 px-3 sm:px-6 bg-muted/20">
        <div className="max-w-6xl mx-auto text-center">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 text-xs sm:text-sm font-medium mb-3 sm:mb-4">
            <Briefcase className="w-3.5 h-3.5" />
            Beyond ERP
          </span>
          <h2 className="text-[clamp(1.25rem,4.5vw,2.75rem)] font-bold text-foreground mb-2 sm:mb-3 leading-tight">
            Manage your <span className="text-yellow-500">people</span> too
          </h2>
          <p className="text-xs sm:text-base text-muted-foreground mb-5 sm:mb-10 max-w-2xl mx-auto px-2 sm:px-0">
            From employee advances to expense reimbursements with receipt attachments — QaliSuite keeps your operations running smooth.
          </p>

          <div className="grid sm:grid-cols-3 gap-2.5 sm:gap-4 max-w-3xl mx-auto">
            {[
              {
                icon: CreditCard,
                title: "Employee Advances",
                desc: "Issue and track petty cash & salary advances. Full settlement workflow with ledger integration.",
              },
              {
                icon: ClipboardCheck,
                title: "Reimbursements",
                desc: "Employees submit claims with receipt photos. Approve, settle, and auto-post to accounts.",
              },
              {
                icon: FileText,
                title: "Stock Requests",
                desc: "Request stock from warehouse. Multi-level approvals with inventory commitment on approval.",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="group p-3.5 sm:p-6 rounded-lg sm:rounded-2xl bg-card border border-border/50 hover:border-yellow-500/30 text-left transition-all duration-300"
              >
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-yellow-500/10 flex items-center justify-center mb-2.5 sm:mb-4 group-hover:bg-yellow-500/20 group-hover:scale-110 transition-all duration-300">
                  <item.icon className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-500" />
                </div>
                <h3 className="text-xs sm:text-base font-semibold text-foreground mb-1 sm:mb-1.5 group-hover:text-yellow-500 transition-colors">
                  {item.title}
                </h3>
                <p className="text-[11px] sm:text-sm text-muted-foreground leading-snug sm:leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== STATS ========== */}
      <section className="py-8 sm:py-20 px-3 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <div className="relative rounded-xl sm:rounded-3xl overflow-hidden">
            <div className="absolute inset-0 bg-linear-to-r from-yellow-400 via-yellow-500 to-orange-500" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(0,0,0,0)_0%,rgba(0,0,0,0.15)_100%)]" />

            <div className="relative px-4 py-6 sm:px-12 sm:py-14">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-8">
                {[
                  { value: "99.9%", label: "Uptime" },
                  { value: "10x", label: "Faster Ops" },
                  { value: "50+", label: "Hours Saved/Mo" },
                  { value: "24/7", label: "Support" },
                ].map((stat, i) => (
                  <div key={i} className="text-center">
                    <div className="text-xl sm:text-3xl lg:text-4xl font-bold text-black">{stat.value}</div>
                    <div className="text-[10px] sm:text-sm text-black/60 font-medium">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========== CTA ========== */}
      <section className="py-8 sm:py-24 px-3 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <div className="relative rounded-xl sm:rounded-3xl overflow-hidden">
            <div className="absolute inset-0 bg-linear-to-br from-gray-900 via-gray-900 to-black" />
            <div className="absolute top-0 right-0 w-48 sm:w-72 h-48 sm:h-72 bg-yellow-500/15 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-48 sm:w-72 h-48 sm:h-72 bg-orange-500/10 rounded-full blur-3xl" />

            <div className="relative px-5 py-10 sm:px-12 sm:py-20 text-center">
              <h2 className="text-[clamp(1.25rem,4vw,2.5rem)] font-bold text-white mb-2 sm:mb-3 leading-tight">
                Ready to streamline<br className="hidden sm:block" />
                <span className="bg-linear-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
                  your business?
                </span>
              </h2>
              <p className="text-gray-400 mb-5 sm:mb-8 text-xs sm:text-base max-w-md mx-auto">
                Start free. No credit card required. Set up in minutes.
              </p>
              <Button
                size="lg"
                className="group bg-linear-to-r from-yellow-400 to-yellow-600 hover:from-yellow-500 hover:to-orange-500 text-black font-bold px-6 sm:px-10 h-10 sm:h-14 rounded-xl sm:rounded-2xl shadow-2xl shadow-yellow-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 text-sm sm:text-base"
                asChild
              >
                <Link href="/login">
                  Start Free Trial
                  <ChevronRight className="ml-2 h-4 w-4 sm:h-5 sm:w-5 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <p className="text-gray-600 text-[10px] sm:text-xs mt-3 sm:mt-5">
                No credit card required. Cancel anytime.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer className="border-t border-border/30">
        <div className="max-w-6xl mx-auto px-3 sm:px-6">
          {/* Top section */}
          <div className="py-6 sm:py-14 grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-8 lg:gap-12">
            {/* Brand */}
            <div className="col-span-2 lg:col-span-1">
              <div className="flex items-center gap-2.5 mb-3 sm:mb-4">
                <div className="w-8 h-8 sm:w-9 sm:h-9 bg-linear-to-br from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center">
                  <span className="text-xs sm:text-sm font-black text-black">Q</span>
                </div>
                <div>
                  <span className="font-bold text-foreground text-base sm:text-lg">QaliSuite</span>
                  <p className="text-[10px] sm:text-xs text-muted-foreground -mt-0.5">by Qalibrated Systems</p>
                </div>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-xs">
                Modern ERP platform for inventory, invoicing, accounting, and business operations.
              </p>
            </div>

            {/* Quick Links */}
            <div>
              <h4 className="text-xs sm:text-sm font-semibold text-foreground mb-2.5 sm:mb-4">Product</h4>
              <ul className="space-y-1.5 sm:space-y-2.5">
                <li>
                  <Link href="/login" className="text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Login
                  </Link>
                </li>
                <li>
                  <Link href="/login" className="text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Get Started
                  </Link>
                </li>
                <li>
                  <Link href="/policy" className="text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Privacy Policy
                  </Link>
                </li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="text-xs sm:text-sm font-semibold text-foreground mb-2.5 sm:mb-4">Company</h4>
              <ul className="space-y-1.5 sm:space-y-2.5">
                <li>
                  <a
                    href="https://www.qalibrated.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                  >
                    www.qalibrated.com
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
                <li>
                  <span className="text-xs sm:text-sm text-muted-foreground">Qalibrated Systems Ltd</span>
                </li>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h4 className="text-xs sm:text-sm font-semibold text-foreground mb-2.5 sm:mb-4">Contact</h4>
              <ul className="space-y-1.5 sm:space-y-2.5">
                <li className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground">
                  <MapPin className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-yellow-500 shrink-0" />
                  Nairobi, Kenya
                </li>
                <li>
                  <a
                    href="mailto:info@qalibrated.com"
                    className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Mail className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-yellow-500 shrink-0" />
                    info@qalibrated.com
                  </a>
                </li>
                <li>
                  <a
                    href="tel:+254714999996"
                    className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Phone className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-yellow-500 shrink-0" />
                    +254 714 999 996
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="py-4 sm:py-5 border-t border-border/30 flex flex-col sm:flex-row items-center justify-between gap-2 sm:gap-3">
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} Qalibrated Systems Ltd. All rights reserved.
            </p>
            <div className="flex items-center gap-4 text-[10px] sm:text-xs text-muted-foreground">
              <Link href="/policy" className="hover:text-foreground transition-colors">Privacy</Link>
              <span className="text-border">|</span>
              <a href="mailto:info@qalibrated.com" className="hover:text-foreground transition-colors">Support</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
