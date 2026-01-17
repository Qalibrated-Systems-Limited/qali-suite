"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  Menu,
  ShoppingCart,
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
import { CreateButton } from "@/app/dashboard/components/smartCreateButton";
import { SmartSearch } from "@/components/search";
import { useTheme } from "next-themes";

export function AppSidebar({ children, user, cartItemsCount = 0, ...props }) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const { theme, setTheme } = useTheme();

  // Avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <PcNav user={user} />
      <MobileNav
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        user={user}
      />
      <main className="flex-1 overflow-y-auto w-full">
        <header className="bg-card border-b border-border sticky top-0 z-10 shadow-sm">
          <div className="px-3 sm:px-4 md:px-6 lg:px-8 py-3 md:py-4">
            {/* Top Row: Logo/Menu, Search, Actions */}
            <div className="flex items-center justify-between gap-2 sm:gap-3">
              {/* Left: Mobile Menu + Logo */}
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden text-foreground hover:text-foreground hover:bg-accent h-9 w-9"
                  onClick={() => setMobileMenuOpen(true)}
                >
                  <Menu className="w-5 h-5" />
                </Button>

                {/* Logo on mobile */}
                <div className="lg:hidden">
                  <span className="text-yellow-500 font-bold text-lg">Q</span>
                </div>
              </div>

              {/* Center: Smart Search - Always visible */}
              <SmartSearch />

              {/* Right: Action Buttons */}
              <div className="flex items-center gap-1 sm:gap-2">
                {/* Theme Toggle - HIDDEN on mobile (in sidebar) */}
                {mounted && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hidden sm:flex text-foreground hover:text-foreground hover:bg-accent h-9 w-9"
                    onClick={() =>
                      setTheme(theme === "dark" ? "light" : "dark")
                    }
                  >
                    {theme === "dark" ? (
                      <Sun className="w-5 h-5" />
                    ) : (
                      <Moon className="w-5 h-5" />
                    )}
                    <span className="sr-only">Toggle theme</span>
                  </Button>
                )}

                {/* Cart Button - Always visible */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative text-foreground hover:text-foreground hover:bg-accent h-9 w-9"
                  asChild
                >
                  <Link href="/dashboard/cart">
                    <ShoppingCart className="w-5 h-5" />
                    {cartItemsCount > 0 && (
                      <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 bg-yellow-500 text-black text-xs font-bold border-2 border-background">
                        {cartItemsCount > 9 ? "9+" : cartItemsCount}
                      </Badge>
                    )}
                    <span className="sr-only">Shopping cart</span>
                  </Link>
                </Button>

                {/* Notifications - Hidden on mobile */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative text-foreground hover:text-foreground hover:bg-accent h-9 w-9 hidden sm:flex"
                >
                  <Bell className="w-5 h-5" />
                  <span className="sr-only">Notifications</span>
                </Button>

                {/* Smart Create Button */}
                <CreateButton user={user} />

                {/* User Menu - HIDDEN on mobile (in sidebar) */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hidden sm:flex text-foreground hover:text-foreground hover:bg-accent h-9 w-9"
                    >
                      <User className="w-5 h-5" />
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
