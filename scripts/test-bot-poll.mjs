/**
 * scripts/test-bot-poll.mjs
 * ─────────────────────────────────────────────────────────────────
 * Local polling tester for @plamxbot
 * Run with:  node scripts/test-bot-poll.mjs
 *
 * No webhook / ngrok needed.
 * Uses getUpdates long-polling directly from Telegram API.
 * ─────────────────────────────────────────────────────────────────
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error("Missing env TELEGRAM_BOT_TOKEN");
  process.exit(1);
}
const API = `https://api.telegram.org/bot${TOKEN}`;

// ── In-memory session ────────────────────────────────────────────
const sessions = new Map(); // chatId → { mode, step, demoBalance }

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { mode: null, step: "start", demoBalance: 10000 });
  }
  return sessions.get(chatId);
}

// ── Telegram API helpers ──────────────────────────────────────────
async function apiCall(method, body = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
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
function kbStart() {
  return {
    inline_keyboard: [
      [
        { text: "🟢 حساب حقيقي", callback_data: "mode:real" },
        { text: "✏️ حساب تجريبي", callback_data: "mode:demo" },
      ],
    ],
  };
}

function kbMain(mode) {
  const modeLabel = mode === "real" ? "🟢 حقيقي" : "✏️ تجريبي";
  return {
    inline_keyboard: [
      [
        { text: "📈 تداول فوري", callback_data: "menu:spot" },
        { text: "👛 محفظتي", callback_data: "menu:wallet" },
      ],
      [
        { text: "📋 صفقات مفتوحة", callback_data: "menu:open_trades" },
        { text: "🤖 تداول آلي", callback_data: "menu:auto" },
      ],
      [
        { text: "📜 سجل الأوامر", callback_data: "menu:history" },
        { text: "⚙️ الإعدادات", callback_data: "menu:settings" },
      ],
      [{ text: `🔄 الوضع الحالي: ${modeLabel}`, callback_data: "menu:switch_mode" }],
    ],
  };
}

function kbTokens() {
  return {
    inline_keyboard: [
      [
        { text: "◎ SOL", callback_data: "token:SOL" },
        { text: "💵 USDC", callback_data: "token:USDC" },
        { text: "💎 RAY", callback_data: "token:RAY" },
      ],
      [
        { text: "🌊 ORCA", callback_data: "token:ORCA" },
        { text: "🐕 BONK", callback_data: "token:BONK" },
        { text: "🎩 WIF", callback_data: "token:WIF" },
      ],
      [
        { text: "⚡ JUP", callback_data: "token:JUP" },
        { text: "🔍 بحث بالعقد", callback_data: "token:search" },
      ],
      [{ text: "◀️ رجوع", callback_data: "menu:main" }],
    ],
  };
}

function kbTradeAction(symbol) {
  return {
    inline_keyboard: [
      [
        { text: `✅ شراء ${symbol}`, callback_data: `trade:buy:${symbol}` },
        { text: `🔴 بيع ${symbol}`, callback_data: `trade:sell:${symbol}` },
      ],
      [{ text: "🎯 وقف الخسارة / جني الأرباح", callback_data: `trade:tpsl:${symbol}` }],
      [{ text: "◀️ رجوع", callback_data: "menu:spot" }],
    ],
  };
}

function kbWallet() {
  return {
    inline_keyboard: [
      [{ text: "👻 ربط محفظة Phantom", callback_data: "wallet:phantom" }],
      [{ text: "🔮 ربط محفظة Solflare", callback_data: "wallet:solflare" }],
      [{ text: "◀️ رجوع", callback_data: "menu:main" }],
    ],
  };
}

// ── Token prices (mock) ───────────────────────────────────────────
const PRICES = {
  SOL:  178.92,
  USDC: 1.000,
  USDT: 1.000,
  RAY:  2.84,
  ORCA: 3.21,
  BONK: 0.0000312,
  WIF:  2.18,
  JUP:  0.94,
};

// ── Message handler ───────────────────────────────────────────────
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const username = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name || "مستخدم";
  const session = getSession(chatId);

  if (text === "/start" || text === "/menu") {
    session.step = "mode_select";
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

  if (text === "/balance") {
    const bal = session.mode === "demo"
      ? `💰 رصيد تجريبي: <b>$${session.demoBalance.toLocaleString()}</b>`
      : `💰 اربط محفظتك لعرض الرصيد`;
    await send(chatId, bal);
    return;
  }

  if (text === "/trades") {
    await send(chatId, "📋 لا توجد صفقات مفتوحة حالياً.");
    return;
  }

  // Default
  await send(
    chatId,
    `اضغط على /start للبدء أو /menu لفتح القائمة الرئيسية 🌴`
  );
}

// ── Callback handler ──────────────────────────────────────────────
async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const msgId = cb.message.message_id;
  const data = cb.data || "";
  const session = getSession(chatId);

  await answer(cb.id);

  // Mode selection
  if (data.startsWith("mode:")) {
    const mode = data.split(":")[1];
    session.mode = mode;
    session.step = "main";
    const modeLabel = mode === "real" ? "🟢 حقيقي" : "✏️ تجريبي (افتراضي)";
    await edit(
      chatId, msgId,
      `✅ تم اختيار الحساب ${modeLabel}\n\n` +
      `<b>القائمة الرئيسية — PalmX Bot</b>\n` +
      `اختر ما تريد فعله:`,
      kbMain(mode)
    );
    return;
  }

  // Main menu
  if (data.startsWith("menu:")) {
    const menu = data.split(":")[1];

    if (menu === "main") {
      await edit(
        chatId, msgId,
        `<b>القائمة الرئيسية — PalmX Bot</b>\nاختر ما تريد فعله:`,
        kbMain(session.mode || "demo")
      );
      return;
    }

    if (menu === "spot") {
      await edit(
        chatId, msgId,
        `📈 <b>التداول الفوري على Solana</b>\n\nاختر الرمز الذي تريد تداوله:`,
        kbTokens()
      );
      return;
    }

    if (menu === "wallet") {
      await edit(
        chatId, msgId,
        `👛 <b>محفظتي</b>\n\nاربط محفظة Phantom أو Solflare للتداول الحقيقي.\n\n` +
        `🔒 <i>نحن نخزن مفتاحك العام فقط — لا نلمس مفتاحك الخاص أبداً</i>`,
        kbWallet()
      );
      return;
    }

    if (menu === "open_trades") {
      await edit(
        chatId, msgId,
        `📋 <b>الصفقات المفتوحة</b>\n\nلا توجد صفقات مفتوحة حالياً.`,
        { inline_keyboard: [[{ text: "◀️ رجوع", callback_data: "menu:main" }]] }
      );
      return;
    }

    if (menu === "history") {
      await edit(
        chatId, msgId,
        `📜 <b>سجل الأوامر</b>\n\nلا يوجد سجل متاح بعد.`,
        { inline_keyboard: [[{ text: "◀️ رجوع", callback_data: "menu:main" }]] }
      );
      return;
    }

    if (menu === "auto") {
      await edit(
        chatId, msgId,
        `🤖 <b>التداول الآلي</b>\n\nقريباً: DCA، Grid Trading، Copy Trading.`,
        { inline_keyboard: [[{ text: "◀️ رجوع", callback_data: "menu:main" }]] }
      );
      return;
    }

    if (menu === "settings") {
      const feeMode = session.mode === "demo" ? "لا رسوم (تجريبي)" : "7% من الأرباح فقط";
      await edit(
        chatId, msgId,
        `⚙️ <b>الإعدادات</b>\n\n` +
        `• الوضع: ${session.mode === "demo" ? "تجريبي" : "حقيقي"}\n` +
        `• الرسوم: ${feeMode}\n` +
        `• اللغة: العربية 🇸🇦\n` +
        `• الشبكة: Solana Mainnet`,
        { inline_keyboard: [[{ text: "◀️ رجوع", callback_data: "menu:main" }]] }
      );
      return;
    }

    if (menu === "switch_mode") {
      session.mode = null;
      session.step = "mode_select";
      await edit(
        chatId, msgId,
        `🔄 اختر نوع الحساب:`,
        kbStart()
      );
      return;
    }
  }

  // Token selection
  if (data.startsWith("token:")) {
    const symbol = data.split(":")[1];
    if (symbol === "search") {
      await edit(
        chatId, msgId,
        `🔍 <b>بحث بعنوان العقد</b>\n\nأرسل عنوان العقد (mint address) على Solana:`,
        { inline_keyboard: [[{ text: "◀️ رجوع", callback_data: "menu:spot" }]] }
      );
      return;
    }
    const price = PRICES[symbol] ?? "—";
    const priceStr = price < 0.001 ? price.toExponential(4) : price.toFixed(price < 1 ? 4 : 2);
    await edit(
      chatId, msgId,
      `📊 <b>${symbol}/USDC</b>\n\n` +
      `💰 السعر الحالي: <b>$${priceStr}</b>\n` +
      `🔀 أفضل مسار: Jupiter → Raydium\n\n` +
      `⚠️ <i>${session.mode === "demo" ? "وضع تجريبي — لن تُفتح صفقة حقيقية" : "تأكد من ربط محفظتك قبل التداول"}</i>`,
      kbTradeAction(symbol)
    );
    return;
  }

  // Trade actions
  if (data.startsWith("trade:")) {
    const [, action, symbol] = data.split(":");
    if (action === "buy" || action === "sell") {
      const emoji = action === "buy" ? "✅" : "🔴";
      const arabic = action === "buy" ? "شراء" : "بيع";
      await edit(
        chatId, msgId,
        `${emoji} <b>أمر ${arabic} ${symbol}</b>\n\n` +
        (session.mode === "demo"
          ? `📝 <i>وضع تجريبي — أرسل المبلغ بالدولار الذي تريد تداوله (مثال: 100)</i>`
          : `👛 <i>اربط محفظتك أولاً من قسم "محفظتي" لإتمام الأمر</i>`),
        { inline_keyboard: [[{ text: "◀️ رجوع", callback_data: `token:${symbol}` }]] }
      );
      return;
    }
    if (action === "tpsl") {
      await edit(
        chatId, msgId,
        `🎯 <b>وقف الخسارة / جني الأرباح — ${symbol}</b>\n\nأرسل بالصيغة:\n<code>TP:200 SL:150</code>`,
        { inline_keyboard: [[{ text: "◀️ رجوع", callback_data: `token:${symbol}` }]] }
      );
      return;
    }
  }

  // Wallet connect
  if (data.startsWith("wallet:")) {
    const wallet = data.split(":")[1];
    const deep = wallet === "phantom"
      ? `https://phantom.app/ul/v1/connect?app_url=https://palmx.io&cluster=mainnet-beta`
      : `https://solflare.com/ul/v1/connect?app_url=https://palmx.io&cluster=mainnet-beta`;
    await edit(
      chatId, msgId,
      `👛 <b>ربط محفظة ${wallet === "phantom" ? "Phantom" : "Solflare"}</b>\n\n` +
      `اضغط الرابط أدناه لفتح المحفظة وتأكيد الربط:\n` +
      `<a href="${deep}">🔗 اضغط هنا لربط المحفظة</a>\n\n` +
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
  console.log("🤖 جاري الاتصال بـ Telegram API...");
  const me = await getMe();
  if (!me) {
    console.error("❌ فشل الاتصال — تحقق من التوكن");
    process.exit(1);
  }
  console.log(`✅ البوت متصل: @${me.username} (${me.first_name})`);
  console.log("📡 جاري الاستماع للرسائل... (اضغط Ctrl+C للإيقاف)\n");

  // Delete any existing webhook so getUpdates works
  await apiCall("deleteWebhook", { drop_pending_updates: false });

  let offset = 0;
  while (true) {
    try {
      const result = await apiCall("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      });

      if (!result.ok) {
        if (result.description?.includes("Conflict")) {
          console.log("⏳ تعارض مع جلسة أخرى — انتظر 35 ثانية ثم يستأنف...");
          await new Promise((r) => setTimeout(r, 35000));
        } else {
          console.error("❌ خطأ في API:", result.description);
          await new Promise((r) => setTimeout(r, 3000));
        }
        continue;
      }

      for (const update of result.result ?? []) {
        offset = update.update_id + 1;

        if (update.message) {
          const from = update.message.from?.username || update.message.from?.first_name || "?";
          const text = update.message.text || "(media)";
          console.log(`📨 [${new Date().toLocaleTimeString("ar-IQ")}] @${from}: ${text}`);
          await handleMessage(update.message).catch(console.error);
        }

        if (update.callback_query) {
          const from = update.callback_query.from?.username || "?";
          console.log(`🔘 [${new Date().toLocaleTimeString("ar-IQ")}] @${from}: ${update.callback_query.data}`);
          await handleCallback(update.callback_query).catch(console.error);
        }
      }
    } catch (err) {
      if (err.message?.includes("Conflict") || result?.description?.includes("Conflict")) {
        console.log("⏳ تعارض مع جلسة أخرى — انتظر 35 ثانية...");
        await new Promise((r) => setTimeout(r, 35000));
      } else {
        console.error("⚠️ خطأ في الاتصال:", err.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}

poll();
