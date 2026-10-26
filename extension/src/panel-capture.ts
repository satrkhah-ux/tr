import { apiGet, apiPost } from "./api";
import { BASE } from "./config";
import { esc } from "./html";
import { readPrice } from "./price";
import type { CompareContext } from "../../src/lib/ext/protocol";

/**
 * The side panel's «أرسل إلى الملف» form: what the employee captured on a hotel
 * site, every value theirs to correct — the hotel, the amount, the currency, what
 * the amount covers (one night? one room?) and the stay of their own proposal —
 * sent only on their press. The stay «قارن» opened the site for is chosen already.
 */
export type Capture = {
  site: string;
  hotel: string;
  priceText: string;
  fromSelection: boolean;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  page: string;
  ctx: CompareContext | null;
};
type Stay = { stayId: string; cityKey: string; city: string; hotel: string; checkIn: string | null; checkOut: string | null; nights: number; rooms: number };
type Proposal = { id: string; title: string; client: string; stays: Stay[] };

const CURRENCIES = ["SAR", "USD", "AED", "EUR", "GBP", "MYR", "IDR", "THB", "TRY", "GEL", "KWD", "QAR", "BHD", "OMR", "EGP", "AZN", "MVR"];

/** `still()`: this capture is still the one the panel should show — a late answer never paints over another view */
export async function renderCapture(root: HTMLElement, cap: Capture, still: () => boolean, retry: () => void) {
  root.innerHTML = `<span class="muted">جارٍ جلب مقترحاتك…</span>`;
  const r = await apiGet<{ ok: true; proposals: Proposal[] }>("/api/ext/stays");
  if (!still()) return;
  if (!r.ok) {
    root.innerHTML = `<div class="card warn">${r.error === "forbidden" ? "إرسال الأسعار لمن يُصدر العروض." : "تعذّر جلب مقترحاتك الآن."}</div>
      <div class="row"><button class="small" id="capRetry">أعد المحاولة</button></div>`;
    root.querySelector("#capRetry")?.addEventListener("click", retry);
    return;
  }
  const options = r.proposals.flatMap((p) => p.stays.map((s) => ({ p, s, value: `${p.id}|${s.stayId}` })));
  if (!options.length) {
    root.innerHTML = `<div class="card"><div class="warn">لا مقترح مفتوح لك الآن.</div>
      <div class="muted">المقترحات يصنعها سكرتيرك، ثم تقارنها بأسعار المواقع وترسل السعر إليها من هنا. ولصف فندق في بيسك: «انسخ السعر» والصقه في «قارن».</div>
      <div class="row"><a class="btn" href="${BASE}/secretary" target="_blank" rel="noopener">افتح «سكرتيري»</a><button id="capCopy">انسخ السعر</button></div>
      <div class="status" id="capStatus"></div></div>`;
    wireCopy(root, () => readPrice(cap.priceText));
    return;
  }
  // «قارن»'s context: the stay itself, else the first stay of that city in that proposal
  const preset =
    (cap.ctx && options.find((o) => o.p.id === cap.ctx!.d && (o.s.stayId === cap.ctx!.c || o.s.cityKey === cap.ctx!.c))?.value) ||
    (options.length === 1 ? options[0].value : "");
  const read = readPrice(cap.priceText);
  const cur = read?.currency ?? "SAR";
  root.innerHTML = `<div class="card">
    <h3>سعر من ${esc(cap.site)}</h3>
    <label class="muted">الفندق</label>
    <input type="text" id="capHotel" maxlength="150" value="${esc(cap.hotel)}" />
    <label class="muted" style="display:block;margin-top:8px">السعر كما تراه ${cap.fromSelection ? "(من تحديدك)" : "(من الصفحة — تأكد منه)"}</label>
    <div style="display:flex;gap:6px">
      <input type="text" id="capPrice" dir="auto" maxlength="200" value="${esc(cap.priceText)}" placeholder="مثل: 1,250" />
      <select id="capCur" style="height:38px;border:1px solid var(--line);border-radius:10px;font:inherit">
        ${[...new Set([cur, ...CURRENCIES])].map((c) => `<option${c === cur ? " selected" : ""}>${esc(c)}</option>`).join("")}
      </select>
    </div>
    ${read && !read.currency ? `<div class="muted">لم تُذكر العملة بجانب السعر — اخترتُ الريال، صحّحها إن كانت غيره.</div>` : ""}
    <label style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="capNightly" /> هذا سعر ليلة واحدة</label>
    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="capPerRoom" /> هذا سعر غرفة واحدة</label>
    <label class="muted" style="display:block;margin-top:8px">إلى إقامة في مقترحك</label>
    <select id="capStay" style="width:100%;height:36px;border:1px solid var(--line);border-radius:10px;font:inherit">
      <option value="">— اختر —</option>
      ${options
        .map(
          ({ p, s, value }) =>
            `<option value="${esc(value)}"${value === preset ? " selected" : ""}>${esc(p.client)} · ${esc(s.city)} · ${esc(s.hotel || "—")} · ${esc(s.checkIn ?? "؟")} ← ${esc(s.checkOut ?? "؟")}</option>`,
        )
        .join("")}
    </select>
    <div class="line" id="capRead"></div>
    <div class="line" id="capWarn"></div>
    <div class="row"><button class="primary" id="capSend">أرسل إلى الملف</button><button id="capCopy" title="للصق في «قارن» على صف الفندق في بيسك">انسخ السعر</button></div>
    <div class="status" id="capStatus"></div>
    <div class="muted" style="margin-top:6px">السعر بيدك أنت وتأكيده عليك — لا يصل للعميل شيء من هنا.</div>
  </div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`) as T;
  const stayOf = () => options.find((o) => o.value === $<HTMLSelectElement>("capStay").value) ?? null;
  /** the whole stay's price for all its rooms, as the employee says the amount reads */
  const total = () => {
    const read = readPrice($<HTMLInputElement>("capPrice").value);
    if (!read) return null;
    const s = stayOf()?.s;
    const nights = s?.nights ?? cap.nights ?? 1;
    const rooms = s?.rooms ?? 1;
    const n = $<HTMLInputElement>("capNightly").checked ? nights : 1;
    const r = $<HTMLInputElement>("capPerRoom").checked ? rooms : 1;
    return { amount: read.amount, total: Math.round(read.amount * n * r * 100) / 100, currency: $<HTMLSelectElement>("capCur").value, nights, rooms, n, r };
  };
  const update = () => {
    const t = total();
    $("capRead").innerHTML = t
      ? `يُكتب: <b>${t.total.toLocaleString("en-US")} ${esc(t.currency)}</b> للإقامة كاملة (${t.nights} ليالٍ، ${t.rooms} ${t.rooms === 1 ? "غرفة" : "غرف"})${
          t.n > 1 || t.r > 1 ? ` = ${t.amount.toLocaleString("en-US")}${t.n > 1 ? ` × ${t.n} ليالٍ` : ""}${t.r > 1 ? ` × ${t.r} غرف` : ""}` : ""
        }`
      : `<span class="warn">اكتب السعر أو حدّده في الصفحة.</span>`;
    const s = stayOf()?.s;
    $("capWarn").innerHTML =
      s && cap.checkIn && s.checkIn && (cap.checkIn !== s.checkIn || cap.checkOut !== s.checkOut)
        ? `<span class="chip red">تواريخ الصفحة ${esc(cap.checkIn)} ← ${esc(cap.checkOut ?? "؟")} غير تواريخ الإقامة</span>`
        : "";
  };
  ["capPrice", "capNightly", "capPerRoom", "capStay", "capCur"].forEach((id) => {
    $(id).addEventListener("input", update);
    $(id).addEventListener("change", update);
  });
  update();
  wireCopy(root, () => {
    const t = total();
    return t ? { amount: t.total, currency: t.currency } : null;
  });

  $<HTMLButtonElement>("capSend").addEventListener("click", async () => {
    const t = total();
    const o = stayOf();
    const hotelName = $<HTMLInputElement>("capHotel").value.trim();
    const say = (ok: boolean, html: string) => {
      $("capStatus").className = `status ${ok ? "ok" : "bad"}`;
      $("capStatus").innerHTML = html;
    };
    if (!t || !o || !hotelName) return say(false, "أكمل الفندق والسعر والإقامة.");
    const btn = $<HTMLButtonElement>("capSend");
    btn.disabled = true;
    const res = await apiPost<{ ok: true; staySar: number; draftId: string }>("/api/ext/stays/apply", {
      draftId: o.p.id,
      stayId: o.s.stayId,
      hotelName,
      amount: t.total,
      currency: t.currency,
      site: cap.site,
    });
    btn.disabled = false;
    if (!res.ok) return say(false, esc(res.error === "unavailable" || res.error === "offline" ? "تعذّر الإرسال الآن — حاول بعد قليل." : res.error));
    say(true, `✓ أُضيف «${esc(hotelName)}» بسعر ≈${res.staySar.toLocaleString("en-US")} ريال — <a href="${BASE}/basic/${esc(res.draftId)}" target="_blank" rel="noopener">افتح المسودة وراجع ثم أصدر</a>`);
  });
}

/** «انسخ السعر»: for «قارن» on a Basic hotel row — that file is written by Basic itself, never from here */
function wireCopy(root: HTMLElement, price: () => { amount: number; currency: string | null } | null) {
  root.querySelector("#capCopy")?.addEventListener("click", async () => {
    const p = price();
    const status = root.querySelector("#capStatus") as HTMLElement | null;
    if (!p || !status) return;
    const text = `${p.amount} ${p.currency ?? "SAR"}`;
    const ok = await navigator.clipboard.writeText(text).then(() => true, () => false);
    status.className = `status ${ok ? "ok" : "bad"}`;
    status.textContent = ok ? `نُسخ ${text} — الصقه في «قارن» في بيسك.` : "تعذّر النسخ.";
  });
}
