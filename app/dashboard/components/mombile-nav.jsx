"use client";
import { useMediaQuery } from "../../hooks/useMediaquery";
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
} from "../../../components/ui/drawer";
import { MenuIcon } from "lucide-react";
import { useState } from "react";
import MainMenu from "./main-menu";
import MenuTitle from "./menu-title";

function MobileNav({ name, isOpen }) {
  const [mobileMenuOpen, setOpen] = useState(false);
  const isDeskTop = useMediaQuery("(min-width: 768px)");
  return (
    !isDeskTop && (
      <div className="md:hidden flex justify-between sticky top-0 left-0 bg-background border-b border-border p-4 ">
        <MenuTitle />
        <Drawer
          direction="right"
          open={mobileMenuOpen}
          onClose={() => setOpen(false)}
          onOpenChange={(open) => setOpen(open)}
        >
          <DrawerTrigger>
            <MenuIcon />
          </DrawerTrigger>
          <DrawerContent>
            <MainMenu name={name} />
          </DrawerContent>
        </Drawer>
      </div>
    )
  );
}

export default MobileNav;
