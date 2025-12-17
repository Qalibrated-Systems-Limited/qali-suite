import { Button } from "../../components/ui/button";
import Link from "next/link";
import { Package, ArrowRight, Sparkles } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-4xl w-full text-center space-y-12">
        {/* Logo & Brand */}
        <div className="space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-yellow-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Package className="w-12 h-12 text-black" />
            </div>
          </div>

          <div className="space-y-3">
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-foreground">
              StockVault
            </h1>
            <div className="flex items-center justify-center gap-2 text-yellow-500">
              <Sparkles className="w-5 h-5" />
              <span className="text-lg font-medium">Inventory Made Simple</span>
              <Sparkles className="w-5 h-5" />
            </div>
            {/* Qalibrated Systems Badge */}
            <div className="pt-2">
              <p className="text-sm text-muted-foreground">
                by{" "}
                <span className="font-semibold text-foreground">
                  Qalibrated Systems
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="max-w-2xl mx-auto space-y-4">
          <p className="text-2xl sm:text-3xl font-semibold text-foreground">
            The most comprehensive and efficient
          </p>
          <p className="text-2xl sm:text-3xl font-semibold text-muted-foreground">
            store management system
          </p>
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
          <Button
            size="lg"
            className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold px-10 text-lg h-14 rounded-xl"
            asChild
          >
            <Link href="/login">
              Get Started
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-12">
          {[
            { label: "Real-time Tracking", emoji: "📊" },
            { label: "Smart Analytics", emoji: "📈" },
            { label: "Secure & Fast", emoji: "🔒" },
          ].map((feature, index) => (
            <div
              key={index}
              className="p-6 rounded-xl border border-border bg-card hover:bg-accent transition-colors"
            >
              <div className="text-4xl mb-3">{feature.emoji}</div>
              <div className="text-foreground font-medium">{feature.label}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="pt-12 text-xs text-muted-foreground">
          © 2025 Qalibrated Systems. All rights reserved.
        </div>
      </div>
    </div>
  );
}
