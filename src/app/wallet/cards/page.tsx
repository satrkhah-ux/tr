"use client";

import { useState } from "react";
import { CreditCard, Plus, Trash2, Check, X, Shield, ChevronDown, AlertTriangle } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { OkxFooter } from "@/components/OkxFooter";
import { useLanguage } from "@/components/LanguageProvider";
import { usePalmXStore } from "@/lib/store";
import type { CardType } from "@/lib/store";

// ─── Mock linked cards ────────────────────────────────────────────────────────
interface LinkedCard {
  id:      string;
  last4:   string;
  type:    CardType;
  bank:    string;
  country: string;
  expiry:  string;
  flag:    string;
}

const INITIAL_CARDS: LinkedCard[] = [
  { id: "c1", last4: "4242", type: "visa",       bank: "National Bank of Iraq",  country: "Iraq",         expiry: "12/28", flag: "🇮🇶" },
  { id: "c2", last4: "5555", type: "mastercard", bank: "Al Rajhi Bank",           country: "Saudi Arabia", expiry: "08/27", flag: "🇸🇦" },
  { id: "c3", last4: "1234", type: "local",      bank: "Emirates NBD",            country: "UAE",          expiry: "03/29", flag: "🇦🇪" },
];

const CARD_BG: Record<CardType, string> = {
  visa:       "linear-gradient(135deg, #1a1f71 0%, #2b3391 100%)",
  mastercard: "linear-gradient(135deg, #390000 0%, #7b1a1a 100%)",
  local:      "linear-gradient(135deg, #0a2e0a 0%, #1a4f1a 100%)",
};
const CARD_ACCENT: Record<CardType, string> = {
  visa:       "#4a6fff",
  mastercard: "#eb001b",
  local:      "#0ecb81",
};

function maskNumber(last4: string, ct: CardType) {
  const groups = ct === "local" ? ["••••••", last4] : ["••••", "••••", "••••", last4];
  return groups.join("  ");
}

export default function CardsPage() {
  const { t, isRTL } = useLanguage();
  const { countries } = usePalmXStore();
  const rtlFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  const [cards, setCards] = useState<LinkedCard[]>(INITIAL_CARDS);

  // ── Add-card modal state ──
  const [showModal, setShowModal] = useState(false);
  const [step, setStep]           = useState<1 | 2 | 3>(1);
  const [selectedCountry, setSelectedCountry] = useState<string>("");
  const [selectedBank,    setSelectedBank]    = useState<string>("");
  const [selectedType,    setSelectedType]    = useState<CardType>("visa");
  const [cardNumber,      setCardNumber]      = useState("");
  const [cardName,        setCardName]        = useState("");
  const [expiry,          setExpiry]          = useState("");
  const [addSuccess,      setAddSuccess]      = useState(false);

  // ── Remove confirm ──
  const [removeId, setRemoveId] = useState<string | null>(null);

  const activeCountries = countries.filter((c) => c.status === "active");
  const countryData     = activeCountries.find((c) => c.code === selectedCountry);
  const availableBanks  = (countryData?.banks ?? []).filter((b) => b.status === "active");
  const bankData        = availableBanks.find((b) => b.id === selectedBank);
  const availableTypes  = bankData?.cardTypes ?? ["visa", "mastercard"];

  function openModal() {
    setStep(1);
    setSelectedCountry(activeCountries[0]?.code ?? "");
    setSelectedBank("");
    setSelectedType("visa");
    setCardNumber("");
    setCardName("");
    setExpiry("");
    setAddSuccess(false);
    setShowModal(true);
  }

  function formatCardNumber(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(.{4})/g, "$1 ").trim();
  }

  function formatExpiry(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return digits;
  }

  function handleStep2() {
    if (!selectedCountry || !selectedBank) return;
    const bank = availableBanks.find((b) => b.id === selectedBank);
    if (bank && !bank.cardTypes.includes(selectedType)) {
      setSelectedType(bank.cardTypes[0] ?? "visa");
    }
    setStep(2);
  }

  function handleSubmit() {
    if (!cardNumber || !cardName || !expiry) return;
    const last4 = cardNumber.replace(/\s/g, "").slice(-4);
    const bank  = availableBanks.find((b) => b.id === selectedBank);
    const country = countryData;
    const newCard: LinkedCard = {
      id:      `c${Date.now()}`,
      last4,
      type:    selectedType,
      bank:    bank?.name ?? "",
      country: country?.name ?? "",
      expiry,
      flag:    country?.flagEmoji ?? "🏳",
    };
    setCards((prev) => [...prev, newCard]);
    setAddSuccess(true);
    setTimeout(() => setShowModal(false), 2200);
  }

  function removeCard() {
    if (!removeId) return;
    setCards((prev) => prev.filter((c) => c.id !== removeId));
    setRemoveId(null);
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1 pt-24 pb-20">
        <div className="max-w-[900px] mx-auto px-6 lg:px-12">

          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-white" style={rtlFont}>{t.cardsMgmt}</h1>
              <p className="text-sm text-white/40 mt-1" style={rtlFont}>{t.cardsSubtitle}</p>
            </div>
            <button
              onClick={openModal}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black text-sm font-semibold rounded-xl transition-colors"
              style={rtlFont}
            >
              <Plus className="w-4 h-4" /> {t.cardsAdd}
            </button>
          </div>

          {/* Security notice */}
          <div className="bg-[#0ecb81]/5 border border-[#0ecb81]/15 rounded-xl px-5 py-3.5 mb-8 flex items-center gap-3">
            <Shield className="w-4 h-4 text-[#0ecb81] flex-shrink-0" />
            <p className="text-xs text-[#0ecb81]/80" style={rtlFont}>{t.cardsSecure}</p>
          </div>

          {/* Cards grid */}
          {cards.length === 0 ? (
            <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-16 text-center">
              <CreditCard className="w-12 h-12 text-white/15 mx-auto mb-4" />
              <p className="text-white/40 text-sm" style={rtlFont}>{t.cardsNoCards}</p>
              <button
                onClick={openModal}
                className="mt-5 px-5 py-2.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black text-sm font-semibold rounded-xl transition-colors"
                style={rtlFont}
              >
                {t.cardsAdd}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {cards.map((card) => (
                <div key={card.id} className="relative rounded-2xl overflow-hidden shadow-xl group">
                  {/* Card face */}
                  <div
                    className="p-5 h-44 flex flex-col justify-between"
                    style={{ background: CARD_BG[card.type] }}
                  >
                    {/* Top row */}
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-xl">{card.flag}</span>
                        <p className="text-[10px] text-white/50 mt-0.5">{card.country}</p>
                      </div>
                      <div
                        className="text-xs font-bold px-2 py-0.5 rounded"
                        style={{ background: CARD_ACCENT[card.type] + "33", color: CARD_ACCENT[card.type] }}
                      >
                        {card.type === "local" ? "LOCAL" : card.type.toUpperCase()}
                      </div>
                    </div>
                    {/* Number */}
                    <div>
                      <p className="font-mono text-sm text-white/80 tracking-widest">{maskNumber(card.last4, card.type)}</p>
                      <div className="flex items-end justify-between mt-2">
                        <div>
                          <p className="text-[9px] text-white/30 uppercase tracking-wider mb-0.5">Bank</p>
                          <p className="text-xs text-white font-medium truncate max-w-[140px]">{card.bank}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] text-white/30 uppercase tracking-wider mb-0.5">Expires</p>
                          <p className="font-mono text-xs text-white">{card.expiry}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Remove button (hover) */}
                  <button
                    onClick={() => setRemoveId(card.id)}
                    className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1.5 bg-black/50 hover:bg-[#f6465d] rounded-lg transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Supported regions info */}
          <div className="mt-10 bg-[#0a0a0a] border border-white/8 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-white mb-4" style={rtlFont}>{t.cardsSupportedRegions}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {activeCountries.slice(0, 16).map((c) => (
                <div key={c.code} className="flex items-center gap-2 text-xs text-white/50 py-1.5 px-2 rounded-lg hover:bg-white/4 transition-colors">
                  <span className="text-base">{c.flagEmoji}</span>
                  <span>{c.name}</span>
                </div>
              ))}
              {activeCountries.length > 16 && (
                <div className="flex items-center gap-2 text-xs text-[#e2b700]/60 py-1.5 px-2">
                  +{activeCountries.length - 16} more regions
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ── Add Card Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl" dir={isRTL ? "rtl" : "ltr"}>

            {addSuccess ? (
              /* Success screen */
              <div className="p-10 text-center">
                <div className="w-14 h-14 bg-[#0ecb81]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Check className="w-7 h-7 text-[#0ecb81]" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2" style={rtlFont}>{t.cardsSuccess}</h3>
                <p className="text-sm text-white/50" style={rtlFont}>{t.cardsSuccessDesc}</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/8">
                  <div>
                    <h3 className="text-base font-bold text-white" style={rtlFont}>{t.cardsAdd}</h3>
                    <p className="text-xs text-white/40 mt-0.5" style={rtlFont}>
                      {t.cardsStep} {step} {t.cardsOf} 2
                    </p>
                  </div>
                  <button onClick={() => setShowModal(false)} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
                </div>

                {/* Step indicator */}
                <div className="flex items-center px-6 pt-4 pb-2 gap-2">
                  {[1, 2].map((s) => (
                    <div key={s} className="flex items-center gap-2 flex-1">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${step >= s ? "bg-[#e2b700] text-black" : "bg-white/10 text-white/30"}`}>
                        {step > s ? <Check className="w-3.5 h-3.5" /> : s}
                      </div>
                      <span className={`text-xs ${step >= s ? "text-white/70" : "text-white/25"}`} style={rtlFont}>
                        {s === 1 ? t.cardsStepCountry : t.cardsStepDetails}
                      </span>
                      {s < 2 && <div className={`flex-1 h-px ${step > s ? "bg-[#e2b700]/50" : "bg-white/10"}`} />}
                    </div>
                  ))}
                </div>

                <div className="p-6 space-y-4">
                  {step === 1 ? (
                    /* Step 1: Country + Bank + Card type */
                    <>
                      <div>
                        <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5" style={rtlFont}>{t.cardsSelectCountry}</label>
                        <div className="relative">
                          <select
                            value={selectedCountry}
                            onChange={(e) => { setSelectedCountry(e.target.value); setSelectedBank(""); }}
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#e2b700]/50 appearance-none"
                            style={rtlFont}
                          >
                            <option value="" className="bg-[#1a1a1a]">— Select country —</option>
                            {activeCountries.map((c) => (
                              <option key={c.code} value={c.code} className="bg-[#1a1a1a]">
                                {c.flagEmoji} {c.name} ({c.currencyCode})
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                        </div>
                      </div>

                      {selectedCountry && (
                        <div>
                          <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5" style={rtlFont}>{t.cardsSelectBank}</label>
                          <div className="relative">
                            <select
                              value={selectedBank}
                              onChange={(e) => setSelectedBank(e.target.value)}
                              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#e2b700]/50 appearance-none"
                              style={rtlFont}
                            >
                              <option value="" className="bg-[#1a1a1a]">— Select bank —</option>
                              {availableBanks.map((b) => (
                                <option key={b.id} value={b.id} className="bg-[#1a1a1a]">{b.name}</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                          </div>
                        </div>
                      )}

                      {selectedBank && (
                        <div>
                          <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5" style={rtlFont}>{t.cardsCardType}</label>
                          <div className="flex gap-2">
                            {availableTypes.map((ct) => (
                              <button
                                key={ct}
                                onClick={() => setSelectedType(ct)}
                                className={`flex-1 py-2 text-sm font-medium rounded-xl border transition-colors capitalize ${selectedType === ct ? "bg-[#e2b700]/10 text-[#e2b700] border-[#e2b700]/30" : "border-white/10 text-white/40 hover:border-white/20"}`}
                                style={rtlFont}
                              >
                                {ct}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedCountry && countryData && (
                        <div className="bg-white/3 border border-white/6 rounded-xl px-4 py-3 text-xs text-white/40 space-y-1">
                          <div className="flex justify-between">
                            <span style={rtlFont}>{t.cardsGateway}:</span>
                            <span className="text-[#e2b700]/80 font-mono">{countryData.gateway}</span>
                          </div>
                          <div className="flex justify-between">
                            <span style={rtlFont}>Currency:</span>
                            <span>{countryData.currency} ({countryData.currencyCode})</span>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    /* Step 2: Card details */
                    <>
                      <div>
                        <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5" style={rtlFont}>{t.cardsCardNumber}</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={cardNumber}
                          onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                          placeholder="0000 0000 0000 0000"
                          maxLength={19}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/50"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5" style={rtlFont}>{t.cardsCardName}</label>
                        <input
                          type="text"
                          value={cardName}
                          onChange={(e) => setCardName(e.target.value.toUpperCase())}
                          placeholder="JOHN DOE"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/50"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5" style={rtlFont}>{t.cardsExpiry}</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={expiry}
                          onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                          placeholder="MM/YY"
                          maxLength={5}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/50"
                        />
                      </div>
                      {/* Mini card preview */}
                      <div
                        className="rounded-xl p-4 h-24 flex flex-col justify-between"
                        style={{ background: CARD_BG[selectedType] }}
                      >
                        <div className="flex justify-between items-start">
                          <span className="text-base">{countryData?.flagEmoji ?? "🏳"}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: CARD_ACCENT[selectedType] + "33", color: CARD_ACCENT[selectedType] }}>
                            {selectedType === "local" ? "LOCAL" : selectedType.toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-mono text-xs text-white/60 tracking-widest">
                            {cardNumber ? cardNumber.padEnd(19, " ") : "•••• •••• •••• ••••"}
                          </p>
                          <div className="flex justify-between mt-1">
                            <span className="text-[10px] text-white/50 truncate max-w-[150px]">{cardName || "CARDHOLDER NAME"}</span>
                            <span className="font-mono text-[10px] text-white/50">{expiry || "MM/YY"}</span>
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-white/30 flex items-center gap-1.5" style={rtlFont}>
                        <Shield className="w-3 h-3 text-[#0ecb81]/50" /> {t.cardsSecure}
                      </p>
                    </>
                  )}
                </div>

                {/* Footer buttons */}
                <div className="flex gap-3 p-6 pt-0">
                  {step === 2 && (
                    <button onClick={() => setStep(1)} className="flex-1 py-2.5 border border-white/10 rounded-xl text-sm text-white/60 hover:text-white transition-colors" style={rtlFont}>
                      {t.kycBack}
                    </button>
                  )}
                  {step === 1 ? (
                    <button
                      onClick={handleStep2}
                      disabled={!selectedCountry || !selectedBank}
                      className="flex-1 py-2.5 bg-[#e2b700] disabled:opacity-40 hover:bg-[#f5ca00] text-black text-sm font-semibold rounded-xl transition-colors"
                      style={rtlFont}
                    >
                      {t.kycNext}
                    </button>
                  ) : (
                    <button
                      onClick={handleSubmit}
                      disabled={!cardNumber || !cardName || !expiry}
                      className="flex-1 py-2.5 bg-[#e2b700] disabled:opacity-40 hover:bg-[#f5ca00] text-black text-sm font-semibold rounded-xl transition-colors"
                      style={rtlFont}
                    >
                      {t.cardsAddBtn}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Remove confirm ── */}
      {removeId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl p-6 text-center">
            <AlertTriangle className="w-10 h-10 text-[#f6465d] mx-auto mb-4" />
            <h3 className="text-base font-bold text-white mb-2" style={rtlFont}>{t.cardsConfirmRemove}</h3>
            <p className="text-sm text-white/50 mb-6" style={rtlFont}>{t.cardsConfirmRemoveDesc}</p>
            <div className="flex gap-3">
              <button onClick={() => setRemoveId(null)} className="flex-1 py-2.5 border border-white/10 rounded-xl text-sm text-white/60 hover:text-white transition-colors">{t.walletCancel}</button>
              <button onClick={removeCard} className="flex-1 py-2.5 bg-[#f6465d] hover:bg-[#ff6b7a] text-white text-sm font-semibold rounded-xl transition-colors">{t.cardsRemove}</button>
            </div>
          </div>
        </div>
      )}

      <OkxFooter />
    </div>
  );
}
