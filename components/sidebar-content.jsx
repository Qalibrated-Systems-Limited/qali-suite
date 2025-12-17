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
  Sun,
  Moon,
  Monitor,
  ShoppingBag,
  Receipt,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { clsx } from "clsx";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import { getInitials } from "@/lib/utils";
import { signOut } from "@/auth";
import { logout } from "@/app/mongodb/actions";

export const SidebarContent = ({ onItemClick, user }) => {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  const sidebarItems = [
    { icon: LayoutDashboard, label: "Dashboard", id: "." },
    {
      icon: Boxes,
      label: "Stocks",
      id: "stocks",
      hidden: user?.role !== "Admin" && user?.role !== "Store Manager",
    },

    { icon: List, label: "Requests", id: "requests" },
    { icon: Package, label: "Checkouts", id: "checkout" },
    { icon: Activity, label: "Movements", id: "movements" },
    {
      icon: Receipt,
      label: "Invoices",
      id: "invoices",
      hidden: !["Admin", "admin", "Accountant"].includes(user?.role),
    },

    {
      icon: Users,
      label: "Users",
      id: "users",
      hidden: user?.role !== "Admin",
    },
    {
      icon: Settings,
      label: "Settings",
      id: "settings",
      hidden: user?.role !== "Admin",
    },
  ];

  return (
    <>
      {/* Logo */}
      <div className="p-4 md:p-6 border-b border-border">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center font-bold text-black text-lg">
            S
          </div>
          <span className="text-lg font-semibold">StockVault</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 md:p-4 space-y-1 overflow-y-auto">
        {sidebarItems.map((item) => {
          if (item.hidden) return;
          return (
            <Link
              key={item.id}
              href={`/dashboard/${item.id}`}
              onClick={() => {
                onItemClick?.();
              }}
              className={clsx(
                "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                {
                  "bg-yellow-500 text-black":
                    pathname === `/dashboard/${item.id}` ||
                    (item.id === "." && pathname === "/dashboard"),
                  "text-foreground/70 hover:bg-accent hover:text-foreground":
                    pathname !== `/dashboard/${item.id}` &&
                    !(item.id === "." && pathname === "/dashboard"),
                }
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Theme Toggle */}
      <div className="px-4 py-2 border-t border-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-3 text-foreground/70 hover:bg-accent hover:text-foreground"
            >
              {theme === "light" ? (
                <Sun className="w-5 h-5" />
              ) : theme === "dark" ? (
                <Moon className="w-5 h-5" />
              ) : (
                <Monitor className="w-5 h-5" />
              )}
              <span className="text-sm font-medium">
                {theme === "light"
                  ? "Light"
                  : theme === "dark"
                  ? "Dark"
                  : "System"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun className="mr-2 h-4 w-4" />
              Light
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon className="mr-2 h-4 w-4" />
              Dark
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor className="mr-2 h-4 w-4" />
              System
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* User Profile with Logout */}
      <div className="p-4 border-t border-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 hover:bg-accent p-2 rounded-md transition-colors">
              <Avatar className="w-10 h-10">
                <AvatarImage
                  src={user?.image || "https://github.com/shadcn.png"}
                />
                <AvatarFallback className="bg-yellow-500 text-black">
                  {getInitials(user?.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium truncate">{user?.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.email}
                </p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/profile">
                <Users className="mr-2 h-4 w-4" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950">
              <form
                action={async () => {
                  await logout();
                }}
              >
                <button className="flex items-center gap-2" type="submit">
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
};
