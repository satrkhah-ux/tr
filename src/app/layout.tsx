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

/**
 * The link card people actually see. Sharing the URL in WhatsApp used to show
 * the framework's default mark and an English developer sentence, because there
 * was no Open Graph block at all — so the crawler fell back to the favicon.
 *
 * `metadataBase` matters: without it the OG image resolves relative to the
 * request and crawlers that fetch without a Host header get nothing. It follows
 * NEXT_PUBLIC_BASE_URL so the VPS and any other deploy each advertise their own
 * absolute URL.
 */
const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://pkg.traveliun.com";
const SITE_NAME = "ترافليون للسفر والسياحة";
const SITE_TITLE = "ترافليون — نظام إدارة الباقات السياحية";
const SITE_DESCRIPTION =
  "نظام ترافليون لبناء العروض السياحية وتسعيرها وإصدار مستند العميل الجاهز للإرسال — الباقات والفنادق والطيران والتأشيرات في مكان واحد.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    locale: "ar_SA",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/seo/og-cover.png",
        width: 1200,
        height: 630,
        alt: SITE_NAME,
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/seo/og-cover.png"],
  },
  icons: {
    icon: "/traveliun/favicon.ico",
    apple: "/icons/apple-touch-icon.png",
  },
  // iOS installed-app chrome (Android reads the manifest instead).
  appleWebApp: {
    capable: true,
    title: "ترافليون",
    statusBarStyle: "default",
  },
  // an internal tool: keep it out of search results
  robots: { index: false, follow: false },
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
