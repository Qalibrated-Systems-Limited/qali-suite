import { Button } from "../../components/ui/button";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Receipt,
  Users,
  Wallet,
  ClipboardList,
  TrendingUp,
  Shield,
  Zap,
  Globe,
  CheckCircle2,
  Sparkles,
  LineChart,
  Package,
  ArrowUpRight,
  Play,
  Layers,
  Clock,
  PieChart,
} from "lucide-react";

export default function LandingPage() {
  const features = [
    {
      icon: Package,
      title: "Inventory Management",
      description: "Track stock levels, movements, and reorder points in real-time with smart alerts",
      color: "from-blue-500 to-cyan-500",
    },
    {
      icon: Receipt,
      title: "Invoicing & Billing",
      description: "Create professional invoices, quotes, and delivery notes in seconds",
      color: "from-green-500 to-emerald-500",
    },
    {
      icon: Wallet,
      title: "Financial Accounting",
      description: "Manage accounts payable, receivable, and general ledger effortlessly",
      color: "from-purple-500 to-violet-500",
    },
    {
      icon: Users,
      title: "Customer Management",
      description: "Build stronger relationships with complete customer history and insights",
      color: "from-orange-500 to-amber-500",
    },
    {
      icon: ClipboardList,
      title: "Purchase Orders",
      description: "Streamline procurement with automated purchase workflows and approvals",
      color: "from-pink-500 to-rose-500",
    },
    {
      icon: BarChart3,
      title: "Analytics & Reports",
      description: "Make data-driven decisions with comprehensive dashboards and reports",
      color: "from-indigo-500 to-blue-500",
    },
  ];

  const highlights = [
    { icon: Zap, label: "Lightning Fast" },
    { icon: Shield, label: "Bank-grade Security" },
    { icon: Globe, label: "Access Anywhere" },
    { icon: Clock, label: "Real-time Sync" },
  ];

  const benefits = [
    { text: "Reduce manual data entry by 80%", icon: TrendingUp },
    { text: "Real-time visibility into operations", icon: PieChart },
    { text: "Automate repetitive business tasks", icon: Layers },
    { text: "Generate reports in one click", icon: BarChart3 },
    { text: "Access from anywhere, anytime", icon: Globe },
    { text: "Scale as your business grows", icon: ArrowUpRight },
  ];

  const stats = [
    { value: "99.9%", label: "Uptime", suffix: "" },
    { value: "10", label: "Faster Operations", suffix: "x" },
    { value: "50", label: "Hours Saved/Month", suffix: "+" },
    { value: "24/7", label: "Support", suffix: "" },
  ];

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Hero Section */}
      <div className="relative min-h-screen flex items-center">
        {/* Animated Background */}
        <div className="absolute inset-0 overflow-hidden">
          {/* Main gradient orbs */}
          <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-yellow-500/30 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-yellow-600/20 rounded-full blur-[100px] animate-pulse delay-700" />
          <div className="absolute top-1/2 left-0 w-[300px] h-[300px] bg-orange-500/10 rounded-full blur-[80px] animate-pulse delay-1000" />

        </div>

        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8881_1px,transparent_1px),linear-gradient(to_bottom,#8881_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_50%,#000_40%,transparent_100%)]" />

        <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="text-center space-y-8">
            {/* Announcement Badge */}
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-500 text-sm font-medium backdrop-blur-sm">
                <Sparkles className="w-4 h-4" />
                <span>Complete ERP Solution for Growing Businesses</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </div>

            {/* Logo */}
            <div className="flex justify-center">
              <div className="relative group">
                <div className="absolute -inset-2 bg-gradient-to-r from-yellow-400 via-yellow-500 to-orange-500 rounded-3xl blur-lg opacity-40 group-hover:opacity-60 transition duration-500 animate-pulse" />
                <div className="relative w-24 h-24 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-2xl flex items-center justify-center shadow-2xl transform group-hover:scale-105 transition duration-300">
                  <span className="text-5xl font-bold text-black">Q</span>
                </div>
              </div>
            </div>

            {/* Main Heading */}
            <div className="space-y-4">
              <h1 className="text-6xl sm:text-7xl lg:text-8xl font-bold tracking-tight">
                <span className="text-foreground">Qali</span>
                <span className="bg-gradient-to-r from-yellow-400 via-yellow-500 to-orange-500 bg-clip-text text-transparent">Suite</span>
              </h1>
              <p className="text-2xl sm:text-3xl font-medium text-muted-foreground">
                Enterprise Resource Planning
              </p>
            </div>

            {/* Tagline */}
            <div className="max-w-4xl mx-auto">
              <p className="text-xl sm:text-2xl lg:text-3xl text-muted-foreground leading-relaxed">
                Manage your{" "}
                <span className="text-foreground font-semibold relative">
                  inventory
                  <span className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-full" />
                </span>
                ,{" "}
                <span className="text-foreground font-semibold relative">
                  finances
                  <span className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-full" />
                </span>
                , and{" "}
                <span className="text-foreground font-semibold relative">
                  operations
                  <span className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-full" />
                </span>
                {" "}in one powerful platform
              </p>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
              <Button
                size="lg"
                className="group bg-gradient-to-r from-yellow-400 via-yellow-500 to-yellow-600 hover:from-yellow-500 hover:via-yellow-600 hover:to-orange-500 text-black font-bold px-10 text-lg h-16 rounded-2xl shadow-2xl shadow-yellow-500/30 transform hover:scale-105 hover:-translate-y-1 transition-all duration-300"
                asChild
              >
                <Link href="/login">
                  Get Started Free
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="group px-8 text-lg h-16 rounded-2xl border-2 border-border/50 hover:border-yellow-500/50 hover:bg-yellow-500/5 backdrop-blur-sm transition-all duration-300"
                asChild
              >
                <Link href="/login">
                  <Play className="mr-2 h-5 w-5 group-hover:scale-110 transition-transform" />
                  Watch Demo
                </Link>
              </Button>
            </div>

            {/* Highlights */}
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 pt-12">
              {highlights.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 px-5 py-3 rounded-full bg-card/50 border border-border/50 backdrop-blur-sm hover:border-yellow-500/30 hover:bg-yellow-500/5 transition-all duration-300"
                >
                  <div className="w-8 h-8 rounded-full bg-yellow-500/10 flex items-center justify-center">
                    <item.icon className="w-4 h-4 text-yellow-500" />
                  </div>
                  <span className="text-sm font-medium text-foreground">{item.label}</span>
                </div>
              ))}
            </div>

            {/* Scroll indicator */}
            <div className="pt-16 animate-bounce">
              <div className="w-6 h-10 rounded-full border-2 border-muted-foreground/30 mx-auto flex justify-center pt-2">
                <div className="w-1.5 h-3 bg-muted-foreground/50 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="relative py-24 sm:py-32">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/30 to-background" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 text-sm font-medium mb-6">
              <Layers className="w-4 h-4" />
              Powerful Features
            </span>
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
              Everything You Need to{" "}
              <span className="bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">Succeed</span>
            </h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              A comprehensive suite of tools designed to streamline your operations and accelerate business growth
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {features.map((feature, index) => (
              <div
                key={index}
                className="group relative p-8 rounded-3xl bg-card border border-border/50 hover:border-yellow-500/30 transition-all duration-500 hover:shadow-2xl hover:shadow-yellow-500/10 hover:-translate-y-2"
              >
                {/* Gradient overlay on hover */}
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-yellow-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                <div className="relative">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 shadow-lg`}>
                    <feature.icon className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-3 group-hover:text-yellow-500 transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <div className="py-20 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative rounded-[2.5rem] overflow-hidden">
            {/* Background */}
            <div className="absolute inset-0 bg-gradient-to-r from-yellow-400 via-yellow-500 to-orange-500" />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000010_1px,transparent_1px),linear-gradient(to_bottom,#00000010_1px,transparent_1px)] bg-[size:40px_40px]" />

            <div className="relative px-8 py-16 sm:px-16 sm:py-20">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
                {stats.map((stat, index) => (
                  <div key={index} className="text-center">
                    <div className="text-4xl sm:text-5xl lg:text-6xl font-bold text-black mb-2">
                      {stat.value}
                      <span className="text-black/70">{stat.suffix}</span>
                    </div>
                    <div className="text-black/70 font-medium">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Benefits Section */}
      <div className="py-24 sm:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
            <div>
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 text-sm font-medium mb-6">
                <TrendingUp className="w-4 h-4" />
                Why Choose QaliSuite
              </span>
              <h2 className="text-4xl sm:text-5xl font-bold text-foreground mb-6 leading-tight">
                Transform How You{" "}
                <span className="bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
                  Run Your Business
                </span>
              </h2>
              <p className="text-xl text-muted-foreground mb-10 leading-relaxed">
                QaliSuite helps businesses of all sizes streamline operations,
                reduce costs, and make better decisions with real-time data and intelligent automation.
              </p>

              <div className="grid gap-4">
                {benefits.map((benefit, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border/50 hover:border-yellow-500/30 hover:bg-yellow-500/5 transition-all duration-300"
                  >
                    <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center shrink-0">
                      <benefit.icon className="w-5 h-5 text-yellow-500" />
                    </div>
                    <span className="font-medium text-foreground">{benefit.text}</span>
                    <CheckCircle2 className="w-5 h-5 text-green-500 ml-auto shrink-0" />
                  </div>
                ))}
              </div>
            </div>

            {/* Visual Element */}
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 rounded-[2rem] blur-2xl" />
              <div className="relative bg-card border border-border rounded-[2rem] p-8 sm:p-12 shadow-2xl">
                {/* Mock Dashboard Preview */}
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center">
                      <span className="text-xl font-bold text-black">Q</span>
                    </div>
                    <div>
                      <div className="h-3 w-24 bg-foreground/20 rounded-full" />
                      <div className="h-2 w-16 bg-foreground/10 rounded-full mt-2" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="p-4 rounded-xl bg-muted/50">
                        <div className="h-2 w-12 bg-foreground/20 rounded-full mb-2" />
                        <div className="h-6 w-16 bg-yellow-500/30 rounded" />
                      </div>
                    ))}
                  </div>

                  <div className="p-4 rounded-xl bg-muted/50">
                    <div className="flex gap-2 mb-4">
                      {[...Array(7)].map((_, i) => (
                        <div
                          key={i}
                          className="flex-1 bg-gradient-to-t from-yellow-500/30 to-yellow-500/10 rounded"
                          style={{ height: `${40 + Math.random() * 60}px` }}
                        />
                      ))}
                    </div>
                    <div className="h-2 w-32 bg-foreground/10 rounded-full" />
                  </div>

                  <div className="flex gap-4">
                    <div className="flex-1 p-4 rounded-xl bg-green-500/10">
                      <div className="h-2 w-16 bg-green-500/30 rounded-full mb-2" />
                      <div className="h-4 w-20 bg-green-500/20 rounded" />
                    </div>
                    <div className="flex-1 p-4 rounded-xl bg-blue-500/10">
                      <div className="h-2 w-16 bg-blue-500/30 rounded-full mb-2" />
                      <div className="h-4 w-20 bg-blue-500/20 rounded" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="py-24 sm:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative rounded-[2.5rem] overflow-hidden">
            {/* Background */}
            <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-900 to-black" />
            <div className="absolute inset-0">
              <div className="absolute top-0 right-0 w-96 h-96 bg-yellow-500/20 rounded-full blur-3xl" />
              <div className="absolute bottom-0 left-0 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
            </div>

            <div className="relative px-8 py-20 sm:px-16 sm:py-28 text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-500/20 text-yellow-400 text-sm font-medium mb-8">
                <Sparkles className="w-4 h-4" />
                Start Your Free Trial Today
              </div>

              <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
                Ready to Transform
                <br />
                <span className="bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
                  Your Business?
                </span>
              </h2>

              <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
                Join businesses that trust QaliSuite for their daily operations.
                Get started in minutes, no credit card required.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button
                  size="lg"
                  className="group bg-gradient-to-r from-yellow-400 to-yellow-600 hover:from-yellow-500 hover:to-orange-500 text-black font-bold px-12 text-lg h-16 rounded-2xl shadow-2xl shadow-yellow-500/30 transform hover:scale-105 transition-all duration-300"
                  asChild
                >
                  <Link href="/login">
                    Start Free Trial
                    <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </Button>
              </div>

              <p className="text-gray-500 text-sm mt-6">
                No credit card required. Cancel anytime.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-xl flex items-center justify-center shadow-lg">
                <span className="text-2xl font-bold text-black">Q</span>
              </div>
              <div>
                <span className="font-bold text-foreground text-xl">QaliSuite</span>
                <p className="text-sm text-muted-foreground">Enterprise Resource Planning</p>
              </div>
            </div>

            <div className="flex items-center gap-8">
              <Link href="/login" className="text-muted-foreground hover:text-foreground transition-colors">
                Login
              </Link>
              <Link href="/login" className="text-muted-foreground hover:text-foreground transition-colors">
                Contact
              </Link>
              <Link href="/login" className="text-muted-foreground hover:text-foreground transition-colors">
                Support
              </Link>
            </div>

            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Qalibrated Systems. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
