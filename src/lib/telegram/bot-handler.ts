/**
 * PalmX Telegram Bot — Arabic Inline Keyboard Handler
 * Bot Username: @plamxbot
 *
 * SECURITY:
 *  - Token is read from TELEGRAM_BOT_TOKEN environment variable — NEVER hardcoded.
 *  - No private keys are stored. All on-chain signing is delegated to user wallets.
 *  - Kill-switch check runs on every incoming update.
 */

import type {
  TelegramUpdate,
  TelegramMessage,
  TelegramCallbackQuery,
  InlineKeyboardMarkup,
  BotMenuState,
  BotUserSession,
  BotTrade,
  AccountMode,
} from "./types";
import { checkTokenRisk, SOLANA_TOKENS } from "./solana";

// ─── Bot API helpers ──────────────────────────────────────────────────────────
export function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set");
  return token;
}

async function callTelegramApi(method: string, body: object): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${getBotToken()}/${method}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

export async function sendMessage(
  chatId:      number,
  text:        string,
  replyMarkup?: InlineKeyboardMarkup,
  parseMode:   "HTML" | "Markdown" = "HTML",
): Promise<void> {
  await callTelegramApi("sendMessage", {
    chat_id:      chatId,
    text,
    parse_mode:   parseMode,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function editMessage(
  chatId:    number,
  messageId: number,
  text:      string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  await callTelegramApi("editMessageText", {
    chat_id:      chatId,
    message_id:   messageId,
    text,
    parse_mode:   "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function answerCallbackQuery(callbackId: string, text?: string): Promise<void> {
  await callTelegramApi("answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

// ─── Register webhook ─────────────────────────────────────────────────────────
export async function registerWebhook(webhookUrl: string): Promise<boolean> {
  const res = await callTelegramApi("setWebhook", {
    url:             webhookUrl,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  return res.ok;
}

// ─── In-memory session store (replace with Redis/DB in production) ────────────
const sessions = new Map<number, BotUserSession>();

export function getSession(telegramId: number): BotUserSession {
  if (!sessions.has(telegramId)) {
    sessions.set(telegramId, {
      telegramId,
      accountMode:  "demo",
      isLinked:     false,
      createdAt:    new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status:       "active",
      demoBalance:  10_000,   // $10,000 virtual USDC
      menuState:    "start",
    });
  }
  const sess = sessions.get(telegramId)!;
  sess.lastActiveAt = new Date().toISOString();
  return sess;
}

export function updateSession(telegramId: number, updates: Partial<BotUserSession>): void {
  const sess = getSession(telegramId);
  sessions.set(telegramId, { ...sess, ...updates });
}

// ─── In-memory open trades (replace with DB in production) ───────────────────
const openTrades = new Map<string, BotTrade>();

export function getOpenTrades(telegramId: number): BotTrade[] {
  return [...openTrades.values()].filter(
    (t) => t.telegramId === telegramId && t.status === "open"
  );
}

export function getAllTrades(): BotTrade[] {
  return [...openTrades.values()];
}

// ─── Kill-switch (read from env or in-memory flag) ────────────────────────────
let BOT_PAUSED = false;
export function setBotPaused(paused: boolean): void { BOT_PAUSED = paused; }
export function isBotPaused(): boolean { return BOT_PAUSED; }

// ─── Keyboards ───────────────────────────────────────────────────────────────
function kbAccountSelect(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🟢 حساب حقيقي",    callback_data: "mode:real" },
        { text: "✏️ حساب تجريبي",   callback_data: "mode:demo" },
      ],
    ],
  };
}

function kbMainMenu(mode: AccountMode): InlineKeyboardMarkup {
  const badge = mode === "real" ? "🟢" : "✏️";
  return {
    inline_keyboard: [
      [{ text: "📈 تداول Spot",                  callback_data: "menu:trade_spot" }],
      [{ text: "💰 رصيد المحفظة",                callback_data: "menu:wallet" }],
      [{ text: "📊 الصفقات المفتوحة",             callback_data: "menu:open_trades" }],
      [{ text: "🤖 التداول الآلي",               callback_data: "menu:auto_trading" }],
      [{ text: "📜 أوامر الشراء والبيع",          callback_data: "menu:order_history" }],
      [
        { text: `${badge} تبديل النمط`,          callback_data: "menu:switch_mode" },
        { text: "⚙️ الإعدادات",                  callback_data: "menu:settings" },
      ],
      [{ text: "🔗 ربط حساب PalmX",              callback_data: "menu:link_account" }],
    ],
  };
}

function kbTradeSpot(): InlineKeyboardMarkup {
  const topTokens = Object.keys(SOLANA_TOKENS).slice(0, 6);
  const tokenRows = topTokens.reduce<Array<Array<{ text: string; callback_data: string }>>>
    ((rows, sym, i) => {
      if (i % 3 === 0) rows.push([]);
      rows[rows.length - 1].push({ text: sym, callback_data: `trade:token:${sym}` });
      return rows;
    }, []);
  return {
    inline_keyboard: [
      ...tokenRows,
      [
        { text: "🔍 بحث برمز العقد", callback_data: "trade:search" },
      ],
      [{ text: "🔙 رجوع",           callback_data: "menu:main" }],
    ],
  };
}

function kbTradeAction(symbol: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🟢 شراء (Buy)",  callback_data: `trade:buy:${symbol}` },
        { text: "🔴 بيع (Sell)",  callback_data: `trade:sell:${symbol}` },
      ],
      [
        { text: "🎯 إضافة TP/SL",    callback_data: `trade:tpsl:${symbol}` },
      ],
      [{ text: "🔙 رجوع",           callback_data: "menu:trade_spot" }],
    ],
  };
}

function kbWallet(isLinked: boolean, walletAddress?: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...(!walletAddress
        ? [[
            { text: "👻 ربط Phantom",    callback_data: "wallet:phantom" },
            { text: "🌊 ربط Solflare",   callback_data: "wallet:solflare" },
          ]]
        : [[{ text: `✅ ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`, callback_data: "wallet:info" }]]
      ),
      [{ text: "📋 عنوان الإيداع",      callback_data: "wallet:deposit" }],
      [{ text: "💸 سحب",               callback_data: "wallet:withdraw" }],
      [{ text: "🔙 رجوع",              callback_data: "menu:main" }],
    ],
  };
}

function kbOpenTrades(trades: BotTrade[]): InlineKeyboardMarkup {
  const tradeRows = trades.slice(0, 8).map((t) => [{
    text:          `${t.direction === "buy" ? "🟢" : "🔴"} ${t.tokenSymbol} · ${t.sizeUSDC.toFixed(0)} USDC`,
    callback_data: `trade:close:${t.id}`,
  }]);
  return {
    inline_keyboard: [
      ...(tradeRows.length ? tradeRows : [[{ text: "لا توجد صفقات مفتوحة", callback_data: "noop" }]]),
      [{ text: "🔙 رجوع", callback_data: "menu:main" }],
    ],
  };
}

function kbAutoTrading(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "⚡ DCA (متوسط التكلفة)",    callback_data: "auto:dca" }],
      [{ text: "📊 Grid Trading",           callback_data: "auto:grid" }],
      [{ text: "🤖 Copy Trading",           callback_data: "auto:copy" }],
      [{ text: "🔙 رجوع",                  callback_data: "menu:main" }],
    ],
  };
}

function kbSettings(session: BotUserSession): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: `نسبة الرسوم: ${process.env.BOT_FEE_PERCENT ?? "5"}% (من الربح فقط)`, callback_data: "noop" }],
      [{ text: "🔔 تنبيهات السعر",         callback_data: "settings:alerts" }],
      [{ text: "📏 الحجم الأقصى للصفقة",    callback_data: "settings:maxsize" }],
      [{ text: `🌐 اللغة: العربية`,         callback_data: "settings:lang" }],
      [{ text: "🔙 رجوع",                  callback_data: "menu:main" }],
    ],
  };
}

// ─── Message builders ─────────────────────────────────────────────────────────
function textGreeting(firstName: string): string {
  return (
    `🌴 <b>مرحباً بك في PalmX، ${firstName}!</b>\n\n` +
    `منصة التداول الأسرع والأكثر أماناً.\n` +
    `<i>غير احتجازية · Solana · Raydium / Orca</i>\n\n` +
    `اختر نوع حسابك للبدء:`
  );
}

function textMainMenu(session: BotUserSession): string {
  const mode  = session.accountMode === "real" ? "🟢 حقيقي" : "✏️ تجريبي";
  const link  = session.isLinked ? `✅ مرتبط بـ PalmX` : `❌ غير مرتبط`;
  const bal   = session.accountMode === "demo"
    ? `\n💵 رصيد تجريبي: <b>$${session.demoBalance.toLocaleString()}</b>`
    : "";
  return (
    `🏠 <b>القائمة الرئيسية</b>\n\n` +
    `النمط: ${mode}  |  ${link}${bal}\n\n` +
    `اختر ما تريد:`
  );
}

function textWallet(session: BotUserSession): string {
  if (!session.walletAddress) {
    return (
      `💰 <b>المحفظة</b>\n\n` +
      `لا توجد محفظة مرتبطة.\n\n` +
      `ابدأ بربط محفظة Phantom أو Solflare للتداول.\n` +
      `<i>⚠️ نحن لا نخزّن مفاتيحك الخاصة أبداً.</i>`
    );
  }
  return (
    `💰 <b>المحفظة</b>\n\n` +
    `📍 العنوان: <code>${session.walletAddress}</code>\n` +
    `🌐 الشبكة: Solana (Mainnet)\n\n` +
    `<i>يتم تحديث الرصيد مباشرة من Solana RPC</i>`
  );
}

function textOpenTrades(trades: BotTrade[]): string {
  if (!trades.length)
    return `📊 <b>الصفقات المفتوحة</b>\n\n<i>لا توجد صفقات مفتوحة حالياً.</i>`;
  const rows = trades.map((t) => {
    const pnl  = (t.currentPrice - t.entryPrice) * t.size;
    const sign = pnl >= 0 ? "+" : "";
    return `• ${t.direction === "buy" ? "🟢" : "🔴"} <b>${t.tokenSymbol}</b>  ${sign}${pnl.toFixed(2)} USDC`;
  });
  return `📊 <b>الصفقات المفتوحة (${trades.length})</b>\n\n${rows.join("\n")}\n\n<i>انقر على صفقة لإغلاقها</i>`;
}

async function textTokenInfo(symbol: string): Promise<string> {
  const address = SOLANA_TOKENS[symbol];
  if (!address) return `❌ الرمز ${symbol} غير مدعوم حالياً.`;
  const risk = await checkTokenRisk(address);
  const riskEmoji = risk.riskLabel === "safe" ? "🟢" : risk.riskLabel === "caution" ? "🟡" : "🔴";
  return (
    `📈 <b>تداول ${symbol}</b>\n\n` +
    `📋 العقد: <code>${address.slice(0, 12)}...${address.slice(-6)}</code>\n` +
    `${riskEmoji} تقييم المخاطر: <b>${risk.riskLabel.toUpperCase()}</b> (${risk.riskScore}/100)\n` +
    `🔒 السيولة مقفلة: ${risk.liquidityLocked ? "✅" : "❌"}\n` +
    `🏭 صلاحية الإصدار ملغاة: ${risk.mintAuthorityRevoked ? "✅" : "❌"}\n` +
    `💧 حجم السيولة: <b>$${risk.liquidityUSD.toLocaleString()}</b>\n\n` +
    `اختر نوع التداول:`
  );
}

// ─── Main update dispatcher ───────────────────────────────────────────────────
export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  // Kill-switch check
  if (BOT_PAUSED) {
    const chatId =
      update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) {
      await sendMessage(
        chatId,
        "⏸ <b>البوت متوقف مؤقتاً</b>\nيعمل الفريق على صيانة طارئة. سنعود قريباً.",
      );
    }
    return;
  }

  if (update.message)        await handleMessage(update.message);
  if (update.callback_query) await handleCallbackQuery(update.callback_query);
}

async function handleMessage(msg: TelegramMessage): Promise<void> {
  if (!msg.from) return;
  const chatId  = msg.chat.id;
  const session = getSession(msg.from.id);
  const text    = msg.text?.trim() ?? "";

  if (text === "/start") {
    updateSession(msg.from.id, { menuState: "start", telegramUsername: msg.from.username });
    await sendMessage(chatId, textGreeting(msg.from.first_name), kbAccountSelect());
    return;
  }

  if (text === "/menu") {
    updateSession(msg.from.id, { menuState: "main_menu" });
    await sendMessage(chatId, textMainMenu(session), kbMainMenu(session.accountMode));
    return;
  }

  if (text === "/help") {
    await sendMessage(chatId,
      `📖 <b>المساعدة</b>\n\n` +
      `/start — بدء البوت\n` +
      `/menu — القائمة الرئيسية\n` +
      `/balance — رصيد المحفظة\n` +
      `/trades — الصفقات المفتوحة\n` +
      `/help — المساعدة\n\n` +
      `للدعم: @PalmXSupport`
    );
    return;
  }

  if (text === "/balance") {
    await sendMessage(chatId, textWallet(session), kbWallet(session.isLinked, session.walletAddress));
    return;
  }

  if (text === "/trades") {
    const trades = getOpenTrades(msg.from.id);
    await sendMessage(chatId, textOpenTrades(trades), kbOpenTrades(trades));
    return;
  }

  // Default: show main menu
  await sendMessage(chatId, textMainMenu(session), kbMainMenu(session.accountMode));
}

async function handleCallbackQuery(cq: TelegramCallbackQuery): Promise<void> {
  if (!cq.message) return;
  await answerCallbackQuery(cq.id);

  const chatId    = cq.message.chat.id;
  const msgId     = cq.message.message_id;
  const userId    = cq.from.id;
  const data      = cq.data ?? "";
  const session   = getSession(userId);

  // ── Account mode selection ──
  if (data === "mode:real" || data === "mode:demo") {
    const mode = data === "mode:real" ? "real" : "demo" as AccountMode;
    updateSession(userId, { accountMode: mode, menuState: "main_menu" });
    const updated = getSession(userId);
    await editMessage(chatId, msgId, textMainMenu(updated), kbMainMenu(mode));
    return;
  }

  // ── Main navigation ──
  if (data === "menu:main") {
    updateSession(userId, { menuState: "main_menu" });
    await editMessage(chatId, msgId, textMainMenu(session), kbMainMenu(session.accountMode));
    return;
  }
  if (data === "menu:trade_spot") {
    updateSession(userId, { menuState: "trade_spot" });
    await editMessage(chatId, msgId,
      `📈 <b>تداول Spot</b>\n\nاختر العملة أو ابحث بعنوان العقد:`,
      kbTradeSpot()
    );
    return;
  }
  if (data === "menu:wallet") {
    updateSession(userId, { menuState: "wallet" });
    await editMessage(chatId, msgId, textWallet(session), kbWallet(session.isLinked, session.walletAddress));
    return;
  }
  if (data === "menu:open_trades") {
    const trades = getOpenTrades(userId);
    updateSession(userId, { menuState: "open_trades" });
    await editMessage(chatId, msgId, textOpenTrades(trades), kbOpenTrades(trades));
    return;
  }
  if (data === "menu:auto_trading") {
    updateSession(userId, { menuState: "auto_trading" });
    await editMessage(chatId, msgId,
      `🤖 <b>التداول الآلي</b>\n\nاختر إستراتيجية:`,
      kbAutoTrading()
    );
    return;
  }
  if (data === "menu:order_history") {
    const trades = getAllTrades().filter((t) => t.telegramId === userId && t.status === "closed");
    const rows   = trades.slice(-5).map((t) =>
      `• ${t.direction === "buy" ? "🟢" : "🔴"} <b>${t.tokenSymbol}</b>  ${(t.realizedPnl ?? 0) >= 0 ? "+" : ""}${(t.realizedPnl ?? 0).toFixed(2)} USDC  ${t.closedAt?.slice(0, 10) ?? ""}`
    );
    await editMessage(chatId, msgId,
      `📜 <b>سجل الأوامر</b>\n\n${rows.length ? rows.join("\n") : "<i>لا يوجد سجل بعد.</i>"}`,
      { inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "menu:main" }]] }
    );
    return;
  }
  if (data === "menu:switch_mode") {
    const newMode = session.accountMode === "real" ? "demo" : "real" as AccountMode;
    updateSession(userId, { accountMode: newMode, menuState: "main_menu" });
    const updated = getSession(userId);
    await editMessage(chatId, msgId, textMainMenu(updated), kbMainMenu(newMode));
    return;
  }
  if (data === "menu:settings") {
    await editMessage(chatId, msgId, `⚙️ <b>الإعدادات</b>`, kbSettings(session));
    return;
  }
  if (data === "menu:link_account") {
    const linkUrl = `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://palmx.io"}/link-telegram?tid=${userId}&t=${Date.now()}`;
    await editMessage(chatId, msgId,
      `🔗 <b>ربط حساب PalmX</b>\n\n` +
      `انقر على الرابط أدناه لربط حسابك بشكل آمن:\n\n${linkUrl}\n\n` +
      `⏱ ينتهي الرابط خلال 15 دقيقة.`,
      { inline_keyboard: [
        [{ text: "🔗 فتح رابط الربط", url: linkUrl }],
        [{ text: "🔙 رجوع", callback_data: "menu:main" }],
      ]}
    );
    return;
  }

  // ── Token selection ──
  if (data.startsWith("trade:token:")) {
    const symbol = data.replace("trade:token:", "");
    const infoText = await textTokenInfo(symbol);
    await editMessage(chatId, msgId, infoText, kbTradeAction(symbol));
    return;
  }

  // ── Buy/Sell ──
  if (data.startsWith("trade:buy:") || data.startsWith("trade:sell:")) {
    const [, direction, symbol] = data.split(":");
    const modeLabel = session.accountMode === "demo" ? " (تجريبي)" : "";
    await editMessage(chatId, msgId,
      `${direction === "buy" ? "🟢" : "🔴"} <b>${direction === "buy" ? "شراء" : "بيع"} ${symbol}${modeLabel}</b>\n\n` +
      `أرسل مبلغ USDC للتداول:\n<i>مثال: 100</i>\n\n` +
      `⚠️ الحد الأقصى للصفقة: $${process.env.BOT_MAX_TRADE_SIZE ?? "1000"} USDC\n` +
      `💡 الرسوم: ${process.env.BOT_FEE_PERCENT ?? "5"}% من الربح فقط`,
      { inline_keyboard: [[{ text: "🔙 إلغاء", callback_data: `trade:token:${symbol}` }]] }
    );
    return;
  }

  // ── TP/SL setup ──
  if (data.startsWith("trade:tpsl:")) {
    const symbol = data.replace("trade:tpsl:", "");
    await editMessage(chatId, msgId,
      `🎯 <b>إعداد TP / SL لـ ${symbol}</b>\n\n` +
      `أرسل الأوامر بالصيغة التالية:\n` +
      `<code>TP 0.95 SL 0.85</code>\n\n` +
      `أو أرسل كل قيمة على حدة:`,
      { inline_keyboard: [
        [{ text: "🎯 Take Profit", callback_data: `tpsl:tp:${symbol}` }],
        [{ text: "🛡 Stop Loss",   callback_data: `tpsl:sl:${symbol}` }],
        [{ text: "🔙 رجوع",        callback_data: `trade:token:${symbol}` }],
      ]}
    );
    return;
  }

  // ── Wallet connect ──
  if (data === "wallet:phantom" || data === "wallet:solflare") {
    const walletType = data === "wallet:phantom" ? "phantom" : "solflare";
    const deepLink   = walletType === "phantom"
      ? `https://phantom.app/ul/v1/connect?dapp_encryption_public_key=${process.env.PHANTOM_ENCRYPTION_KEY ?? "DEMO_KEY"}&redirect_link=${encodeURIComponent(`${process.env.NEXT_PUBLIC_BASE_URL ?? "https://palmx.io"}/api/telegram/wallet-callback?tid=${userId}`)}&cluster=mainnet-beta`
      : `https://solflare.com/ul/v1/connect?app_url=${encodeURIComponent(process.env.NEXT_PUBLIC_BASE_URL ?? "https://palmx.io")}&redirect_url=${encodeURIComponent(`${process.env.NEXT_PUBLIC_BASE_URL ?? "https://palmx.io"}/api/telegram/wallet-callback?tid=${userId}`)}`;
    await editMessage(chatId, msgId,
      `${walletType === "phantom" ? "👻" : "🌊"} <b>ربط ${walletType === "phantom" ? "Phantom" : "Solflare"}</b>\n\n` +
      `انقر للربط الآمن. <b>نحن لا نخزّن مفاتيحك الخاصة أبداً.</b>\n` +
      `فقط مفتاحك العام سيُحفظ لعرض الرصيد.`,
      { inline_keyboard: [
        [{ text: `🔗 فتح ${walletType === "phantom" ? "Phantom" : "Solflare"}`, url: deepLink }],
        [{ text: "🔙 رجوع", callback_data: "menu:wallet" }],
      ]}
    );
    return;
  }

  // ── Auto-trading stubs ──
  if (data.startsWith("auto:")) {
    const strategy = data.replace("auto:", "");
    const names: Record<string, string> = { dca: "DCA", grid: "Grid Trading", copy: "Copy Trading" };
    await editMessage(chatId, msgId,
      `🤖 <b>${names[strategy] ?? strategy}</b>\n\n<i>قيد التطوير — سيُتاح في الإصدار القادم.</i>`,
      { inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "menu:auto_trading" }]] }
    );
    return;
  }

  // ── No-op buttons (display-only) ──
  if (data === "noop") return;
}
