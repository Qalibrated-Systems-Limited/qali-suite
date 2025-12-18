"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  Menu,
  Plus,
  Search,
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
import { Input } from "@/components/ui/input";
import { CreateButton } from "@/components/createButton";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";

export function AppSidebar({ children, user, cartItemsCount = 0, ...props }) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  // Avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const createButtonIsNotVisible =
    (pathname.startsWith("/dashboard/user") && user?.role !== "Admin") ||
    (pathname.startsWith("/dashboard/stocks") &&
      !["Admin", "Store Manager"].includes(user?.role));

  // Determine what the Create button should show/link to
  const shouldCreateRequest = [
    "/dashboard/requests",
    "/dashboard/checkout",
    "/dashboard/movement",
    "/dashboard",
    "/dashboard/cart",
  ].includes(pathname);

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

              {/* Center: Search Bar */}
              <div className="flex-1 max-w-2xl">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search products, invoices, customers..."
                    className="pl-10 pr-4 bg-background border-input text-foreground placeholder:text-muted-foreground focus-visible:ring-yellow-500 focus-visible:border-yellow-500 text-sm h-9 sm:h-10"
                  />
                </div>
              </div>

              {/* Right: Action Buttons */}
              <div className="flex items-center gap-1 sm:gap-2">
                {/* Theme Toggle - Always visible */}
                {mounted && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-foreground hover:text-foreground hover:bg-accent h-9 w-9"
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

                {/* Cart Button */}
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

                {/* Create Button */}
                {!createButtonIsNotVisible && (
                  <>
                    {/* Mobile: Icon only */}
                    <Button
                      size="icon"
                      className="bg-yellow-500 text-black hover:bg-yellow-600 font-medium sm:hidden h-9 w-9"
                      asChild
                    >
                      <Link
                        href={
                          shouldCreateRequest
                            ? "/dashboard/requests/create"
                            : `${pathname}/create`
                        }
                      >
                        <Plus className="w-5 h-5" />
                      </Link>
                    </Button>

                    {/* Desktop: Full button */}
                    <div className="hidden sm:block">
                      <CreateButton />
                    </div>
                  </>
                )}

                {/* User Menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-foreground hover:text-foreground hover:bg-accent h-9 w-9"
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

                    {/* Theme Toggle in Menu (Mobile alternative) */}
                    {mounted && (
                      <DropdownMenuItem
                        className="focus:bg-accent focus:text-accent-foreground cursor-pointer sm:hidden"
                        onClick={() =>
                          setTheme(theme === "dark" ? "light" : "dark")
                        }
                      >
                        {theme === "dark" ? (
                          <>
                            <Sun className="mr-2 h-4 w-4" />
                            <span>Light Mode</span>
                          </>
                        ) : (
                          <>
                            <Moon className="mr-2 h-4 w-4" />
                            <span>Dark Mode</span>
                          </>
                        )}
                      </DropdownMenuItem>
                    )}

                    {/* Mobile-only menu items */}
                    <DropdownMenuItem
                      className="focus:bg-accent focus:text-accent-foreground cursor-pointer sm:hidden"
                      asChild
                    >
                      <Link href="/dashboard/cart">
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        <span>Cart ({cartItemsCount})</span>
                      </Link>
                    </DropdownMenuItem>

                    <DropdownMenuItem className="focus:bg-accent focus:text-accent-foreground cursor-pointer sm:hidden">
                      <Bell className="mr-2 h-4 w-4" />
                      <span>Notifications</span>
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
