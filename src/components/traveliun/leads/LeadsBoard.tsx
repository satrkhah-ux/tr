"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2, MessageCircle, Plus, RefreshCw, Search, Users } from "lucide-react";
import { DirText } from "@/components/DirText";
import { addLead, pullLeadsNow, startProgramme, updateLead, type Lead, type LeadPatch, type LeadsPage } from "@/lib/data/leads";
import { TraveliunShell } from "../TraveliunShell";

/** the sheet's own words, so a pulled row and a typed one read the same */
const INQUIRIES = ["باكدج", "تاشيرات", "طيران", "فنادق", "مواصلات", "يستفسر", "طلب", "طلب غير واضح"];
const SENT = ["تم ارسال التفاصيل", "تم ارسال البرنامج", "تم ارسال المعلومات"];

type Tab = "open" | "mine" | "returning" | "closed" | "all";
const TABS: [Tab, string][] = [
  ["open", "مفتوحة"],
  ["mine", "محادثاتي"],
  ["returning", "عميل سابق"],
  ["closed", "مغلقة"],
  ["all", "الكل"],
];

const CELL = "h-8 w-full rounded-[8px] border border-[#cfe0d9] bg-white px-2 text-[12px] font-semibold text-[#185045]";

export function LeadsBoard({ leads, team, meId, pullError }: LeadsPage) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("open");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(pullError ? `تعذّر السحب من الشيت: ${pullError}` : null);
  const [draft, setDraft] = useState({ phone: "", name: "", inquiry: "", destination: "" });
  const nameOf = useMemo(() => new Map(team.map((e) => [e.id, e.arabic_name])), [team]);

  const list = leads.filter((l) => {
    if (tab === "open" && l.status !== "open") return false;
    if (tab === "closed" && l.status !== "closed") return false;
    if (tab === "mine" && l.assigned_to !== meId && l.received_by !== meId) return false;
    if (tab === "returning" && !l.returning) return false;
    if (!q.trim()) return true;
    const hay = [l.phone, l.name, l.inquiry, l.destination, l.file?.destination, l.received_by_name, l.assigned_to_name, nameOf.get(l.assigned_to ?? "")].join(" ");
    return hay.includes(q.trim());
  });
  const count = (t: Tab) =>
    t === "all" ? leads.length
    : t === "open" ? leads.filter((l) => l.status === "open").length
    : t === "closed" ? leads.filter((l) => l.status === "closed").length
    : t === "returning" ? leads.filter((l) => l.returning).length
    : leads.filter((l) => l.assigned_to === meId || l.received_by === meId).length;

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error === "phone" ? "رقم الهاتف غير صحيح" : `لم يُحفظ: ${r.error ?? ""}`);
      else router.refresh();
      return r.ok;
    } finally {
      setBusy(null);
    }
  }
  const save = (l: Lead, patch: LeadPatch) => void run(l.id, () => updateLead(l.id, patch));

  async function open(l: Lead) {
    if (l.file) return router.push(`/basic/${l.file.id}`);
    setBusy(`p-${l.id}`);
    const r = await startProgramme(l.id);
    setBusy(null);
    if (r.ok && r.draftId) router.push(`/basic/${r.draftId}`);
    else setError(`لم يُفتح البرنامج: ${r.error ?? ""}`);
  }

  return (
    <TraveliunShell title="nav.customers">
      <div className="tv-fade-up space-y-4">
        <section className="rounded-[16px] border border-[#d8e6e0] bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="inline-flex items-center gap-2 text-lg font-extrabold text-[#003c3a]">
              <Users className="size-5 text-[#0f7a52]" />
              العملاء والمحادثات
            </h1>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("pull", pullLeadsNow)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#cfe0d9] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60"
            >
              {busy === "pull" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              تحديث من الشيت
            </button>
          </div>
          <p className="mt-1 text-[12px] font-semibold text-[#78948f]">ما يُسجَّل في شيت المحادثات يظهر هنا وحده، ويمكن تسجيل محادثة جديدة مباشرة.</p>

          {/* a new conversation: the one who logs it is the one who received it */}
          <form
            className="mt-3 grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_9rem_minmax(0,1fr)_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void run("add", () => addLead(draft)).then((ok) => ok && setDraft({ phone: "", name: "", inquiry: "", destination: "" }));
            }}
          >
            <input required inputMode="tel" placeholder="رقم الهاتف" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={CELL} />
            <input placeholder="اسم العميل" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={CELL} />
            <select value={draft.inquiry} onChange={(e) => setDraft({ ...draft, inquiry: e.target.value })} className={CELL}>
              <option value="">نوع الاستفسار</option>
              {INQUIRIES.map((i) => <option key={i}>{i}</option>)}
            </select>
            <input placeholder="الدولة / التفاصيل" value={draft.destination} onChange={(e) => setDraft({ ...draft, destination: e.target.value })} className={CELL} />
            <button type="submit" disabled={busy !== null} className="inline-flex h-8 items-center justify-center gap-1 rounded-[8px] bg-[#185045] px-3 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60">
              {busy === "add" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              تسجيل محادثة
            </button>
          </form>
          {error ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}
        </section>

        <section className="rounded-[16px] border border-[#d8e6e0] bg-white p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            {TABS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`h-8 rounded-full px-3 text-[12px] font-bold ${tab === k ? "bg-[#185045] text-white" : "border border-[#cfe0d9] text-[#185045] hover:bg-[#f4f8f6]"}`}
              >
                {label} <span className="tv-tnum opacity-70">{count(k)}</span>
              </button>
            ))}
            <label className="relative ms-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute start-2 top-2 size-4 text-[#93aaa3]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث: رقم، اسم، دولة، موظف" className={`${CELL} ps-8`} />
            </label>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1100px] border-separate border-spacing-y-1 text-start text-[12px]">
              <thead className="text-[10.5px] font-extrabold text-[#78948f]">
                <tr className="[&>th]:px-2 [&>th]:text-start">
                  <th>العميل</th>
                  <th>الاستفسار</th>
                  <th>الدولة / التفاصيل</th>
                  <th>البرنامج</th>
                  <th>المستلم</th>
                  <th>مسنَدة إلى</th>
                  <th>ما أُرسل</th>
                  <th>ما تم مع العميل</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {list.map((l) => (
                  <tr key={l.id} className={`[&>td]:px-2 [&>td]:py-1.5 ${l.status === "closed" ? "bg-[#f5f7fa] text-[#78948f]" : "bg-[#f8fbfa]"}`}>
                    <td className="min-w-[10rem] rounded-s-[10px] border-s-4 border-s-[#0f7a52]">
                      <span className="block truncate font-bold text-[#103f37]">{l.name || "—"}</span>
                      <a href={`https://wa.me/${l.phone}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#0f7a52] hover:underline">
                        <MessageCircle className="size-3" />
                        <DirText>{l.phone}</DirText>
                      </a>
                      {l.returning ? <span className="ms-1 rounded-full border border-[#f4d9a6] bg-[#fff8e8] px-1.5 text-[10px] font-bold text-[#a86a10]">عميل سابق</span> : null}
                    </td>
                    <td className="w-32">
                      <select value={l.inquiry ?? ""} onChange={(e) => save(l, { inquiry: e.target.value })} className={CELL}>
                        <option value="">—</option>
                        {[...new Set([...INQUIRIES, l.inquiry ?? ""])].filter(Boolean).map((i) => <option key={i}>{i}</option>)}
                      </select>
                    </td>
                    <td className="min-w-[9rem]">
                      <input defaultValue={l.destination ?? ""} onBlur={(e) => e.target.value !== (l.destination ?? "") && save(l, { destination: e.target.value })} className={CELL} />
                    </td>
                    <td className="w-36">
                      {/* the programme made for the client classifies them: «ماليزيا» */}
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void open(l)}
                        className={`inline-flex h-8 w-full items-center justify-center gap-1 rounded-[8px] px-2 text-[11.5px] font-bold ${l.file ? "border border-[#bfe5d4] bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#185045] text-white hover:bg-[#0f4439]"}`}
                      >
                        {busy === `p-${l.id}` ? <Loader2 className="size-3.5 animate-spin" /> : null}
                        {l.file ? l.file.destination || "فتح البرنامج" : "ابدأ برنامج"}
                      </button>
                    </td>
                    <td className="w-28 truncate font-semibold">{nameOf.get(l.received_by ?? "") ?? l.received_by_name ?? "—"}</td>
                    <td className="w-40">
                      <select value={l.assigned_to ?? ""} onChange={(e) => save(l, { assigned_to: e.target.value })} className={CELL}>
                        <option value="">{l.assigned_to_name ? `${l.assigned_to_name} (من الشيت)` : "لم تُسنَد"}</option>
                        {team.map((e) => <option key={e.id} value={e.id}>{e.arabic_name}</option>)}
                      </select>
                    </td>
                    <td className="w-40">
                      <select value={l.sent_status ?? ""} onChange={(e) => save(l, { sent_status: e.target.value })} className={CELL}>
                        <option value="">لم يُرسل شيء</option>
                        {[...new Set([...SENT, l.sent_status ?? ""])].filter(Boolean).map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="min-w-[10rem]">
                      <input defaultValue={l.done_text ?? ""} placeholder="ملاحظة" onBlur={(e) => e.target.value !== (l.done_text ?? "") && save(l, { done_text: e.target.value })} className={CELL} />
                    </td>
                    <td className="w-28 rounded-e-[10px]">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => save(l, { status: l.status === "open" ? "closed" : "open" })}
                        className={`h-8 w-full rounded-[8px] text-[11.5px] font-bold ${l.status === "open" ? "bg-[#2f7fc0] text-white hover:bg-[#256aa3]" : "border border-[#cfe0d9] bg-white text-[#557d78]"}`}
                      >
                        {l.status === "open" ? "مفتوحة · أغلق" : "مغلقة · افتح"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length === 0 ? <p className="py-8 text-center text-[12px] font-semibold text-[#93aaa3]">لا محادثات هنا.</p> : null}
          </div>
          <p className="mt-2 text-[11px] font-semibold text-[#93aaa3]">
            {list.length} من {leads.length} · <Link href="/basic" className="hover:underline">النظام بيسك</Link>
          </p>
        </section>
      </div>
    </TraveliunShell>
  );
}
