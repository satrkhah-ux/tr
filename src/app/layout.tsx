import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/components/LanguageProvider";
import { StoreProvider } from "@/lib/store";
import { TraveliunUIProvider } from "@/components/traveliun/TraveliunUIProvider";
import { RoleProvider } from "@/lib/roles/RoleContext";
import { getCurrentRole } from "@/lib/data/metrics";
import { getPublicSupabaseConfig } from "@/lib/supabase/constants";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Traveliun Admin System",
  description:
    "A rebuilt Traveliun travel operations dashboard with structured, AI-friendly system data.",
  icons: {
    icon: "/traveliun/favicon.ico",
    apple: "/icons/apple-touch-icon.png",
  },
  // iOS installed-app chrome (Android reads the manifest instead).
  appleWebApp: {
    capable: true,
    title: "Traveliun",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // lets the fixed bottom tab bar extend under the home indicator (safe-area).
  viewportFit: "cover",
  themeColor: "#185045",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const realRole = await getCurrentRole();
  // Public Supabase config, read at RUNTIME and injected so the browser gets it
  // even when NEXT_PUBLIC_* were not baked at build time (Coolify/VPS deploys).
  // These are public values (anon key + URL) — safe to embed in the HTML.
  const publicEnv = getPublicSupabaseConfig();
  return (
    <html lang="ar" dir="rtl" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-[#003c3a] dark:bg-[#0b1a17] dark:text-[#e7f0ec]">
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__ENV__=${JSON.stringify({
              supabaseUrl: publicEnv?.url ?? "",
              supabaseAnonKey: publicEnv?.anonKey ?? "",
            })}`,
          }}
        />
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
