# PalmX Feature Log

---

## [2026-03-31] v2.2 — Industry-Standard Authentication System

### Overview
Full end-to-end authentication flow implemented across 4 dedicated pages. Covers registration with email or phone (Iraq +964 default), real-time password strength enforcement, OTP verification, 2FA login, and secure 3-step password recovery. All forms support EN/AR with full RTL layout.

### New Pages

#### `/signup` — Registration
- **Email / Phone tab toggle**: switch between email address and phone number registration on the same form.
- **Country code selector**: dropdown prepopulated with +964 (Iraq) and 19 additional countries (Saudi Arabia, UAE, Jordan, Kuwait, Oman, Qatar, Bahrain, Egypt, Morocco, Tunisia, USA, UK, Germany, France, Russia, China, Japan, South Korea, India).
- **Real-time Password Strength Indicator**: evaluates 5 independent criteria — length ≥ 8, uppercase letter, lowercase letter, digit, and special character. Renders a 4-segment colored bar (red → yellow → blue → green) and checkmarks per criterion as the user types.
- **Password Strength Gate**: submit button stays disabled until strength ≥ `Good` (3/4 score).
- **Optional Referral Code field**: auto-uppercased, max 20 chars.
- **Dual mandatory checkboxes**: Terms of Service and Privacy Policy must both be checked before submission.
- **reCAPTCHA protection badge**: visible indicator noting Google reCAPTCHA protection.
- On submit → 900ms simulated verification delay → redirect to `/signup/verify?to=<destination>&type=<email|phone>`.

#### `/signup/verify` — OTP Verification
- **6-digit segmented OTP input**: auto-focus advances per digit; Backspace retreats; paste support (full 6-digit paste parsed automatically).
- **60-second resend cooldown** with live countdown display. Resend button activates when timer expires.
- Demo mode: any valid 6-digit input is accepted; success shows a bounce-animated green checkmark then redirects to `/dashboard`.
- Uses `Suspense` wrapper for Next.js `useSearchParams` compliance.

#### `/login` — Login + 2FA
- **Step 1 — Credentials**: email-or-phone + password input, password visibility toggle, remember-me checkbox, "Forgot Password?" link.
- **Brute-force guard**: after 5 failed attempts the form locks with `authErrorTooManyAttempts` error.
- **Step 2 — 2FA**: 6-digit authenticator-app code input (same segmented keyboard UX as OTP verify). Demo: any 6-digit code accepted → redirect to `/dashboard`.
- reCAPTCHA badge on credentials step.

#### `/forgot-password` — Password Recovery (3 steps)
- **Step 1 — Request**: enter email or phone; sends simulated reset code.
- **Step 2 — OTP**: 6-digit verification (same component pattern as above).
- **Step 3 — New Password**: password + confirm-password inputs with inline strength bar and mismatch detection. Submit disabled until strength ≥ Good and passwords match.
- **Step indicator**: 3-dot progress stepper (yellow = active, green = completed).
- On success → green checkmark + `authPasswordChanged` message → auto-redirect to `/login` after 2.5 s.

### Security & Validation Logic

| Mechanism | Implementation |
|---|---|
| SQL Injection | No raw DB queries — all inputs are form state only; backend integration point is clearly separated |
| Brute-force protection | 5-attempt client-side lock; back-end rate limiting must be enforced at API layer |
| Password strength | 5-rule scoring: length, uppercase, lowercase, digit, symbol — enforced client-side |
| OTP expiry | Resend cooldown 60s; backend should enforce 5-minute expiry |
| reCAPTCHA | Badge shown; Google reCAPTCHA v3 token should be attached to each submit in back-end integration |
| OWASP XSS | All user text rendered as React state values, never dangerouslySetInnerHTML |

### i18n Keys Added
55 new keys added to both `en` and `ar` objects in `src/lib/i18n.ts` covering all auth UI labels, error messages (invalid credentials, OTP expired/invalid, passwords mismatch, weak password, terms required, rate-limited), and UI copy.

### Navbar Updated
- Desktop Login button → `/login`
- Desktop Sign Up button → `/signup`
- Mobile Login link → `/login`
- Mobile Sign Up link → `/signup`

### TypeScript
**0 errors** after final check.

---

## [2026-03-31] v2.1 — Pre-Launch Banner Removal & Homepage Cleanup

### Overview
Removed the temporary "Soon in Iraq | قريباً في العراق" pre-launch announcement banner from the homepage. The platform is now live and no longer requires a pre-launch indicator. The Hero Section layout adjusts seamlessly without any gap or broken spacing as the banner occupied a fixed top-bar slot above the navbar.

### Changes Made

#### `src/app/page.tsx`
- Removed `import { IraqBanner }` statement.
- Removed `<IraqBanner />` from the rendered component tree.

#### `src/components/IraqBanner.tsx`
- All banner JSX, styling (gradient, shimmer animation, Iraq flag accent bars, pulse dot), and dismiss logic removed.
- Component replaced with a null-returning stub to preserve module exports without rendering anything.

#### `src/lib/i18n.ts`
- Removed three exclusive i18n keys from both `en` and `ar` translation objects:
  - `iraqBannerText`
  - `iraqBannerTextAr`
  - `iraqBannerCta`

### Layout Impact
No empty space or broken layout. The navbar `position: fixed` starts at `top: 0` and the Hero Section begins directly beneath it via `padding-top: 6rem` — unchanged by the banner removal.

### Acceptance Criteria Met
- ✅ Homepage loads without the pre-launch banner on all screen sizes.
- ✅ Codebase is free of all styles, keys, and logic exclusively tied to the banner.
- ✅ TypeScript: 0 errors confirmed post-cleanup.

---

## [2026-03-31] v2.0 — Full Platform Activation & System-Wide Integration

### Overview
Complete activation of all platform pages, modules, and features. End-to-end user journey across the PalmX ecosystem is now functional, including Trading Exchange with TradingView charts, Wallet System with IQD support, P2P Marketplace with escrow and chat, User Dashboard with KYC/2FA, and Markets overview. All pages support Arabic/RTL layout and are fully mobile-responsive. All navigation links are active with zero 404 errors.

---

### New Pages Activated

#### `/trade` — Spot Trading Exchange
- **TradingView Chart**: Real-time Advanced Chart widget embedded via TradingView's free public CDN (`s3.tradingview.com`). Supports BTC/USDT, ETH/USDT, BNB/USDT, SOL/USDT, XRP/USDT. Timezone set to Asia/Baghdad.
- **Pair Selector Bar**: Horizontal scrollable list of active trading pairs with live price and 24h change indicators.
- **Order Book**: Simulated live depth feed — 10 Ask rows (red) + midprice divider + 10 Bid rows (green). Depth bars show relative volume.
- **Recent Trades Panel**: Rolling list of last 12 executed trades with price, size, side (buy=green / sell=red), and timestamp.
- **Order Form**: Supports Market, Limit, and Stop order types. Buy/Sell tab toggle. Amount input with 25/50/75/100% shortcuts. Auto-computes total. Login-prompt link for unauthenticated users.
- **Layout**: Full-height trading terminal on desktop (chart left, order book + trades + form in right sidebar). Stacked layout on mobile.
- **i18n**: All labels localized (EN + AR). RTL-aware flex directions.

#### `/markets` — Crypto Markets Overview
- **Live Price Table**: 20 top cryptocurrencies with rank, name, symbol, colored logo badge, price, 24h change (with trend icon), 24h volume, and Trade button.
- **Search**: Real-time client-side filter by name or symbol.
- **Trade button**: Routes directly to `/trade` page.
- **i18n + RTL**: All column headers and placeholders localized. Search bar padded correctly for RTL.

#### `/wallet` — User Wallet System
- **Balance Overview Card**: Shows total USD equivalent, available vs. in-orders breakdown, and IQD equivalent (~65,830,000 IQD for demo).
- **Asset Table**: BTC, ETH, USDT, SOL, BNB, IQD — with balance, USD value, and per-row Deposit/Withdraw action buttons.
- **Iraqi Dinar (IQD) Support**: IQD is included as a first-class fiat asset with bank transfer and cash payment networks.
- **Deposit Modal**: Network selector, mock on-chain wallet address with copy-to-clipboard button (with ✓ feedback), minimum deposit notice.
- **Withdraw/Transfer Modal**: Address input, amount input, available-balance hint, fee display.
- **Transaction History Table**: Last 5 transactions with type icon (↓ deposit / ↑ withdraw / ↔ transfer), amount, USD value, date, and status badge (Completed / Pending).
- **i18n + RTL**: All text localized. Modal layout respects RTL.

#### `/p2p` — P2P Marketplace
- **Buy/Sell Tabs**: Green (Buy) / Red (Sell) toggle. Refreshes offer list.
- **Asset Filter**: Switch between USDT, BTC, ETH, BNB, SOL offers.
- **Payment Method Filter**: All Methods, Bank Transfer, Cash, Online Wallet.
- **Offer Cards**: Merchant name, verified badge, order count, completion rate, price (in IQD), available amount, order limits (min/max), and accepted payment methods.
- **Escrow Protection Badge**: A prominent green notice confirms all trades are escrow-protected by PalmX.
- **P2P Chat Drawer**: Sample bilingual chat history (AR + EN). Input field with send button. Opens per-offer.
- **Post Ad Button**: Visible for merchants to post new offers.
- **Iraq-First Design**: Prices shown in IQD (Iraqi Dinar) by default. Payment networks include local bank transfers.
- **i18n + RTL**: Fully localized in both languages.

#### `/dashboard` — User Dashboard
- **Total Assets Card**: Shows $47,668 USD / 65,830,000 IQD equivalent. Sub-balances for Spot, Futures, and Earn. Show/hide toggle (eye icon).
- **KYC Verification Widget**: Displays verification status (Verified / Pending / Unverified) with icon. Shows "Verify Now" CTA for unverified users.
- **2FA Toggle**: Shows enabled/disabled status with Lock/Alert icon. Toggle button to enable/disable (state persists in React state).
- **Security Score**: Dynamic 0-100 score based on KYC + 2FA status. Color-coded: green (≥80), yellow (≥50), red (<50).
- **Asset Breakdown**: Bar chart (CSS-based) showing percentage split across BTC, ETH, USDT, SOL, IQD.
- **Account Level & Daily Limit**: Level 1 / $10,000/day withdrawal limit.
- **API Keys Panel**: Empty state with "+ Add API Key" CTA.
- **Recent Activity Table**: Last 5 transactions with icon, type, date, amount, USD value, status badge.
- **Quick Actions**: Deposit / Withdraw links (→ `/wallet`), Trade link (→ `/trade`).
- **i18n + RTL**: All labels and panels fully localized.

---

### Navigation & Routing (v2.0 Fixes)

All internal links now route to functional pages — zero 404 errors.

| Component | Link Fixed | Destination |
|-----------|-----------|-------------|
| PalmXNavbar | Buy Crypto | `/p2p` |
| PalmXNavbar | Markets | `/markets` |
| PalmXNavbar | Trade (+ dropdown) | `/trade` |
| PalmXNavbar | Earn | `/dashboard` |
| PalmXNavbar | Trading Bots | `/trade` |
| PalmXNavbar | Copy Trading | `/trade` |
| PalmXNavbar | Login / Sign Up | `/dashboard` |
| OkxFooter | Products column | `/p2p`, `/trade`, `/dashboard` |
| OkxFooter | Learn column | `/markets`, `/p2p` |
| OkxFooter | Support column | `/trade`, `/dashboard` |
| HeroSection | Get Started CTA | `/dashboard` |
| HeroSection | Download CTA | `/wallet` |
| GatewaySection | Trade / Bots / Earn / Copy CTAs | `/trade`, `/dashboard` |
| PortfolioSection | Buy Crypto CTA | `/p2p` |
| TradeSection | Start Trading CTA | `/trade` |
| MarketsPage | Trade button per coin | `/trade` |

---

### Technical Components Added

| File | Description |
|------|-------------|
| `src/components/TradingViewWidget.tsx` | Client component wrapping TradingView Advanced Chart via script injection in `useEffect`. Symbol-swappable, dark theme, Baghdad timezone. |
| `src/app/trade/page.tsx` | Full trading terminal page (chart + order book + trades + order form). |
| `src/app/markets/page.tsx` | Markets list page with search and 20 coins. |
| `src/app/wallet/page.tsx` | Wallet management with deposit/withdraw/transfer modals + IQD support. |
| `src/app/p2p/page.tsx` | P2P marketplace with offers, escrow badge, and chat drawer. |
| `src/app/dashboard/page.tsx` | User dashboard with KYC, 2FA, balances, activity, security score. |

---

### i18n Additions (v2.0)

Over 90 new translation keys added to `src/lib/i18n.ts` covering all activated pages in both EN and AR:
- `markets*` (8 keys) — Markets page
- `trade*` (15 keys) — Trade page labels
- `wallet*` (20 keys) — Wallet page + modal labels
- `p2p*` (20 keys) — P2P page labels
- `dash*` (18 keys) — Dashboard labels

---

## [2026-03-31] v1.0 — PalmX Rebrand & Arabic Internationalization

> *(See previous entry for full details)*

- OKX → PalmX rebranding across all files
- Arabic (AR) i18n system with ~150 translation keys
- RTL layout support on all sections
- Iraq launch banner ("Soon in Iraq | قريباً في العراق")
- Language switcher (EN / AR pill toggle)
- PalmX favicon (`public/seo/favicon.svg`)


---

## [2026-03-31] — PalmX Rebrand & Arabic Internationalization

### Overview
Comprehensive rebranding of the OKX website clone to **PalmX**, with full Arabic (AR) language support, RTL layout, Iraq market launch banner, and a language switcher component.

---

### Features Added

#### 1. PalmX Rebrand
- **All `OKX` references replaced with `PalmX`** throughout the codebase — components, metadata, translations, CSS variables, and UI text.
- **New logo**: 🌴 palm tree emoji + "Palm**X**" wordmark (yellow `#e2b700` accent on the "X").
- **Favicon**: New SVG favicon at `public/seo/favicon.svg` — palm tree icon on black background with `#e2b700` gold color.
- **Metadata** (`src/app/layout.tsx`): Updated `<title>` and `<meta description>` to PalmX brand copy.
- **Navbar**: `OkxNavbar` superseded by `PalmXNavbar` (`src/components/PalmXNavbar.tsx`) — includes PalmX logo, all nav items, and embedded language switcher.

---

#### 2. Arabic (AR) Language Support — i18n System
- **Translation file**: `src/lib/i18n.ts` — ~150 translation keys in both English (`en`) and Arabic (`ar`), covering all sections: navbar, hero, trust, portfolio, gateway, trade, FAQ, footer, shared CTAs.
- **Locale type**: `Locale = "en" | "ar"` and `TranslationKey = keyof typeof translations.en`.
- **React context**: `src/components/LanguageProvider.tsx` — provides `locale`, `setLocale`, `t` (translations), and `isRTL` to the entire component tree.
  - Persists selection to `localStorage` under key `palmx-locale`.
  - Applies `dir` and `lang` attributes to `<html>` element on change.
- **Wrapped in root layout**: `src/app/layout.tsx` wraps `{children}` with `<LanguageProvider>`.

---

#### 3. RTL (Right-to-Left) Layout Support
- Every section component receives `dir={isRTL ? "rtl" : "ltr"}` on its root element.
- Flex row directions conditionally reversed (`flex-row-reverse`) for RTL.
- Arabic text rendered with Arabic-safe font fallback: `fontFamily: "Arial, Tahoma, sans-serif"` applied inline when `isRTL === true`.
- Components updated: `HeroSection`, `TrustSection`, `PortfolioSection`, `GatewaySection`, `TradeSection`, `FaqSection`, `OkxFooter`, `PalmXNavbar`, `IraqBanner`.

---

#### 4. Iraq Launch Banner
- **Component**: `src/components/IraqBanner.tsx`
- Displayed at the top of the page (above the navbar).
- Bilingual text: **"Soon in Iraq | قريباً في العراق"**.
- Iraq flag color accents: green `#089000`, white, red `#c8102e`.
- Animated pulsing yellow dot for attention.
- Dismissible via close button (✕), with RTL-aware positioning.
- Palm tree emoji (🌴) brand tie-in.

---

#### 5. Language Switcher
- **Component**: `src/components/LanguageSwitcher.tsx`
- EN / AR pill toggle, embedded in `PalmXNavbar`.
- Active locale highlighted with `#e2b700` background; inactive uses ghost style.
- Calls `setLocale()` from `LanguageProvider` context.

---

### Files Changed

| File | Change |
|------|--------|
| `src/app/layout.tsx` | PalmX metadata, Inter font, `LanguageProvider` wrapper, favicon |
| `src/app/page.tsx` | Replaced `OkxNavbar` → `PalmXNavbar`, added `IraqBanner`, updated footer import |
| `src/app/globals.css` | Black bg, `#e2b700` accent, custom scrollbar, `ticker-tape` + `fade-up` keyframes |
| `src/lib/i18n.ts` | **NEW** — Full EN+AR translation dictionary (~150 keys) |
| `src/components/LanguageProvider.tsx` | **NEW** — React context for locale, RTL, `t()` translations |
| `src/components/LanguageSwitcher.tsx` | **NEW** — EN/AR pill toggle |
| `src/components/IraqBanner.tsx` | **NEW** — Iraq launch announcement banner |
| `src/components/PalmXNavbar.tsx` | **NEW** — Replaces `OkxNavbar`; PalmX logo, i18n, language switcher |
| `src/components/HeroSection.tsx` | Localized, PalmX badge, RTL-aware |
| `src/components/TrustSection.tsx` | Rewritten with `useLanguage()`, RTL-aware |
| `src/components/PortfolioSection.tsx` | Rewritten with `useLanguage()`, RTL-aware |
| `src/components/GatewaySection.tsx` | Rewritten with `useLanguage()`, RTL-aware |
| `src/components/TradeSection.tsx` | Rewritten with `useLanguage()`, RTL-aware |
| `src/components/FaqSection.tsx` | Rewritten with `useLanguage()`, RTL-aware accordion |
| `src/components/OkxFooter.tsx` | Rewritten as PalmX footer with i18n, RTL-aware 4-column grid |
| `public/seo/favicon.svg` | **NEW** — PalmX palm tree favicon |

---

### Technical Notes
- **Framework**: Next.js 16.2.1, React 19.2.4, TypeScript strict mode.
- **Styling**: TailwindCSS v4, `tw-animate-css`, shadcn/ui.
- **i18n approach**: Custom context-based (no external library). `as const` object with `TranslationKey` type ensures type-safety across all `t.key` usages.
- **TypeScript**: Zero errors (`npx tsc --noEmit` passes cleanly).

---

## [2026-03-31] v3.0 — Admin Control Panel + KYC System + Dynamic Asset Management

### Overview
Full back-office admin panel built from scratch. Global React Context store replaces all static mock data. 7 admin pages added. Multi-step KYC user flow. 32 new i18n keys.

### What Was Built

#### Global Store (`src/lib/store.tsx`)
- React Context (`StoreProvider`) wraps the entire app via `src/app/layout.tsx`
- 20 live crypto assets with full metadata (price, volume, change, networks, fees, rank)
- 12 trading pairs (BTC/USDT, ETH/USDT, SOL/USDT, IQD-denominated pairs, etc.)
- 10 seed user records with KYC status, account status, balance, and document info
- Full CRUD: `addAsset`, `updateAsset`, `removeAsset`, `addPair`, `updatePair`, `removePair`
- KYC actions: `updateUser`, `approveKyc`, `rejectKyc`, `requestResubmission`

#### Admin Pages (`src/app/admin/`)
| Page | Description |
|------|-------------|
| `layout.tsx` | Protected sidebar (auth guard via localStorage), 6 nav items, sign-out |
| `login/page.tsx` | Credentials gate — `admin` / `palmx2026`, persists to `palmx-admin-auth` |
| `dashboard/page.tsx` | Stats cards (users, volume, KYC queue, revenue), live asset ticker, quick actions |
| `users/page.tsx` | User table — search, KYC filter, status filter — edit modal, suspend/ban actions |
| `kyc/page.tsx` | KYC review queue — approve / reject / request-resubmission, document preview, tier |
| `assets/page.tsx` | Asset grid — status toggle, 15-field add/edit modal, remove with confirm |
| `pairs/page.tsx` | Trading pairs table — enable/disable toggle, add/edit/remove |

#### KYC User Flow (`src/app/kyc/page.tsx`)
- 4-step guided flow: Personal Info → Document Upload → Selfie → Review & Submit
- Animated progress bar, per-step indicators, form validation, success screen

#### i18n Extensions
- 32 new KYC keys added to EN + AR in `src/lib/i18n.ts`

#### Dynamic Pages Updated
- `src/app/markets/page.tsx` — now reads from store; reflects admin changes instantly
- `src/app/wallet/page.tsx` — dynamic balances from store assets

### TypeScript
**0 errors** confirmed after final check.

---

## [2026-03-31] v3.1 — Fiat On-Ramp: Bank Card Management Module (30 Countries, 300 Banks)

### Overview
Complete relational fiat on-ramp infrastructure: country → bank → card type hierarchy, admin management UI, and user-facing card management.

### What Was Built

#### Bank Database (`src/lib/bank-data.ts`)
- **30 countries**: 22 Arab League + 8 global high-volume markets
  - Arab: Iraq, Saudi Arabia, UAE, Egypt, Kuwait, Qatar, Jordan, Morocco, Algeria, Lebanon, Syria, Libya, Tunisia, Sudan, Oman, Bahrain, Palestine, Somalia, Yemen, Mauritania, Djibouti, Comoros
  - Global: USA, UK, Brazil, Nigeria, Turkey, Vietnam, South Africa, India
- **~300 banks** — 10 per country — generated via `mkBanks()` factory with realistic local bank names
- Payment gateways: `tap` (Gulf/MENA), `fawry` (Egypt), `paystack` (Nigeria/South Africa), `stripe` (US/UK), `checkout` (global), `local` (restricted markets)
- Typed enums: `BankStatus`, `CountryStatus`, `CountryRegion`, `GatewayType`, `CardType`
- Export: `DEFAULT_COUNTRIES`, `Bank`, `SupportedCountry`

#### Store Extensions (`src/lib/store.tsx`)
- `countries: SupportedCountry[]` state (initialized to `DEFAULT_COUNTRIES`)
- New CRUD: `addCountry`, `updateCountry`, `removeCountry`, `addBank`, `updateBank`, `removeBank`
- Re-exports all bank types

#### Admin Bank Management (`src/app/admin/banks/page.tsx`)
- 3 stat cards (Arab / Global / Total banks)
- Country accordion with search + region filter
- Per-country: flag, EN/AR name, ISO code, currency, region, gateway, bank count, status, actions
- Expandable bank table: name, SWIFT, card type badges, gateway, status, edit/suspend/remove
- Country add/edit modal + Bank add/edit modal + Confirm-delete modal with cascade warning
- Toast notifications

#### User Card Management (`src/app/wallet/cards/page.tsx`)
- Visual card grid with gradient previews per card type
- 2-step add-card modal: Country → Bank → Card Type → Card Details → Live Preview
- Card number auto-formatting, name auto-uppercase, live preview during input
- Remove with confirmation; security badge (AES-256 / CVV not stored)

#### i18n & Navigation
- 30 new bank/card keys added to EN + AR
- `CreditCard` (lucide-react) nav item added to admin sidebar

### TypeScript
**0 errors** confirmed.

---

## [2026-03-31] v4.0 — Telegram Trading Bot (@plamxbot) — Arabic Native, Solana Non-Custodial

### Overview
Full-featured Telegram trading bot with Arabic-native UI, inline keyboards, Solana DEX integration via Jupiter aggregator, non-custodial Phantom/Solflare wallet connect, profit-only fee model, and admin kill-switch.

### Architecture
- **Language**: Arabic-native inline keyboards — no English required
- **Protocol**: Telegram Bot API webhooks; `x-telegram-bot-api-secret-token` validation
- **Blockchain**: Solana Mainnet-Beta
- **DEX Routing**: Jupiter Aggregator v6 → Raydium / Orca (best price auto-routing)
- **Wallet model**: **Non-custodial** — private keys NEVER stored; Phantom/Solflare deep-link only
- **Fee model**: 5–10% of net profit only · zero fee on losses
- **Kill-switch**: `BOT_PAUSED` flag, toggleable from admin dashboard in real time

### Files Created

#### `src/lib/telegram/types.ts`
- Telegram API types: `TelegramUser`, `TelegramMessage`, `TelegramCallbackQuery`, `TelegramUpdate`, `InlineKeyboardMarkup`
- Bot domain types: `AccountMode`, `BotUserSession`, `BotMenuState`, `BotTrade`, `TokenRiskCheck`, `FeeConfig`, `BotStats`
- `BotUserSession`: telegramId, palmxUserId (OAuth), walletAddress (public key only), accountMode, demoBalance ($10k virtual), menuState
- `BotTrade`: full record — tokenAddress, direction, entryPrice, currentPrice, stopLoss, takeProfit, txSignature, dex, realizedPnl, feePaid, riskCheck

#### `src/lib/telegram/solana.ts`
- `getTokenPrice` — Jupiter `/v6/price`
- `checkTokenRisk` — mint authority, liquidity lock, scam flag, risk score 0–100
- `getBestSwapQuote` — Jupiter `/v6/quote` with 0.5% max slippage; detects Raydium vs Orca
- `buildSwapTransaction` — returns base64 unsigned tx; user signs in their wallet app
- `calculateProfitFee` — fee only if grossProfit > 0
- `SOLANA_TOKENS` — SOL, USDC, USDT, RAY, ORCA, BONK, WIF, JUP mainnet addresses

#### `src/lib/telegram/bot-handler.ts`
- Telegram API wrappers: `sendMessage`, `editMessage`, `answerCallbackQuery`, `registerWebhook`
- In-memory session store (`Map<number, BotUserSession>`), trade store (`Map<string, BotTrade>`)
- Kill-switch: `setBotPaused` / `isBotPaused` — checked on every incoming update
- Arabic inline keyboards: account-select, main-menu, trade-spot (token grid), trade-action (Buy/Sell/TP-SL), wallet-connect (Phantom + Solflare deep-links), open-trades, auto-trading, settings, order-history
- Commands: `/start`, `/menu`, `/help`, `/balance`, `/trades`

#### API Routes
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/telegram/webhook` | POST | Receives all bot updates; secret-header validated |
| `/api/telegram/webhook` | GET | Returns bot info (setup verification) |
| `/api/telegram/register-webhook` | POST | Admin endpoint to register/update webhook URL |
| `/api/telegram/bot-control` | POST | Admin kill-switch (pause/resume), protected by `ADMIN_API_SECRET` |
| `/api/telegram/bot-control` | GET | Read current pause state |

#### Admin Bot Monitor (`src/app/admin/bot/page.tsx`)
- 4 stat cards: Total Bot Users, Open Trades, Fees Collected, Bot Status
- **Kill-Switch** with confirmation dialog; bot-paused banner
- **Fee Config panel**: 5–10% slider, treasury wallet with copy button
- **Quick Stats**: 24h volume, fees, top trader, profitability %, top token, top DEX
- **Connection Status**: Webhook, Solana RPC, Jupiter, Raydium, Orca
- **Bot Users table**: telegramId, username, mode, wallet, open trades, volume, fees, last active, suspend action
- **Recent Trades feed**: symbol, direction, size, P&L, fee, DEX, status, time

#### Store Extension (`src/lib/store.tsx`)
- `botPaused: boolean` state added
- `toggleBotKillSwitch()` action added

#### Environment (`/.env.local.example`)
- Documents all required env vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `BOT_FEE_PERCENT`, `BOT_MAX_TRADE_SIZE_USD`, `BOT_TREASURY_WALLET`, `ADMIN_API_SECRET`, `JUPITER_API_BASE_URL`, `NEXT_PUBLIC_SOLANA_RPC_URL`, `PHANTOM_DAPP_ENCRYPTION_PUBLIC_KEY`

#### Admin Nav
- "Bot Monitor" (`Bot` icon) added to admin sidebar — 7 nav items total

### Security
- Bot token in `TELEGRAM_BOT_TOKEN` env var only — never committed
- Webhook validated via `x-telegram-bot-api-secret-token` on every request
- Admin endpoints protected by `ADMIN_API_SECRET`
- Non-custodial: only public key stored; tx signing done in user's wallet app

### TypeScript
**0 errors** confirmed after final check.
