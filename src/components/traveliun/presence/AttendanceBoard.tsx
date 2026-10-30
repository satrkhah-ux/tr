"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addLeave,
  callMeeting,
  cancelLeave,
  endMeeting,
  endShift,
  saveHolidays,
  saveShift,
  saveStatusLimits,
  type AttendanceData,
} from "@/lib/data/presence-status";
import { DAY_NAMES, SAT_FIRST_DAYS } from "@/lib/presence/shift";
import { EXCUSE_LABEL, STATUS_KINDS, type StatusKind, type StatusLimits } from "@/lib/presence/excuse";

/**
 * «الحضور والإجازات» (the owner, 2026-10-29): the leaves (who, from, to, why), the meetings the administration calls, and
 * the day's status buttons — who pressed what, when, for how long, and whether it closed itself at the limit.
 */

const card = "rounded-2xl border border-[#E3E8E4] bg-white p-4 dark:border-[#294039] dark:bg-[#14231f]";
const btn =
  "inline-flex min-h-10 items-center justify-center rounded-xl border border-[#D5DED9] bg-white px-3 text-sm font-bold text-[#185045] hover:bg-[#F4F6F3] disabled:opacity-40";
const primary = "inline-flex min-h-10 items-center justify-center rounded-xl bg-[#185045] px-4 text-sm font-bold text-white disabled:opacity-40";
const field = "tv-field mt-1 w-full rounded-xl border p-2.5 text-sm";
const time = (iso: string) => new Date(iso).toLocaleTimeString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" });
const ENDED: Record<string, string> = { employee: "أنهاها", auto: "أُغلقت تلقائياً عند الحد", manager: "أنهتها الإدارة" };

export function AttendanceBoard({ data }: { data: AttendanceData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState("");
  const run = (task: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await task().catch(() => ({ ok: false, error: "تعذّر الحفظ، أعد المحاولة." }));
      setNotice(r.ok ? ok : (r.error ?? "تعذّر الحفظ."));
      if (r.ok) router.refresh();
    });

  const today = data.day;
  const live = data.leaves.filter((l) => !l.cancelled);
  return (
    <div dir="rtl" className="space-y-4 rounded-3xl bg-[#F4F6F3] p-2 text-[#12332c] sm:p-3 dark:bg-transparent dark:text-[#eaf3ef]">
      <section className={card}>
        <h1 className="text-2xl font-extrabold">الحضور والإجازات</h1>
        <p className="mt-1 text-sm text-slate-500">من في إجازة أو مع عميل أو في صلاة أو اجتماع: لا تُحوَّل إليه طلبات ولا يُحسب عليه تأخير.</p>
        {notice && (
          <p role="status" className="mt-3 rounded-xl bg-[#EEF5F1] p-2.5 text-sm text-[#185045]">
            {notice}
          </p>
        )}
      </section>

      <LeaveForm people={data.people} today={today} busy={pending} onSave={(v) => run(() => addLeave(v), "سُجّلت الإجازة وأُبلغ الموظف في «تنبيهاتي».")} />

      <section className={card}>
        <h2 className="mb-2 font-extrabold">الإجازات الحالية والقادمة</h2>
        {live.length ? (
          <table className="w-full text-sm">
            <thead className="text-slate-500">
              <tr>
                {["الموظف", "من", "إلى", "السبب", "سجّلها", ""].map((h) => (
                  <th key={h} className="p-2 text-start font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {live.map((l) => (
                <tr key={l.id} className="border-t border-[#E3E8E4]">
                  <td className="p-2 font-bold">
                    {l.name}
                    {l.startsOn <= today && today <= l.endsOn ? (
                      <span className="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">اليوم</span>
                    ) : null}
                  </td>
                  <td className="p-2">{l.startsOn}</td>
                  <td className="p-2">{l.endsOn}</td>
                  <td className="p-2">{l.reason || "—"}</td>
                  <td className="p-2 text-slate-500">{l.by ?? "—"}</td>
                  <td className="p-2">
                    <button className={btn} disabled={pending} onClick={() => run(() => cancelLeave(l.id), "أُلغيت الإجازة.")}>
                      إلغاء
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">لا إجازات الآن.</p>
        )}
      </section>

      <MeetingForm people={data.people} busy={pending} onSave={(t, ids) => run(() => callMeeting(t, ids), "بدأ الاجتماع وأُبلغ المدعوّون في «تنبيهاتي».")} />

      {data.meetings.length > 0 && (
        <section className={card}>
          <h2 className="mb-2 font-extrabold">اجتماعات اليوم</h2>
          <ul className="space-y-2 text-sm">
            {data.meetings.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E3E8E4] pt-2">
                <span>
                  <b>{m.title}</b> · {time(m.startsAt)}
                  {m.endsAt ? ` → ${time(m.endsAt)}` : " · جارٍ"} · المدعوّون: {m.invited.join("، ")}
                </span>
                {!m.endsAt && (
                  <button className={btn} disabled={pending} onClick={() => run(() => endMeeting(m.id), "انتهى الاجتماع.")}>
                    إنهاء الاجتماع
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <h2 className="mb-2 font-extrabold">أزرار الحالة اليوم ({data.log.length})</h2>
        {data.log.length ? (
          <table className="w-full text-sm">
            <thead className="text-slate-500">
              <tr>
                {["الموظف", "الحالة", "من", "إلى", "المدة", "التفاصيل"].map((h) => (
                  <th key={h} className="p-2 text-start font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.log.map((s) => {
                const d = s.details as { name?: string; want?: string; destination?: string; phone?: string; note?: string; for_name?: string };
                return (
                  <tr key={s.id} className="border-t border-[#E3E8E4]">
                    <td className="p-2 font-bold">{s.name}</td>
                    <td className="p-2">{EXCUSE_LABEL[s.kind]}</td>
                    <td className="p-2">{time(s.startedAt)}</td>
                    <td className="p-2">{s.endedAt ? `${time(s.endedAt)} · ${ENDED[s.endedBy ?? ""] ?? ""}` : "ما زالت مفعّلة"}</td>
                    <td className="p-2">{s.minutes} د</td>
                    <td className="p-2 text-slate-600">
                      {[d.want, d.destination, d.name, d.phone ? <bdi key="p">{d.phone}</bdi> : null, d.note, d.for_name ? `يريد ${d.for_name}` : null].filter(Boolean).map((x, i) => (
                        <span key={i}>
                          {i ? " · " : ""}
                          {x}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">لم يضغط أحد زر حالة اليوم.</p>
        )}
      </section>

      <LimitsForm limits={data.limits} busy={pending} onSave={(l) => run(() => saveStatusLimits(l), "حُفظت الحدود القصوى.")} />
      <ShiftsSection
        data={data}
        busy={pending}
        onSave={(v) => run(() => saveShift(v), "حُفظ الدوام الخاص.")}
        onEnd={(id) => run(() => endShift(id), "عاد الموظف إلى دوام المكتب.")}
      />
      <HolidaysForm holidays={data.holidays} busy={pending} onSave={(h) => run(() => saveHolidays(h), "حُفظت العطل الرسمية.")} />
    </div>
  );
}

function LeaveForm({
  people,
  today,
  busy,
  onSave,
}: {
  people: { id: string; name: string }[];
  today: string;
  busy: boolean;
  onSave: (v: { employeeId: string; startsOn: string; endsOn: string; reason: string }) => void;
}) {
  const [v, setV] = useState({ employeeId: "", startsOn: today, endsOn: today, reason: "" });
  return (
    <section className={card}>
      <h2 className="mb-2 font-extrabold">منح إجازة</h2>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-xs font-bold">
          الموظف
          <select className={field} value={v.employeeId} onChange={(e) => setV({ ...v, employeeId: e.target.value })}>
            <option value="">اختر…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold">
          من
          <input
            type="date"
            className={field}
            value={v.startsOn}
            min={today}
            onChange={(e) => setV({ ...v, startsOn: e.target.value, endsOn: e.target.value > v.endsOn ? e.target.value : v.endsOn })}
          />
        </label>
        <label className="text-xs font-bold">
          إلى
          <input type="date" className={field} value={v.endsOn} min={v.startsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} />
        </label>
        <label className="text-xs font-bold">
          السبب
          <input className={field} maxLength={300} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="سنوية، مرضية…" />
        </label>
      </div>
      <button className={`${primary} mt-3`} disabled={busy || !v.employeeId} onClick={() => onSave(v)}>
        حفظ الإجازة
      </button>
    </section>
  );
}

function MeetingForm({ people, busy, onSave }: { people: { id: string; name: string }[]; busy: boolean; onSave: (title: string, ids: string[]) => void }) {
  const [title, setTitle] = useState("");
  const [ids, setIds] = useState<Set<string>>(new Set());
  return (
    <section className={card}>
      <h2 className="mb-2 font-extrabold">استدعاء اجتماع</h2>
      <label className="block text-xs font-bold">
        العنوان
        <input className={field} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="اجتماع فريق المبيعات" />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        {people.map((p) => (
          <label
            key={p.id}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-bold ${ids.has(p.id) ? "border-[#185045] bg-[#185045] text-white" : "border-[#D5DED9]"}`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={ids.has(p.id)}
              onChange={(e) => {
                const next = new Set(ids);
                if (e.target.checked) next.add(p.id);
                else next.delete(p.id);
                setIds(next);
              }}
            />
            {p.name}
          </label>
        ))}
      </div>
      <button className={`${primary} mt-3`} disabled={busy || !title.trim() || !ids.size} onClick={() => onSave(title, [...ids])}>
        ابدأ الاجتماع ({ids.size})
      </button>
    </section>
  );
}

function LimitsForm({ limits, busy, onSave }: { limits: StatusLimits; busy: boolean; onSave: (l: StatusLimits) => void }) {
  const [v, setV] = useState(limits);
  return (
    <section className={card}>
      <h2 className="mb-1 font-extrabold">الحد الأقصى لكل زر</h2>
      <p className="mb-2 text-sm text-slate-500">بعده يُغلق الزر تلقائياً ويُبلَّغ الموظف، كي لا يبقى مفعّلاً منسياً.</p>
      <div className="flex flex-wrap gap-4">
        {STATUS_KINDS.map((k: StatusKind) => (
          <label key={k} className="text-xs font-bold">
            {EXCUSE_LABEL[k]}
            <span className="mt-1 flex items-center gap-2">
              <input type="number" min={5} max={600} className={`${field} w-24`} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
              <span className="font-normal text-slate-500">دقيقة</span>
            </span>
          </label>
        ))}
      </div>
      <button className={`${primary} mt-3`} disabled={busy} onClick={() => onSave(v)}>
        حفظ الحدود
      </button>
    </section>
  );
}

function HolidaysForm({
  holidays,
  busy,
  onSave,
}: {
  holidays: { day: string; name: string }[];
  busy: boolean;
  onSave: (h: { day: string; name: string }[]) => void;
}) {
  const [list, setList] = useState(holidays);
  const [day, setDay] = useState("");
  const [name, setName] = useState("");
  return (
    <section className={card}>
      <h2 className="mb-1 font-extrabold">العطل الرسمية</h2>
      <p className="mb-2 text-sm text-slate-500">لا يُحسب فيها وقت عمل ولا تأخير على أحد.</p>
      <ul className="mb-2 space-y-1 text-sm">
        {list.map((h) => (
          <li key={h.day} className="flex items-center gap-2">
            <bdi>{h.day}</bdi> {h.name}
            <button className="text-xs text-[#9A3412] underline" onClick={() => setList(list.filter((x) => x.day !== h.day))}>
              حذف
            </button>
          </li>
        ))}
        {!list.length && <li className="text-slate-500">لا عطل مسجّلة.</li>}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <input type="date" className={`${field} w-auto`} value={day} onChange={(e) => setDay(e.target.value)} aria-label="اليوم" />
        <input
          className={`${field} w-48`}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="اليوم الوطني"
          aria-label="الاسم"
        />
        <button
          className={btn}
          disabled={!day}
          onClick={() => {
            setList([...list.filter((x) => x.day !== day), { day, name }].sort((a, b) => a.day.localeCompare(b.day)));
            setDay("");
            setName("");
          }}
        >
          إضافة
        </button>
        <button className={primary} disabled={busy} onClick={() => onSave(list)}>
          حفظ العطل
        </button>
      </div>
    </section>
  );
}

/** «الدوام الخاص»: a colleague's own hours over the office's — the seven days, Saturday first, each its windows */
function ShiftsSection({
  data,
  busy,
  onSave,
  onEnd,
}: {
  data: AttendanceData;
  busy: boolean;
  onSave: (v: { employeeId: string; days: string[]; startsOn: string; endsOn: string | null; note: string }) => void;
  onEnd: (employeeId: string) => void;
}) {
  const blank = { employeeId: "", days: ["", "", "", "", "", "", ""], startsOn: data.day, endsOn: "", note: "" };
  const [v, setV] = useState(blank);
  const pick = (employeeId: string) => {
    const own = data.shifts.find((s) => s.employeeId === employeeId);
    setV({ ...blank, employeeId, days: own ? own.days : blank.days, note: own?.note ?? "" });
  };
  return (
    <section className={card}>
      <h2 className="mb-1 font-extrabold">الدوام الخاص</h2>
      <p className="mb-2 text-sm text-slate-500">
        من له دوام غير دوام المكتب (ليلي، مقسّم، أيام أخرى). دوام المكتب: <bdi>{data.officeHours}</bdi>. لا تُحوَّل للموظف طلبات ولا يُحسب عليه تأخير خارج
        دوامه.
      </p>
      {data.shifts.length ? (
        <ul className="mb-3 space-y-1 text-sm">
          {data.shifts.map((s) => (
            <li key={s.employeeId} className="flex flex-wrap items-center gap-2 border-t border-[#E3E8E4] pt-1">
              <b>{s.name}</b> <bdi>{s.hours}</bdi>
              <span className="text-slate-500">
                من {s.startsOn}
                {s.endsOn ? ` إلى ${s.endsOn}` : ""}
                {s.note ? ` · ${s.note}` : ""}
              </span>
              <button className="text-xs underline" onClick={() => pick(s.employeeId)}>
                تعديل
              </button>
              <button className="text-xs text-[#9A3412] underline" disabled={busy} onClick={() => onEnd(s.employeeId)}>
                إعادته لدوام المكتب
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-slate-500">كل الموظفين على دوام المكتب.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-bold">
          الموظف
          <select className={field} value={v.employeeId} onChange={(e) => pick(e.target.value)}>
            <option value="">اختر…</option>
            {data.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold">
          يبدأ من
          <input type="date" className={field} min={data.day} value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} />
        </label>
        <label className="text-xs font-bold">
          ينتهي في (اختياري)
          <input type="date" className={field} min={v.startsOn} value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} />
        </label>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {SAT_FIRST_DAYS.map((d, i) => (
          <label key={d} className="flex items-center gap-2 text-xs font-bold">
            <span className="w-16 shrink-0">{DAY_NAMES[d]}</span>
            <input
              className={field}
              dir="ltr"
              value={v.days[i]}
              onChange={(e) => setV({ ...v, days: v.days.map((x, k) => (k === i ? e.target.value : x)) })}
              placeholder="16:00-00:00 — فارغ = إجازة"
              aria-label={`دوام ${DAY_NAMES[d]}`}
            />
          </label>
        ))}
      </div>
      <label className="mt-3 block text-xs font-bold">
        ملاحظة
        <input className={field} maxLength={200} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="مثال: الفترة الليلية" />
      </label>
      <button
        className={`${primary} mt-3`}
        disabled={busy || !v.employeeId}
        onClick={() => onSave({ employeeId: v.employeeId, days: v.days, startsOn: v.startsOn, endsOn: v.endsOn || null, note: v.note })}
      >
        حفظ الدوام
      </button>
    </section>
  );
}
