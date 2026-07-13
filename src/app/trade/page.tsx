"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { OkxFooter } from "@/components/OkxFooter";
import { TradingViewWidget } from "@/components/TradingViewWidget";
import { useLanguage } from "@/components/LanguageProvider";

const PAIRS = [
  { label: "BTC/USDT", symbol: "BTCUSDT", price: "96,420.50", change: "+2.14%" },
  { label: "ETH/USDT", symbol: "ETHUSDT", price: "3,241.80", change: "+1.67%" },
  { label: "BNB/USDT", symbol: "BNBUSDT", price: "601.30", change: "-0.43%" },
  { label: "SOL/USDT", symbol: "SOLUSDT", price: "178.92", change: "+3.21%" },
  { label: "XRP/USDT", symbol: "XRPUSDT", price: "0.5812", change: "+0.88%" },
];

function generateOrderBook(midPrice: number, rows = 10) {
  const asks = Array.from({ length: rows }, (_, i) => ({
    price: (midPrice + (i + 1) * 5.2 + Math.random() * 3).toFixed(2),
    size: (Math.random() * 2 + 0.01).toFixed(4),
    total: (Math.random() * 180000 + 5000).toFixed(0),
  })).reverse();
  const bids = Array.from({ length: rows }, (_, i) => ({
    price: (midPrice - (i + 1) * 5.1 - Math.random() * 3).toFixed(2),
    size: (Math.random() * 2 + 0.01).toFixed(4),
    total: (Math.random() * 180000 + 5000).toFixed(0),
  }));
  return { asks, bids };
}

function generateRecentTrades(midPrice: number, count = 12) {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    price: (midPrice + (Math.random() - 0.5) * 40).toFixed(2),
    size: (Math.random() * 0.5 + 0.001).toFixed(4),
    side: Math.random() > 0.5 ? "buy" : "sell",
    time: new Date(now - i * 8000 - Math.random() * 5000).toLocaleTimeString(),
  }));
}

export default function TradePage() {
  const { t, isRTL } = useLanguage();
  const [selectedPair, setSelectedPair] = useState(PAIRS[0]);
  const [orderType, setOrderType] = useState<"market" | "limit" | "stop">("limit");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("96420.00");
  const [amount, setAmount] = useState("");
  const rtlFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  const midPrice = parseFloat(selectedPair.price.replace(",", ""));
  const { asks, bids } = generateOrderBook(midPrice);
  const recentTrades = generateRecentTrades(midPrice);

  const total =
    amount && price ? (parseFloat(amount) * parseFloat(price)).toFixed(2) : "";

  useEffect(() => {
    setPrice(selectedPair.price.replace(",", ""));
  }, [selectedPair]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <div className="flex-1 pt-16">
        {/* Pair selector bar */}
        <div className="border-b border-white/8 bg-[#0a0a0a] overflow-x-auto">
          <div className="flex items-center gap-1 px-4 py-2 min-w-max">
            {PAIRS.map((pair) => (
              <button
                key={pair.symbol}
                onClick={() => setSelectedPair(pair)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-all whitespace-nowrap ${
                  selectedPair.symbol === pair.symbol
                    ? "bg-white/8 text-white"
                    : "text-white/50 hover:text-white hover:bg-white/4"
                }`}
              >
                <span className="font-semibold">{pair.label}</span>
                <span className="font-mono">{pair.price}</span>
                <span
                  className={
                    pair.change.startsWith("+") ? "text-[#0ecb81]" : "text-[#f6465d]"
                  }
                >
                  {pair.change}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Main trading layout */}
        <div className="flex flex-col xl:flex-row h-[calc(100vh-112px)] min-h-[700px]">
          {/* Chart + order form */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* TradingView Chart */}
            <div className="flex-1 min-h-[300px] xl:min-h-0">
              <TradingViewWidget symbol={selectedPair.symbol} height={undefined} />
            </div>

            {/* Order Form (below chart on mobile, hidden on xl — moved to sidebar) */}
            <div className="xl:hidden border-t border-white/8 p-4">
              <OrderForm
                t={t}
                isRTL={isRTL}
                rtlFont={rtlFont}
                orderType={orderType}
                setOrderType={setOrderType}
                side={side}
                setSide={setSide}
                price={price}
                setPrice={setPrice}
                amount={amount}
                setAmount={setAmount}
                total={total}
                pair={selectedPair.label}
              />
            </div>
          </div>

          {/* Right sidebar: Order Book + Trades + Order Form */}
          <div
            className={`hidden xl:flex flex-col w-[340px] border-${isRTL ? "l" : "r"} border-white/8`}
          >
            {/* Order Book */}
            <div className="flex-1 overflow-hidden flex flex-col border-b border-white/8">
              <div className="px-4 pt-4 pb-2">
                <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider" style={rtlFont}>
                  {t.tradeOrderBook}
                </h3>
              </div>
              <div className="flex text-[10px] text-white/30 px-4 pb-1 gap-2">
                <span className="flex-1" style={rtlFont}>{t.tradePrice} (USDT)</span>
                <span className="flex-1 text-center" style={rtlFont}>{t.tradeSize}</span>
                <span className="flex-1 text-right" style={rtlFont}>{t.tradeTotal}</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {asks.map((row, i) => (
                  <div key={i} className="flex items-center gap-2 px-4 py-[3px] hover:bg-white/3 relative">
                    <div
                      className="absolute inset-0 bg-[#f6465d]/6"
                      style={{ width: `${Math.random() * 60 + 20}%`, right: 0, left: "auto" }}
                    />
                    <span className="flex-1 font-mono text-[11px] text-[#f6465d] relative z-10">{row.price}</span>
                    <span className="flex-1 text-center font-mono text-[11px] text-white/60 relative z-10">{row.size}</span>
                    <span className="flex-1 text-right font-mono text-[11px] text-white/40 relative z-10">{Number(row.total).toLocaleString()}</span>
                  </div>
                ))}
                <div className="px-4 py-2 border-y border-white/8 flex items-center gap-2">
                  <span className="font-mono text-base font-bold text-[#0ecb81]">
                    {midPrice.toLocaleString()}
                  </span>
                  <span className="text-xs text-white/40">≈ {midPrice.toLocaleString()} USD</span>
                </div>
                {bids.map((row, i) => (
                  <div key={i} className="flex items-center gap-2 px-4 py-[3px] hover:bg-white/3 relative">
                    <div
                      className="absolute inset-0 bg-[#0ecb81]/6"
                      style={{ width: `${Math.random() * 60 + 20}%` }}
                    />
                    <span className="flex-1 font-mono text-[11px] text-[#0ecb81] relative z-10">{row.price}</span>
                    <span className="flex-1 text-center font-mono text-[11px] text-white/60 relative z-10">{row.size}</span>
                    <span className="flex-1 text-right font-mono text-[11px] text-white/40 relative z-10">{Number(row.total).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Trades */}
            <div className="h-[200px] overflow-hidden flex flex-col border-b border-white/8">
              <div className="px-4 pt-3 pb-1">
                <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider" style={rtlFont}>
                  {t.tradeRecentTrades}
                </h3>
              </div>
              <div className="flex text-[10px] text-white/30 px-4 pb-1 gap-2">
                <span className="flex-1" style={rtlFont}>{t.tradePrice}</span>
                <span className="flex-1 text-center" style={rtlFont}>{t.tradeSize}</span>
                <span className="flex-1 text-right" style={rtlFont}>{t.tradeTime}</span>
              </div>
              <div className="overflow-y-auto flex-1">
                {recentTrades.map((trade, i) => (
                  <div key={i} className="flex items-center gap-2 px-4 py-[3px]">
                    <span className={`flex-1 font-mono text-[11px] ${trade.side === "buy" ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                      {trade.price}
                    </span>
                    <span className="flex-1 text-center font-mono text-[11px] text-white/60">{trade.size}</span>
                    <span className="flex-1 text-right font-mono text-[11px] text-white/40">{trade.time}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Order Form */}
            <div className="p-4 overflow-y-auto">
              <OrderForm
                t={t}
                isRTL={isRTL}
                rtlFont={rtlFont}
                orderType={orderType}
                setOrderType={setOrderType}
                side={side}
                setSide={setSide}
                price={price}
                setPrice={setPrice}
                amount={amount}
                setAmount={setAmount}
                total={total}
                pair={selectedPair.label}
              />
            </div>
          </div>
        </div>
      </div>

      <OkxFooter />
    </div>
  );
}

// ─── Order Form sub-component ────────────────────────────────────────────────
function OrderForm({
  t, isRTL, rtlFont, orderType, setOrderType, side, setSide,
  price, setPrice, amount, setAmount, total, pair,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any; isRTL: boolean; rtlFont: React.CSSProperties;
  orderType: "market" | "limit" | "stop"; setOrderType: (v: "market" | "limit" | "stop") => void;
  side: "buy" | "sell"; setSide: (v: "buy" | "sell") => void;
  price: string; setPrice: (v: string) => void;
  amount: string; setAmount: (v: string) => void;
  total: string; pair: string;
}) {
  return (
    <div className="space-y-3">
      {/* Buy / Sell tabs */}
      <div className="flex rounded-lg overflow-hidden border border-white/10">
        <button
          onClick={() => setSide("buy")}
          className={`flex-1 py-2 text-sm font-semibold transition-colors ${side === "buy" ? "bg-[#0ecb81] text-black" : "bg-transparent text-white/50 hover:text-white"}`}
          style={rtlFont}
        >
          {t.tradeBuyBtn} {pair.split("/")[0]}
        </button>
        <button
          onClick={() => setSide("sell")}
          className={`flex-1 py-2 text-sm font-semibold transition-colors ${side === "sell" ? "bg-[#f6465d] text-white" : "bg-transparent text-white/50 hover:text-white"}`}
          style={rtlFont}
        >
          {t.tradeSellBtn} {pair.split("/")[0]}
        </button>
      </div>

      {/* Order type */}
      <div className="flex gap-1">
        {(["limit", "market", "stop"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setOrderType(type)}
            className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${orderType === type ? "bg-white/10 text-white" : "text-white/40 hover:text-white"}`}
            style={rtlFont}
          >
            {type === "limit" ? t.tradeLimit : type === "market" ? t.tradeMarket : t.tradeStop}
          </button>
        ))}
      </div>

      {/* Available */}
      <div className="flex items-center justify-between text-xs text-white/40">
        <span style={rtlFont}>{t.tradeAvailable}</span>
        <span className="font-mono">0.00 {side === "buy" ? "USDT" : pair.split("/")[0]}</span>
      </div>

      {/* Price */}
      {orderType !== "market" && (
        <div>
          <label className="block text-xs text-white/40 mb-1" style={rtlFont}>{t.tradePrice} (USDT)</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-[#e2b700]/50"
          />
        </div>
      )}

      {/* Amount */}
      <div>
        <label className="block text-xs text-white/40 mb-1" style={rtlFont}>
          {t.tradeAmount} ({pair.split("/")[0]})
        </label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-[#e2b700]/50"
        />
        {/* Amount % shortcuts */}
        <div className="flex gap-1 mt-1">
          {["25%", "50%", "75%", "100%"].map((pct) => (
            <button
              key={pct}
              className="flex-1 text-[10px] py-1 bg-white/5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors"
            >
              {pct}
            </button>
          ))}
        </div>
      </div>

      {/* Total */}
      {total && (
        <div className="flex items-center justify-between text-xs text-white/40">
          <span style={rtlFont}>{t.tradeTotal}</span>
          <span className="font-mono text-white/60">{Number(total).toLocaleString()} USDT</span>
        </div>
      )}

      {/* Submit */}
      <button
        className={`w-full py-3 rounded-lg font-semibold text-sm transition-all ${
          side === "buy"
            ? "bg-[#0ecb81] hover:bg-[#0ab56e] text-black"
            : "bg-[#f6465d] hover:bg-[#e03550] text-white"
        }`}
        style={rtlFont}
      >
        {side === "buy" ? t.tradePlaceBuy : t.tradePlaceSell}
      </button>

      <p className="text-center text-xs text-white/30" style={rtlFont}>
        <Link href="/account/login" className="text-[#e2b700] hover:underline">
          {t.tradeLoginPrompt}
        </Link>
      </p>
    </div>
  );
}
