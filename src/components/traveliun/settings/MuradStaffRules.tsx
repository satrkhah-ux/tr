"use client";

import { useState } from "react";
import { saveMuradStaffRules } from "@/lib/data/murad-staff-rules";
import { STAFF_RULES, STAFF_RULE_SECTIONS, type MuradStaffRulesDoc, type StaffRuleChoice } from "@/lib/murad/staff-rules-catalog";

const CHOICE_LABELS: [StaffRuleChoice, string][] = [["approve", "نفّذ"], ["reject", "لا تنفّذ"], ["edit", "تعديل"]];
const CHOICE_STYLE: Record<StaffRuleChoice, string> = {
  approve: "border-emerald-600 bg-emerald-50 text-emerald-800",
  reject: "border-red-500 bg-red-50 text-red-700",
  edit: "border-amber-500 bg-amber-50 text-amber-800",
};

export function MuradStaffRules({ initial }: { initial: MuradStaffRulesDoc }) {
  // «في زر بالأعلى كي لا تكون الصفحة طويلة» (the owner, 2026-10-24): folded by default
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [addText, setAddText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save(next: MuradStaffRulesDoc) {
    setDoc(next);
    setBusy(true); setMessage("");
    try {
      const r = await saveMuradStaffRules(next, doc.updatedAt);
      if (r.ok && r.doc) setDoc(r.doc);
      else { if (r.doc) setDoc(r.doc); setMessage(r.error ?? "تعذّر الحفظ"); }
    } catch { setMessage("تعذّر الاتصال"); } finally { setBusy(false); }
  }

  function decide(id: string, choice: StaffRuleChoice) {
    const prev = doc.decisions[id];
    void save({ ...doc, decisions: { ...doc.decisions, [id]: { choice, text: choice === "edit" ? prev?.text : undefined } } });
  }

  function saveEdit(id: string) {
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    void save({ ...doc, decisions: { ...doc.decisions, [id]: { choice: "edit", text } } });
  }

  function addRule() {
    const text = addText.trim();
    if (!text) return;
    setAddText("");
    void save({ ...doc, added: [...doc.added, { id: `u${Date.now()}`, text }] });
  }

  const counts = { approve: 0, reject: 0, edit: 0 };
  for (const r of STAFF_RULES) { const c = doc.decisions[r.id]?.choice; if (c) counts[c]++; }
  const undecided = STAFF_RULES.length - counts.approve - counts.reject - counts.edit;

  return <section className="space-y-5">
    <header className="rounded-2xl border bg-white p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-xl font-extrabold">قواعد مراد بين الموظفين</h2>
        <span className="text-sm tabular-nums text-[#5b7a71]">نفّذ <b>{counts.approve}</b> · لا تنفّذ <b>{counts.reject}</b> · تعديل <b>{counts.edit}</b> · بلا قرار <b>{undecided}</b></span>
        <button onClick={() => setOpen(!open)} className="rounded-lg bg-[#185045] px-5 py-2 text-sm font-bold text-white">
          {open ? "أخفِ القواعد" : "اعرض القواعد"}
        </button>
      </div>
      {open && <p className="mt-2 text-sm">الخطتان المقترحتان لمتابعة الطلبات غير المردود عليها والسحب التلقائي. قرّر لكل قاعدة: نفّذ، لا تنفّذ، أو تعديل (واكتب القاعدة كما تريدها). لا شيء يُنفَّذ قبل الاعتماد، والتنفيذ يبدأ بوضع تجريبي.</p>}
    </header>

    {open && <>
    {(["a", "b", "s"] as const).map((sec) => <div key={sec} className="rounded-2xl border bg-white p-5">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h3 className="font-bold">{STAFF_RULE_SECTIONS[sec].title}</h3>
        <span className="rounded-full border px-3 py-0.5 text-xs">{STAFF_RULE_SECTIONS[sec].tag}</span>
      </div>
      <p className="mb-4 text-sm text-[#5b7a71]">{STAFF_RULE_SECTIONS[sec].note}</p>
      <div className="space-y-3">
        {STAFF_RULES.filter((r) => r.sec === sec).map((r) => {
          const dec = doc.decisions[r.id];
          return <article key={r.id} className={`rounded-xl border p-4 ${dec ? CHOICE_STYLE[dec.choice].split(" ")[0] : ""} ${dec?.choice === "reject" ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="rounded border px-2 py-0.5 text-xs font-bold">{r.id.toUpperCase()}</span>
              <strong className="text-sm">{r.title}</strong>
            </div>
            <p className="my-2 text-sm leading-7">{r.desc}</p>
            <div className="flex flex-wrap gap-2">
              {CHOICE_LABELS.map(([c, label]) => <button key={c} disabled={busy} onClick={() => decide(r.id, c)}
                className={`rounded-lg border px-4 py-1.5 text-sm font-bold ${dec?.choice === c ? CHOICE_STYLE[c] : "bg-white"}`}>{label}</button>)}
            </div>
            {dec?.choice === "edit" && <div className="mt-3 space-y-2">
              <label className="block text-xs">اكتب القاعدة كما تريدها (وقت، صياغة، استثناء…):
                <textarea value={drafts[r.id] ?? dec.text ?? r.desc} onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })}
                  maxLength={2000} className="tv-field mt-1 w-full rounded-lg border p-3 text-sm" rows={3} />
              </label>
              <button disabled={busy} onClick={() => saveEdit(r.id)} className="rounded-lg bg-[#185045] px-4 py-1.5 text-sm font-bold text-white">احفظ التعديل</button>
              {dec.text && <p className="rounded-lg bg-amber-50 p-2 text-xs leading-6">التعديل المحفوظ: {dec.text}</p>}
            </div>}
          </article>;
        })}
      </div>
    </div>)}

    <div className="rounded-2xl border bg-white p-5">
      <h3 className="mb-1 font-bold">قواعد تضيفها أنت</h3>
      <p className="mb-3 text-sm text-[#5b7a71]">اكتب أي قاعدة تريد إضافتها للاعتماد، بأي صياغة.</p>
      <div className="space-y-2">
        {doc.added.map((a) => <div key={a.id} className="flex items-start gap-3 rounded-xl border p-3">
          <p className="min-w-0 flex-1 text-sm leading-7">{a.text}</p>
          <button disabled={busy} onClick={() => void save({ ...doc, added: doc.added.filter((x) => x.id !== a.id) })} className="text-sm text-red-600 underline">حذف</button>
        </div>)}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <textarea value={addText} onChange={(e) => setAddText(e.target.value)} maxLength={1000} rows={2}
          placeholder="مثال: السحب لا يشمل عملاء كباراً محددين بقائمة…" className="tv-field w-full rounded-lg border p-3 text-sm" />
        <button disabled={busy || !addText.trim()} onClick={addRule} className="self-start rounded-lg bg-[#185045] px-4 py-2 text-sm font-bold text-white">أضف القاعدة</button>
      </div>
    </div>

    <div className="sticky bottom-3 rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="flex-1 tabular-nums">نفّذ <b>{counts.approve}</b> · لا تنفّذ <b>{counts.reject}</b> · تعديل <b>{counts.edit}</b> · بلا قرار <b>{undecided}</b></span>
        {doc.approvedAt && <span className="font-bold text-emerald-700">اعتُمدت في {new Date(doc.approvedAt).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" })}</span>}
        <button disabled={busy} onClick={() => void save({ ...doc, approvedAt: new Date().toISOString() })}
          className="rounded-lg bg-[#185045] px-5 py-2 font-bold text-white">{doc.approvedAt ? "حدّث الاعتماد" : "اعتمد القرارات"}</button>
      </div>
      <p role="status" className="mt-1 text-sm text-red-700">{message}</p>
    </div>
    </>}
  </section>;
}
