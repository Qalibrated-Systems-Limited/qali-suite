import { LightDarkToggle } from "@/components/theme-toggler";

export const metadata = {
  title: "Welcome to QaliSuite",
  description: "Complete ERP solution for inventory, finance, and operations",
};

export default function LogoutLayout({ children }) {
  return (
    <>
      <div className=" flex flex-col min-h-screen p-24 items-center justify-center gap-4">
        {children}
      </div>
      <LightDarkToggle className="fixed top-1/2 -mt-4 right-2" />
    </>
  );
}
