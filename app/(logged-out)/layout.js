import AuthProvider from "../context/auth";
import "../globals.css";
import { Poppins } from "next/font/google";

import { LightDarkToggle } from "../../components/ui/light-dark-toggle";
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
});

export const metadata = {
  title: "Welcome to StockVault",
  description: "The most comprehensive and efficient store management solution",
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
