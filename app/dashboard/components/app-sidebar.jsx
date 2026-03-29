"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Bell,
  Menu,
  User,
  Settings,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MobileNav } from "@/components/mobile-nav";
import { PcNav } from "@/components/pc-nav";
import { MobileSearch } from "@/components/search";
import { useTheme } from "next-themes";
import { QaliSuiteIcon } from "@/components/qalisuite-logo";

export function AppSidebar({ children, user, ...props }) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const { theme, setTheme } = useTheme();

  // Avoid hydration mismatch & restore collapsed state
  React.useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved !== null) setSidebarCollapsed(JSON.parse(saved));
  }, []);

  // Auto-collapse between lg (1024) and xl (1280)
  React.useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      if (w >= 1024 && w < 1280) {
        setSidebarCollapsed(true);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", JSON.stringify(next));
      return next;
    });
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      <PcNav user={user} collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <MobileNav
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        user={user}
      />
      <main className="flex-1 overflow-y-auto w-full">
        <header className="bg-card/80 backdrop-blur-sm border-b border-border sticky top-0 z-10">
          <div className="px-3 sm:px-4 md:px-6 lg:px-8 py-2 sm:py-2.5">
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Left: Mobile Menu + Logo */}
              <div className="flex items-center gap-1.5 lg:hidden shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-foreground hover:bg-accent h-8 w-8"
                  onClick={() => setMobileMenuOpen(true)}
                >
                  <Menu className="w-5 h-5" />
                </Button>
                <QaliSuiteIcon className="w-8 h-8" />
              </div>

              {/* Right: Action Buttons */}
              <div className="flex items-center gap-0.5 sm:gap-1.5 ml-auto shrink-0">
                {/* Mobile search icon — opens command palette */}
                <MobileSearch />

                {/* Theme Toggle */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden sm:inline-flex text-muted-foreground hover:text-foreground hover:bg-accent h-8 w-8"
                  onClick={() =>
                    setTheme(theme === "dark" ? "light" : "dark")
                  }
                >
                  {mounted ? (
                    theme === "dark" ? (
                      <Sun className="w-4 h-4" />
                    ) : (
                      <Moon className="w-4 h-4" />
                    )
                  ) : (
                    <Sun className="w-4 h-4 opacity-0" />
                  )}
                  <span className="sr-only">Toggle theme</span>
                </Button>

                {/* Notifications */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden sm:inline-flex text-muted-foreground hover:text-foreground hover:bg-accent h-8 w-8"
                >
                  <Bell className="w-4 h-4" />
                  <span className="sr-only">Notifications</span>
                </Button>

                {/* User Menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hidden sm:inline-flex text-muted-foreground hover:text-foreground hover:bg-accent h-8 w-8"
                    >
                      <User className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-56 bg-card border-border"
                  >
                    <DropdownMenuLabel>
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {user?.name || "User"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {user?.email || "user@example.com"}
                        </p>
                        <p className="text-xs text-yellow-500 font-medium">
                          {user?.role || "User"}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-border" />

                    <DropdownMenuItem className="focus:bg-accent focus:text-accent-foreground cursor-pointer">
                      <User className="mr-2 h-4 w-4" />
                      <span>Profile</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem className="focus:bg-accent focus:text-accent-foreground cursor-pointer">
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Settings</span>
                    </DropdownMenuItem>

                    <DropdownMenuSeparator className="bg-border" />

                    <DropdownMenuItem className="focus:bg-destructive/10 focus:text-destructive cursor-pointer">
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Log out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
