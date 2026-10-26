import { apiGet, apiPost } from "./api";
import { BASE } from "./config";
import { esc } from "./html";
import { parsePastedPrice } from "../../src/lib/secretary/compare";
import type { CompareContext } from "../../src/lib/ext/protocol";

/**
 * The side panel's «أرسل إلى الملف» form: what the employee captured on a hotel
 * site, every value theirs to correct, sent into one of their own proposals'
 * stays only on their press. The proposal «قارن» opened the site for is chosen
 * already.
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
type Stay = { cityKey: string; city: string; hotel: string; checkIn: string | null; checkOut: string | null; nights: number; rooms: number };
type Proposal = { id: string; title: string; client: string; stays: Stay[] };

export async function renderCapture(root: HTMLElement, cap: Capture) {
  root.innerHTML = `<span class="muted">جارٍ جلب مقترحاتك…</span>`;
  const r = await apiGet<{ ok: true; proposals: Proposal[] }>("/api/ext/stays");
  if (!r.ok) {
    root.innerHTML = `<div class="card warn">${r.error === "forbidden" ? "إرسال الأسعار لمن يُصدر العروض." : "تعذّر جلب مقترحاتك الآن — حاول بعد قليل."}</div>`;
    return;
  }
  const options = r.proposals.flatMap((p) => p.stays.map((s) => ({ p, s, value: `${p.id}|${s.cityKey}` })));
  if (!options.length) {
    root.innerHTML = `<div class="card"><div class="warn">لا مقترح مفتوح لك الآن.</div>
      <div class="muted">المقترحات يصنعها سكرتيرك، ثم تقارنها بأسعار المواقع وترسل السعر إليها من هنا.</div>
      <div class="row"><a class="btn" href="${BASE}/secretary" target="_blank" rel="noopener">افتح «سكرتيري»</a></div></div>`;
    return;
  }
  const preset = cap.ctx ? `${cap.ctx.d}|${cap.ctx.c}` : options.length === 1 ? options[0].value : "";
  root.innerHTML = `<div class="card">
    <h3>سعر من ${esc(cap.site)}</h3>
    <label class="muted">الفندق</label>
    <input type="text" id="capHotel" maxlength="150" value="${esc(cap.hotel)}" />
    <label class="muted" style="display:block;margin-top:8px">السعر كما تراه ${cap.fromSelection ? "(من تحديدك)" : "(من الصفحة — تأكد منه)"}</label>
    <input type="text" id="capPrice" dir="auto" maxlength="200" value="${esc(cap.priceText)}" placeholder="مثل: SAR 1,250" />
    <label style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="capNightly" /> هذا سعر ليلة واحدة</label>
    <div class="line" id="capRead"></div>
    <label class="muted" style="display:block;margin-top:8px">إلى إقامة في مقترحك</label>
    <select id="capStay" style="width:100%;height:36px;border:1px solid var(--line);border-radius:10px;font:inherit">
      <option value="">— اختر —</option>
      ${options
        .map(({ p, s, value }) => `<option value="${esc(value)}"${value === preset ? " selected" : ""}>${esc(p.client)} · ${esc(s.city)} · ${esc(s.checkIn ?? "؟")} ← ${esc(s.checkOut ?? "؟")}</option>`)
        .join("")}
    </select>
    <div class="line" id="capWarn"></div>
    <div class="row"><button class="primary" id="capSend">أرسل إلى الملف</button><button id="capCopy" title="للصق في «قارن» على صف الفندق في بيسك">انسخ السعر</button></div>
    <div class="status" id="capStatus"></div>
    <div class="muted" style="margin-top:6px">السعر بيدك أنت وتأكيده عليك — لا يصل للعميل شيء من هنا.</div>
  </div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`) as T;
  const stayOf = () => options.find((o) => o.value === $<HTMLSelectElement>("capStay").value) ?? null;
  const amount = () => {
    const parsed = parsePastedPrice($<HTMLInputElement>("capPrice").value);
    if (!parsed) return null;
    const nights = stayOf()?.s.nights ?? cap.nights ?? 1;
    return { ...parsed, total: $<HTMLInputElement>("capNightly").checked ? parsed.amount * nights : parsed.amount, nights };
  };
  const update = () => {
    const a = amount();
    $("capRead").innerHTML = a
      ? `قرأت: <b>${a.total.toLocaleString("en-US")} ${esc(a.currency)}</b>${$<HTMLInputElement>("capNightly").checked ? ` (${a.amount.toLocaleString("en-US")} × ${a.nights} ليالٍ)` : ""}${a.assumed ? " — افترضتها ريالاً، صحّح إن كانت غيرها" : ""}`
      : `<span class="warn">اكتب السعر أو حدّده في الصفحة.</span>`;
    const s = stayOf()?.s;
    $("capWarn").innerHTML =
      s && cap.checkIn && s.checkIn && (cap.checkIn !== s.checkIn || cap.checkOut !== s.checkOut)
        ? `<span class="chip red">تواريخ الصفحة ${esc(cap.checkIn)} ← ${esc(cap.checkOut ?? "؟")} غير تواريخ الإقامة</span>`
        : "";
  };
  ["capPrice", "capNightly", "capStay"].forEach((id) => $(id).addEventListener("input", update));
  $("capStay").addEventListener("change", update);
  update();

  // for «قارن» on a Basic hotel row: the price as read, to paste in its box (the file there is written by Basic itself)
  $<HTMLButtonElement>("capCopy").addEventListener("click", async () => {
    const a = amount();
    if (!a) return;
    const ok = await navigator.clipboard.writeText(`${a.total} ${a.currency}`).then(() => true, () => false);
    $("capStatus").className = `status ${ok ? "ok" : "bad"}`;
    $("capStatus").textContent = ok ? `نُسخ ${a.total.toLocaleString("en-US")} ${a.currency} — الصقه في «قارن» في بيسك.` : "تعذّر النسخ.";
  });
  $<HTMLButtonElement>("capSend").addEventListener("click", async () => {
    const a = amount();
    const o = stayOf();
    const hotelName = $<HTMLInputElement>("capHotel").value.trim();
    const say = (ok: boolean, html: string) => {
      $("capStatus").className = `status ${ok ? "ok" : "bad"}`;
      $("capStatus").innerHTML = html;
    };
    if (!a || !o || !hotelName) return say(false, "أكمل الفندق والسعر والإقامة.");
    const btn = $<HTMLButtonElement>("capSend");
    btn.disabled = true;
    const res = await apiPost<{ ok: true; staySar: number; draftId: string }>("/api/ext/stays/apply", {
      draftId: o.p.id,
      cityKey: o.s.cityKey,
      hotelName,
      amount: a.total,
      currency: a.currency,
      site: cap.site,
    });
    btn.disabled = false;
    if (!res.ok) return say(false, esc(res.error === "unavailable" || res.error === "offline" ? "تعذّر الإرسال الآن — حاول بعد قليل." : res.error));
    say(true, `✓ أُضيف «${esc(hotelName)}» بسعر ≈${res.staySar.toLocaleString("en-US")} ريال — <a href="${BASE}/basic/${esc(res.draftId)}" target="_blank" rel="noopener">افتح المسودة وراجع ثم أصدر</a>`);
  });
}
