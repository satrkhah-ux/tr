import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/components/LanguageProvider";
import { StoreProvider } from "@/lib/store";
import { TraveliunUIProvider } from "@/components/traveliun/TraveliunUIProvider";
import { RoleProvider } from "@/lib/roles/RoleContext";
import { getCurrentRole } from "@/lib/data/metrics";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Traveliun Admin System",
  description:
    "A rebuilt Traveliun travel operations dashboard with structured, AI-friendly system data.",
  icons: { icon: "/traveliun/favicon.ico" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const realRole = await getCurrentRole();
  return (
    <html lang="ar" dir="rtl" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-[#003c3a] dark:bg-[#0b1a17] dark:text-[#e7f0ec]">
        <StoreProvider>
          <LanguageProvider>
            <RoleProvider realRole={realRole}>
              <TraveliunUIProvider>{children}</TraveliunUIProvider>
            </RoleProvider>
          </LanguageProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
