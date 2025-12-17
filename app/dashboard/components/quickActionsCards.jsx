"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Plus,
  FileText,
  Package,
  TrendingUp,
  Download,
  Settings,
} from "lucide-react";

export function QuickActionsCard() {
  const actions = [
    {
      title: "New Request",
      description: "Create stock request",
      icon: FileText,
      href: "/dashboard/requests/create",
      color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
    {
      title: "Add Stock",
      description: "Add new product",
      icon: Package,
      href: "/dashboard/stocks/create",
      color: "bg-green-500/10 text-green-600 dark:text-green-400",
    },
    {
      title: "View Reports",
      description: "Analytics & insights",
      icon: TrendingUp,
      href: "/dashboard/reports",
      color: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    },
    {
      title: "Export Data",
      description: "Download records",
      icon: Download,
      href: "/dashboard/exports",
      color: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    },
  ];

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Quick Actions
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {actions.map((action) => (
            <Button
              key={action.title}
              variant="outline"
              className="h-auto flex-col items-start p-4 border-border hover:bg-accent"
              asChild
            >
              <Link href={action.href}>
                <div className={`p-2 rounded-lg mb-2 ${action.color}`}>
                  <action.icon className="h-5 w-5" />
                </div>
                <p className="font-medium text-sm text-foreground">
                  {action.title}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {action.description}
                </p>
              </Link>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
