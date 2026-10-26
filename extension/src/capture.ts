import { readTvctx } from "../../src/lib/ext/protocol";

/**
 * On Agoda, Almosafer and Booking: one button, «أرسل السعر إلى الملف». Pressed by
 * the employee (a real click — never a script), it reads what is on the screen
 * at that moment — the price they selected with the mouse (else the one the page
 * shows), the hotel's name, the dates in the address — and hands it to the side
 * panel, where they check every value before anything is sent. No browsing, no
 * looping over results, nothing read without that press.
 */
const host = location.hostname;
const SITE = host.endsWith("agoda.com") ? "أجودا" : host.endsWith("booking.com") ? "Booking.com" : host.endsWith("almosafer.com") ? "المسافر" : null;

const NAME: Record<string, string[]> = {
  "Booking.com": ['[data-testid="property-header"] h2', "h2.pp-header__title", "#hp_hotel_name h2", "#hp_hotel_name"],
  أجودا: ['[data-selenium="hotel-header-name"]', 'h1[data-selenium="hotel-header-name"]'],
  المسافر: ['[data-testid*="hotel-name" i]', "h1"],
};
const PRICE: Record<string, string[]> = {
  "Booking.com": ['[data-testid="price-and-discounted-price"]', ".prco-valign-middle-helper", ".bui-price-display__value"],
  أجودا: ['[data-selenium="display-price"]', '[data-element-name="final-price"]', '[data-selenium="PriceDisplay"]'],
  المسافر: ['[data-testid*="total-price" i]', '[data-testid*="price" i]'],
};

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const first = (selectors: string[]) => selectors.map((s) => text(document.querySelector(s))).find(Boolean) ?? "";

function dates(): { checkIn: string | null; checkOut: string | null; nights: number | null } {
  const q = new URLSearchParams(location.search);
  const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const checkIn = day(q.get("checkin")) ?? day(q.get("checkIn")) ?? day(q.get("check_in"));
  let checkOut = day(q.get("checkout")) ?? day(q.get("checkOut")) ?? day(q.get("check_out"));
  const los = Number(q.get("los"));
  if (!checkOut && checkIn && Number.isInteger(los) && los > 0) checkOut = new Date(Date.parse(`${checkIn}T00:00:00Z`) + los * 86_400_000).toISOString().slice(0, 10);
  const nights = checkIn && checkOut ? Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000) : null;
  return { checkIn, checkOut, nights: nights && nights > 0 ? nights : null };
}

function capture() {
  const selected = window.getSelection()?.toString().replace(/\s+/g, " ").trim().slice(0, 200) ?? "";
  return {
    site: SITE as string,
    hotel: (first(NAME[SITE as string] ?? []) || text(document.querySelector("h1")) || document.title).slice(0, 150),
    priceText: selected || first(PRICE[SITE as string] ?? []).slice(0, 200),
    fromSelection: Boolean(selected),
    ...dates(),
    page: `${location.origin}${location.pathname}`,
  };
}

async function send(ev: MouseEvent, button: HTMLButtonElement) {
  // a click a person made — a page script cannot press it for them
  if (!ev.isTrusted) return;
  let r: { opened?: boolean } | null = null;
  try {
    // cut off when the extension was reloaded since this page opened
    if (chrome.runtime?.id) r = (await chrome.runtime.sendMessage({ type: "capture", data: capture() })) as { opened?: boolean } | null;
  } catch {
    r = null;
  }
  button.textContent = r?.opened ? "✓ في لوحة المساعد — راجع وأرسل" : r ? "✓ في لوحة المساعد — افتحها من أيقونة الإضافة في نافذة النظام" : "حدّث الصفحة ثم حاول";
  window.setTimeout(() => (button.textContent = "⇪ أرسل السعر إلى الملف"), 4000);
}

if (SITE) {
  // the stay «قارن» opened this for — kept for this tab, the site drops the fragment as it moves on
  const ctx = readTvctx(location.hash);
  if (ctx) void chrome.runtime.sendMessage({ type: "ctx", ctx }).catch(() => null);

  const holder = document.createElement("div");
  const root = holder.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    button{all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483647;cursor:pointer;
      font:800 13px/1 Tajawal,"Segoe UI",Tahoma,sans-serif;color:#fff;background:#185045;padding:11px 14px;border-radius:12px;
      box-shadow:0 6px 18px rgba(0,0,0,.25);direction:rtl}
    button:hover{background:#0f3d38}
  </style><button type="button" title="مساعد ترافليون — حدّد السعر بالماوس إن أردت، ثم اضغط">⇪ أرسل السعر إلى الملف</button>`;
  const button = root.querySelector("button") as HTMLButtonElement;
  button.addEventListener("click", (ev) => void send(ev, button));
  document.documentElement.appendChild(holder);
}
