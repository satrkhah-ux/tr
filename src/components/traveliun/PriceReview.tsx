"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, History, Loader2, Search } from "lucide-react";
import { DirText } from "@/components/DirText";
import { saveReviewPrice, type ReviewKind, type ReviewPage, type ReviewRow } from "@/lib/data/price-review";
import { TraveliunShell } from "./TraveliunShell";
import { DuplicatesPanel } from "./DuplicatesPanel";
import type { Duplicates } from "@/lib/data/dedupe";

/** «مراجعة الأسعار» — the prices waiting on a person, edited in place, every change in «آخر التحديثات». */

const KINDS: { key: ReviewKind; label: string; note: string }[] = [
  {
    key: "airport",
    label: "مطارات الدول الأكثر استخداماً",
    note: "كل مطار في الدول الأكثر استخداماً في الملفات، ومعه أسعار استقباله لمدينته لكل سيارة. الخانة لسعر السيارة الصغيرة: اكتبه حيث لا سعر، أو صحّح المؤقت.",
  },
  { key: "transfer", label: "توصيلات مؤقتة", note: "سعر مؤقت لاستقبال المطار وتوديعه بسيارة صغيرة. اكتب سعر المورّد الحقيقي، أو اعتمد السعر الحالي كما هو." },
  { key: "tour", label: "جولات مؤقتة", note: "جولات أُعطيت سعراً مؤقتاً بسيارة صغيرة. اكتب السعر الحقيقي لكل جولة." },
  { key: "conflict", label: "أسعار متعارضة", note: "جولة واحدة بأكثر من سعر في القائمة. اكتب السعر الصحيح الواحد، فيُكتب على كل صفوفها." },
];
const CURRENCIES = ["SAR", "USD", "TRY", "MYR", "THB", "IDR", "EUR", "AED", "GEL", "AZN", "VND", "SGD"];
const FIELD = "h-9 rounded-[8px] border border-[#cfe0d9] bg-white px-2 text-[12.5px] font-semibold text-[#185045]";

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `قبل ${Math.max(m, 1)} دقيقة`;
  if (m < 1440) return `قبل ${Math.round(m / 60)} ساعة`;
  return `قبل ${Math.round(m / 1440)} يوم`;
};
const whoOf = (email: string) => email.split("@")[0];

export function PriceReview({ rows, history, duplicates }: ReviewPage & { duplicates?: Duplicates }) {
  const router = useRouter();
  const [tab, setTab] = useState<ReviewKind>("airport");
  const [country, setCountry] = useState("");
  const [q, setQ] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [typed, setTyped] = useState<Record<string, { price: string; currency: string }>>({});

  // an airport is done once its small car is priced and not provisional; the other lists only hold what is still open
  const open = (r: ReviewRow) => r.provisional || r.price == null || r.kind === "conflict";
  const ofTab = rows.filter((r) => r.kind === tab);
  const countries = [...new Set(ofTab.map((r) => r.country).filter(Boolean))];
  const list = ofTab.filter(
    (r) => (!country || r.country === country) && (!onlyOpen || open(r)) && (!q.trim() || [r.label, r.city, r.country, r.sub].join(" ").includes(q.trim())),
  );

  async function save(r: ReviewRow) {
    const t = typed[r.key];
    const value = t?.price.trim() ? Number(t.price) : null;
    if (value == null && (r.price == null || r.kind === "conflict")) return setMsg({ text: "اكتب السعر الصحيح قبل الحفظ.", bad: true });
    setBusy(r.key);
    setMsg(null);
    const res = await saveReviewPrice(r.key, value, t?.currency || r.currency || "SAR");
    setBusy(null);
    if (!res.ok) return setMsg({ text: res.error === "price" ? "اكتب السعر الصحيح قبل الحفظ." : "لم يُحفظ. أعد المحاولة.", bad: true });
    setTyped((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== r.key)));
    setMsg({ text: `حُفظ: ${r.label}` });
    router.refresh();
  }

  return (
    <TraveliunShell title="nav.priceReview">
      <div className="tv-fade-up space-y-4">
        <section className="rounded-[16px] border border-[#d8e6e0] bg-white p-4 sm:p-5">
          <h1 className="text-lg font-extrabold text-[#003c3a]">مراجعة الأسعار</h1>
          <p className="mt-1 max-w-[75ch] text-[12.5px] font-semibold leading-6 text-[#557d78]">
            اكتب السعر الصحيح ثم «حفظ»، أو «اعتماد كما هو» إن كان الحالي صحيحاً. كل حفظ يُكتب في بيانات النظام مباشرة، ويُسجَّل باسم من عدّله في «آخر التحديثات» أسفل الصفحة.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {KINDS.map((k) => {
              const all = rows.filter((r) => r.kind === k.key);
              const left = all.filter(open).length;
              return (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => {
                    setTab(k.key);
                    setCountry("");
                  }}
                  className={`h-9 rounded-full px-3 text-[12.5px] font-bold ${tab === k.key ? "bg-[#185045] text-white" : "border border-[#cfe0d9] text-[#185045] hover:bg-[#f4f8f6]"}`}
                >
                  {k.label} <span className="tv-tnum opacity-75">{k.key === "airport" ? `${all.length - left}/${all.length}` : left}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[12px] font-semibold text-tv-text-faint">{KINDS.find((k) => k.key === tab)?.note}</p>
        </section>

        <section className="rounded-[16px] border border-[#d8e6e0] bg-white p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="الدولة" className={FIELD}>
              <option value="">كل الدول ({ofTab.length})</option>
              {countries.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <label className="relative min-w-0 flex-1 basis-56">
              <Search className="pointer-events-none absolute start-2 top-2.5 size-4 text-tv-text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم المدينة أو الجولة أو المطار" className={`${FIELD} w-full ps-8`} />
            </label>
            {tab === "airport" ? (
              <label className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#557d78]">
                <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
                ما لم يُسعَّر فقط
              </label>
            ) : null}
            {msg ? <span className={`text-[12px] font-bold ${msg.bad ? "text-[#c22850]" : "text-[#0f7a52]"}`}>{msg.text}</span> : null}
          </div>

          <div className="mt-3 overflow-x-auto rounded-[12px] border border-[#e3ece8]">
            <table className="w-full min-w-[900px] table-fixed text-start text-[12.5px]">
              <colgroup>
                <col className="w-[33%]" />
                <col className="w-[10%]" />
                <col className="w-[24%]" />
                <col className="w-[19%]" />
                <col className="w-[14%]" />
              </colgroup>
              <thead className="bg-[#f6f9f8] text-[11px] font-extrabold text-tv-text-faint">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start">
                  <th>البند</th>
                  <th>السيارة</th>
                  <th>في القائمة الآن</th>
                  <th>السعر الصحيح</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef3f1]">
                {list.map((r) => {
                  const t = typed[r.key];
                  const done = !open(r);
                  return (
                    <tr key={r.key} className={`align-top [&>td]:px-3 [&>td]:py-2.5 ${done ? "bg-[#f1faf5]" : t?.price ? "bg-[#f3f8fd]" : ""}`}>
                      <td>
                        <div className="font-bold leading-6 text-[#103f37]">{r.label}</div>
                        <div className="text-[11px] font-semibold text-tv-text-faint">{[r.country, r.city, r.sub].filter(Boolean).join(" · ")}</div>
                        {r.last ? (
                          <div className="mt-0.5 text-[10.5px] font-semibold text-[#0f7a52]">
                            عدّله {whoOf(r.last.by)} {ago(r.last.at)}
                          </div>
                        ) : null}
                      </td>
                      <td className="font-semibold text-[#557d78]">{r.car || "—"}</td>
                      <td>
                        <div className="grid gap-0.5">
                          {r.listed.length === 0 ? <span className="text-tv-text-faint">لا سعر في القائمة</span> : null}
                          {r.listed.map((l) => (
                            <span key={l} title={l} className={`tv-tnum truncate ${l.includes("مؤقت") ? "font-bold text-[#a86a10]" : "text-[#557d78]"}`}>
                              {l}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="flex gap-1.5">
                          <input
                            type="number"
                            min={0}
                            dir="ltr"
                            inputMode="decimal"
                            aria-label="السعر الصحيح"
                            placeholder={r.price != null ? String(r.price) : "السعر"}
                            value={t?.price ?? ""}
                            onChange={(e) => setTyped({ ...typed, [r.key]: { price: e.target.value, currency: t?.currency || r.currency || "SAR" } })}
                            className={`${FIELD} tv-tnum w-24 text-center`}
                          />
                          <select
                            aria-label="العملة"
                            value={t?.currency || r.currency || "SAR"}
                            onChange={(e) => setTyped({ ...typed, [r.key]: { price: t?.price ?? "", currency: e.target.value } })}
                            className={`${FIELD} w-20`}
                          >
                            {[...new Set([r.currency || "SAR", ...CURRENCIES])].map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          disabled={busy !== null || (done && !t?.price)}
                          onClick={() => void save(r)}
                          className={`inline-flex h-9 w-full items-center justify-center gap-1 rounded-[8px] px-2 text-[12px] font-bold disabled:opacity-60 ${
                            done && !t?.price ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#185045] text-white hover:bg-[#0f4439]"
                          }`}
                        >
                          {busy === r.key ? <Loader2 className="size-3.5 animate-spin" /> : done && !t?.price ? <CheckCircle2 className="size-3.5" /> : null}
                          {done && !t?.price ? "مُسعَّر" : t?.price ? "حفظ" : r.price != null && r.kind !== "conflict" ? "اعتماد كما هو" : "حفظ"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {list.length === 0 ? <p className="py-8 text-center text-[12.5px] font-semibold text-tv-text-faint">لا بنود هنا — كلها مراجَعة.</p> : null}
          </div>
        </section>

        {/* the same thing held twice — the owner keeps one (2026-10-22) */}
        {duplicates ? <DuplicatesPanel data={duplicates} /> : null}

        {/* who changed what — the audit trail of this page */}
        <section className="rounded-[16px] border border-[#d8e6e0] bg-white p-3 sm:p-4">
          <h2 className="inline-flex items-center gap-2 text-[14px] font-extrabold text-[#003c3a]">
            <History className="size-4 text-[#0f7a52]" />
            آخر التحديثات
          </h2>
          {history.length === 0 ? (
            <p className="mt-2 text-[12px] font-semibold text-tv-text-faint">لم يُعدَّل شيء بعد. كل حفظ يظهر هنا باسم من عدّله.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-start text-[12px]">
                <thead className="text-[11px] font-extrabold text-tv-text-faint">
                  <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-start">
                    <th>متى</th>
                    <th>من</th>
                    <th>البند</th>
                    <th>كان</th>
                    <th>صار</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef3f1]">
                  {history.map((h, i) => (
                    <tr key={`${h.at}-${i}`} className="[&>td]:px-2 [&>td]:py-1.5 font-semibold text-[#185045]">
                      <td className="whitespace-nowrap text-[#557d78]">{ago(h.at)}</td>
                      <td className="whitespace-nowrap">{whoOf(h.by)}</td>
                      <td className="max-w-[28rem] truncate" title={h.label}>
                        {h.label}
                      </td>
                      <td className="tv-tnum whitespace-nowrap text-tv-text-faint">
                        <DirText>{h.before}</DirText>
                      </td>
                      <td className="tv-tnum whitespace-nowrap font-extrabold">
                        <DirText>{h.after}</DirText>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}
