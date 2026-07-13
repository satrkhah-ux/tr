"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Coins,
  ArrowLeftRight,
  CreditCard,
  Bot,
  LogOut,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin/dashboard", label: "Dashboard",      icon: LayoutDashboard },
  { href: "/admin/users",     label: "Users",          icon: Users },
  { href: "/admin/kyc",       label: "KYC Review",     icon: ShieldCheck },
  { href: "/admin/assets",    label: "Assets",         icon: Coins },
  { href: "/admin/pairs",     label: "Trading Pairs",  icon: ArrowLeftRight },
  { href: "/admin/banks",     label: "Bank Management",icon: CreditCard },
  { href: "/admin/bot",       label: "Bot Monitor",    icon: Bot },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [loaded, setLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const authed = localStorage.getItem("palmx-admin-auth") === "true";
    if (!authed && pathname !== "/admin/login") {
      router.replace("/admin/login");
    } else {
      setLoaded(true);
    }
  }, [pathname, router]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Login page: no sidebar
  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  if (!loaded) return null;

  function signOut() {
    localStorage.removeItem("palmx-admin-auth");
    router.replace("/admin/login");
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex relative">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-30 w-60 flex-shrink-0 bg-black border-r border-white/8 flex flex-col transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/8 flex items-center justify-between">
          <Link href="/admin/dashboard" className="flex items-center gap-2">
            <span className="text-[#e2b700] text-lg" aria-hidden="true">🌴</span>
            <span className="font-bold text-white">
              Palm<span className="text-[#e2b700]">X</span>
              <span className="text-white/40 text-xs font-normal ml-1.5">Admin</span>
            </span>
          </Link>
          <button
            className="md:hidden p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/8"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active
                    ? "bg-[#e2b700]/10 text-[#e2b700]"
                    : "text-white/50 hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
                {active && <ChevronRight className="w-3.5 h-3.5 ml-auto" />}
              </Link>
            );
          })}
        </nav>

        {/* User-facing link */}
        <div className="px-3 pb-2 border-t border-white/8 pt-3">
          <Link
            href="/"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
          >
            ← Back to PalmX
          </Link>
        </div>

        {/* Sign out */}
        <div className="px-3 pb-4">
          <button
            onClick={signOut}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-white/40 hover:text-[#f6465d] hover:bg-[#f6465d]/8 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto min-h-screen">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 h-14 bg-black border-b border-white/8 sticky top-0 z-10">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/8"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-[#e2b700] text-lg">🌴</span>
          <span className="font-bold text-sm text-white">
            Palm<span className="text-[#e2b700]">X</span>
            <span className="text-white/40 text-xs font-normal ml-1.5">Admin</span>
          </span>
        </div>
        {children}
      </main>
    </div>
  );
}
