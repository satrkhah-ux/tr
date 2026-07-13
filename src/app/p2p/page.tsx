"use client";

import { useState } from "react";
import { Shield, MessageSquare, Star } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { OkxFooter } from "@/components/OkxFooter";
import { useLanguage } from "@/components/LanguageProvider";

const OFFERS_BUY = [
  {
    merchant: "Ali_IQ",      orders: 1240, completion: "99.1%", price: "1,390 IQD", available: "15,000 USDT",
    min: "50,000 IQD", max: "20,000,000 IQD", methods: ["Bank Transfer", "Cash"],   verified: true,
  },
  {
    merchant: "CryptoMaestro", orders: 887, completion: "98.4%", price: "1,388 IQD", available: "8,200 USDT",
    min: "100,000 IQD", max: "10,000,000 IQD", methods: ["Bank Transfer"],           verified: true,
  },
  {
    merchant: "Gulf_Trader", orders: 543, completion: "97.8%", price: "1,385 IQD", available: "3,300 USDT",
    min: "250,000 IQD", max: "5,000,000 IQD",  methods: ["Cash", "Online Wallet"],  verified: true,
  },
  {
    merchant: "ZeedExchange", orders: 310, completion: "96.5%", price: "1,382 IQD", available: "21,000 USDT",
    min: "50,000 IQD", max: "30,000,000 IQD", methods: ["Bank Transfer", "Cash"],   verified: false,
  },
  {
    merchant: "Baghdad_P2P",  orders: 192, completion: "95.2%", price: "1,379 IQD", available: "6,500 USDT",
    min: "100,000 IQD", max: "9,000,000 IQD",  methods: ["Online Wallet"],           verified: false,
  },
];

const OFFERS_SELL = [
  {
    merchant: "Mosul_Exchanger", orders: 980, completion: "98.9%", price: "1,370 IQD", available: "12,000 USDT",
    min: "50,000 IQD", max: "18,000,000 IQD", methods: ["Bank Transfer"],              verified: true,
  },
  {
    merchant: "FastP2P_IQ",     orders: 741, completion: "97.5%", price: "1,368 IQD", available: "4,500 USDT",
    min: "200,000 IQD", max: "8,000,000 IQD",  methods: ["Cash"],                      verified: true,
  },
  {
    merchant: "IraqTrader99",   orders: 422, completion: "96.1%", price: "1,365 IQD", available: "9,800 USDT",
    min: "100,000 IQD", max: "14,000,000 IQD", methods: ["Bank Transfer", "Cash"],     verified: false,
  },
];

const ASSETS_LIST = ["USDT", "BTC", "ETH", "BNB", "SOL"];
const PAYMENT_METHODS = (t: { p2pAllMethods: string; p2pBankTransfer: string; p2pCash: string; p2pOnlineWallet: string }) => [
  t.p2pAllMethods, t.p2pBankTransfer, t.p2pCash, t.p2pOnlineWallet,
];

export default function P2PPage() {
  const { t, isRTL } = useLanguage();
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [asset, setAsset] = useState("USDT");
  const [payMethod, setPayMethod] = useState<string>(t.p2pAllMethods);
  const [chatOpen, setChatOpen] = useState(false);
  const rtlFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  const offers = tab === "buy" ? OFFERS_BUY : OFFERS_SELL;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1 pt-24 pb-20">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-12">
          {/* Page header */}
          <div className="mb-8">
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-3" style={rtlFont}>
              {t.p2pHeading}
            </h1>
            <p className="text-white/50 text-sm max-w-xl" style={rtlFont}>{t.p2pSubtitle}</p>
          </div>

          {/* Escrow badge */}
          <div className="flex items-center gap-2 mb-8 bg-[#0ecb81]/8 border border-[#0ecb81]/20 rounded-xl px-4 py-3 max-w-max">
            <Shield className="w-4 h-4 text-[#0ecb81] flex-shrink-0" />
            <span className="text-sm text-[#0ecb81]" style={rtlFont}>{t.p2pEscrowNote}</span>
          </div>

          {/* Filters bar */}
          <div className="flex flex-wrap items-end gap-3 mb-6">
            {/* Buy/Sell tab */}
            <div className="flex rounded-xl overflow-hidden border border-white/10">
              <button
                onClick={() => setTab("buy")}
                className={`px-6 py-2.5 text-sm font-semibold transition-colors ${tab === "buy" ? "bg-[#0ecb81] text-black" : "bg-transparent text-white/50 hover:text-white"}`}
                style={rtlFont}
              >
                {t.p2pBuy}
              </button>
              <button
                onClick={() => setTab("sell")}
                className={`px-6 py-2.5 text-sm font-semibold transition-colors ${tab === "sell" ? "bg-[#f6465d] text-white" : "bg-transparent text-white/50 hover:text-white"}`}
                style={rtlFont}
              >
                {t.p2pSell}
              </button>
            </div>

            {/* Asset filter */}
            <div className="flex gap-1">
              {ASSETS_LIST.map((a) => (
                <button
                  key={a}
                  onClick={() => setAsset(a)}
                  className={`px-3 py-2 text-sm rounded-lg transition-colors ${asset === a ? "bg-white/12 text-white font-semibold" : "text-white/40 hover:text-white hover:bg-white/6"}`}
                >
                  {a}
                </button>
              ))}
            </div>

            {/* Payment method filter */}
            <select
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#e2b700]/50 appearance-none"
              style={rtlFont}
            >
              {PAYMENT_METHODS(t).map((m) => (
                <option key={m} value={m} className="bg-[#1a1a1a]">{m}</option>
              ))}
            </select>

            {/* Post ad button */}
            <button
              className="ml-auto px-5 py-2.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black font-semibold rounded-xl text-sm transition-colors"
              style={rtlFont}
            >
              + {t.p2pPostAd}
            </button>
          </div>

          {/* Offers table */}
          <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="hidden md:grid grid-cols-[2fr_1fr_1.5fr_1fr_2fr_auto] gap-4 px-6 py-3 border-b border-white/8 text-xs font-semibold text-white/30 uppercase tracking-wider">
              <span style={rtlFont}>{t.p2pMerchant}</span>
              <span className="text-right" style={rtlFont}>{t.p2pPrice}</span>
              <span className="text-right" style={rtlFont}>{t.p2pAvailable}</span>
              <span className="text-right" style={rtlFont}>{t.p2pLimit}</span>
              <span style={rtlFont}>{t.p2pMethods}</span>
              <span className="text-right" style={rtlFont}>{t.p2pTradeBtn}</span>
            </div>

            {offers.map((offer, i) => (
              <div
                key={i}
                className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1.5fr_1fr_2fr_auto] gap-4 items-center px-6 py-5 border-b border-white/5 hover:bg-white/2 transition-colors last:border-0"
              >
                {/* Merchant */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#e2b700]/15 flex items-center justify-center text-sm font-bold text-[#e2b700]">
                    {offer.merchant[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-white">{offer.merchant}</span>
                      {offer.verified && (
                        <span className="flex items-center gap-0.5 text-[10px] text-[#0ecb81] bg-[#0ecb81]/10 px-1.5 py-0.5 rounded-full">
                          <Star className="w-2.5 h-2.5" /> {t.p2pVerified}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-white/40 mt-0.5">
                      {offer.orders} {t.p2pOrders} · {offer.completion} {t.p2pCompletion}
                    </div>
                  </div>
                </div>

                {/* Price */}
                <div className="md:text-right">
                  <div className="text-sm font-bold text-white">{offer.price}</div>
                  <div className="text-xs text-white/30">IQD / {asset}</div>
                </div>

                {/* Available */}
                <div className="md:text-right">
                  <div className="text-sm text-white/70 font-mono">{offer.available}</div>
                </div>

                {/* Limit */}
                <div className="md:text-right">
                  <div className="text-xs text-white/50">{offer.min}</div>
                  <div className="text-xs text-white/30">—</div>
                  <div className="text-xs text-white/50">{offer.max}</div>
                </div>

                {/* Payment methods */}
                <div className="flex flex-wrap gap-1.5">
                  {offer.methods.map((m) => (
                    <span
                      key={m}
                      className="text-[10px] px-2 py-1 bg-white/6 border border-white/8 rounded-full text-white/60"
                      style={rtlFont}
                    >
                      {m}
                    </span>
                  ))}
                </div>

                {/* Trade button */}
                <div className="flex flex-col gap-1.5 items-end">
                  <button
                    className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
                      tab === "buy"
                        ? "bg-[#0ecb81] hover:bg-[#0ab56e] text-black"
                        : "bg-[#f6465d] hover:bg-[#e03550] text-white"
                    }`}
                    style={rtlFont}
                  >
                    {tab === "buy" ? t.p2pBuy : t.p2pSell} {asset}
                  </button>
                  <button
                    onClick={() => setChatOpen(true)}
                    className="flex items-center gap-1 text-xs text-white/40 hover:text-white transition-colors"
                    style={rtlFont}
                  >
                    <MessageSquare className="w-3 h-3" /> {t.p2pChatOpen}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Chat drawer (mock) */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div
            className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-md h-[480px] flex flex-col shadow-2xl"
            dir={isRTL ? "rtl" : "ltr"}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#0ecb81]" />
                <span className="text-sm font-semibold text-white" style={rtlFont}>P2P Chat</span>
                <span className="text-xs text-white/30">· Ali_IQ</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-white/40 hover:text-white text-xl leading-none">×</button>
            </div>

            {/* Messages area */}
            <div className="flex-1 p-5 space-y-4 overflow-y-auto">
              <div className="flex gap-3 items-end">
                <div className="w-7 h-7 rounded-full bg-[#e2b700]/20 flex items-center justify-center text-xs font-bold text-[#e2b700] flex-shrink-0">A</div>
                <div className="bg-white/6 rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[80%]">
                  <p className="text-sm text-white" style={rtlFont}>مرحباً، كيف يمكنني مساعدتك؟</p>
                  <p className="text-[10px] text-white/30 mt-1">14:22</p>
                </div>
              </div>
              <div className="flex gap-3 items-end justify-end">
                <div className="bg-[#e2b700]/15 border border-[#e2b700]/20 rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[80%]">
                  <p className="text-sm text-white" style={rtlFont}>Hello, I want to buy 500 USDT</p>
                  <p className="text-[10px] text-white/30 mt-1">14:23</p>
                </div>
                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60 flex-shrink-0">Y</div>
              </div>
              <div className="flex gap-3 items-end">
                <div className="w-7 h-7 rounded-full bg-[#e2b700]/20 flex items-center justify-center text-xs font-bold text-[#e2b700] flex-shrink-0">A</div>
                <div className="bg-white/6 rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[80%]">
                  <p className="text-sm text-white" style={rtlFont}>سأرسل لك تفاصيل الحساب المصرفي بعد تأكيد الطلب.</p>
                  <p className="text-[10px] text-white/30 mt-1">14:23</p>
                </div>
              </div>
            </div>

            {/* Input */}
            <div className="px-4 py-4 border-t border-white/8 flex gap-2">
              <input
                type="text"
                placeholder={isRTL ? "اكتب رسالة..." : "Type a message..."}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/50"
                style={rtlFont}
              />
              <button className="px-4 py-2.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black rounded-xl text-sm font-semibold transition-colors">
                ↑
              </button>
            </div>
          </div>
        </div>
      )}

      <OkxFooter />
    </div>
  );
}
