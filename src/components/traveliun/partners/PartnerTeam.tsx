"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { DirText } from "@/components/DirText";
import { invitePartnerUser, setPartnerUserActive, type TeamMember } from "@/lib/partners/registration";
import { useSafeTransition } from "../useSafeTransition";

/**
 * «فريق الشركة» — the owner's: who logs in for the company, as what, and a way
 * to add a colleague or stop a login. A colleague receives a set-your-password
 * link; nobody here ever sees a password.
 */

const ROLE: Record<TeamMember["role"], string> = { owner: "مدير الحساب", sales: "موظف مبيعات" };
const field =
  "tv-field h-9 rounded-[8px] border px-2.5 text-[12.5px] font-semibold";

export function PartnerTeam({ team }: { team: TeamMember[] }) {
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [form, setForm] = useState({ email: "", name: "", role: "sales" as TeamMember["role"] });
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section className="rounded-[14px] border border-[#e2ebe7] bg-white p-5 dark:border-[#22443b] dark:bg-[#12241f]">
      <h2 className="text-[14px] font-extrabold text-[var(--tv-brand)]">فريق الشركة</h2>
      <p className="mb-3 mt-0.5 text-[12px] font-semibold text-tv-text-faint">
        مدير الحساب يرى كشف الحساب ويدير الفريق؛ موظف المبيعات يُصدر العروض ويسجّل تأكيد العملاء.
      </p>

      <ul className="space-y-1.5">
        {team.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-[#f4f8f6] px-3 py-2 text-[12.5px] dark:bg-[#17302a]">
            <span className="min-w-0 font-bold">
              {m.name ? `${m.name} · ` : ""}
              <DirText dir="ltr">{m.email}</DirText>
              {m.me ? <span className="ms-1.5 text-[11px] text-tv-text-faint">(أنت)</span> : null}
            </span>
            <span className="flex items-center gap-2 text-[11.5px] font-bold">
              <span className="text-[#557d78]">{ROLE[m.role]}</span>
              {m.status === "active" ? null : <span className="text-[#c22850]">موقوف</span>}
              {m.me ? null : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      setNote(null);
                      const res = await setPartnerUserActive(m.id, m.status !== "active");
                      if (res.ok) router.refresh();
                      else setNote({ ok: false, text: res.message });
                    })
                  }
                  className="rounded-[7px] border border-[#d8e4df] bg-white px-2 py-1 text-[11px] text-[#557d78] disabled:opacity-60 dark:border-[#294039] dark:bg-[#0f1f1b]"
                >
                  {m.status === "active" ? "إيقاف" : "إعادة تفعيل"}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            setNote(null);
            const res = await invitePartnerUser(form);
            if (res.ok) {
              setNote({ ok: true, text: `أُرسل رابط تعيين كلمة المرور إلى ${form.email}.` });
              setForm({ email: "", name: "", role: "sales" });
              router.refresh();
            } else setNote({ ok: false, text: res.message });
          });
        }}
      >
        <label className="grid min-w-[200px] flex-1 gap-1 text-[11.5px] font-bold text-[#185045]">
          البريد
          <input id="team-email" type="email" dir="ltr" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} />
        </label>
        <label className="grid min-w-[140px] gap-1 text-[11.5px] font-bold text-[#185045]">
          الاسم
          <input id="team-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
        </label>
        <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
          الدور
          <select id="team-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as TeamMember["role"] })} className={field}>
            <option value="sales">{ROLE.sales}</option>
            <option value="owner">{ROLE.owner}</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[var(--tv-brand)] px-3 text-[12px] font-bold text-white disabled:opacity-60">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          إضافة مستخدم
        </button>
      </form>
      {note ? <p className={`mt-2 text-[12px] font-bold ${note.ok ? "text-[#0f7a52]" : "text-[#c22850]"}`}>{note.text}</p> : null}
    </section>
  );
}
