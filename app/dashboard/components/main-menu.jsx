"use client";
import { logout } from "../../mongodb/actions";
import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { LightDarkToggle } from "../../../components/ui/light-dark-toggle";
import { cn } from "../../../lib/utils";

import {
  BuildingIcon,
  CameraIcon,
  GroupIcon,
  HomeIcon,
  LayoutDashboardIcon,
  Settings,
  TableIcon,
  TagIcon,
  UserIcon,
  WeightIcon,
} from "lucide-react";
import MenuItem from "./menu-item";
import MenuTitle from "./menu-title";
HomeIcon;

const menuItems = [
  { title: "Dashboard", href: "/dashboard", Icon: LayoutDashboardIcon },
  { title: "Transactions", href: "/dashboard/transactions", Icon: WeightIcon },
  { title: "Customers", href: "/dashboard/customers", Icon: GroupIcon },

  { title: "Users", href: "/dashboard/users", Icon: UserIcon },

  { title: "Settings", href: "/dashboard/settings", Icon: Settings },
];

function MainMenu({ className, name }) {
  let userName = "";
  let initials = "";

  if (name) {
    userName = name;
    initials = name[0].toUpperCase();
  }
  if (userName.trim().includes(" ")) {
    initials = `${initials}${userName.split(" ")[1][0]}`;
  }
  return (
    <div
      className={cn("md:bg-muted overflow-auto p-4 flex flex-col", className)}
    >
      <div className=" hidden md:block border-b dark:border-black border-zinc-300 p-4">
        <MenuTitle />
      </div>

      <div className="flex flex-col gap-4  p-4 grow">
        {menuItems.map((Item) => (
          <MenuItem
            key={Item.href}
            href={Item.href}
            title={Item.title}
            Icon={Item.Icon}
          />
        ))}
      </div>
      <div className="flex  gap-2 items-center">
        <Avatar>
          <AvatarFallback className="bg-pink-200 dark:bg-pink-500 px-4 uppercase">
            {initials}
          </AvatarFallback>
        </Avatar>
        <form
          action={async () => {
            await logout();
          }}
        >
          <button className="hover:underline">Logout</button>
        </form>

        <LightDarkToggle className="ml-auto" />
      </div>
    </div>
  );
}

export default MainMenu;
