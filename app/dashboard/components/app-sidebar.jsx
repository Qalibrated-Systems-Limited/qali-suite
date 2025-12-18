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

export function AppSidebar({ children, user, cartItemsCount = 0, ...props }) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const pathname = usePathname();

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
    <div className="flex h-screen bg-[#0d1117] text-gray-100">
      <PcNav user={user} />
      <MobileNav
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        user={user}
      />
      <main className="flex-1 overflow-y-auto w-full">
        <header className="bg-[#161b22] border-b border-[#30363d] sticky top-0 z-10">
          <div className="px-3 sm:px-4 md:px-6 lg:px-8 py-3 md:py-4">
            {/* Top Row: Logo/Menu, Search, Actions */}
            <div className="flex items-center justify-between gap-2 sm:gap-3">
              {/* Left: Mobile Menu + Logo (optional) */}
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden text-gray-300 hover:text-white hover:bg-[#1f2937] h-9 w-9"
                  onClick={() => setMobileMenuOpen(true)}
                >
                  <Menu className="w-5 h-5" />
                </Button>

                {/* Optional: Show logo/brand on mobile when sidebar is hidden */}
                <div className="lg:hidden">
                  <span className="text-yellow-500 font-bold text-lg">Q</span>
                </div>
              </div>

              {/* Center: Search Bar */}
              <div className="flex-1 max-w-2xl">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search products, invoices, customers..."
                    className="pl-10 pr-4 bg-[#0d1117] border-[#30363d] text-gray-100 placeholder:text-gray-500 focus:border-yellow-500 focus:ring-yellow-500 text-sm h-9 sm:h-10"
                  />
                </div>
              </div>

              {/* Right: Action Buttons */}
              <div className="flex items-center gap-1 sm:gap-2">
                {/* Cart Button - Always visible */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative text-gray-300 hover:text-white hover:bg-[#1f2937] h-9 w-9"
                  asChild
                >
                  <Link href="/dashboard/cart">
                    <ShoppingCart className="w-5 h-5" />
                    {cartItemsCount > 0 && (
                      <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 bg-yellow-500 text-black text-xs font-bold border-2 border-[#161b22]">
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
                  className="relative text-gray-300 hover:text-white hover:bg-[#1f2937] h-9 w-9 hidden sm:flex"
                >
                  <Bell className="w-5 h-5" />
                </Button>

                {/* Create Button - Always visible on all screen sizes */}
                {!createButtonIsNotVisible && (
                  <>
                    {/* Mobile: Icon only with responsive link */}
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

                    {/* Tablet & Desktop: Full button with text */}
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
                      className="text-gray-300 hover:text-white hover:bg-[#1f2937] h-9 w-9"
                    >
                      <User className="w-5 h-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-56 bg-[#161b22] border-[#30363d] text-gray-100"
                  >
                    <DropdownMenuLabel>
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium text-gray-100">
                          {user?.name || "User"}
                        </p>
                        <p className="text-xs text-gray-400">
                          {user?.email || "user@example.com"}
                        </p>
                        <p className="text-xs text-yellow-500">
                          {user?.role || "User"}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-[#30363d]" />
                    <DropdownMenuItem className="focus:bg-[#1f2937] focus:text-white">
                      <User className="mr-2 h-4 w-4" />
                      <span>Profile</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem className="focus:bg-[#1f2937] focus:text-white">
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Settings</span>
                    </DropdownMenuItem>
                    {/* Mobile-only menu items */}
                    <DropdownMenuItem
                      className="focus:bg-[#1f2937] focus:text-white sm:hidden"
                      asChild
                    >
                      <Link href="/dashboard/cart">
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        <span>Cart ({cartItemsCount})</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem className="focus:bg-[#1f2937] focus:text-white sm:hidden">
                      <Bell className="mr-2 h-4 w-4" />
                      <span>Notifications</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-[#30363d]" />
                    <DropdownMenuItem className="focus:bg-red-500/10 focus:text-red-400">
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
