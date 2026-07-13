"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronDown, Menu, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export function PalmXNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const { t, isRTL } = useLanguage();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { label: t.navBuyCrypto, href: "/p2p" },
    { label: t.navMarkets, href: "/markets" },
    {
      label: t.navTrade,
      href: "/trade",
      children: [
        { label: t.navTradeSpot, href: "/trade" },
        { label: t.navTradeFutures, href: "/trade" },
        { label: t.navTradeConvert, href: "/trade" },
      ],
    },
    { label: t.navEarn, href: "/dashboard" },
    { label: t.navTradingBots, href: "/trade" },
    { label: t.navCopyTrading, href: "/copy-trading" },
    {
      label: t.navMore,
      href: "#",
      children: [
        { label: t.navXAssets, href: "/markets" },
        { label: t.navApi, href: "/dashboard" },
        { label: t.navAffiliate, href: "/affiliate" },
        { label: t.navLearn, href: "/" },
        { label: "🛡 Admin Panel", href: "/admin/dashboard" },
      ],
    },
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-black/95 backdrop-blur-md border-b border-white/8"
          : "bg-transparent"
      }`}
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="max-w-[1440px] mx-auto px-6 lg:px-12">
        <div className="flex items-center h-16 gap-8">
          {/* PalmX Logo */}
          <Link href="/" className="flex-shrink-0 flex items-center gap-2">
            {/* Palm tree icon */}
            <span className="text-[#e2b700] text-xl leading-none" aria-hidden="true">🌴</span>
            <span className="text-white font-bold text-xl tracking-tight">
              Palm<span className="text-[#e2b700]">X</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1 flex-1">
            {navLinks.map((link) => (
              <div
                key={link.label}
                className="relative"
                onMouseEnter={() => link.children && setOpenDropdown(link.label)}
                onMouseLeave={() => setOpenDropdown(null)}
              >
                <Link
                  href={link.href}
                  className="flex items-center gap-0.5 px-3 py-2 text-sm font-medium text-white/75 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                >
                  {link.label}
                  {link.children && (
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${
                        openDropdown === link.label ? "rotate-180" : ""
                      }`}
                    />
                  )}
                </Link>
                {link.children && openDropdown === link.label && (
                  <div
                    className={`absolute ${isRTL ? "right-0" : "left-0"} top-full mt-1 min-w-[180px] bg-[#141414] border border-white/10 rounded-xl py-2 shadow-2xl`}
                  >
                    {link.children.map((child) => (
                      <Link
                        key={child.label}
                        href={child.href}
                        className="block px-4 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>

          {/* Auth + Language */}
          <div className={`hidden lg:flex items-center gap-3 ${isRTL ? "mr-auto" : "ml-auto"}`}>
            <LanguageSwitcher />
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-white/80 hover:text-white transition-colors"
            >
              {t.navLogin}
            </Link>
            <Link
              href="/signup"
              className="px-5 py-2 text-sm font-semibold bg-[#e2b700] hover:bg-[#f5ca00] text-black rounded-lg transition-colors"
            >
              {t.navSignup}
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            className={`lg:hidden ${isRTL ? "mr-auto" : "ml-auto"} p-2 text-white/75 hover:text-white`}
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className="lg:hidden bg-black/98 border-t border-white/8 px-6 py-4 space-y-1"
          dir={isRTL ? "rtl" : "ltr"}
        >
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="block py-3 text-base font-medium text-white/80 hover:text-white border-b border-white/5"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-4 flex flex-col gap-3">
            <div className="flex justify-center">
              <LanguageSwitcher />
            </div>
            <Link
              href="/login"
              className="text-center py-3 text-sm font-medium border border-white/20 text-white rounded-lg"
            >
              {t.navLogin}
            </Link>
            <Link
              href="/signup"
              className="text-center py-3 text-sm font-semibold bg-[#e2b700] text-black rounded-lg"
            >
              {t.navSignup}
            </Link>
            <Link
              href="/admin/dashboard"
              className="text-center py-2 text-xs font-medium text-white/25 hover:text-[#e2b700] border border-white/8 rounded-lg transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              🛡 Admin Panel
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
