"use client";

import { useState } from "react";
import {
  Bot,
  Users,
  Activity,
  DollarSign,
  Zap,
  Power,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Shield,
  AlertTriangle,
  Copy,
  Check,
  Wallet,
  BarChart2,
} from "lucide-react";
import { usePalmXStore } from "@/lib/store";

// ─── Mock bot data (would come from bot-handler in production) ────────────────
interface BotUserRow {
  telegramId: number;
  username: string;
  accountMode: "real" | "demo";
  walletAddress: string | null;
  openTrades: number;
  volume: string;
  feesEarned: string;
  lastActive: string;
  status: "active" | "suspended" | "banned";
}

interface RecentTrade {
  id: string;
  telegramId: number;
  username: string;
  symbol: string;
  direction: "buy" | "sell";
  size: string;
  pnl: string;
  pnlPositive: boolean;
  fee: string;
  dex: string;
  status: "open" | "closed";
  time: string;
}

const MOCK_BOT_USERS: BotUserRow[] = [
  { telegramId: 112233, username: "@ahmed_trader",   accountMode: "real", walletAddress: "7xKp...3mNq", openTrades: 2, volume: "$4,820", feesEarned: "$24.10", lastActive: "منذ 5 دقائق",   status: "active" },
  { telegramId: 445566, username: "@solana_omar",    accountMode: "real", walletAddress: "9aRt...7bLz", openTrades: 1, volume: "$1,200", feesEarned: "$8.50",  lastActive: "منذ 12 دقيقة",   status: "active" },
  { telegramId: 778899, username: "@fatima_defi",    accountMode: "demo", walletAddress: null,           openTrades: 3, volume: "$0",     feesEarned: "$0",     lastActive: "منذ 1 ساعة",     status: "active" },
  { telegramId: 101010, username: "@kareem_kw",      accountMode: "real", walletAddress: "3cVb...9pQt", openTrades: 0, volume: "$900",   feesEarned: "$4.20",  lastActive: "منذ 3 ساعات",    status: "active" },
  { telegramId: 112112, username: "@layla_arb",      accountMode: "real", walletAddress: "5dWn...2kRs", openTrades: 0, volume: "$15,400",feesEarned: "$102.00",lastActive: "أمس",             status: "active" },
  { telegramId: 131313, username: "@spam_account",   accountMode: "demo", walletAddress: null,           openTrades: 0, volume: "$0",     feesEarned: "$0",     lastActive: "منذ يومين",       status: "suspended" },
];

const MOCK_RECENT_TRADES: RecentTrade[] = [
  { id: "t001", telegramId: 112233, username: "@ahmed_trader", symbol: "SOL/USDC", direction: "buy",  size: "$500",   pnl: "+$42.00",  pnlPositive: true,  fee: "$2.10", dex: "Raydium", status: "open",   time: "منذ 5 دقائق" },
  { id: "t002", telegramId: 445566, username: "@solana_omar",  symbol: "RAY/USDC", direction: "buy",  size: "$300",   pnl: "+$8.50",   pnlPositive: true,  fee: "$0.43", dex: "Orca",    status: "open",   time: "منذ 12 دقيقة" },
  { id: "t003", telegramId: 778899, username: "@fatima_defi",  symbol: "WIF/USDC", direction: "sell", size: "$200",   pnl: "-$5.20",   pnlPositive: false, fee: "$0",    dex: "Raydium", status: "open",   time: "منذ 30 دقيقة" },
  { id: "t004", telegramId: 112233, username: "@ahmed_trader", symbol: "BONK/USDC",direction: "buy",  size: "$150",   pnl: "+$28.00",  pnlPositive: true,  fee: "$1.40", dex: "Orca",    status: "open",   time: "منذ 45 دقيقة" },
  { id: "t005", telegramId: 112112, username: "@layla_arb",    symbol: "SOL/USDC", direction: "buy",  size: "$2,000", pnl: "+$180.00", pnlPositive: true,  fee: "$9.00", dex: "Raydium", status: "closed", time: "منذ ساعتين" },
  { id: "t006", telegramId: 101010, username: "@kareem_kw",    symbol: "JUP/USDC", direction: "sell", size: "$400",   pnl: "+$16.00",  pnlPositive: true,  fee: "$0.80", dex: "Orca",    status: "closed", time: "منذ 3 ساعات" },
];

export default function AdminBotPage() {
  const { botPaused, toggleBotKillSwitch } = usePalmXStore();

  const [feePercent, setFeePercent] = useState(7);
  const [treasury, setTreasury] = useState("7xKpABCDEFGH1234567890MNPQRSTUVWXYZ");
  const [copiedTreasury, setCopiedTreasury] = useState(false);
  const [savingFee, setSavingFee] = useState(false);
  const [savedFee, setSavedFee] = useState(false);
  const [userFilter, setUserFilter] = useState<"all" | "real" | "demo">("all");
  const [confirmKill, setConfirmKill] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "green" | "red" | "yellow" } | null>(null);

  function showToast(msg: string, type: "green" | "red" | "yellow" = "green") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleKillSwitch() {
    if (!botPaused && !confirmKill) {
      setConfirmKill(true);
      return;
    }
    toggleBotKillSwitch();
    setConfirmKill(false);
    showToast(
      botPaused ? "✅ تم تشغيل البوت بنجاح" : "⏸ تم إيقاف البوت — لن يُعالج أي طلبات جديدة",
      botPaused ? "green" : "yellow"
    );
  }

  function handleSaveFee() {
    setSavingFee(true);
    setTimeout(() => {
      setSavingFee(false);
      setSavedFee(true);
      showToast(`✅ تم حفظ رسوم البوت: ${feePercent}%`);
      setTimeout(() => setSavedFee(false), 2000);
    }, 800);
  }

  function copyTreasury() {
    navigator.clipboard.writeText(treasury).catch(() => {});
    setCopiedTreasury(true);
    setTimeout(() => setCopiedTreasury(false), 2000);
  }

  function handleSuspendUser(telegramId: number, username: string) {
    showToast(`⚠️ تم تعليق حساب ${username}`, "yellow");
  }

  const filteredUsers = MOCK_BOT_USERS.filter((u) =>
    userFilter === "all" ? true : u.accountMode === userFilter
  );

  const totalUsers   = MOCK_BOT_USERS.length;
  const realUsers    = MOCK_BOT_USERS.filter((u) => u.accountMode === "real").length;
  const openTradesN  = MOCK_BOT_USERS.reduce((s, u) => s + u.openTrades, 0);
  const totalFees    = MOCK_BOT_USERS.reduce((s, u) => {
    const n = parseFloat(u.feesEarned.replace(/[$,]/g, "")) || 0;
    return s + n;
  }, 0);

  return (
    <div className="p-6 space-y-6" dir="rtl">

      {/* toast */}
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg ${
            toast.type === "green"  ? "bg-[#0ecb81]/20 text-[#0ecb81] border border-[#0ecb81]/30"
            : toast.type === "red" ? "bg-[#f6465d]/20 text-[#f6465d] border border-[#f6465d]/30"
                                   : "bg-[#e2b700]/20 text-[#e2b700] border border-[#e2b700]/30"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bot className="w-6 h-6 text-[#e2b700]" />
            مراقبة بوت تيليغرام
          </h1>
          <p className="text-white/50 text-sm mt-1">
            @plamxbot — إدارة البوت والمستخدمين والرسوم في الوقت الفعلي
          </p>
        </div>
        {/* Kill Switch */}
        <div className="flex items-center gap-3">
          {confirmKill && !botPaused && (
            <div className="flex items-center gap-2 bg-[#f6465d]/10 border border-[#f6465d]/30 rounded-xl px-4 py-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-[#f6465d]" />
              <span className="text-white/80">هل تريد إيقاف البوت؟</span>
              <button
                onClick={handleKillSwitch}
                className="text-[#f6465d] font-bold hover:underline"
              >
                نعم، أوقف
              </button>
              <button
                onClick={() => setConfirmKill(false)}
                className="text-white/40 hover:text-white"
              >
                إلغاء
              </button>
            </div>
          )}
          <button
            onClick={handleKillSwitch}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
              botPaused
                ? "bg-[#0ecb81]/20 text-[#0ecb81] border border-[#0ecb81]/40 hover:bg-[#0ecb81]/30"
                : "bg-[#f6465d]/20 text-[#f6465d] border border-[#f6465d]/40 hover:bg-[#f6465d]/30"
            }`}
          >
            <Power className="w-4 h-4" />
            {botPaused ? "▶ تشغيل البوت" : "⏸ إيقاف البوت"}
          </button>
        </div>
      </div>

      {/* Bot paused banner */}
      {botPaused && (
        <div className="bg-[#f6465d]/10 border border-[#f6465d]/30 rounded-xl px-5 py-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-[#f6465d] flex-shrink-0" />
          <div>
            <p className="text-[#f6465d] font-semibold">البوت متوقف حالياً</p>
            <p className="text-white/50 text-sm mt-0.5">
              لن يُعالج البوت أي طلبات واردة من مستخدمي تيليغرام حتى تعيد تشغيله.
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Users,      label: "إجمالي المستخدمين",   value: totalUsers.toString(),         sub: `${realUsers} حساب حقيقي`,    color: "text-[#e2b700]",  bg: "bg-[#e2b700]/10" },
          { icon: Activity,   label: "صفقات مفتوحة",        value: openTradesN.toString(),         sub: "في الوقت الفعلي",             color: "text-blue-400",   bg: "bg-blue-400/10" },
          { icon: DollarSign, label: "إجمالي الرسوم",       value: `$${totalFees.toFixed(2)}`,    sub: "من الأرباح فقط",              color: "text-[#0ecb81]",  bg: "bg-[#0ecb81]/10" },
          { icon: Zap,        label: "حالة البوت",           value: botPaused ? "متوقف" : "نشط",  sub: botPaused ? "معطّل" : "يعمل",  color: botPaused ? "text-[#f6465d]" : "text-[#0ecb81]", bg: botPaused ? "bg-[#f6465d]/10" : "bg-[#0ecb81]/10" },
        ].map(({ icon: Icon, label, value, sub, color, bg }) => (
          <div key={label} className="bg-white/4 border border-white/8 rounded-2xl p-5">
            <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl ${bg} mb-3`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <p className="text-white/50 text-xs">{label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
            <p className="text-white/30 text-xs mt-1">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Fee Configuration */}
        <div className="bg-white/4 border border-white/8 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#e2b700]" />
            <h2 className="font-semibold text-white">إعداد رسوم البوت</h2>
          </div>

          <div>
            <label className="text-white/50 text-xs block mb-2">
              نسبة الرسوم من الأرباح فقط
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={5}
                max={10}
                step={1}
                value={feePercent}
                onChange={(e) => setFeePercent(Number(e.target.value))}
                className="flex-1 accent-[#e2b700]"
              />
              <span className="text-[#e2b700] font-bold text-lg w-12 text-right">
                {feePercent}%
              </span>
            </div>
            <p className="text-white/30 text-xs mt-1">
              5% – 10% من صافي الربح فقط · لا رسوم على الخسائر
            </p>
          </div>

          <div>
            <label className="text-white/50 text-xs block mb-1">محفظة الخزينة (Solana)</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={treasury}
                onChange={(e) => setTreasury(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-[#e2b700]/50"
                placeholder="عنوان محفظة Solana"
              />
              <button
                onClick={copyTreasury}
                className="p-2 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-white transition-colors"
              >
                {copiedTreasury ? <Check className="w-4 h-4 text-[#0ecb81]" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            onClick={handleSaveFee}
            disabled={savingFee}
            className="w-full bg-[#e2b700] text-black font-semibold py-2.5 rounded-xl hover:bg-[#c9a300] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {savingFee ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : savedFee ? (
              <><Check className="w-4 h-4" /> تم الحفظ</>
            ) : (
              "حفظ الإعدادات"
            )}
          </button>
        </div>

        {/* Quick Stats */}
        <div className="bg-white/4 border border-white/8 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-[#e2b700]" />
            <h2 className="font-semibold text-white">إحصائيات سريعة</h2>
          </div>
          <div className="space-y-3">
            {[
              { label: "حجم تداول البوت (24 ساعة)", value: "$7,350", positive: true },
              { label: "رسوم محصّلة (24 ساعة)",     value: "$139.30", positive: true },
              { label: "أعلى حجم تداول",             value: "@layla_arb — $15,400", positive: true },
              { label: "معدل الربحية",               value: "68%", positive: true },
              { label: "أكثر رمز تداولاً",           value: "SOL/USDC", positive: null },
              { label: "DEX الأكثر استخداماً",       value: "Raydium (62%)", positive: null },
            ].map(({ label, value, positive }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <span className="text-white/50 text-sm">{label}</span>
                <span className={`text-sm font-semibold ${
                  positive === true ? "text-[#0ecb81]" :
                  positive === false ? "text-[#f6465d]" : "text-white"
                }`}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Webhook Status */}
        <div className="bg-white/4 border border-white/8 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-[#e2b700]" />
            <h2 className="font-semibold text-white">حالة الاتصال</h2>
          </div>
          <div className="space-y-3">
            {[
              { label: "Webhook URL",      value: "مُعيَّن", ok: true },
              { label: "Bot Username",     value: "@plamxbot", ok: true },
              { label: "Solana Network",   value: "Mainnet-Beta", ok: true },
              { label: "Jupiter API",      value: "متصل", ok: true },
              { label: "Raydium",          value: "متصل", ok: true },
              { label: "Orca",             value: "متصل", ok: true },
            ].map(({ label, value, ok }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <span className="text-white/50 text-sm">{label}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  ok ? "bg-[#0ecb81]/10 text-[#0ecb81]" : "bg-[#f6465d]/10 text-[#f6465d]"
                }`}>{value}</span>
              </div>
            ))}
          </div>
          <a
            href="/api/telegram/register-webhook"
            className="block text-center text-xs text-white/30 hover:text-[#e2b700] transition-colors mt-2"
          >
            إعادة تسجيل Webhook
          </a>
        </div>

      </div>

      {/* Bot Users */}
      <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#e2b700]" />
            <h2 className="font-semibold text-white">مستخدمو البوت</h2>
            <span className="text-white/40 text-xs">({MOCK_BOT_USERS.length})</span>
          </div>
          <div className="flex gap-2">
            {(["all", "real", "demo"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setUserFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  userFilter === f
                    ? "bg-[#e2b700]/15 text-[#e2b700]"
                    : "bg-white/5 text-white/50 hover:text-white"
                }`}
              >
                {f === "all" ? "الكل" : f === "real" ? "حقيقي" : "تجريبي"}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 text-xs">
                <th className="text-right py-2 px-3 font-medium">المستخدم</th>
                <th className="text-right py-2 px-3 font-medium">الحساب</th>
                <th className="text-right py-2 px-3 font-medium">المحفظة</th>
                <th className="text-right py-2 px-3 font-medium">صفقات مفتوحة</th>
                <th className="text-right py-2 px-3 font-medium">الحجم</th>
                <th className="text-right py-2 px-3 font-medium">الرسوم المحصّلة</th>
                <th className="text-right py-2 px-3 font-medium">آخر نشاط</th>
                <th className="text-right py-2 px-3 font-medium">الحالة</th>
                <th className="py-2 px-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredUsers.map((u) => (
                <tr key={u.telegramId} className="hover:bg-white/3 transition-colors">
                  <td className="py-3 px-3">
                    <div className="font-medium text-white">{u.username}</div>
                    <div className="text-white/30 text-xs">#{u.telegramId}</div>
                  </td>
                  <td className="py-3 px-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      u.accountMode === "real"
                        ? "bg-[#0ecb81]/10 text-[#0ecb81]"
                        : "bg-blue-400/10 text-blue-400"
                    }`}>
                      {u.accountMode === "real" ? "حقيقي" : "تجريبي"}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    {u.walletAddress ? (
                      <div className="flex items-center gap-1">
                        <Wallet className="w-3 h-3 text-[#9945ff]" />
                        <span className="text-white/60 text-xs font-mono">{u.walletAddress}</span>
                      </div>
                    ) : (
                      <span className="text-white/20 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className={`font-bold ${u.openTrades > 0 ? "text-[#e2b700]" : "text-white/30"}`}>
                      {u.openTrades}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-white/70">{u.volume}</td>
                  <td className="py-3 px-3 text-[#0ecb81] font-semibold">{u.feesEarned}</td>
                  <td className="py-3 px-3 text-white/40 text-xs">{u.lastActive}</td>
                  <td className="py-3 px-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      u.status === "active"
                        ? "bg-[#0ecb81]/10 text-[#0ecb81]"
                        : u.status === "suspended"
                        ? "bg-[#e2b700]/10 text-[#e2b700]"
                        : "bg-[#f6465d]/10 text-[#f6465d]"
                    }`}>
                      {u.status === "active" ? "نشط" : u.status === "suspended" ? "موقوف" : "محظور"}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    {u.status === "active" ? (
                      <button
                        onClick={() => handleSuspendUser(u.telegramId, u.username)}
                        className="text-[#f6465d]/70 hover:text-[#f6465d] text-xs transition-colors"
                      >
                        إيقاف
                      </button>
                    ) : (
                      <span className="text-white/20 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Trades */}
      <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-[#e2b700]" />
          <h2 className="font-semibold text-white">آخر الصفقات</h2>
          <span className="text-white/40 text-xs">({MOCK_RECENT_TRADES.length})</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 text-xs">
                <th className="text-right py-2 px-3 font-medium">المستخدم</th>
                <th className="text-right py-2 px-3 font-medium">الزوج</th>
                <th className="text-right py-2 px-3 font-medium">الاتجاه</th>
                <th className="text-right py-2 px-3 font-medium">الحجم</th>
                <th className="text-right py-2 px-3 font-medium">الأرباح / الخسارة</th>
                <th className="text-right py-2 px-3 font-medium">الرسوم</th>
                <th className="text-right py-2 px-3 font-medium">DEX</th>
                <th className="text-right py-2 px-3 font-medium">الحالة</th>
                <th className="text-right py-2 px-3 font-medium">الوقت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {MOCK_RECENT_TRADES.map((t) => (
                <tr key={t.id} className="hover:bg-white/3 transition-colors">
                  <td className="py-3 px-3 text-white/70 text-xs">{t.username}</td>
                  <td className="py-3 px-3 font-semibold text-white">{t.symbol}</td>
                  <td className="py-3 px-3">
                    <div className={`inline-flex items-center gap-1 text-xs font-semibold ${
                      t.direction === "buy" ? "text-[#0ecb81]" : "text-[#f6465d]"
                    }`}>
                      {t.direction === "buy"
                        ? <TrendingUp className="w-3 h-3" />
                        : <TrendingDown className="w-3 h-3" />}
                      {t.direction === "buy" ? "شراء" : "بيع"}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-white/70">{t.size}</td>
                  <td className="py-3 px-3">
                    <span className={`font-bold text-sm ${t.pnlPositive ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                      {t.pnl}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-[#e2b700] text-xs">{t.fee}</td>
                  <td className="py-3 px-3 text-white/50 text-xs">{t.dex}</td>
                  <td className="py-3 px-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      t.status === "open"
                        ? "bg-blue-400/10 text-blue-400"
                        : "bg-white/10 text-white/40"
                    }`}>
                      {t.status === "open" ? "مفتوحة" : "مغلقة"}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-white/30 text-xs">{t.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
