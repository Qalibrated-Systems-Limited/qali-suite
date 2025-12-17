import React from "react";
import { Sheet, SheetContent } from "./ui/sheet";
import { SidebarContent } from "./sidebar-content";
import { useState } from "react";

export function MobileNav({ mobileMenuOpen, setMobileMenuOpen, user }) {
  return (
    <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
      <SheetContent
        side="left"
        className="w-64 p-0 bg-[#161b22] border-[#30363d]"
      >
        <SidebarContent
          onItemClick={() => setMobileMenuOpen(false)}
          user={user}
        />
      </SheetContent>
    </Sheet>
  );
}
