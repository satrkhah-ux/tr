"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import {
  DEFAULT_COUNTRIES,
  type Bank,
  type SupportedCountry,
  type CardType,
  type BankStatus,
  type CountryStatus,
  type CountryRegion,
  type GatewayType,
} from "./bank-data";

// Re-export bank types for convenience
export type { Bank, SupportedCountry, CardType, BankStatus, CountryStatus, CountryRegion, GatewayType };

// ─── Types ────────────────────────────────────────────────────────────────────
export type KycStatus = "unverified" | "pending" | "verified" | "rejected" | "resubmit";
export type AccountStatus = "active" | "suspended" | "frozen" | "banned";
export type AssetStatus = "active" | "suspended";

export interface PalmXAsset {
  id: string;
  symbol: string;
  name: string;
  color: string;
  price: string;
  priceNum: number;
  change: string;
  positive: boolean;
  volume: string;
  cap: string;
  rank: number;
  status: AssetStatus;
  networks: string[];
  depositMin: string;
  networkFee: string;
}

export interface TradingPair {
  id: string;
  base: string;
  quote: string;
  enabled: boolean;
  price: string;
  volume24h: string;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  country: string;
  joinedAt: string;
  kycStatus: KycStatus;
  kycTier: 0 | 1 | 2;
  accountStatus: AccountStatus;
  spotBalance: string;
  kycDocType?: string;
  kycDocNumber?: string;
  kycSubmittedAt?: string;
  adminNotes?: string;
}

// ─── Default Data ─────────────────────────────────────────────────────────────
const DEFAULT_ASSETS: PalmXAsset[] = [
  { id: "btc",  symbol: "BTC",  name: "Bitcoin",      color: "#f7931a", price: "$96,420.50",    priceNum: 96420.50,  change: "+2.14%", positive: true,  volume: "$38.2B",  cap: "$1.89T",  rank: 1,  status: "active",    networks: ["Bitcoin (BTC)", "Lightning Network"],                       depositMin: "0.0001 BTC",   networkFee: "0.0002 BTC" },
  { id: "eth",  symbol: "ETH",  name: "Ethereum",     color: "#627eea", price: "$3,241.80",     priceNum: 3241.80,   change: "+1.67%", positive: true,  volume: "$19.4B",  cap: "$389.5B", rank: 2,  status: "active",    networks: ["Ethereum (ERC20)", "Arbitrum", "Optimism"],                 depositMin: "0.01 ETH",     networkFee: "0.001 ETH" },
  { id: "usdt", symbol: "USDT", name: "Tether",       color: "#26a17b", price: "$1.0001",       priceNum: 1.0001,    change: "+0.01%", positive: true,  volume: "$71.0B",  cap: "$109.3B", rank: 3,  status: "active",    networks: ["Ethereum (ERC20)", "Tron (TRC20)", "BNB Chain (BEP20)"],   depositMin: "10 USDT",      networkFee: "1 USDT" },
  { id: "bnb",  symbol: "BNB",  name: "BNB",          color: "#f0b90b", price: "$601.30",       priceNum: 601.30,    change: "-0.43%", positive: false, volume: "$2.1B",   cap: "$87.2B",  rank: 4,  status: "active",    networks: ["BNB Chain (BEP20)"],                                        depositMin: "0.01 BNB",     networkFee: "0.002 BNB" },
  { id: "sol",  symbol: "SOL",  name: "Solana",       color: "#9945ff", price: "$178.92",       priceNum: 178.92,    change: "+3.21%", positive: true,  volume: "$6.8B",   cap: "$82.6B",  rank: 5,  status: "active",    networks: ["Solana"],                                                   depositMin: "0.1 SOL",      networkFee: "0.01 SOL" },
  { id: "xrp",  symbol: "XRP",  name: "XRP",          color: "#346aa9", price: "$0.5812",       priceNum: 0.5812,    change: "+0.88%", positive: true,  volume: "$3.2B",   cap: "$63.1B",  rank: 6,  status: "active",    networks: ["XRP Ledger"],                                               depositMin: "20 XRP",       networkFee: "0.1 XRP" },
  { id: "usdc", symbol: "USDC", name: "USD Coin",     color: "#2775ca", price: "$1.0000",       priceNum: 1.0000,    change: "0.00%",  positive: true,  volume: "$8.9B",   cap: "$43.5B",  rank: 7,  status: "active",    networks: ["Ethereum (ERC20)", "Solana", "Polygon"],                    depositMin: "10 USDC",      networkFee: "1 USDC" },
  { id: "doge", symbol: "DOGE", name: "Dogecoin",     color: "#c2a633", price: "$0.1821",       priceNum: 0.1821,    change: "-1.24%", positive: false, volume: "$1.8B",   cap: "$26.8B",  rank: 8,  status: "active",    networks: ["Dogecoin"],                                                 depositMin: "100 DOGE",     networkFee: "5 DOGE" },
  { id: "ada",  symbol: "ADA",  name: "Cardano",      color: "#0d1e2d", price: "$0.6103",       priceNum: 0.6103,    change: "+0.55%", positive: true,  volume: "$0.9B",   cap: "$21.7B",  rank: 9,  status: "active",    networks: ["Cardano"],                                                  depositMin: "10 ADA",       networkFee: "1 ADA" },
  { id: "avax", symbol: "AVAX", name: "Avalanche",    color: "#e84142", price: "$39.82",        priceNum: 39.82,     change: "+4.10%", positive: true,  volume: "$0.7B",   cap: "$16.4B",  rank: 10, status: "active",    networks: ["Avalanche C-Chain"],                                        depositMin: "0.1 AVAX",     networkFee: "0.01 AVAX" },
  { id: "link", symbol: "LINK", name: "Chainlink",    color: "#375bd2", price: "$18.43",        priceNum: 18.43,     change: "+2.73%", positive: true,  volume: "$0.6B",   cap: "$10.8B",  rank: 11, status: "active",    networks: ["Ethereum (ERC20)"],                                         depositMin: "1 LINK",       networkFee: "0.5 LINK" },
  { id: "dot",  symbol: "DOT",  name: "Polkadot",     color: "#e6007a", price: "$9.12",         priceNum: 9.12,      change: "-0.91%", positive: false, volume: "$0.4B",   cap: "$11.2B",  rank: 12, status: "active",    networks: ["Polkadot"],                                                 depositMin: "2 DOT",        networkFee: "0.1 DOT" },
  { id: "uni",  symbol: "UNI",  name: "Uniswap",      color: "#ff007a", price: "$12.37",        priceNum: 12.37,     change: "+1.08%", positive: true,  volume: "$0.3B",   cap: "$9.3B",   rank: 13, status: "active",    networks: ["Ethereum (ERC20)"],                                         depositMin: "1 UNI",        networkFee: "0.5 UNI" },
  { id: "ltc",  symbol: "LTC",  name: "Litecoin",     color: "#a6a9aa", price: "$87.54",        priceNum: 87.54,     change: "-0.62%", positive: false, volume: "$0.5B",   cap: "$6.5B",   rank: 14, status: "active",    networks: ["Litecoin"],                                                 depositMin: "0.1 LTC",      networkFee: "0.01 LTC" },
  { id: "trx",  symbol: "TRX",  name: "TRON",         color: "#eb0029", price: "$0.1254",       priceNum: 0.1254,    change: "+0.33%", positive: true,  volume: "$0.7B",   cap: "$10.9B",  rank: 15, status: "active",    networks: ["Tron (TRC20)"],                                             depositMin: "100 TRX",      networkFee: "1 TRX" },
  { id: "iqd",  symbol: "IQD",  name: "Iraqi Dinar",  color: "#009900", price: "$0.000762",     priceNum: 0.000762,  change: "0.00%",  positive: true,  volume: "$0.1B",   cap: "$5.0B",   rank: 16, status: "active",    networks: ["Bank Transfer (Iraq)", "Cash (Baghdad)"],                   depositMin: "100,000 IQD",  networkFee: "Free" },
  { id: "xlm",  symbol: "XLM",  name: "Stellar",      color: "#444444", price: "$0.1423",       priceNum: 0.1423,    change: "+1.15%", positive: true,  volume: "$0.4B",   cap: "$4.2B",   rank: 17, status: "active",    networks: ["Stellar"],                                                  depositMin: "10 XLM",       networkFee: "0.1 XLM" },
  { id: "atom", symbol: "ATOM", name: "Cosmos",       color: "#2e3148", price: "$11.24",        priceNum: 11.24,     change: "+0.75%", positive: true,  volume: "$0.3B",   cap: "$4.4B",   rank: 18, status: "active",    networks: ["Cosmos"],                                                   depositMin: "1 ATOM",       networkFee: "0.01 ATOM" },
  { id: "fil",  symbol: "FIL",  name: "Filecoin",     color: "#0090ff", price: "$5.87",         priceNum: 5.87,      change: "-1.30%", positive: false, volume: "$0.2B",   cap: "$3.2B",   rank: 19, status: "active",    networks: ["Filecoin"],                                                 depositMin: "0.1 FIL",      networkFee: "0.01 FIL" },
  { id: "aave", symbol: "AAVE", name: "Aave",         color: "#b6509e", price: "$143.20",       priceNum: 143.20,    change: "+2.50%", positive: true,  volume: "$0.3B",   cap: "$2.1B",   rank: 20, status: "active",    networks: ["Ethereum (ERC20)"],                                         depositMin: "0.05 AAVE",    networkFee: "0.01 AAVE" },
];

const DEFAULT_PAIRS: TradingPair[] = [
  { id: "btc-usdt",  base: "BTC",  quote: "USDT", enabled: true,  price: "$96,420.50",     volume24h: "$38.2B" },
  { id: "eth-usdt",  base: "ETH",  quote: "USDT", enabled: true,  price: "$3,241.80",      volume24h: "$19.4B" },
  { id: "sol-usdt",  base: "SOL",  quote: "USDT", enabled: true,  price: "$178.92",        volume24h: "$6.8B" },
  { id: "bnb-usdt",  base: "BNB",  quote: "USDT", enabled: true,  price: "$601.30",        volume24h: "$2.1B" },
  { id: "xrp-usdt",  base: "XRP",  quote: "USDT", enabled: true,  price: "$0.5812",        volume24h: "$3.2B" },
  { id: "btc-iqd",   base: "BTC",  quote: "IQD",  enabled: true,  price: "126,471,177 IQD",volume24h: "$5.1B" },
  { id: "usdt-iqd",  base: "USDT", quote: "IQD",  enabled: true,  price: "1,312 IQD",      volume24h: "$12.3B" },
  { id: "eth-iqd",   base: "ETH",  quote: "IQD",  enabled: true,  price: "4,249,242 IQD",  volume24h: "$3.2B" },
  { id: "btc-eth",   base: "BTC",  quote: "ETH",  enabled: true,  price: "29.74 ETH",      volume24h: "$8.4B" },
  { id: "ada-usdt",  base: "ADA",  quote: "USDT", enabled: false, price: "$0.6103",        volume24h: "$0.9B" },
  { id: "dot-usdt",  base: "DOT",  quote: "USDT", enabled: true,  price: "$9.12",          volume24h: "$0.4B" },
  { id: "avax-usdt", base: "AVAX", quote: "USDT", enabled: true,  price: "$39.82",         volume24h: "$0.7B" },
];

const DEFAULT_USERS: UserRecord[] = [
  { id: "u001", name: "Ahmed Al-Rashid", email: "ahmed@example.com",  phone: "+964 771 234 5678", country: "Iraq",   joinedAt: "2026-01-15", kycStatus: "verified",   kycTier: 2, accountStatus: "active",    spotBalance: "$12,841.50", kycDocType: "Passport",          kycDocNumber: "A1234567",   kycSubmittedAt: "2026-01-17" },
  { id: "u002", name: "Sara Mohammed",   email: "sara@example.com",   phone: "+964 750 987 6543", country: "Iraq",   joinedAt: "2026-01-20", kycStatus: "pending",    kycTier: 2, accountStatus: "active",    spotBalance: "$3,200.00",  kycDocType: "National ID",       kycDocNumber: "IQ98765432", kycSubmittedAt: "2026-03-28" },
  { id: "u003", name: "Omar Khalil",     email: "omar@example.com",   phone: "+964 780 111 2222", country: "Iraq",   joinedAt: "2026-02-01", kycStatus: "pending",    kycTier: 1, accountStatus: "active",    spotBalance: "$890.00",    kycDocType: "National ID",       kycDocNumber: "IQ12341234", kycSubmittedAt: "2026-03-29" },
  { id: "u004", name: "Fatima Hassan",   email: "fatima@example.com", phone: "+964 770 333 4444", country: "Iraq",   joinedAt: "2026-02-10", kycStatus: "unverified", kycTier: 0, accountStatus: "active",    spotBalance: "$120.00" },
  { id: "u005", name: "Ali Al-Saadi",    email: "ali@example.com",    phone: "+964 781 555 6666", country: "Iraq",   joinedAt: "2026-02-14", kycStatus: "rejected",   kycTier: 1, accountStatus: "active",    spotBalance: "$0.00",      kycDocType: "Passport",          kycDocNumber: "B9876543",   kycSubmittedAt: "2026-03-01" },
  { id: "u006", name: "Layla Ibrahim",   email: "layla@example.com",  phone: "+964 790 777 8888", country: "Iraq",   joinedAt: "2026-02-20", kycStatus: "verified",   kycTier: 2, accountStatus: "active",    spotBalance: "$28,400.00", kycDocType: "Passport",          kycDocNumber: "C3456789",   kycSubmittedAt: "2026-02-22" },
  { id: "u007", name: "Kareem Nasser",   email: "kareem@example.com", phone: "+965 99 123 4567",  country: "Kuwait", joinedAt: "2026-03-01", kycStatus: "pending",    kycTier: 2, accountStatus: "active",    spotBalance: "$5,670.00",  kycDocType: "National ID",       kycDocNumber: "KW44443333", kycSubmittedAt: "2026-03-30" },
  { id: "u008", name: "Nour Al-Amin",    email: "nour@example.com",   phone: "+971 50 234 5678",  country: "UAE",    joinedAt: "2026-03-05", kycStatus: "resubmit",   kycTier: 1, accountStatus: "active",    spotBalance: "$1,100.00",  kycDocType: "Passport",          kycDocNumber: "D2345678",   kycSubmittedAt: "2026-03-10" },
  { id: "u009", name: "Hassan Saleh",    email: "hassan@example.com", phone: "+964 770 999 0000", country: "Iraq",   joinedAt: "2026-03-10", kycStatus: "unverified", kycTier: 0, accountStatus: "suspended", spotBalance: "$0.00" },
  { id: "u010", name: "Zainab Mahdi",    email: "zainab@example.com", phone: "+964 781 444 5555", country: "Iraq",   joinedAt: "2026-03-15", kycStatus: "pending",    kycTier: 2, accountStatus: "active",    spotBalance: "$450.00",    kycDocType: "Driver's License",  kycDocNumber: "DL99887766", kycSubmittedAt: "2026-03-31" },
];

// ─── Context ──────────────────────────────────────────────────────────────────
interface StoreContextType {
  assets: PalmXAsset[];
  tradingPairs: TradingPair[];
  users: UserRecord[];
  countries: SupportedCountry[];
  addAsset: (asset: Omit<PalmXAsset, "id" | "rank">) => void;
  updateAsset: (id: string, updates: Partial<PalmXAsset>) => void;
  removeAsset: (id: string) => void;
  addPair: (pair: Omit<TradingPair, "id">) => void;
  updatePair: (id: string, updates: Partial<TradingPair>) => void;
  removePair: (id: string) => void;
  updateUser: (id: string, updates: Partial<UserRecord>) => void;
  approveKyc: (userId: string) => void;
  rejectKyc: (userId: string, notes?: string) => void;
  requestResubmission: (userId: string, reason?: string) => void;
  addCountry: (country: Omit<SupportedCountry, "banks">) => void;
  updateCountry: (code: string, updates: Partial<Omit<SupportedCountry, "banks">>) => void;
  removeCountry: (code: string) => void;
  addBank: (countryCode: string, bank: Omit<Bank, "id">) => void;
  updateBank: (countryCode: string, bankId: string, updates: Partial<Bank>) => void;
  removeBank: (countryCode: string, bankId: string) => void;
  // Bot state
  botPaused: boolean;
  toggleBotKillSwitch: () => void;
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState<PalmXAsset[]>(DEFAULT_ASSETS);
  const [tradingPairs, setTradingPairs] = useState<TradingPair[]>(DEFAULT_PAIRS);
  const [users, setUsers] = useState<UserRecord[]>(DEFAULT_USERS);
  const [countries, setCountries] = useState<SupportedCountry[]>(DEFAULT_COUNTRIES);
  const [botPaused, setBotPausedState] = useState(false);

  function addAsset(asset: Omit<PalmXAsset, "id" | "rank">) {
    const maxRank = assets.reduce((m, a) => (a.rank > m ? a.rank : m), 0);
    const id = `${asset.symbol.toLowerCase()}-${Date.now()}`;
    setAssets((prev) => [...prev, { ...asset, id, rank: maxRank + 1 }]);
  }

  function updateAsset(id: string, updates: Partial<PalmXAsset>) {
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
  }

  function removeAsset(id: string) {
    setAssets((prev) => prev.filter((a) => a.id !== id));
  }

  function addPair(pair: Omit<TradingPair, "id">) {
    const id = `${pair.base.toLowerCase()}-${pair.quote.toLowerCase()}-${Date.now()}`;
    setTradingPairs((prev) => [...prev, { ...pair, id }]);
  }

  function updatePair(id: string, updates: Partial<TradingPair>) {
    setTradingPairs((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }

  function removePair(id: string) {
    setTradingPairs((prev) => prev.filter((p) => p.id !== id));
  }

  function updateUser(id: string, updates: Partial<UserRecord>) {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...updates } : u)));
  }

  function approveKyc(userId: string) {
    updateUser(userId, { kycStatus: "verified", kycTier: 2 });
  }

  function rejectKyc(userId: string, notes?: string) {
    updateUser(userId, { kycStatus: "rejected", adminNotes: notes });
  }

  function requestResubmission(userId: string, reason?: string) {
    updateUser(userId, { kycStatus: "resubmit", adminNotes: reason });
  }

  // ── Country / Bank CRUD ──────────────────────────────────────────────────────
  function addCountry(country: Omit<SupportedCountry, "banks">) {
    setCountries((prev) => [...prev, { ...country, banks: [] }]);
  }

  function updateCountry(code: string, updates: Partial<Omit<SupportedCountry, "banks">>) {
    setCountries((prev) =>
      prev.map((c) => (c.code === code ? { ...c, ...updates } : c))
    );
  }

  function removeCountry(code: string) {
    setCountries((prev) => prev.filter((c) => c.code !== code));
  }

  function addBank(countryCode: string, bank: Omit<Bank, "id">) {
    const id = `${countryCode.toLowerCase()}-bank-${Date.now()}`;
    setCountries((prev) =>
      prev.map((c) =>
        c.code === countryCode
          ? { ...c, banks: [...c.banks, { ...bank, id }] }
          : c
      )
    );
  }

  function updateBank(countryCode: string, bankId: string, updates: Partial<Bank>) {
    setCountries((prev) =>
      prev.map((c) =>
        c.code === countryCode
          ? { ...c, banks: c.banks.map((b) => (b.id === bankId ? { ...b, ...updates } : b)) }
          : c
      )
    );
  }

  function removeBank(countryCode: string, bankId: string) {
    setCountries((prev) =>
      prev.map((c) =>
        c.code === countryCode
          ? { ...c, banks: c.banks.filter((b) => b.id !== bankId) }
          : c
      )
    );
  }

  function toggleBotKillSwitch() {
    setBotPausedState((prev) => !prev);
  }

  return (
    <StoreContext.Provider
      value={{
        assets, tradingPairs, users, countries,
        addAsset, updateAsset, removeAsset,
        addPair, updatePair, removePair,
        updateUser, approveKyc, rejectKyc, requestResubmission,
        addCountry, updateCountry, removeCountry,
        addBank, updateBank, removeBank,
        botPaused, toggleBotKillSwitch,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function usePalmXStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("usePalmXStore must be used within StoreProvider");
  return ctx;
}
