"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/utils";
import { logout } from "@/app/mongodb/actions/auth-actions";
import {
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
import { usePathname } from "next/navigation";
import { QaliSuiteIcon } from "@/components/qalisuite-logo";
import NotificationBell from "./NotificationBell";
import { titleForPath } from "@/lib/nav/route-titles";

export function AppSidebar({ children, user, notifications, ...props }) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  // Current page title for the mobile header — desktop has the sidebar
  // for context, phones lose the h1 the moment they scroll.
  const pageTitle = titleForPath(pathname);

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
              {/* Left: Logo (+ menu on tablets). Phones (<sm) get no
                  hamburger — the bottom nav's "More" sheet covers full
                  navigation there; tablets (sm–lg) have no bottom nav,
                  so they keep the drawer trigger. */}
              <div className="flex items-center gap-1.5 lg:hidden shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden sm:inline-flex text-foreground hover:bg-accent h-8 w-8"
                  onClick={() => setMobileMenuOpen(true)}
                >
                  <Menu className="w-5 h-5" />
                </Button>
                <QaliSuiteIcon className="w-8 h-8" />
              </div>

              {/* Center: current page title (mobile only — desktop has the
                  sidebar for context). Truncates rather than wraps. */}
              {pageTitle && (
                <span className="min-w-0 flex-1 truncate text-center text-sm font-semibold lg:hidden">
                  {pageTitle}
                </span>
              )}

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

                {/* Notifications — visible on all breakpoints (mobile too) */}
                <NotificationBell
                  items={notifications?.items || []}
                  unread={notifications?.unread || 0}
                />

                {/* User Menu — visible on ALL breakpoints. On phones this
                    is the only home for profile / theme / logout (no
                    hamburger, and the bottom nav is destinations-only). */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                        {getInitials(user?.name || user?.email || "U")}
                      </span>
                      <span className="sr-only">Account menu</span>
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
                          {user?.email || ""}
                        </p>
                        <p className="text-xs text-yellow-500 font-medium">
                          {user?.role || "User"}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-border" />

                    <DropdownMenuItem asChild className="cursor-pointer focus:bg-accent focus:text-accent-foreground">
                      <Link href="/dashboard/profile">
                        <User className="mr-2 h-4 w-4" />
                        <span>My Profile</span>
                      </Link>
                    </DropdownMenuItem>

                    <DropdownMenuItem asChild className="cursor-pointer focus:bg-accent focus:text-accent-foreground">
                      <Link href="/dashboard/settings">
                        <Settings className="mr-2 h-4 w-4" />
                        <span>Settings</span>
                      </Link>
                    </DropdownMenuItem>

                    {/* Theme switch lives here on phones — the standalone
                        header toggle is sm+ only. */}
                    <DropdownMenuItem
                      className="cursor-pointer focus:bg-accent focus:text-accent-foreground sm:hidden"
                      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                    >
                      {mounted && theme === "dark" ? (
                        <Sun className="mr-2 h-4 w-4" />
                      ) : (
                        <Moon className="mr-2 h-4 w-4" />
                      )}
                      <span>{mounted && theme === "dark" ? "Light mode" : "Dark mode"}</span>
                    </DropdownMenuItem>

                    <DropdownMenuSeparator className="bg-border" />

                    <form
                      action={async () => {
                        await logout();
                      }}
                    >
                      <DropdownMenuItem asChild className="cursor-pointer focus:bg-destructive/10 focus:text-destructive">
                        <button type="submit" className="w-full">
                          <LogOut className="mr-2 h-4 w-4" />
                          <span>Log out</span>
                        </button>
                      </DropdownMenuItem>
                    </form>
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
