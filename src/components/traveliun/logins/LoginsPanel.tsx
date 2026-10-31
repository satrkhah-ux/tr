"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Eye, EyeOff, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteLogin, revealLogin, saveLogin, type LoginInput, type LoginRow } from "@/lib/logins/actions";
import { LOGIN_KINDS } from "@/lib/logins/kinds";

/**
 * «حسابات الدخول» (the owner, 2026-10-31): one place for every login the company holds — the employee writes the
 * account, its password, the email and phone it is tied to, and saves; the administration sees them all. A password
 * shows only on «اعرض» (audited), never in the list.
 */
const card = "rounded-2xl border border-tv-border-default bg-tv-surface-raised p-4 shadow-sm sm:p-5";
const field = "tv-field min-h-10 w-full rounded-lg border border-tv-border-default bg-tv-surface-raised px-3 text-[13px]";
const KIND = new Map<string, string>(LOGIN_KINDS);
const EMPTY: LoginInput = { name: "", kind: "social", url: "", username: "", email: "", phone: "", notes: "", password: "" };

export function LoginsPanel({ rows, manager, vault }: { rows: LoginRow[]; manager: boolean; vault: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<LoginInput | null>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [pending, start] = useTransition();

  const set = (k: keyof LoginInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  const save = () =>
    form &&
    start(async () => {
      const r = await saveLogin(form);
      if (!r.ok) return setMsg(r.error);
      setMsg("حُفظ ✓");
      setForm(null);
      router.refresh();
    });

  const reveal = (id: string) =>
    start(async () => {
      if (shown[id] !== undefined)
        return setShown((s) => {
          const next = { ...s };
          delete next[id];
          return next;
        });
      const r = await revealLogin(id);
      if (!r.ok) return setMsg(r.error);
      setShown((s) => ({ ...s, [id]: r.password }));
    });

  const remove = (r: LoginRow) =>
    window.confirm(`حذف «${r.name}» نهائياً؟`) &&
    start(async () => {
      const res = await deleteLogin(r.id);
      setMsg(res.ok ? "حُذف" : res.error);
      router.refresh();
    });

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMsg("نُسخ ✓");
    } catch {
      setMsg("تعذّر النسخ");
    }
  };

  const needle = q.trim().toLowerCase();
  const list = rows.filter(
    (r) => (kind === "all" || r.kind === kind) && (!needle || [r.name, r.url, r.username, r.email, r.phone, r.notes, r.createdByName].some((v) => v?.toLowerCase().includes(needle))),
  );

  return (
    <div dir="rtl" className="tv-fade-up mx-auto max-w-5xl space-y-4">
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-extrabold text-tv-text-strong"><KeyRound className="size-5" />حسابات الدخول</h1>
            <p className="mt-1 text-[13px] font-semibold text-tv-text-faint">
              {manager ? "كل حسابات الشركة التي أضافها الموظفون." : "أضف كل حساب تستخدمه للشركة — تراه الإدارة، ولا يراه غيرك من الموظفين."} كلمة السر محفوظة مشفّرة، ولا تظهر إلا عند «اعرض».
            </p>
          </div>
          {!form && (
            <button type="button" onClick={() => { setForm({ ...EMPTY }); setMsg(null); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-tv-action-primary px-4 text-[13px] font-extrabold text-tv-action-on-primary">
              <Plus className="size-4" />أضف حساباً
            </button>
          )}
        </div>
        {!vault && <p className="mt-3 rounded-lg bg-[#fff1f1] px-3 py-2 text-[12.5px] font-bold text-[#c43d3d]">التشفير غير مُعدّ على الخادم — لا يمكن حفظ كلمات السر الآن.</p>}

        {form && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-[12.5px] font-bold text-tv-text-muted">اسم الحساب أو المنصة *
              <input value={form.name} onChange={set("name")} placeholder="انستقرام ترافليون، بوابة TBO…" className={`${field} mt-1`} />
            </label>
            <label className="text-[12.5px] font-bold text-tv-text-muted">النوع
              <select value={form.kind} onChange={set("kind")} className={`${field} mt-1`}>
                {LOGIN_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="text-[12.5px] font-bold text-tv-text-muted">اسم المستخدم
              <input value={form.username ?? ""} onChange={set("username")} dir="ltr" autoComplete="off" className={`${field} mt-1`} />
            </label>
            <label className="text-[12.5px] font-bold text-tv-text-muted">كلمة السر {form.id ? "(اتركها فارغة لتبقى كما هي)" : ""}
              <input type="password" value={form.password ?? ""} onChange={set("password")} dir="ltr" autoComplete="new-password" className={`${field} mt-1`} />
            </label>
            <label className="text-[12.5px] font-bold text-tv-text-muted">الإيميل المرتبط
              <input type="email" value={form.email ?? ""} onChange={set("email")} dir="ltr" autoComplete="off" className={`${field} mt-1`} />
            </label>
            <label className="text-[12.5px] font-bold text-tv-text-muted">رقم الهاتف المرتبط
              <input type="tel" inputMode="tel" value={form.phone ?? ""} onChange={set("phone")} dir="ltr" autoComplete="off" className={`${field} mt-1`} />
            </label>
            <label className="text-[12.5px] font-bold text-tv-text-muted sm:col-span-2">رابط الدخول
              <input value={form.url ?? ""} onChange={set("url")} dir="ltr" placeholder="https://" autoComplete="off" className={`${field} mt-1`} />
            </label>
            <label className="text-[12.5px] font-bold text-tv-text-muted sm:col-span-2">ملاحظات (التحقق بخطوتين، من يستخدمه…)
              <textarea value={form.notes ?? ""} onChange={set("notes")} rows={2} className={`${field} mt-1 py-2`} />
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <button type="button" disabled={pending} onClick={save} className="min-h-10 rounded-xl bg-tv-action-primary px-5 text-[13px] font-extrabold text-tv-action-on-primary disabled:opacity-50">احفظ</button>
              <button type="button" onClick={() => setForm(null)} className="min-h-10 rounded-xl border border-tv-border-default px-5 text-[13px] font-bold text-tv-text-muted">إلغاء</button>
            </div>
          </div>
        )}
        {msg && <p role="status" className="mt-3 text-[13px] font-bold text-tv-text-muted">{msg}</p>}
      </section>

      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الإيميل أو الرقم" className={`${field} sm:max-w-xs`} />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={field.replace("w-full", "w-auto")}>
            <option value="all">كل الأنواع</option>
            {LOGIN_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <span className="ms-auto text-[12.5px] font-bold text-tv-text-faint">{list.length} حساب</span>
        </div>
        {list.length === 0 ? (
          <p className="py-6 text-center text-[13px] font-semibold text-tv-text-faint">لا حسابات بعد — اضغط «أضف حساباً».</p>
        ) : (
          <ul className="divide-y divide-tv-border-default">
            {list.map((r) => (
              <li key={r.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]">
                <div className="min-w-0 space-y-1 text-[13px]">
                  <p className="font-extrabold text-tv-text-strong">
                    {r.name} <span className="ms-1 rounded-full bg-tv-surface-sunken px-2 py-0.5 text-[11px] font-bold text-tv-text-muted">{KIND.get(r.kind) ?? r.kind}</span>
                  </p>
                  <dl className="grid gap-x-4 gap-y-0.5 text-tv-text-muted sm:grid-cols-2">
                    {r.username && <div>المستخدم: <bdi dir="ltr" className="font-bold text-tv-text-strong">{r.username}</bdi></div>}
                    {r.email && <div>الإيميل: <bdi dir="ltr" className="font-bold text-tv-text-strong">{r.email}</bdi></div>}
                    {r.phone && <div>الهاتف: <bdi dir="ltr" className="font-bold text-tv-text-strong">{r.phone}</bdi></div>}
                    {r.url && <div className="truncate">الرابط: <a href={r.url} target="_blank" rel="noreferrer" dir="ltr" className="font-bold text-tv-text-brand underline">{r.url}</a></div>}
                    {r.hasPassword && (
                      <div>
                        كلمة السر: <bdi dir="ltr" className="font-mono font-bold text-tv-text-strong">{shown[r.id] ?? "••••••••"}</bdi>
                        {shown[r.id] !== undefined && (
                          <button type="button" onClick={() => void copy(shown[r.id])} aria-label="انسخ كلمة السر" className="ms-1 inline-grid size-7 place-items-center rounded-md align-middle text-tv-text-muted hover:bg-tv-surface-sunken"><Copy className="size-3.5" /></button>
                        )}
                      </div>
                    )}
                  </dl>
                  {r.notes && <p className="text-[12.5px] text-tv-text-faint">{r.notes}</p>}
                  {manager && r.createdByName && <p className="text-[11.5px] font-semibold text-tv-text-faint">أضافه: {r.createdByName}</p>}
                </div>
                <div className="flex items-start gap-1.5">
                  {r.hasPassword && (
                    <button type="button" disabled={pending} onClick={() => reveal(r.id)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-tv-border-default px-3 text-[12px] font-bold text-tv-text-brand disabled:opacity-50">
                      {shown[r.id] !== undefined ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{shown[r.id] !== undefined ? "أخفِ" : "اعرض"}
                    </button>
                  )}
                  <button type="button" onClick={() => { setForm({ id: r.id, name: r.name, kind: r.kind, url: r.url ?? "", username: r.username ?? "", email: r.email ?? "", phone: r.phone ?? "", notes: r.notes ?? "", password: "" }); setMsg(null); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-label="عدّل" className="grid size-9 place-items-center rounded-lg border border-tv-border-default text-tv-text-muted"><Pencil className="size-3.5" /></button>
                  <button type="button" disabled={pending} onClick={() => remove(r)} aria-label="احذف" className="grid size-9 place-items-center rounded-lg border border-tv-border-default text-tv-status-danger disabled:opacity-50"><Trash2 className="size-3.5" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
