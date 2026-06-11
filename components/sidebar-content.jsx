"use client";

import {
  Boxes,
  LayoutDashboard,
  List,
  Package,
  Settings,
  Users,
  Activity,
  LogOut,
  Receipt,
  FileText,
  User,
  FolderKanban,
  ClipboardCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "./ui/dropdown-menu";
import { getInitials } from "@/lib/utils";
import { logout } from "@/app/mongodb/actions/auth-actions";
import { NextThemeToggler } from "./NextThemeToggler";

export const SidebarContent = ({ onItemClick, user }) => {
  const pathname = usePathname();

  const sidebarItems = [
    {
      icon: LayoutDashboard,
      label: "Dashboard",
      id: ".",
      href: "/dashboard",
    },
    {
      icon: Boxes,
      label: "Stocks",
      id: "stocks",
      href: "/dashboard/stocks",
      hidden: user?.role !== "Admin" && user?.role !== "Store Manager",
    },
    {
      icon: List,
      label: "Requests",
      id: "requests",
      href: "/dashboard/requests",
    },
    {
      icon: FolderKanban,
      label: "Projects",
      id: "projects",
      href: "/dashboard/projects",
      hidden: !["Admin", "admin", "Accountant", "Manager"].includes(user?.role),
    },
    {
      icon: Package,
      label: "Checkouts",
      id: "checkout",
      href: "/dashboard/checkout",
    },
    {
      icon: Activity,
      label: "Movements",
      id: "movements",
      href: "/dashboard/movements",
    },
    {
      icon: ClipboardCheck,
      label: "Goods Receipts",
      id: "grn",
      href: "/dashboard/grn",
    },
    {
      icon: Receipt,
      label: "Invoices",
      id: "invoices",
      href: "/dashboard/invoices",
      hidden: !["Admin", "admin", "Accountant"].includes(user?.role),
    },
    {
      icon: Users,
      label: "Users",
      id: "users",
      href: "/dashboard/users",
      hidden: user?.role !== "Admin",
    },
  ];

  const isActive = (itemId, itemHref) => {
    if (itemId === ".") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(itemHref);
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Logo */}
      <div className="p-4 md:p-6 border-b border-border">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 group"
          onClick={() => onItemClick?.()}
        >
          <div className="w-10 h-10 bg-yellow-500 rounded-lg flex items-center justify-center font-bold text-black text-xl shadow-sm group-hover:shadow-md transition-shadow">
            Q
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold text-foreground">
              QaliSuite
            </span>
            <span className="text-xs text-muted-foreground">
              ERP System
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 md:p-4 space-y-1 overflow-y-auto">
        {sidebarItems.map((item) => {
          if (item.hidden) return null;

          const active = isActive(item.id, item.href);

          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={() => onItemClick?.()}
              className={clsx(
                "group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                {
                  "bg-yellow-500 text-black shadow-sm hover:shadow-md": active,
                  "text-muted-foreground hover:bg-accent hover:text-foreground":
                    !active,
                }
              )}
            >
              <item.icon
                className={clsx(
                  "w-5 h-5 transition-transform group-hover:scale-110",
                  {
                    "text-black": active,
                  }
                )}
              />
              <span
                className={clsx("font-medium", {
                  "text-black": active,
                })}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Theme Toggle */}
      <NextThemeToggler />

      {/* User Profile with Logout */}
      <div className="p-4 border-t border-border bg-muted/30">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 hover:bg-accent p-2.5 rounded-lg transition-all duration-200">
              <Avatar className="w-10 h-10 ring-2 ring-border">
                <AvatarImage
                  src={user?.image || "https://github.com/shadcn.png"}
                  alt={user?.name}
                />
                <AvatarFallback className="bg-yellow-500 text-black font-bold">
                  {getInitials(user?.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-semibold text-foreground truncate">
                  {user?.name}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.role || "User"}
                </p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-64 bg-card border-border"
            sideOffset={5}
          >
            <DropdownMenuLabel>
              <div className="flex items-center gap-3 pb-2">
                <Avatar className="w-12 h-12 ring-2 ring-border">
                  <AvatarImage
                    src={user?.image || "https://github.com/shadcn.png"}
                    alt={user?.name}
                  />
                  <AvatarFallback className="bg-yellow-500 text-black font-bold">
                    {getInitials(user?.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {user?.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user?.email}
                  </p>
                  <p className="text-xs font-medium text-yellow-600 dark:text-yellow-500 truncate mt-1">
                    {user?.role || "User"}
                  </p>
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator className="bg-border" />

            <DropdownMenuItem
              asChild
              className="cursor-pointer focus:bg-accent focus:text-accent-foreground"
            >
              <Link href="/dashboard/profile" className="flex items-center">
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem
              asChild
              className="cursor-pointer focus:bg-accent focus:text-accent-foreground"
            >
              <Link href="/dashboard/settings" className="flex items-center">
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </Link>
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-border" />

            <DropdownMenuItem
              className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
              asChild
            >
              <form
                action={async () => {
                  await logout();
                }}
                className="w-full"
              >
                <button
                  className="w-full flex items-center text-left"
                  type="submit"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
