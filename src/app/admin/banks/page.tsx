"use client";

import { useState } from "react";
import {
  Plus, Edit2, Trash2, Power, ChevronDown, ChevronRight,
  Building2, CreditCard, Globe, Search, X, Check, AlertTriangle,
} from "lucide-react";
import { usePalmXStore } from "@/lib/store";
import type { SupportedCountry, Bank, CardType, GatewayType, CountryRegion } from "@/lib/store";

// ─── Constants ────────────────────────────────────────────────────────────────
const GATEWAYS: GatewayType[] = ["stripe", "checkout", "adyen", "tap", "fawry", "paystack", "local"];
const REGIONS: { value: CountryRegion; label: string }[] = [
  { value: "arab",   label: "Arab League" },
  { value: "global", label: "Global Market" },
];
const GATEWAY_COLORS: Record<GatewayType, string> = {
  stripe:   "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
  checkout: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  adyen:    "bg-green-500/15 text-green-400 border-green-500/20",
  tap:      "bg-purple-500/15 text-purple-400 border-purple-500/20",
  fawry:    "bg-orange-500/15 text-orange-400 border-orange-500/20",
  paystack: "bg-teal-500/15 text-teal-400 border-teal-500/20",
  local:    "bg-white/8 text-white/50 border-white/10",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function CardBadge({ type }: { type: CardType }) {
  const cls = type === "visa"       ? "bg-[#1a1f71]/30 text-[#1a91ff]"
            : type === "mastercard" ? "bg-[#eb001b]/20 text-[#ff6a6a]"
            : "bg-white/8 text-white/50";
  return (
    <span className={`${cls} px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider`}>
      {type === "local" ? "Local" : type === "visa" ? "Visa" : "MC"}
    </span>
  );
}

// ─── Blank forms ──────────────────────────────────────────────────────────────
const BLANK_COUNTRY: Omit<SupportedCountry, "banks"> = {
  code: "", name: "", nameAr: "", region: "arab",
  currency: "", currencyCode: "", flagEmoji: "🏳",
  gateway: "local", status: "active",
};
const BLANK_BANK: Omit<Bank, "id"> = {
  name: "", swift: "", cardTypes: ["visa", "mastercard"],
  gateway: "local", status: "active",
};

export default function AdminBanksPage() {
  const {
    countries, addCountry, updateCountry, removeCountry,
    addBank, updateBank, removeBank,
  } = usePalmXStore();

  // ── filters ──
  const [regionFilter, setRegionFilter]   = useState<"all" | CountryRegion>("all");
  const [search, setSearch]               = useState("");
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set(["IQ"]));

  // ── country modal ──
  const [countryModal, setCountryModal]   = useState<"add" | "edit" | null>(null);
  const [editingCountry, setEditingCountry] = useState<Omit<SupportedCountry, "banks">>(BLANK_COUNTRY);

  // ── bank modal ──
  const [bankModal, setBankModal]         = useState<"add" | "edit" | null>(null);
  const [bankCountryCode, setBankCountryCode] = useState("");
  const [editingBank, setEditingBank]     = useState<Omit<Bank, "id"> & { id?: string }>(BLANK_BANK);

  // ── confirm remove ──
  const [confirmRemove, setConfirmRemove] = useState<{ type: "country" | "bank"; countryCode: string; bankId?: string } | null>(null);

  // ── toast ──
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  function showToast(msg: string, color = "#0ecb81") {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3000);
  }

  // ── derived list ──
  const filtered = countries.filter((c) => {
    if (regionFilter !== "all" && c.region !== regionFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.currency.toLowerCase().includes(q)
      );
    }
    return true;
  });

  function toggleExpand(code: string) {
    setExpandedCodes((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  // ── country CRUD ──
  function openAddCountry() {
    setEditingCountry(BLANK_COUNTRY);
    setCountryModal("add");
  }
  function openEditCountry(c: SupportedCountry) {
    const { banks: _b, ...rest } = c;
    setEditingCountry(rest);
    setCountryModal("edit");
  }
  function saveCountry() {
    if (!editingCountry.code || !editingCountry.name) return;
    if (countryModal === "add") {
      addCountry(editingCountry);
      showToast(`Country ${editingCountry.name} added.`);
    } else {
      updateCountry(editingCountry.code, editingCountry);
      showToast(`Country ${editingCountry.name} updated.`);
    }
    setCountryModal(null);
  }
  function suspendCountry(c: SupportedCountry) {
    const next = c.status === "active" ? "suspended" : "active";
    updateCountry(c.code, { status: next });
    showToast(`${c.name} ${next === "active" ? "activated" : "suspended"}.`, next === "active" ? "#0ecb81" : "#e2b700");
  }

  // ── bank CRUD ──
  function openAddBank(countryCode: string) {
    setBankCountryCode(countryCode);
    setEditingBank(BLANK_BANK);
    setBankModal("add");
  }
  function openEditBank(countryCode: string, bank: Bank) {
    setBankCountryCode(countryCode);
    setEditingBank({ ...bank });
    setBankModal("edit");
  }
  function saveBank() {
    if (!editingBank.name || !editingBank.swift) return;
    if (bankModal === "add") {
      addBank(bankCountryCode, editingBank);
      showToast(`Bank "${editingBank.name}" added.`);
    } else if (editingBank.id) {
      updateBank(bankCountryCode, editingBank.id, editingBank);
      showToast(`Bank "${editingBank.name}" updated.`);
    }
    setBankModal(null);
  }
  function suspendBank(countryCode: string, bank: Bank) {
    const next = bank.status === "active" ? "suspended" : "active";
    updateBank(countryCode, bank.id, { status: next });
    showToast(`${bank.name} ${next === "active" ? "activated" : "suspended"}.`, next === "active" ? "#0ecb81" : "#e2b700");
  }

  function handleRemove() {
    if (!confirmRemove) return;
    if (confirmRemove.type === "country") {
      removeCountry(confirmRemove.countryCode);
      showToast("Country removed.", "#f6465d");
    } else if (confirmRemove.bankId) {
      removeBank(confirmRemove.countryCode, confirmRemove.bankId);
      showToast("Bank removed.", "#f6465d");
    }
    setConfirmRemove(null);
  }

  // ── stats ──
  const totalArab   = countries.filter((c) => c.region === "arab").length;
  const totalGlobal = countries.filter((c) => c.region === "global").length;
  const totalBanks  = countries.reduce((s, c) => s + c.banks.length, 0);

  return (
    <div className="flex-1 p-8 overflow-auto bg-[#0a0a0a] min-h-screen">
      {/* Toast */}
      {toast && (
        <div
          className="fixed top-6 right-6 z-[200] px-5 py-3 rounded-xl text-sm font-semibold text-black shadow-2xl flex items-center gap-2 transition-all"
          style={{ background: toast.color }}
        >
          <Check className="w-4 h-4" /> {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Bank Management</h1>
          <p className="text-sm text-white/40 mt-1">
            Manage countries, banks, card types &amp; payment gateways for fiat on-ramp
          </p>
        </div>
        <button
          onClick={openAddCountry}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black text-sm font-semibold rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Country
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Arab League Countries", value: totalArab,   icon: "🌍", color: "#e2b700" },
          { label: "Global Market Countries", value: totalGlobal, icon: "🌐", color: "#0ecb81" },
          { label: "Total Supported Banks",   value: totalBanks,  icon: "🏦", color: "#7b61ff" },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="bg-black border border-white/8 rounded-2xl px-6 py-5">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">{icon}</span>
              <span className="text-3xl font-bold text-white">{value}</span>
            </div>
            <p className="text-xs text-white/40 font-medium">{label}</p>
            <div className="h-0.5 mt-3 rounded-full" style={{ background: color, width: "40px" }} />
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search countries..."
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#e2b700]/50"
          />
        </div>
        {(["all", "arab", "global"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRegionFilter(r)}
            className={`px-4 py-2 text-sm font-medium rounded-xl border transition-colors ${
              regionFilter === r
                ? "bg-[#e2b700]/10 text-[#e2b700] border-[#e2b700]/30"
                : "bg-white/4 text-white/50 border-white/8 hover:text-white hover:border-white/20"
            }`}
          >
            {r === "all" ? "All" : r === "arab" ? "Arab League" : "Global"}
          </button>
        ))}
        <span className="text-xs text-white/30 ml-auto">{filtered.length} countries</span>
      </div>

      {/* Country accordion list */}
      <div className="space-y-2">
        {filtered.map((country) => {
          const isOpen = expandedCodes.has(country.code);
          const activeBanks = country.banks.filter((b) => b.status === "active").length;
          return (
            <div key={country.code} className="bg-black border border-white/8 rounded-2xl overflow-hidden">
              {/* Country row */}
              <div
                className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-white/2 transition-colors"
                onClick={() => toggleExpand(country.code)}
              >
                <div className="text-white/30">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</div>
                <span className="text-2xl">{country.flagEmoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{country.name}</span>
                    <span className="text-white/30 text-xs">{country.nameAr}</span>
                    <span className="text-xs font-mono text-white/30 bg-white/5 px-1.5 py-0.5 rounded">{country.code}</span>
                  </div>
                  <div className="text-xs text-white/40 mt-0.5">{country.currency} ({country.currencyCode})</div>
                </div>
                <div className="hidden sm:flex items-center gap-3">
                  <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${country.region === "arab" ? "bg-[#e2b700]/10 text-[#e2b700] border-[#e2b700]/20" : "bg-[#0ecb81]/10 text-[#0ecb81] border-[#0ecb81]/20"}`}>
                    {country.region === "arab" ? "Arab" : "Global"}
                  </span>
                  <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${GATEWAY_COLORS[country.gateway]}`}>
                    {country.gateway}
                  </span>
                  <span className="text-xs text-white/40">
                    <Building2 className="w-3.5 h-3.5 inline mr-1" />
                    {activeBanks}/{country.banks.length} banks
                  </span>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${country.status === "active" ? "bg-[#0ecb81]/10 text-[#0ecb81]" : "bg-[#f6465d]/10 text-[#f6465d]"}`}>
                    {country.status}
                  </span>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => openEditCountry(country)}
                    title="Edit"
                    className="p-2 text-white/30 hover:text-[#e2b700] hover:bg-[#e2b700]/10 rounded-lg transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => suspendCountry(country)}
                    title={country.status === "active" ? "Suspend" : "Activate"}
                    className={`p-2 rounded-lg transition-colors ${country.status === "active" ? "text-white/30 hover:text-[#e2b700] hover:bg-[#e2b700]/10" : "text-[#0ecb81] bg-[#0ecb81]/10 hover:bg-[#0ecb81]/20"}`}
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setConfirmRemove({ type: "country", countryCode: country.code })}
                    title="Remove"
                    className="p-2 text-white/20 hover:text-[#f6465d] hover:bg-[#f6465d]/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Expanded bank list */}
              {isOpen && (
                <div className="border-t border-white/6 bg-white/[0.01]">
                  {/* Bank table header */}
                  <div className="grid grid-cols-[1fr_130px_120px_120px_80px_100px] gap-4 px-8 py-2.5 text-[10px] font-semibold text-white/25 uppercase tracking-wider border-b border-white/5">
                    <span>Bank Name</span>
                    <span>SWIFT</span>
                    <span>Card Types</span>
                    <span>Gateway</span>
                    <span>Status</span>
                    <span className="text-right">Actions</span>
                  </div>
                  {country.banks.length === 0 && (
                    <div className="px-8 py-6 text-sm text-white/30 text-center">No banks added yet.</div>
                  )}
                  {country.banks.map((bank) => (
                    <div
                      key={bank.id}
                      className="grid grid-cols-[1fr_130px_120px_120px_80px_100px] gap-4 items-center px-8 py-3 border-b border-white/4 hover:bg-white/[0.02] last:border-0"
                    >
                      <span className="text-sm font-medium text-white truncate" title={bank.name}>{bank.name}</span>
                      <span className="font-mono text-xs text-white/40">{bank.swift}</span>
                      <div className="flex gap-1 flex-wrap">
                        {bank.cardTypes.map((ct) => <CardBadge key={ct} type={ct} />)}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-lg border font-medium ${GATEWAY_COLORS[bank.gateway]}`}>
                        {bank.gateway}
                      </span>
                      <span className={`text-xs font-medium ${bank.status === "active" ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                        {bank.status}
                      </span>
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEditBank(country.code, bank)} className="p-1.5 text-white/25 hover:text-[#e2b700] hover:bg-[#e2b700]/10 rounded-lg transition-colors">
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button onClick={() => suspendBank(country.code, bank)} className={`p-1.5 rounded-lg transition-colors ${bank.status === "active" ? "text-white/25 hover:text-[#e2b700] hover:bg-[#e2b700]/10" : "text-[#0ecb81] bg-[#0ecb81]/10"}`}>
                          <Power className="w-3 h-3" />
                        </button>
                        <button onClick={() => setConfirmRemove({ type: "bank", countryCode: country.code, bankId: bank.id })} className="p-1.5 text-white/20 hover:text-[#f6465d] hover:bg-[#f6465d]/10 rounded-lg transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {/* Add bank button */}
                  <div className="px-8 py-3">
                    <button
                      onClick={() => openAddBank(country.code)}
                      className="flex items-center gap-2 text-xs text-[#e2b700]/70 hover:text-[#e2b700] transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Bank to {country.name}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Country Modal ── */}
      {countryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-white/8">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#e2b700]" />
                {countryModal === "add" ? "Add Country" : "Edit Country"}
              </h3>
              <button onClick={() => setCountryModal(null)} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              {[
                { label: "ISO Code (2 letters)", key: "code",         placeholder: "IQ",    upper: true  },
                { label: "Flag Emoji",           key: "flagEmoji",    placeholder: "🇮🇶",   upper: false },
                { label: "Country Name (EN)",    key: "name",         placeholder: "Iraq",  upper: false },
                { label: "Country Name (AR)",    key: "nameAr",       placeholder: "العراق",upper: false },
                { label: "Currency Name",        key: "currency",     placeholder: "Iraqi Dinar", upper: false },
                { label: "Currency Code",        key: "currencyCode", placeholder: "IQD",   upper: true  },
              ].map(({ label, key, placeholder, upper }) => (
                <div key={key}>
                  <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">{label}</label>
                  <input
                    type="text"
                    value={(editingCountry as Record<string, string>)[key] ?? ""}
                    onChange={(e) => setEditingCountry((f) => ({ ...f, [key]: upper ? e.target.value.toUpperCase() : e.target.value }))}
                    placeholder={placeholder}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/50"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">Region</label>
                <select
                  value={editingCountry.region}
                  onChange={(e) => setEditingCountry((f) => ({ ...f, region: e.target.value as CountryRegion }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#e2b700]/50 appearance-none"
                >
                  {REGIONS.map((r) => <option key={r.value} value={r.value} className="bg-[#1a1a1a]">{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">Default Gateway</label>
                <select
                  value={editingCountry.gateway}
                  onChange={(e) => setEditingCountry((f) => ({ ...f, gateway: e.target.value as GatewayType }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#e2b700]/50 appearance-none"
                >
                  {GATEWAYS.map((g) => <option key={g} value={g} className="bg-[#1a1a1a]">{g}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">Status</label>
                <div className="flex gap-3">
                  {(["active", "suspended"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setEditingCountry((f) => ({ ...f, status: s }))}
                      className={`flex-1 py-2 text-sm font-medium rounded-xl border transition-colors ${editingCountry.status === s ? "bg-[#e2b700]/10 text-[#e2b700] border-[#e2b700]/30" : "border-white/10 text-white/40 hover:border-white/20"}`}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 p-6 pt-2">
              <button onClick={() => setCountryModal(null)} className="flex-1 py-2.5 border border-white/10 rounded-xl text-sm text-white/60 hover:text-white transition-colors">Cancel</button>
              <button onClick={saveCountry} className="flex-1 py-2.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black text-sm font-semibold rounded-xl transition-colors">
                {countryModal === "add" ? "Add Country" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bank Modal ── */}
      {bankModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-white/8">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#e2b700]" />
                {bankModal === "add" ? "Add Bank" : "Edit Bank"}
              </h3>
              <button onClick={() => setBankModal(null)} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              {[
                { label: "Bank Name",   key: "name",  placeholder: "Bank of Baghdad" },
                { label: "SWIFT Code",  key: "swift", placeholder: "BAGBIQBA", upper: true },
              ].map(({ label, key, placeholder, upper }) => (
                <div key={key}>
                  <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">{label}</label>
                  <input
                    type="text"
                    value={(editingBank as unknown as Record<string, string>)[key] ?? ""}
                    onChange={(e) => setEditingBank((f) => ({ ...f, [key]: upper ? e.target.value.toUpperCase() : e.target.value }))}
                    placeholder={placeholder}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/50"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">Card Types</label>
                <div className="flex gap-3">
                  {(["visa", "mastercard", "local"] as CardType[]).map((ct) => (
                    <button
                      key={ct}
                      onClick={() =>
                        setEditingBank((f) => ({
                          ...f,
                          cardTypes: f.cardTypes.includes(ct)
                            ? f.cardTypes.filter((x) => x !== ct)
                            : [...f.cardTypes, ct],
                        }))
                      }
                      className={`flex-1 py-2 text-sm font-medium rounded-xl border transition-colors capitalize ${editingBank.cardTypes.includes(ct) ? "bg-[#e2b700]/10 text-[#e2b700] border-[#e2b700]/30" : "border-white/10 text-white/40 hover:border-white/20"}`}
                    >
                      {ct}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">Payment Gateway</label>
                <select
                  value={editingBank.gateway}
                  onChange={(e) => setEditingBank((f) => ({ ...f, gateway: e.target.value as GatewayType }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#e2b700]/50 appearance-none"
                >
                  {GATEWAYS.map((g) => <option key={g} value={g} className="bg-[#1a1a1a]">{g}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">Status</label>
                <div className="flex gap-3">
                  {(["active", "suspended"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setEditingBank((f) => ({ ...f, status: s }))}
                      className={`flex-1 py-2 text-sm font-medium rounded-xl border transition-colors ${editingBank.status === s ? "bg-[#e2b700]/10 text-[#e2b700] border-[#e2b700]/30" : "border-white/10 text-white/40 hover:border-white/20"}`}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 p-6 pt-2">
              <button onClick={() => setBankModal(null)} className="flex-1 py-2.5 border border-white/10 rounded-xl text-sm text-white/60 hover:text-white transition-colors">Cancel</button>
              <button onClick={saveBank} className="flex-1 py-2.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black text-sm font-semibold rounded-xl transition-colors">
                {bankModal === "add" ? "Add Bank" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Remove ── */}
      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl p-6 text-center">
            <AlertTriangle className="w-10 h-10 text-[#f6465d] mx-auto mb-4" />
            <h3 className="text-base font-bold text-white mb-2">Confirm Remove</h3>
            <p className="text-sm text-white/50 mb-6">
              {confirmRemove.type === "country"
                ? "Removing a country will also remove all its banks. This action cannot be undone."
                : "Remove this bank? This cannot be undone."}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmRemove(null)} className="flex-1 py-2.5 border border-white/10 rounded-xl text-sm text-white/60 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleRemove} className="flex-1 py-2.5 bg-[#f6465d] hover:bg-[#ff6b7a] text-white text-sm font-semibold rounded-xl transition-colors">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
