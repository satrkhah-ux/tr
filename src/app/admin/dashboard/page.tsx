"use client";

import Link from "next/link";
import {
  Users,
  ShieldCheck,
  TrendingUp,
  DollarSign,
  ChevronRight,
  AlertTriangle,
  Activity,
} from "lucide-react";
import { usePalmXStore } from "@/lib/store";

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="bg-black border border-white/8 rounded-2xl p-5 hover:border-white/15 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">{label}</span>
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${color}18` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <p className="text-3xl font-bold text-white mb-1">{value}</p>
      <p className="text-xs text-white/35">{sub}</p>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { users, assets, tradingPairs } = usePalmXStore();

  const totalUsers    = users.length;
  const activeUsers   = users.filter((u) => u.accountStatus === "active").length;
  const pendingKyc    = users.filter((u) => u.kycStatus === "pending").length;
  const activeAssets  = assets.filter((a) => a.status === "active").length;
  const enabledPairs  = tradingPairs.filter((p) => p.enabled).length;
  const suspendedUsers = users.filter((u) => u.accountStatus !== "active").length;

  const recentKyc = users.filter((u) => u.kycStatus === "pending").slice(0, 6);

  const KYC_COLORS: Record<string, string> = {
    pending:    "#e2b700",
    verified:   "#0ecb81",
    rejected:   "#f6465d",
    resubmit:   "#ff8c00",
    unverified: "#666",
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1280px]">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Platform Overview</h1>
          <p className="text-sm text-white/40 mt-1 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-[#0ecb81]" />
            Live metrics —{" "}
            {new Date().toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0ecb81]/10 border border-[#0ecb81]/20 rounded-xl">
          <span className="w-2 h-2 bg-[#0ecb81] rounded-full animate-pulse" />
          <span className="text-xs font-medium text-[#0ecb81]">System Online</span>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          icon={Users}
          label="Total Users"
          value={totalUsers.toString()}
          sub={`${activeUsers} active · ${suspendedUsers} suspended`}
          color="#e2b700"
        />
        <MetricCard
          icon={ShieldCheck}
          label="Pending KYC"
          value={pendingKyc.toString()}
          sub="Awaiting compliance review"
          color="#f6465d"
        />
        <MetricCard
          icon={TrendingUp}
          label="24h Trading Volume"
          value="$127.4M"
          sub="↑ 18.3% vs yesterday"
          color="#0ecb81"
        />
        <MetricCard
          icon={DollarSign}
          label="Revenue Today"
          value="$38,220"
          sub="Platform fees collected"
          color="#9945ff"
        />
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Active Assets",    value: `${activeAssets} / ${assets.length}`,          color: "#0ecb81", href: "/admin/assets" },
          { label: "Enabled Pairs",    value: `${enabledPairs} / ${tradingPairs.length}`,    color: "#e2b700", href: "/admin/pairs" },
          { label: "Restricted Users", value: suspendedUsers.toString(),                      color: "#f6465d", href: "/admin/users" },
        ].map(({ label, value, color, href }) => (
          <Link
            key={label}
            href={href}
            className="bg-black border border-white/8 rounded-2xl p-4 flex items-center justify-between group hover:border-white/20 transition-colors"
          >
            <div>
              <p className="text-xs text-white/40 mb-0.5">{label}</p>
              <p className="text-xl font-bold" style={{ color }}>{value}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors" />
          </Link>
        ))}
      </div>

      {/* Pending KYC table */}
      <div className="bg-black border border-white/8 rounded-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[#e2b700]" />
            <h2 className="text-sm font-semibold text-white">Pending KYC Review</h2>
            {pendingKyc > 0 && (
              <span className="px-2 py-0.5 bg-[#e2b700]/15 text-[#e2b700] text-xs font-semibold rounded-lg">
                {pendingKyc}
              </span>
            )}
          </div>
          <Link
            href="/admin/kyc"
            className="text-xs text-[#e2b700] hover:text-[#f5ca00] font-medium transition-colors"
          >
            Review all →
          </Link>
        </div>

        {recentKyc.length === 0 ? (
          <div className="py-12 text-center text-white/30 text-sm">
            ✓ No pending KYC submissions
          </div>
        ) : (
          <div>
            {recentKyc.map((user) => {
              const color = KYC_COLORS[user.kycStatus] ?? "#666";
              return (
                <div
                  key={user.id}
                  className="flex items-center gap-4 px-6 py-4 border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors"
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                    style={{ background: `${color}18`, color }}
                  >
                    {user.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{user.name}</p>
                    <p className="text-xs text-white/40">
                      {user.email} · Tier {user.kycTier} · {user.kycDocType ?? "—"}
                    </p>
                  </div>
                  <span className="text-xs text-white/30 flex-shrink-0">
                    {user.kycSubmittedAt}
                  </span>
                  <span
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0"
                    style={{ background: `${color}18`, color }}
                  >
                    Pending
                  </span>
                  <Link
                    href="/admin/kyc"
                    className="text-xs text-[#e2b700] hover:underline flex-shrink-0 font-medium"
                  >
                    Review
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
