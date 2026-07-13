"use client";

import { useState } from "react";
import { Plus, Trash2, X, Check, ToggleLeft, ToggleRight } from "lucide-react";
import { usePalmXStore, type TradingPair } from "@/lib/store";

const EMPTY_PAIR = { base: "", quote: "", price: "", volume24h: "", enabled: true };

export default function AdminPairsPage() {
  const { tradingPairs, assets, addPair, updatePair, removePair } = usePalmXStore();

  const [modal, setModal]             = useState(false);
  const [form, setForm]               = useState({ ...EMPTY_PAIR });
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [toast, setToast]             = useState("");
  const [search, setSearch]           = useState("");

  const activeSymbols = assets
    .filter((a) => a.status === "active")
    .map((a) => a.symbol)
    .sort();

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3500); }

  function handleAdd() {
    if (!form.base || !form.quote || form.base === form.quote) return;
    addPair({
      base: form.base,
      quote: form.quote,
      enabled: form.enabled,
      price: form.price || "—",
      volume24h: form.volume24h || "$0",
    });
    showToast(`${form.base}/${form.quote} pair added.`);
    setModal(false);
    setForm({ ...EMPTY_PAIR });
  }

  function togglePair(pair: TradingPair) {
    updatePair(pair.id, { enabled: !pair.enabled });
    showToast(`${pair.base}/${pair.quote} ${!pair.enabled ? "enabled" : "disabled"}.`);
  }

  const filtered = tradingPairs.filter(
    (p) =>
      `${p.base}/${p.quote}`.toLowerCase().includes(search.toLowerCase())
  );

  const enabledCount  = tradingPairs.filter((p) => p.enabled).length;
  const disabledCount = tradingPairs.length - enabledCount;

  return (
    <div className="p-6 lg:p-8 max-w-[1280px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Trading Pairs</h1>
          <p className="text-sm text-white/40 mt-1">
            {enabledCount} enabled · {disabledCount} disabled · {tradingPairs.length} total
          </p>
        </div>
        <button
          onClick={() => { setForm({ ...EMPTY_PAIR }); setModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black text-sm font-semibold rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Pair
        </button>
      </div>

      {/* Search */}
      <div className="mb-5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search pairs…"
          className="bg-black border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e2b700]/40 w-64"
        />
      </div>

      {/* Table */}
      <div className="bg-black border border-white/8 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-4 px-5 py-3 border-b border-white/8 text-xs font-semibold text-white/30 uppercase tracking-wider">
          <span>Pair</span>
          <span>Current Price</span>
          <span>24h Volume</span>
          <span>Status / Toggle</span>
          <span>Remove</span>
        </div>

        {filtered.map((pair) => (
          <div
            key={pair.id}
            className={`grid grid-cols-[1fr_1fr_auto_auto_auto] gap-4 items-center px-5 py-4 border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors ${
              !pair.enabled ? "opacity-50" : ""
            }`}
          >
            {/* Pair */}
            <div className="flex items-center gap-2">
              <div className="flex -space-x-1.5">
                {[pair.base, pair.quote].map((sym) => {
                  const asset = assets.find((a) => a.symbol === sym);
                  return (
                    <div
                      key={sym}
                      className="w-7 h-7 rounded-full border-2 border-[#0a0a0a] flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ background: asset?.color ?? "#444" }}
                    >
                      {sym.slice(0, 1)}
                    </div>
                  );
                })}
              </div>
              <span className="text-sm font-semibold text-white">
                {pair.base}/{pair.quote}
              </span>
            </div>

            <span className="text-sm font-mono text-white/70">{pair.price}</span>
            <span className="text-sm text-white/50">{pair.volume24h}</span>

            {/* Toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => togglePair(pair)}
                className={`flex items-center gap-1.5 transition-colors text-sm font-medium ${
                  pair.enabled
                    ? "text-[#0ecb81] hover:text-[#0ecb81]/70"
                    : "text-white/30 hover:text-white/60"
                }`}
                title={pair.enabled ? "Disable pair" : "Enable pair"}
              >
                {pair.enabled ? (
                  <ToggleRight className="w-6 h-6" />
                ) : (
                  <ToggleLeft className="w-6 h-6" />
                )}
                <span className="text-xs hidden sm:inline">
                  {pair.enabled ? "Enabled" : "Disabled"}
                </span>
              </button>
            </div>

            {/* Remove */}
            <button
              onClick={() => setConfirmRemove(pair.id)}
              className="p-1.5 text-[#f6465d]/40 hover:text-[#f6465d] hover:bg-[#f6465d]/8 rounded-lg transition-colors"
              title="Remove pair"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="py-14 text-center text-white/30 text-sm">No trading pairs found</div>
        )}
      </div>

      {/* Add Pair Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0a0a0a] border border-white/12 rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-white">Add Trading Pair</h3>
              <button onClick={() => setModal(false)} className="text-white/40 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">
                    Base Asset
                  </label>
                  <select
                    value={form.base}
                    onChange={(e) => setForm((f) => ({ ...f, base: e.target.value }))}
                    className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none cursor-pointer"
                  >
                    <option value="">Select…</option>
                    {activeSymbols.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">
                    Quote Asset
                  </label>
                  <select
                    value={form.quote}
                    onChange={(e) => setForm((f) => ({ ...f, quote: e.target.value }))}
                    className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none cursor-pointer"
                  >
                    <option value="">Select…</option>
                    {activeSymbols.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>

              {form.base && form.quote && form.base === form.quote && (
                <p className="text-xs text-[#f6465d]">Base and quote assets must be different.</p>
              )}

              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">
                  Current Price
                </label>
                <input
                  type="text"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="e.g. $96,420.50"
                  className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/40"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">
                  24h Volume
                </label>
                <input
                  type="text"
                  value={form.volume24h}
                  onChange={(e) => setForm((f) => ({ ...f, volume24h: e.target.value }))}
                  placeholder="e.g. $38.2B"
                  className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/40"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-white/60">Enable pair immediately</span>
                <button
                  onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
                  className={`transition-colors ${form.enabled ? "text-[#0ecb81]" : "text-white/30"}`}
                >
                  {form.enabled ? (
                    <ToggleRight className="w-7 h-7" />
                  ) : (
                    <ToggleLeft className="w-7 h-7" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={handleAdd}
                disabled={!form.base || !form.quote || form.base === form.quote}
                className="flex-1 py-2.5 bg-[#e2b700] hover:bg-[#f5ca00] disabled:opacity-40 text-black font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                Add Pair
              </button>
              <button
                onClick={() => setModal(false)}
                className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white/70 rounded-xl text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Remove */}
      {confirmRemove && (() => {
        const pair = tradingPairs.find((p) => p.id === confirmRemove);
        return (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#0a0a0a] border border-white/12 rounded-2xl p-6 w-full max-w-sm">
              <h3 className="text-base font-semibold text-white mb-2">Remove Trading Pair</h3>
              <p className="text-sm text-white/60 mb-5">
                Remove the <strong className="text-white">{pair?.base}/{pair?.quote}</strong> trading pair?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    removePair(confirmRemove);
                    showToast(`${pair?.base}/${pair?.quote} removed.`);
                    setConfirmRemove(null);
                  }}
                  className="flex-1 py-2.5 bg-[#f6465d]/15 hover:bg-[#f6465d]/25 text-[#f6465d] font-semibold rounded-xl text-sm"
                >
                  Remove
                </button>
                <button
                  onClick={() => setConfirmRemove(null)}
                  className="flex-1 py-2.5 bg-white/5 text-white/60 rounded-xl text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-[#0ecb81] text-black text-sm font-semibold px-5 py-3 rounded-xl shadow-2xl z-50">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
