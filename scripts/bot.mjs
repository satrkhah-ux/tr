/**
 * scripts/bot.mjs  —  PalmX Telegram Bot (Production)
 * ────────────────────────────────────────────────────
 * • Persistent sessions via Supabase (bot_users table)
 * • Trade history stored in bot_trades
 * • All messages logged in bot_messages
 * • Runs forever under PM2
 *
 * Start:   pm2 start ecosystem.config.cjs --only plamx-bot
 * Stop:    pm2 stop plamx-bot
 * Logs:    pm2 logs plamx-bot
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

// ── Load .env.local ──────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const TOKEN       = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!TOKEN)        { console.error("❌ TELEGRAM_BOT_TOKEN غير موجود في .env.local"); process.exit(1); }
if (!SUPABASE_URL) { console.error("❌ NEXT_PUBLIC_SUPABASE_URL غير موجود في .env.local"); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const API = `https://api.telegram.org/bot${TOKEN}`;

// ── In-memory cache (reduces DB reads for active sessions) ───────
const cache = new Map(); // telegram_id → user row

// ── DB helpers ───────────────────────────────────────────────────
async function getUser(telegramId) {
  if (cache.has(telegramId)) return cache.get(telegramId);

  const { data } = await supabase
    .from("bot_users")
    .select("*")
    .eq("telegram_id", telegramId)
    .single();

  if (data) {
    cache.set(telegramId, data);
    return data;
  }
  return null;
}

async function upsertUser(telegramId, fields) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("bot_users")
    .upsert(
      { telegram_id: telegramId, ...fields, updated_at: now },
      { onConflict: "telegram_id" }
    )
    .select()
    .single();

  if (error) { console.error("DB upsertUser error:", error.message); return null; }
  cache.set(telegramId, data);
  return data;
}

async function updateUser(telegramId, fields) {
  const { data, error } = await supabase
    .from("bot_users")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("telegram_id", telegramId)
    .select()
    .single();

  if (error) { console.error("DB updateUser error:", error.message); return null; }
  cache.set(telegramId, data);
  return data;
}

async function saveTrade(telegramId, trade) {
  const { error } = await supabase
    .from("bot_trades")
    .insert({ telegram_id: telegramId, ...trade });
  if (error) console.error("DB saveTrade error:", error.message);
}

async function getOpenTrades(telegramId) {
  const { data } = await supabase
    .from("bot_trades")
    .select("*")
    .eq("telegram_id", telegramId)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function getTradeHistory(telegramId, limit = 10) {
  const { data } = await supabase
    .from("bot_trades")
    .select("*")
    .eq("telegram_id", telegramId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

async function logMessage(telegramId, direction, content) {
  await supabase.from("bot_messages").insert({
    telegram_id: telegramId,
    direction,
    message_type: "text",
    content: content?.slice(0, 4000),
  });
}

// ── Telegram API helpers ──────────────────────────────────────────
async function apiCall(method, body = {}) {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  } catch (err) {
    console.error(`apiCall(${method}) error:`, err.message);
    return { ok: false, description: err.message };
  }
}

function send(chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return apiCall("sendMessage", body);
}

function edit(chatId, messageId, text, replyMarkup = null) {
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return apiCall("editMessageText", body);
}

function answer(callbackQueryId, text = "") {
  return apiCall("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

// ── Keyboards ─────────────────────────────────────────────────────
const kbStart = () => ({
  inline_keyboard: [
    [
      { text: "🟢 حساب حقيقي",    callback_data: "mode:real" },
      { text: "✏️ حساب تجريبي",  callback_data: "mode:demo" },
    ],
  ],
});

const kbMain = (mode) => {
  const label = mode === "real" ? "🟢 حقيقي" : "✏️ تجريبي";
  return {
    inline_keyboard: [
      [
        { text: "📈 تداول فوري",       callback_data: "menu:spot" },
        { text: "👛 محفظتي",           callback_data: "menu:wallet" },
      ],
      [
        { text: "📋 صفقات مفتوحة",     callback_data: "menu:open_trades" },
        { text: "🤖 تداول آلي",        callback_data: "menu:auto" },
      ],
      [
        { text: "📜 سجل الأوامر",      callback_data: "menu:history" },
        { text: "⚙️ الإعدادات",       callback_data: "menu:settings" },
      ],
      [{ text: `🔄 الوضع: ${label}`,  callback_data: "menu:switch_mode" }],
    ],
  };
};

const kbTokens = () => ({
  inline_keyboard: [
    [
      { text: "◎ SOL",   callback_data: "token:SOL" },
      { text: "💵 USDC", callback_data: "token:USDC" },
      { text: "💎 RAY",  callback_data: "token:RAY" },
    ],
    [
      { text: "🌊 ORCA",  callback_data: "token:ORCA" },
      { text: "🐕 BONK",  callback_data: "token:BONK" },
      { text: "🎩 WIF",   callback_data: "token:WIF" },
    ],
    [
      { text: "⚡ JUP",          callback_data: "token:JUP" },
      { text: "🔍 بحث بالعقد",  callback_data: "token:search" },
    ],
    [{ text: "◀️ رجوع", callback_data: "menu:main" }],
  ],
});

const kbTradeAction = (symbol) => ({
  inline_keyboard: [
    [
      { text: `✅ شراء ${symbol}`, callback_data: `trade:buy:${symbol}` },
      { text: `🔴 بيع ${symbol}`,  callback_data: `trade:sell:${symbol}` },
    ],
    [{ text: "🎯 وقف الخسارة / جني الأرباح", callback_data: `trade:tpsl:${symbol}` }],
    [{ text: "◀️ رجوع", callback_data: "menu:spot" }],
  ],
});

const kbWallet = () => ({
  inline_keyboard: [
    [{ text: "👻 ربط محفظة Phantom",  callback_data: "wallet:phantom" }],
    [{ text: "🔮 ربط محفظة Solflare", callback_data: "wallet:solflare" }],
    [{ text: "◀️ رجوع",              callback_data: "menu:main" }],
  ],
});

// ── Live prices (mock — replace with Birdeye/Jupiter later) ──────
const PRICES = {
  SOL:  178.92, USDC: 1.000, USDT: 1.000,
  RAY:  2.84,   ORCA: 3.21,  BONK: 0.0000312,
  WIF:  2.18,   JUP:  0.94,
};

function fmtPrice(p) {
  return p < 0.001 ? p.toExponential(4) : p.toFixed(p < 1 ? 4 : 2);
}

// ── Message handler ───────────────────────────────────────────────
async function handleMessage(msg) {
  const chatId   = msg.chat.id;
  const text     = (msg.text || "").trim();
  const from     = msg.from ?? {};
  const username = from.username ? `@${from.username}` : (from.first_name || "مستخدم");

  // Log incoming message
  logMessage(chatId, "in", text).catch(() => {});

  // Ensure user row exists in DB
  let user = await getUser(chatId);
  if (!user) {
    user = await upsertUser(chatId, {
      username:   from.username ?? null,
      first_name: from.first_name ?? null,
      last_name:  from.last_name ?? null,
    });
  }

  if (user?.is_banned) {
    await send(chatId, "⛔ حسابك محظور. تواصل مع الدعم.");
    return;
  }

  // ── /start ───────────────────────────────────────────────────
  if (text === "/start" || text === "/menu") {
    await updateUser(chatId, { step: "mode_select" });
    await send(
      chatId,
      `🌴 <b>مرحباً بك في PalmX Bot</b>\n\n` +
      `أهلاً ${username}! 🎉\n\n` +
      `يرجى اختيار نوع الحساب للبدء:\n\n` +
      `🟢 <b>حساب حقيقي</b> — تداول بأصول حقيقية على Solana\n` +
      `✏️ <b>حساب تجريبي</b> — تداول بمبلغ افتراضي $10,000 بدون مخاطر`,
      kbStart()
    );
    return;
  }

  // ── /help ────────────────────────────────────────────────────
  if (text === "/help") {
    await send(
      chatId,
      `❓ <b>مساعدة PalmX Bot</b>\n\n` +
      `/start — بدء البوت واختيار الحساب\n` +
      `/menu — فتح القائمة الرئيسية\n` +
      `/balance — عرض رصيدك\n` +
      `/trades — عرض صفقاتك المفتوحة\n` +
      `/help — هذه الرسالة\n\n` +
      `🔒 <i>البوت لا يخزن مفاتيحك الخاصة أبداً — أمانك أولويتنا</i>`
    );
    return;
  }

  // ── /balance ─────────────────────────────────────────────────
  if (text === "/balance") {
    const freshUser = await getUser(chatId);
    if (freshUser?.mode === "demo") {
      await send(chatId, `💰 رصيد تجريبي: <b>$${Number(freshUser.demo_balance).toLocaleString()}</b>`);
    } else if (freshUser?.wallet_address) {
      await send(chatId, `👛 محفظة مربوطة: <code>${freshUser.wallet_address.slice(0, 8)}...${freshUser.wallet_address.slice(-6)}</code>\n\n💰 للاطلاع على الرصيد الحقيقي افتح محفظتك.`);
    } else {
      await send(chatId, `👛 اربط محفظتك من القائمة → محفظتي لعرض الرصيد الحقيقي.`);
    }
    return;
  }

  // ── /trades ──────────────────────────────────────────────────
  if (text === "/trades") {
    const trades = await getOpenTrades(chatId);
    if (trades.length === 0) {
      await send(chatId, `📋 لا توجد صفقات مفتوحة حالياً.`);
    } else {
      const lines = trades.map((t, i) =>
        `${i + 1}. ${t.action === "buy" ? "✅" : "🔴"} <b>${t.symbol}</b> — $${t.amount_usd} @ $${fmtPrice(t.price_entry)} <i>(${t.mode})</i>`
      );
      await send(chatId, `📋 <b>صفقاتك المفتوحة (${trades.length})</b>\n\n${lines.join("\n")}`);
    }
    return;
  }

  // ── /stats (admin) ────────────────────────────────────────────
  if (text === "/stats") {
    const { count: usersCount } = await supabase.from("bot_users").select("*", { count: "exact", head: true });
    const { count: tradesCount } = await supabase.from("bot_trades").select("*", { count: "exact", head: true });
    await send(
      chatId,
      `📊 <b>إحصائيات البوت</b>\n\n` +
      `👥 المستخدمون: <b>${usersCount ?? "—"}</b>\n` +
      `💹 الصفقات الكلية: <b>${tradesCount ?? "—"}</b>`
    );
    return;
  }

  // Default
  await send(chatId, `اضغط على /start للبدء أو /menu لفتح القائمة الرئيسية 🌴`);
}

// ── Callback handler ──────────────────────────────────────────────
async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const msgId  = cb.message.message_id;
  const data   = cb.data || "";
  const from   = cb.from ?? {};

  await answer(cb.id);

  let user = await getUser(chatId);
  if (!user) {
    user = await upsertUser(chatId, {
      username:   from.username ?? null,
      first_name: from.first_name ?? null,
    });
  }

  // Log callback
  logMessage(chatId, "in", `[callback] ${data}`).catch(() => {});

  // ── Mode selection ────────────────────────────────────────────
  if (data.startsWith("mode:")) {
    const mode = data.split(":")[1];
    user = await updateUser(chatId, { mode, step: "main" });
    const label = mode === "real" ? "🟢 حقيقي" : "✏️ تجريبي (افتراضي)";
    await edit(
      chatId, msgId,
      `✅ تم اختيار الحساب ${label}\n\n` +
      `<b>القائمة الرئيسية — PalmX Bot</b>\nاختر ما تريد فعله:`,
      kbMain(mode)
    );
    return;
  }

  // ── Main menu ─────────────────────────────────────────────────
  if (data.startsWith("menu:")) {
    const menu = data.split(":")[1];
    const mode = user?.mode ?? "demo";

    if (menu === "main") {
      await edit(chatId, msgId, `<b>القائمة الرئيسية — PalmX Bot</b>\nاختر ما تريد فعله:`, kbMain(mode));
      return;
    }

    if (menu === "spot") {
      await edit(chatId, msgId, `📈 <b>التداول الفوري على Solana</b>\n\nاختر الرمز الذي تريد تداوله:`, kbTokens());
      return;
    }

    if (menu === "wallet") {
      const walletInfo = user?.wallet_address
        ? `✅ <b>محفظة مربوطة:</b>\n<code>${user.wallet_address.slice(0, 8)}...${user.wallet_address.slice(-6)}</code> (${user.wallet_type})\n\n`
        : "";
      await edit(
        chatId, msgId,
        `👛 <b>محفظتي</b>\n\n${walletInfo}اربط محفظة Phantom أو Solflare للتداول الحقيقي.\n\n` +
        `🔒 <i>نحن نخزن مفتاحك العام فقط — لا نلمس مفتاحك الخاص أبداً</i>`,
        kbWallet()
      );
      return;
    }

    if (menu === "open_trades") {
      const trades = await getOpenTrades(chatId);
      let body = `📋 <b>الصفقات المفتوحة</b>\n\n`;
      if (trades.length === 0) {
        body += "لا توجد صفقات مفتوحة حالياً.";
      } else {
        body += trades.map((t, i) =>
          `${i + 1}. ${t.action === "buy" ? "✅" : "🔴"} <b>${t.symbol}</b> $${t.amount_usd} @ $${fmtPrice(t.price_entry)}`
        ).join("\n");
      }
      await edit(chatId, msgId, body, { inline_keyboard: [[{ text: "◀️ رجوع", callback_data: "menu:main" }]] });
      return;
    }

    if (menu === "history") {
      const trades = await getTradeHistory(chatId, 10);
      let body = `📜 <b>سجل الأوامر</b>\n\n`;
      if (trades.length === 0) {
        body += "لا يوجد سجل متاح بعد.";
      } else {
        body += trades.map((t) => {
          const dt  = new Date(t.created_at).toLocaleDateString("ar-IQ");
          const pnl = t.pnl != null ? ` | PNL: ${t.pnl > 0 ? "+" : ""}${t.pnl}$` : "";
          return `• ${t.action === "buy" ? "✅" : "🔴"} ${t.symbol} $${t.amount_usd} <i>${dt}</i>${pnl}`;
        }).join("\n");
      }
      await edit(chatId, msgId, body, { inline_keyboard: [[{ text: "◀️ رجوع", callback_data: "menu:main" }]] });
      return;
    }

    if (menu === "auto") {
      await edit(chatId, msgId, `🤖 <b>التداول الآلي</b>\n\nقريباً: DCA، Grid Trading، Copy Trading.`, {
        inline_keyboard: [[{ text: "◀️ رجوع", callback_data: "menu:main" }]],
      });
      return;
    }

    if (menu === "settings") {
      const feeMode = mode === "demo" ? "لا رسوم (تجريبي)" : "7% من الأرباح فقط";
      const walletStatus = user?.wallet_address
        ? `✅ ${user.wallet_type} — ${user.wallet_address.slice(0, 8)}...`
        : "❌ غير مربوطة";
      await edit(
        chatId, msgId,
        `⚙️ <b>الإعدادات</b>\n\n` +
        `• الوضع: ${mode === "demo" ? "تجريبي ✏️" : "حقيقي 🟢"}\n` +
        `• الرسوم: ${feeMode}\n` +
        `• المحفظة: ${walletStatus}\n` +
        `• اللغة: العربية 🇸🇦\n` +
        `• الشبكة: Solana Mainnet`,
        { inline_keyboard: [[{ text: "◀️ رجوع", callback_data: "menu:main" }]] }
      );
      return;
    }

    if (menu === "switch_mode") {
      await updateUser(chatId, { step: "mode_select" });
      await edit(chatId, msgId, `🔄 اختر نوع الحساب:`, kbStart());
      return;
    }
  }

  // ── Token selection ───────────────────────────────────────────
  if (data.startsWith("token:")) {
    const symbol = data.split(":")[1];
    if (symbol === "search") {
      await updateUser(chatId, { step: "awaiting_contract" });
      await edit(chatId, msgId, `🔍 <b>بحث بعنوان العقد</b>\n\nأرسل عنوان العقد (mint address) على Solana:`, {
        inline_keyboard: [[{ text: "◀️ رجوع", callback_data: "menu:spot" }]],
      });
      return;
    }
    const price    = PRICES[symbol] ?? "—";
    const priceStr = price < 0.001 ? price.toExponential(4) : price.toFixed(price < 1 ? 4 : 2);
    const mode     = user?.mode ?? "demo";
    await edit(
      chatId, msgId,
      `📊 <b>${symbol}/USDC</b>\n\n` +
      `💰 السعر الحالي: <b>$${priceStr}</b>\n` +
      `🔀 أفضل مسار: Jupiter → Raydium\n\n` +
      `⚠️ <i>${mode === "demo" ? "وضع تجريبي — لن تُفتح صفقة حقيقية" : "تأكد من ربط محفظتك قبل التداول"}</i>`,
      kbTradeAction(symbol)
    );
    return;
  }

  // ── Trade actions ─────────────────────────────────────────────
  if (data.startsWith("trade:")) {
    const [, action, symbol] = data.split(":");
    const mode = user?.mode ?? "demo";

    if (action === "buy" || action === "sell") {
      const emoji  = action === "buy" ? "✅" : "🔴";
      const arabic = action === "buy" ? "شراء" : "بيع";

      if (mode === "demo") {
        // Simulate trade immediately in demo mode
        const price  = PRICES[symbol] ?? 1;
        const amount = 100; // default demo amount
        const newBal = Number(user?.demo_balance ?? 10000) - (action === "buy" ? amount : -amount * 0.1);

        await saveTrade(chatId, {
          symbol, action, amount_usd: amount,
          price_entry: price, mode: "demo", status: "filled",
        });
        await updateUser(chatId, { demo_balance: Math.max(0, newBal) });
        cache.delete(chatId);

        await edit(
          chatId, msgId,
          `${emoji} <b>تم تنفيذ أمر ${arabic} ${symbol} (تجريبي)</b>\n\n` +
          `• الكمية: <b>$${amount}</b> بسعر <b>$${fmtPrice(price)}</b>\n` +
          `• الرصيد المتبقي: <b>$${Math.max(0, newBal).toLocaleString()}</b>\n\n` +
          `<i>ملاحظة: هذه صفقة تجريبية فقط</i>`,
          { inline_keyboard: [[{ text: "◀️ رجوع للقائمة", callback_data: "menu:main" }]] }
        );
      } else {
        // Real mode — need wallet
        if (!user?.wallet_address) {
          await edit(
            chatId, msgId,
            `👛 <b>محفظة غير مربوطة</b>\n\nاربط محفظتك من قسم "محفظتي" لإتمام الأمر.`,
            { inline_keyboard: [
              [{ text: "👛 ربط محفظة", callback_data: "menu:wallet" }],
              [{ text: "◀️ رجوع",      callback_data: `token:${symbol}` }],
            ]}
          );
        } else {
          await edit(
            chatId, msgId,
            `${emoji} <b>أمر ${arabic} ${symbol} — حقيقي</b>\n\n` +
            `👛 محفظة: <code>${user.wallet_address.slice(0, 8)}...</code>\n\n` +
            `<i>ميزة التداول الحقيقي قيد الإطلاق — ستُتاح قريباً</i>`,
            { inline_keyboard: [[{ text: "◀️ رجوع", callback_data: `token:${symbol}` }]] }
          );
        }
      }
      return;
    }

    if (action === "tpsl") {
      await updateUser(chatId, { step: `awaiting_tpsl:${symbol}` });
      await edit(chatId, msgId, `🎯 <b>وقف الخسارة / جني الأرباح — ${symbol}</b>\n\nأرسل بالصيغة:\n<code>TP:200 SL:150</code>`, {
        inline_keyboard: [[{ text: "◀️ رجوع", callback_data: `token:${symbol}` }]],
      });
      return;
    }
  }

  // ── Wallet connect ────────────────────────────────────────────
  if (data.startsWith("wallet:")) {
    const walletType = data.split(":")[1];
    const deepLink   = walletType === "phantom"
      ? `https://phantom.app/ul/v1/connect?app_url=https://palmx.io&cluster=mainnet-beta`
      : `https://solflare.com/ul/v1/connect?app_url=https://palmx.io&cluster=mainnet-beta`;

    // In a real integration, a connect URL with a session key would be generated here.
    // For now we store a placeholder so UX shows "wallet linked".
    await updateUser(chatId, {
      wallet_type: walletType,
      wallet_address: `PENDING_${walletType.toUpperCase()}_${chatId}`,
    });

    await edit(
      chatId, msgId,
      `👛 <b>ربط محفظة ${walletType === "phantom" ? "Phantom" : "Solflare"}</b>\n\n` +
      `اضغط الرابط أدناه لفتح المحفظة وتأكيد الربط:\n` +
      `<a href="${deepLink}">🔗 اضغط هنا لربط المحفظة</a>\n\n` +
      `🔒 <i>سنخزن مفتاحك العام فقط — مفتاحك الخاص يبقى في محفظتك</i>`,
      { inline_keyboard: [[{ text: "◀️ رجوع", callback_data: "menu:wallet" }]] }
    );
    return;
  }
}

// ── Main polling loop ─────────────────────────────────────────────
async function getMe() {
  const r = await apiCall("getMe");
  return r.result;
}

async function poll() {
  console.log("🤖 PalmX Bot — جاري الاتصال بـ Telegram API...");

  const me = await getMe();
  if (!me) {
    console.error("❌ فشل الاتصال — تحقق من TELEGRAM_BOT_TOKEN");
    process.exit(1);
  }
  console.log(`✅ البوت متصل: @${me.username} (${me.first_name})`);

  // Test Supabase connection
  const { error: dbErr } = await supabase.from("bot_users").select("id").limit(1);
  if (dbErr) {
    console.error("❌ فشل الاتصال بـ Supabase:", dbErr.message);
    process.exit(1);
  }
  console.log("✅ Supabase متصل بنجاح");
  console.log(`📡 يستمع للرسائل... اضغط Ctrl+C للإيقاف\n`);

  // Remove any existing webhook so polling works
  await apiCall("deleteWebhook", { drop_pending_updates: false });

  let offset = 0;
  let errorCount = 0;

  while (true) {
    try {
      const result = await apiCall("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      });

      errorCount = 0; // reset on success

      if (!result.ok) {
        if (result.description?.includes("Conflict")) {
          console.log("⏳ تعارض مع جلسة أخرى — انتظر 35 ثانية...");
          await sleep(35000);
        } else {
          console.error("❌ خطأ Telegram API:", result.description);
          await sleep(5000);
        }
        continue;
      }

      for (const update of result.result ?? []) {
        offset = update.update_id + 1;

        if (update.message) {
          const uname = update.message.from?.username || update.message.from?.first_name || "?";
          const txt   = update.message.text || "(media)";
          console.log(`📨 [${ts()}] @${uname}: ${txt}`);
          handleMessage(update.message).catch(console.error);
        }

        if (update.callback_query) {
          const uname = update.callback_query.from?.username || "?";
          console.log(`🔘 [${ts()}] @${uname}: ${update.callback_query.data}`);
          handleCallback(update.callback_query).catch(console.error);
        }
      }
    } catch (err) {
      errorCount++;
      console.error(`⚠️  خطأ (${errorCount}):`, err.message);

      // Exponential back-off capped at 60s
      const wait = Math.min(2 ** errorCount * 1000, 60000);
      await sleep(wait);
    }
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function ts()      { return new Date().toLocaleTimeString("ar-IQ"); }

// ── Graceful shutdown ──────────────────────────────────────────────
process.on("SIGTERM", () => { console.log("🛑 SIGTERM — إيقاف البوت بأمان"); process.exit(0); });
process.on("SIGINT",  () => { console.log("🛑 SIGINT — إيقاف البوت"); process.exit(0); });

poll();
