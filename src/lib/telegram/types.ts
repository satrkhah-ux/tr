/**
 * PalmX Telegram Bot — Core Types
 * All trading is non-custodial; NO private keys are ever stored.
 */

// ─── Telegram API primitives ──────────────────────────────────────────────────
export interface TelegramUser {
  id:         number;
  first_name: string;
  last_name?: string;
  username?:  string;
  language_code?: string;
}

export interface TelegramMessage {
  message_id:   number;
  from?:        TelegramUser;
  chat:         { id: number; type: string };
  date:         number;
  text?:        string;
  entities?:    Array<{ type: string; offset: number; length: number }>;
}

export interface TelegramCallbackQuery {
  id:       string;
  from:     TelegramUser;
  message?: TelegramMessage;
  data?:    string;
}

export interface TelegramUpdate {
  update_id:       number;
  message?:        TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text:          string;
  callback_data?: string;
  url?:          string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

// ─── Bot session & account types ──────────────────────────────────────────────
export type AccountMode = "real" | "demo";
export type BotUserStatus = "active" | "suspended" | "banned";
export type TradeStatus = "open" | "closed" | "cancelled";
export type TradeDirection = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop";

export interface BotUserSession {
  telegramId:     number;
  telegramUsername?: string;
  palmxUserId?:   string;      // linked PalmX account (from OAuth deep-link)
  walletAddress?: string;      // Phantom/Solflare public key (NOT private key)
  walletType?:    "phantom" | "solflare";
  accountMode:    AccountMode;
  isLinked:       boolean;
  createdAt:      string;
  lastActiveAt:   string;
  status:         BotUserStatus;
  /** Demo account virtual balance (USDC equivalent) */
  demoBalance:    number;
  /** Current menu state for inline keyboard navigation */
  menuState:      BotMenuState;
}

export type BotMenuState =
  | "start"
  | "main_menu"
  | "trade_spot"
  | "wallet"
  | "open_trades"
  | "auto_trading"
  | "order_history"
  | "settings"
  | "link_account"
  | "connect_wallet";

// ─── Trade types ──────────────────────────────────────────────────────────────
export interface TokenRiskCheck {
  tokenAddress:  string;
  mintAuthorityRevoked: boolean;
  liquidityLocked:      boolean;
  isScamFlagged:        boolean;
  liquidityUSD:         number;
  holderCount:          number;
  riskScore:            number;  // 0 = safe, 100 = extreme risk
  riskLabel:            "safe" | "caution" | "high" | "extreme";
}

export interface BotTrade {
  id:            string;
  telegramId:    number;
  palmxUserId?:  string;
  accountMode:   AccountMode;
  tokenSymbol:   string;
  tokenAddress:  string;
  direction:     TradeDirection;
  orderType:     OrderType;
  entryPrice:    number;
  currentPrice:  number;
  size:          number;        // token amount
  sizeUSDC:      number;        // value in USDC
  stopLoss?:     number;        // price level
  takeProfit?:   number;        // price level
  status:        TradeStatus;
  txSignature?:  string;        // Solana transaction signature
  dex:           "raydium" | "orca";
  openedAt:      string;
  closedAt?:     string;
  realizedPnl?:  number;        // USDC
  /** Fee deducted from profit only (5-10%) */
  feePaid?:      number;        // USDC
  riskCheck?:    TokenRiskCheck;
}

// ─── Fee system ───────────────────────────────────────────────────────────────
export interface FeeConfig {
  /** Percentage of PROFIT to deduct (5–10) */
  feePercent:       number;
  /** Solana wallet address of PalmX treasury */
  treasuryAddress:  string;
  enabled:          boolean;
}

export interface BotStats {
  totalUsers:       number;
  activeUsers24h:   number;
  realAccounts:     number;
  demoAccounts:     number;
  openTrades:       number;
  closedTrades24h:  number;
  totalVolume24h:   number;    // USDC
  totalFeesCollected: number;  // USDC
  botPaused:        boolean;   // kill-switch flag
}
