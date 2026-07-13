"use client";

import Link from "next/link";
import { Globe, Send, MessageCircle, Share2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/palmx-i18n";

type LinkEntry = { key: TranslationKey; href: string };

const footerColumns: { titleKey: TranslationKey; links: LinkEntry[] }[] = [
  {
    titleKey: "footerProducts",
    links: [
      { key: "footerBuyCrypto", href: "/p2p" },
      { key: "footerTrade",     href: "/trade" },
      { key: "footerEarn",      href: "/dashboard" },
      { key: "footerBots",      href: "/trade" },
      { key: "footerCopy",      href: "/copy-trading" },
      { key: "footerP2p",       href: "/p2p" },
    ],
  },
  {
    titleKey: "footerAbout",
    links: [
      { key: "footerAboutUs",   href: "/about" },
      { key: "footerCareers",   href: "/careers" },
      { key: "footerContact",   href: "/contact" },
      { key: "footerApp",       href: "/app" },
      { key: "footerAffiliate", href: "/affiliate" },
    ],
  },
  {
    titleKey: "footerLearn",
    links: [
      { key: "footerAllCrypto",    href: "/markets" },
      { key: "footerBtcPrice",     href: "/markets" },
      { key: "footerEthPrice",     href: "/markets" },
      { key: "footerHowToBuyBtc",  href: "/p2p" },
      { key: "footerHowToBuyEth",  href: "/p2p" },
    ],
  },
  {
    titleKey: "footerSupport",
    links: [
      { key: "footerSupportCenter",  href: "/support" },
      { key: "footerAnnouncements",  href: "/support" },
      { key: "footerFees",           href: "/trade" },
      { key: "footerApi",            href: "/dashboard" },
      { key: "footerLawEnforcement", href: "/law-enforcement" },
    ],
  },
];

export function OkxFooter() {
  const { t, isRTL } = useLanguage();
  const arabicFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  return (
    <footer className="bg-black border-t border-white/8" dir={isRTL ? "rtl" : "ltr"}>
      <div className="max-w-[1200px] mx-auto px-6 py-16 lg:py-20">
        {/* Top row */}
        <div className={`flex flex-col lg:flex-row gap-12 ${isRTL ? "lg:flex-row-reverse" : ""}`}>
          {/* Brand */}
          <div className="lg:w-52 flex-shrink-0">
            <Link href="/" className={`flex items-center gap-2 mb-5 ${isRTL ? "flex-row-reverse" : ""}`}>
              <span className="text-2xl">🌴</span>
              <span className="text-xl font-bold text-white">
                Palm<span style={{ color: "#e2b700" }}>X</span>
              </span>
            </Link>
            <div className={`flex gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
              {[
                { icon: Share2, label: "Twitter / X" },
                { icon: Send, label: "Telegram" },
                { icon: MessageCircle, label: "Discord" },
                { icon: Globe, label: "Website" },
              ].map(({ icon: Icon, label }) => (
                <a
                  key={label}
                  href="#"
                  aria-label={label}
                  className="w-9 h-9 rounded-full bg-white/8 flex items-center justify-center text-white/50 hover:bg-[#e2b700]/15 hover:text-[#e2b700] transition-colors"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          <div className={`flex-1 grid grid-cols-2 md:grid-cols-4 gap-8 ${isRTL ? "text-right" : ""}`}>
            {footerColumns.map(({ titleKey, links }) => (
              <div key={titleKey}>
                <h4
                  className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4"
                  style={arabicFont}
                >
                  {t[titleKey]}
                </h4>
                <ul className="space-y-2.5">
                  {links.map(({ key, href }) => (
                    <li key={key}>
                      <Link
                        href={href}
                        className="text-sm text-white/55 hover:text-white transition-colors"
                        style={arabicFont}
                      >
                        {t[key]}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/8 mt-12 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-white/30" style={arabicFont}>
            {t.footerCopyright}
          </p>
          <div className={`flex gap-5 ${isRTL ? "flex-row-reverse" : ""}`}>
            {(["footerTerms", "footerPrivacy", "footerDisclosures"] as const).map((key) => (
              <Link
                key={key}
                href="/"
                className="text-xs text-white/30 hover:text-white/60 transition-colors"
                style={arabicFont}
              >
                {t[key]}
              </Link>
            ))}
            <Link
              href="/admin/dashboard"
              className="text-xs text-white/15 hover:text-white/40 transition-colors"
            >
              Admin
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

