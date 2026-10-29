import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/components/LanguageProvider";
import { StoreProvider } from "@/lib/store";
import { TraveliunUIProvider } from "@/components/traveliun/TraveliunUIProvider";
import { NavigationLoader } from "@/components/traveliun/NavigationLoader";
import { RoleProvider } from "@/lib/roles/RoleContext";
import { getFeatureFlags } from "@/lib/features-server";
import { PartnerProvider } from "@/lib/partners/PartnerContext";
import { getPartnerBrand } from "@/lib/partners/session";
import { getCurrentRole } from "@/lib/data/metrics";
import { currentPermissions, currentRealPermissions, currentViewAs } from "@/lib/roles/current";
import { canSwitchRoles } from "@/lib/roles/roles";
import { getPublicSupabaseConfig } from "@/lib/supabase/constants";
import { getServerUser, sessionGone } from "@/lib/supabase/server";
import { SessionGone } from "@/components/traveliun/SessionGone";
import { ChangePasswordDialog } from "@/components/traveliun/ChangePasswordDialog";

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
const SITE_NAME = "ترافليون ون";
const SITE_TITLE = "ترافليون ون — من أول رسالة حتى العودة";
const SITE_DESCRIPTION =
  "ترافليون ون: نظام واحد لرحلة العميل كلها — العملاء والمتابعة والعروض والعمليات والحجوزات والتأشيرات والحسابات في مكان واحد.";

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
    // ?v: browsers keep a tab icon for weeks — the old blue logo was cached under the bare name
    icon: [{ url: "/seo/favicon.svg", type: "image/svg+xml" }, { url: "/traveliun/favicon.ico?v=2", sizes: "48x48" }],
    apple: "/icons/apple-touch-icon.png",
  },
  // iOS installed-app chrome (Android reads the manifest instead).
  appleWebApp: {
    capable: true,
    title: "ترافليون ون",
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
  // Side by side, not one after another: each is a round trip to the database
  // in Mumbai (the server is in Frankfurt), and none waits on another's answer
  // — they share the one session lookup (getServerUser, cached per token).
  //  · «عرض النظام كـ»: who may switch and what is being looked through come
  //    from the account's OWN role — the viewed-as one could never lead back.
  //  · A login handed over with a temporary password changes it before anything
  //    else (scripts/flag-password-change.mjs); app_metadata is not user-writable.
  //  · A partner wears their own colours, resolved here so the first paint is
  //    already theirs — a client-side swap would flash ours first.
  const [realRole, permissions, realPermissions, viewAs, user, features, partnerBrand, gone] = await Promise.all([
    getCurrentRole(),
    currentPermissions(),
    currentRealPermissions(),
    currentViewAs(),
    getServerUser(),
    getFeatureFlags(),
    getPartnerBrand(),
    sessionGone(),
  ]);
  const mustChangePassword = user?.app_metadata?.["must_change_password"] === true;
  // Public Supabase config, read at RUNTIME and injected so the browser gets it
  // even when NEXT_PUBLIC_* were not baked at build time (Coolify/VPS deploys).
  // These are public values (anon key + URL) — safe to embed in the HTML.
  const publicEnv = getPublicSupabaseConfig();
  return (
    <html lang="ar" dir="rtl" className={`${inter.variable} h-full antialiased`}>
      <body
        className="min-h-full flex flex-col bg-white text-[#003c3a] dark:bg-[#0b1a17] dark:text-[#e7f0ec]"
        style={
          partnerBrand
            ? ({ "--tv-brand": partnerBrand.brandColor, "--tv-accent": partnerBrand.accentColor } as React.CSSProperties)
            : undefined
        }
      >
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
            <RoleProvider
              realRole={realRole}
              permissions={permissions}
              features={features}
              viewAs={viewAs}
              canSwitch={canSwitchRoles(realPermissions)}
              isDeveloper={realPermissions.includes("developer.access")}
            >
              <PartnerProvider brand={partnerBrand}>
                <TraveliunUIProvider>
                  {children}
                  {mustChangePassword ? <ChangePasswordDialog forced /> : null}
                  {gone ? <SessionGone /> : null}
                  <NavigationLoader />
                </TraveliunUIProvider>
              </PartnerProvider>
            </RoleProvider>
          </LanguageProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
