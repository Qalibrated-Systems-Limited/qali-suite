import { auth } from "../../auth";
// import { AppSidebar } from "./components/app-sidebar";
// import { SiteHeader } from "@/components/site-header";

import { AppSidebar } from "./components/app-sidebar";
import { CommandPaletteProvider } from "@/components/command-palette-provider";
import MobileBottomNav from "./components/MobileBottomNav";

export const metadata = {
  title: "QaliSuite Dashboard",
  description: "Enterprise Resource Planning",
};

async function DashboardLayout({ children }) {
  const session = await auth();
  const user = session?.user;

  return (
    <CommandPaletteProvider>
      <AppSidebar
        user={user}
        children={
          <div className="p-4 pb-20 md:p-6 md:pb-6">
            {children}
            {/* Mobile bottom nav — fixed, sm:hidden. Extra pb-20 above
                so content isn't hidden behind it on small screens. */}
            <MobileBottomNav role={user?.role} />
          </div>
        }
      />
    </CommandPaletteProvider>
  );
}

export default DashboardLayout;
