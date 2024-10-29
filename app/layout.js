import "./globals.css";
import { Poppins } from "next/font/google";

import { cn } from "../lib/utils";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
});

export const metadata = {
  title: "Kilosahihi weighing app",
  description: "The most comprehensive weighing solution",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={cn(poppins.className, "dark")}>{children}</body>
    </html>
  );
}
