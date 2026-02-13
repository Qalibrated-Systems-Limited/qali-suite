import { Button } from "../../components/ui/button";
import Link from "next/link";
import {
  Package,
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
} from "lucide-react";

export default function LandingPage() {
  const features = [
    {
      icon: Package,
      title: "Inventory Management",
      description: "Track stock levels, movements, and reorder points in real-time",
    },
    {
      icon: Receipt,
      title: "Invoicing & Billing",
      description: "Create professional invoices, quotes, and delivery notes",
    },
    {
      icon: Wallet,
      title: "Financial Accounting",
      description: "Manage accounts payable, receivable, and general ledger",
    },
    {
      icon: Users,
      title: "Customer Management",
      description: "Track customer relationships, history, and communications",
    },
    {
      icon: ClipboardList,
      title: "Purchase Orders",
      description: "Streamline procurement with automated purchase workflows",
    },
    {
      icon: BarChart3,
      title: "Analytics & Reports",
      description: "Gain insights with comprehensive dashboards and reports",
    },
  ];

  const highlights = [
    { icon: Zap, label: "Fast & Efficient" },
    { icon: Shield, label: "Secure & Reliable" },
    { icon: Globe, label: "Cloud Ready" },
    { icon: TrendingUp, label: "Real-time Insights" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/10 via-transparent to-transparent" />

        <div className="relative max-w-6xl mx-auto px-4 py-20 sm:py-32">
          <div className="text-center space-y-8">
            {/* Logo & Brand */}
            <div className="flex justify-center">
              <div className="w-20 h-20 bg-yellow-500 rounded-2xl flex items-center justify-center shadow-lg shadow-yellow-500/20">
                <Package className="w-12 h-12 text-black" />
              </div>
            </div>

            <div className="space-y-4">
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-foreground tracking-tight">
                QaliSuite
              </h1>
              <p className="text-xl sm:text-2xl text-yellow-500 font-medium">
                Enterprise Resource Planning
              </p>
              <p className="text-sm text-muted-foreground">
                by <span className="font-semibold text-foreground">Qalibrated Systems</span>
              </p>
            </div>

            {/* Tagline */}
            <div className="max-w-2xl mx-auto">
              <p className="text-xl sm:text-2xl text-muted-foreground">
                The complete business management solution for
                <span className="text-foreground font-semibold"> inventory</span>,
                <span className="text-foreground font-semibold"> finance</span>, and
                <span className="text-foreground font-semibold"> operations</span>
              </p>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <Button
                size="lg"
                className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold px-10 text-lg h-14 rounded-xl shadow-lg shadow-yellow-500/20"
                asChild
              >
                <Link href="/login">
                  Get Started
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
            </div>

            {/* Highlights */}
            <div className="flex flex-wrap items-center justify-center gap-6 pt-8">
              {highlights.map((item, index) => (
                <div key={index} className="flex items-center gap-2 text-muted-foreground">
                  <item.icon className="w-4 h-4 text-yellow-500" />
                  <span className="text-sm">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Everything You Need to Run Your Business
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            A comprehensive suite of tools designed to streamline your operations
            and drive growth
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <div
              key={index}
              className="p-6 rounded-xl border border-border bg-card hover:bg-accent/50 transition-all duration-300 hover:shadow-lg hover:shadow-yellow-500/5 group"
            >
              <div className="w-12 h-12 bg-yellow-500/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-yellow-500/20 transition-colors">
                <feature.icon className="w-6 h-6 text-yellow-500" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Stats Section */}
      <div className="border-y border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { value: "99.9%", label: "Uptime" },
              { value: "10x", label: "Faster Operations" },
              { value: "360°", label: "Business View" },
              { value: "24/7", label: "Support Ready" },
            ].map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-3xl sm:text-4xl font-bold text-yellow-500 mb-2">
                  {stat.value}
                </div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center space-y-6 p-8 sm:p-12 rounded-2xl bg-gradient-to-br from-yellow-500/10 via-yellow-500/5 to-transparent border border-yellow-500/20">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
            Ready to Transform Your Business?
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Join businesses that trust QaliSuite for their daily operations.
            Get started today and see the difference.
          </p>
          <Button
            size="lg"
            className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold px-8 h-12 rounded-xl"
            asChild
          >
            <Link href="/login">
              Start Now
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-yellow-500 rounded-lg flex items-center justify-center">
                <Package className="w-5 h-5 text-black" />
              </div>
              <span className="font-semibold text-foreground">QaliSuite</span>
            </div>
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Qalibrated Systems. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
