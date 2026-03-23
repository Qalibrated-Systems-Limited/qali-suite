import "./globals.css";
import { Inter, JetBrains_Mono } from "next/font/google";

import { cn } from "../lib/utils";
import { ThemeProvider } from "@/components/Theme-Provider";
import { Toaster } from "sonner";

// Inter — variable font, industry standard for dashboards/ERP
// (Linear, Stripe, GitHub, Vercel all use Inter)
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// JetBrains Mono — for amounts, codes, IDs, financial figures
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata = {
  title: "QaliSuite",
  description: "Complete ERP solution for inventory, finance, and operations",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn(inter.variable, jetbrainsMono.variable, "font-sans")}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
