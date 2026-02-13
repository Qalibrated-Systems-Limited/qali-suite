import { LightDarkToggle } from "@/components/theme-toggler";

export const metadata = {
  title: "Welcome to QaliSuite",
  description: "Complete ERP solution for inventory, finance, and operations",
};

export default function LogoutLayout({ children }) {
  return (
    <>
      {children}
      <LightDarkToggle className="fixed top-6 right-6 z-50" />
    </>
  );
}
