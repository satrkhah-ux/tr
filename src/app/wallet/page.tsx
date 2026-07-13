"use client";

import { useState } from "react";
import { Copy, Check, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, X } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { OkxFooter } from "@/components/OkxFooter";
import { useLanguage } from "@/components/LanguageProvider";
import { usePalmXStore } from "@/lib/store";

// Mock user balances per symbol (in real app, fetched from user account API)
const MOCK_BALANCES: Record<string, { balance: string; usd: string }> = {
  BTC:  { balance: "0.24831000", usd: "$23,948.12" },
  ETH:  { balance: "4.18200000", usd: "$13,551.63" },
  USDT: { balance: "5,241.83",   usd: "$5,241.83" },
  SOL:  { balance: "18.50000000",usd: "$3,310.02" },
  BNB:  { balance: "3.00000000", usd: "$1,803.90" },
  IQD:  { balance: "5,000,000",  usd: "$3,813.00" },
};

const TX_HISTORY = [
  { type: "Deposit",  asset: "BTC",  amount: "+0.05 BTC",   usd: "+$4,821.02", date: "2026-03-30 14:22", status: "completed" },
  { type: "Withdraw", asset: "USDT", amount: "-1,000 USDT", usd: "-$1,000.00", date: "2026-03-29 09:18", status: "completed" },
  { type: "Deposit",  asset: "ETH",  amount: "+1.2 ETH",    usd: "+$3,890.16", date: "2026-03-28 17:45", status: "completed" },
  { type: "Transfer", asset: "BNB",  amount: "-0.5 BNB",    usd: "-$300.65",   date: "2026-03-27 11:30", status: "completed" },
  { type: "Deposit",  asset: "IQD",  amount: "+1,000,000 IQD", usd: "+$762.60", date: "2026-03-26 08:10", status: "completed" },
  { type: "Withdraw", asset: "BTC",  amount: "-0.01 BTC",   usd: "-$964.21",   date: "2026-03-25 20:55", status: "pending" },
];

const MOCK_ADDRESS = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

type ModalType = "deposit" | "withdraw" | "transfer" | null;

export default function WalletPage() {
  const { t, isRTL } = useLanguage();
  const { assets } = usePalmXStore();

  // Build wallet asset list from store (with mock balances)
  const activeAssets = assets.filter((a) => a.status === "active");
  const walletAssets = activeAssets.map((a) => ({
    symbol:  a.symbol,
    name:    a.name,
    logo:    a.color,
    balance: MOCK_BALANCES[a.symbol]?.balance ?? "0.00000000",
    usd:     MOCK_BALANCES[a.symbol]?.usd     ?? "$0.00",
    networks: a.networks,
  }));

  const [modal, setModal] = useState<ModalType>(null);
  const [selectedAsset, setSelectedAsset] = useState(walletAssets[0] ?? { symbol: "BTC", name: "Bitcoin", logo: "#f7931a", balance: "0", usd: "$0", networks: ["Bitcoin (BTC)"] });
  const [copied, setCopied] = useState(false);
  const [withdrawAddr, setWithdrawAddr] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [selectedNetwork, setSelectedNetwork] = useState("");
  const rtlFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  const totalUSD = "$47,668.50";

  function openModal(type: ModalType, asset = walletAssets[0]) {
    setSelectedAsset(asset);
    setSelectedNetwork((asset.networks ?? [""])[0]);
    setWithdrawAddr("");
    setWithdrawAmount("");
    setModal(type);
  }

  function copyAddress() {
    navigator.clipboard.writeText(MOCK_ADDRESS).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1 pt-24 pb-20">
        <div className="max-w-[1100px] mx-auto px-6 lg:px-12">
          {/* Balance overview */}
          <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-8 mb-8">
            <p className="text-sm text-white/40 mb-1" style={rtlFont}>{t.walletTotalBalance}</p>
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-6">
              <div>
                <span className="text-4xl font-bold text-white">{totalUSD}</span>
                <span className="text-white/30 text-lg ml-2">≈ 65,830,000 IQD</span>
              </div>
              <div className="flex gap-2 text-sm text-white/40">
                <span>{t.walletAvailableBalance}: <b className="text-white">$44,291.50</b></span>
                <span>·</span>
                <span>{t.walletFrozenBalance}: <b className="text-yellow-400">$3,377.00</b></span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => openModal("deposit")}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black font-semibold rounded-xl text-sm transition-colors"
                style={rtlFont}
              >
                <ArrowDownLeft className="w-4 h-4" /> {t.walletDeposit}
              </button>
              <button
                onClick={() => openModal("withdraw")}
                className="flex items-center gap-2 px-5 py-2.5 bg-white/8 hover:bg-white/12 text-white font-semibold rounded-xl text-sm transition-colors"
                style={rtlFont}
              >
                <ArrowUpRight className="w-4 h-4" /> {t.walletWithdraw}
              </button>
              <button
                onClick={() => openModal("transfer")}
                className="flex items-center gap-2 px-5 py-2.5 bg-white/8 hover:bg-white/12 text-white font-semibold rounded-xl text-sm transition-colors"
                style={rtlFont}
              >
                <ArrowLeftRight className="w-4 h-4" /> {t.walletTransfer}
              </button>
            </div>
          </div>

          {/* Assets table */}
          <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl overflow-hidden mb-8">
            <div className="px-6 py-4 border-b border-white/8">
              <h2 className="text-base font-semibold text-white" style={rtlFont}>
                {t.walletHeading}
              </h2>
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 sm:gap-4 px-4 sm:px-6 py-3 border-b border-white/8 text-xs font-semibold text-white/30 uppercase tracking-wider">
              <span style={rtlFont}>{t.walletAsset}</span>
              <span className="text-right" style={rtlFont}>{t.walletBalance}</span>
              <span className="hidden sm:block text-right" style={rtlFont}>{t.walletUsdValue}</span>
              <span className="text-right" style={rtlFont}>{t.walletActions}</span>
            </div>
            {walletAssets.map((asset) => (
              <div
                key={asset.symbol}
                className="grid grid-cols-[1fr_1fr_auto] sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 sm:gap-4 items-center px-4 sm:px-6 py-3 sm:py-4 border-b border-white/5 hover:bg-white/2 transition-colors last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ background: asset.logo }}
                  >
                    {asset.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{asset.symbol}</div>
                    <div className="text-xs text-white/40">{asset.name}</div>
                  </div>
                </div>
                <div className="text-right font-mono text-sm text-white">{asset.balance}</div>
                <div className="hidden sm:block text-right font-mono text-sm text-white/60">{asset.usd}</div>
                <div className="flex items-center gap-1 justify-end">
                  <button
                    onClick={() => openModal("deposit", asset)}
                    className="px-3 py-1 text-xs font-medium bg-[#e2b700]/10 hover:bg-[#e2b700]/20 text-[#e2b700] rounded-lg transition-colors border border-[#e2b700]/20"
                    style={rtlFont}
                  >
                    {t.walletDeposit}
                  </button>
                  <button
                    onClick={() => openModal("withdraw", asset)}
                    className="px-3 py-1 text-xs font-medium bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-lg transition-colors"
                    style={rtlFont}
                  >
                    {t.walletWithdraw}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Transaction History */}
          <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/8">
              <h2 className="text-base font-semibold text-white" style={rtlFont}>
                {t.walletHistoryHeading}
              </h2>
            </div>
            <div className="grid grid-cols-[1fr_1fr_1fr] sm:grid-cols-[1fr_1fr_1fr_1fr] gap-3 sm:gap-4 px-4 sm:px-6 py-3 border-b border-white/8 text-xs font-semibold text-white/30 uppercase tracking-wider">
              <span style={rtlFont}>{t.walletHistoryType}</span>
              <span className="text-right" style={rtlFont}>{t.walletHistoryAmount}</span>
              <span className="hidden sm:block text-right" style={rtlFont}>{t.walletHistoryDate}</span>
              <span className="text-right" style={rtlFont}>{t.walletHistoryStatus}</span>
            </div>
            {TX_HISTORY.map((tx, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_1fr_1fr] sm:grid-cols-[1fr_1fr_1fr_1fr] gap-3 sm:gap-4 items-center px-4 sm:px-6 py-3 sm:py-4 border-b border-white/5 hover:bg-white/2 transition-colors last:border-0"
              >
                <div className="flex items-center gap-2">
                  {tx.type === "Deposit" ? (
                    <ArrowDownLeft className="w-4 h-4 text-[#0ecb81]" />
                  ) : tx.type === "Withdraw" ? (
                    <ArrowUpRight className="w-4 h-4 text-[#f6465d]" />
                  ) : (
                    <ArrowLeftRight className="w-4 h-4 text-[#e2b700]" />
                  )}
                  <span className="text-sm text-white">{tx.type}</span>
                </div>
                <div className="text-right">
                  <div className={`font-mono text-sm ${tx.amount.startsWith("+") ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                    {tx.amount}
                  </div>
                  <div className="text-xs text-white/30">{tx.usd}</div>
                </div>
                <div className="hidden sm:block text-right text-xs text-white/40 font-mono">{tx.date}</div>
                <div className="text-right">
                  <span
                    className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${
                      tx.status === "completed"
                        ? "bg-[#0ecb81]/10 text-[#0ecb81]"
                        : "bg-[#e2b700]/10 text-[#e2b700]"
                    }`}
                    style={rtlFont}
                  >
                    {tx.status === "completed" ? t.walletHistoryCompleted : t.walletHistoryPending}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Modal overlay */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl" dir={isRTL ? "rtl" : "ltr"}>
            {/* Modal header */}
            <div className="flex items-center justify-between p-6 border-b border-white/8">
              <h3 className="text-lg font-bold text-white" style={rtlFont}>
                {modal === "deposit" ? t.walletDeposit : modal === "withdraw" ? t.walletWithdraw : t.walletTransfer}{" "}
                {selectedAsset.symbol}
              </h3>
              <button onClick={() => setModal(null)} className="text-white/40 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Asset selector */}
              <div>
                <label className="block text-xs text-white/40 mb-1.5" style={rtlFont}>{t.walletSelectAsset}</label>
                <select
                  value={selectedAsset.symbol}
                  onChange={(e) => {
                    const a = walletAssets.find((x) => x.symbol === e.target.value) ?? walletAssets[0];
                    setSelectedAsset(a);
                    setSelectedNetwork((a.networks ?? [""])[0]);
                  }}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#e2b700]/50 appearance-none"
                  style={rtlFont}
                >
                  {walletAssets.map((a) => (
                    <option key={a.symbol} value={a.symbol} className="bg-[#1a1a1a]">
                      {a.symbol} — {a.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Network selector */}
              <div>
                <label className="block text-xs text-white/40 mb-1.5" style={rtlFont}>{t.walletNetwork}</label>
                <select
                  value={selectedNetwork}
                  onChange={(e) => setSelectedNetwork(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#e2b700]/50 appearance-none"
                  style={rtlFont}
                >
                  {(selectedAsset.networks ?? []).map((n) => (
                    <option key={n} value={n} className="bg-[#1a1a1a]">{n}</option>
                  ))}
                </select>
              </div>

              {modal === "deposit" ? (
                <>
                  {/* QR / Address for deposit */}
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5" style={rtlFont}>{t.walletAddress}</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white/70 font-mono truncate">
                        {MOCK_ADDRESS}
                      </code>
                      <button
                        onClick={copyAddress}
                        className="px-3 py-2.5 bg-white/8 hover:bg-white/12 rounded-xl text-white/60 hover:text-white transition-colors"
                      >
                        {copied ? <Check className="w-4 h-4 text-[#0ecb81]" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-white/30 mt-2" style={rtlFont}>
                      {t.walletMinDeposit}: 0.0001 {selectedAsset.symbol}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  {/* Address / Amount for withdraw/transfer */}
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5" style={rtlFont}>{t.walletAddress}</label>
                    <input
                      type="text"
                      value={withdrawAddr}
                      onChange={(e) => setWithdrawAddr(e.target.value)}
                      placeholder="0x..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5" style={rtlFont}>
                      {t.walletAmount} · {t.walletAvailableBalance}: {selectedAsset.balance} {selectedAsset.symbol}
                    </label>
                    <input
                      type="number"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/50"
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-white/40">
                    <span style={rtlFont}>{t.walletFee}</span>
                    <span>0.0005 {selectedAsset.symbol}</span>
                  </div>
                </>
              )}

              {/* Action buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setModal(null)}
                  className="flex-1 py-2.5 border border-white/10 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:border-white/20 transition-colors"
                  style={rtlFont}
                >
                  {t.walletCancel}
                </button>
                <button
                  className="flex-1 py-2.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black rounded-xl text-sm font-semibold transition-colors"
                  style={rtlFont}
                >
                  {t.walletConfirm}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <OkxFooter />
    </div>
  );
}
