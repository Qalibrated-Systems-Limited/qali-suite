import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import { SidebarContentGrouped } from "./sidebar-content-grouped";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

export function MobileNav({ mobileMenuOpen, setMobileMenuOpen, user }) {
  return (
    <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
      <SheetContent side="left" className="w-64 p-0 bg-card border-border">
        {/* Hidden title for accessibility */}
        <VisuallyHidden>
          <SheetTitle>Navigation Menu</SheetTitle>
        </VisuallyHidden>

        <SidebarContentGrouped
          onItemClick={() => setMobileMenuOpen(false)}
          user={user}
        />
      </SheetContent>
    </Sheet>
  );
}
