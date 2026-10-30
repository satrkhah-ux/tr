"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  editDecisionWording,
  issueDecisionNow,
  saveDecisionDraft,
  saveDecisionSettings,
  wordDecisionDraft,
  type DecisionsArchive,
} from "@/lib/data/admin-decisions";
import type { ArchiveFilter, Audience } from "@/lib/decisions/core";

import { buttonTone } from "@/components/ui/button-variants";
/**
 * «القرارات الإدارية» (the owner, 2026-10-29: «اريد ارشيف القرارات الإدارية يكون موجود ونرجع له: الموظف متى وقّع وعلى
 * ماذا استلم خطاب»): issue a decision (kind, whom, text, the suggested wording or the text as written, the PDF preview,
 * «أصدر»), then the archive — by decision with who acknowledged, or by employee with every decision and letter they got.
 */

const card =
  "tv-card rounded-2xl border p-4";
const btn =
  `${buttonTone({ variant: "secondary" })} inline-flex min-h-10 items-center justify-center rounded-xl border px-3 text-sm font-bold disabled:opacity-40`;
const primary =
  `${buttonTone({ variant: "default" })} inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-sm font-bold disabled:opacity-40`;
const field =
  "tv-field mt-1 w-full rounded-xl border p-2.5 text-sm";
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-bold ${on ? "border-[#185045] bg-[#185045] text-white" : "border-[#D5DED9] bg-white text-[#185045] dark:bg-[#0f1c19] dark:text-[#eaf3ef]"}`;
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        timeZone: "Asia/Riyadh",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Riyadh" });

export function DecisionsBoard({
  data,
  filter,
}: {
  data: DecisionsArchive;
  filter: ArchiveFilter;
}) {
  const [notice, setNotice] = useState("");
  return (
    <div
      dir="rtl"
      className="space-y-4 rounded-3xl bg-[#F4F6F3] p-2 text-[#12332c] sm:p-3 dark:bg-transparent dark:text-[#eaf3ef]"
    >
      <section className={card}>
        <h1 className="text-2xl font-extrabold">القرارات الإدارية</h1>
        <p className="mt-1 text-sm text-slate-500">
          كل قرار يصدر بهوية ترافليون ورقم متسلسل، ويصل لكل مستلم في «تنبيهاتي»
          وجرس النظام مع زر «استلمت». الخطابات الرسمية لقسم المبيعات تظهر هنا
          أيضاً.
        </p>
        {notice && (
          <p
            role="status"
            className="mt-3 rounded-xl bg-[#EEF5F1] p-2.5 text-sm text-[#185045]"
          >
            {notice}
          </p>
        )}
      </section>
      <IssueForm data={data} onNotice={setNotice} />
      <Filters data={data} filter={filter} />
      {filter.employeeId ? (
        <EmployeeArchive data={data} />
      ) : (
        <DecisionList data={data} />
      )}
      <Letters data={data} />
      <Settings data={data} onNotice={setNotice} />
    </div>
  );
}

function IssueForm({
  data,
  onNotice,
}: {
  data: DecisionsArchive;
  onNotice: (s: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState(data.settings.kinds[0] ?? "");
  const [audience, setAudience] = useState<Audience>({});
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<{
    id: string;
    count: number;
    label: string;
    title: string;
    body: string;
    worded: boolean;
  } | null>(null);
  const [error, setError] = useState("");

  const toggle = (key: "employees" | "roles" | "teams", id: string | number) =>
    setAudience((a) => {
      const list = (
        (a.all ? [] : (a[key] ?? [])) as (string | number)[]
      ).slice();
      const next = list.includes(id)
        ? list.filter((x) => x !== id)
        : [...list, id];
      setDraft(null);
      return { ...(a.all ? {} : a), [key]: next };
    });
  const run = <T,>(task: () => Promise<T>, then: (r: T) => void) =>
    start(async () => {
      setError("");
      try {
        then(await task());
      } catch {
        setError("تعذّر الحفظ، أعد المحاولة.");
      }
    });

  const save = () =>
    run(
      () => saveDecisionDraft({ id: draft?.id, kind, audience, text }),
      (r) =>
        r.ok
          ? setDraft({
              id: r.id,
              count: r.count,
              label: r.label,
              title: r.title,
              body: r.body,
              worded: false,
            })
          : setError(r.error),
    );
  const word = () =>
    draft &&
    run(
      () => wordDecisionDraft(draft.id),
      (r) =>
        r.ok
          ? setDraft({ ...draft, title: r.title, body: r.body, worded: true })
          : setError(r.error),
    );
  // the title and wording as edited, kept when leaving the field — the preview link prints what is stored
  const keep = () => {
    if (draft)
      void editDecisionWording(draft.id, draft.title, draft.body).then((r) => {
        if (!r.ok) setError(r.error);
      });
  };
  const issue = () =>
    draft &&
    run(
      async () => {
        const e = await editDecisionWording(draft.id, draft.title, draft.body);
        return e.ok ? issueDecisionNow(draft.id) : e;
      },
      (r) => {
        if (!r.ok) return setError(r.error);
        const x = r as {
          serial: string;
          recipients: number;
          delivered: number;
          noTelegram: number;
        };
        onNotice(
          `صدر القرار ${x.serial} إلى ${x.recipients}: وصل في «تنبيهاتي» إلى ${x.delivered}${x.noTelegram ? `، و${x.noTelegram} في جرس النظام فقط` : ""}.`,
        );
        setDraft(null);
        setText("");
        setAudience({});
        router.refresh();
      },
    );

  return (
    <section className={card}>
      <h2 className="mb-3 font-extrabold">📜 إصدار قرار</h2>
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        <label className="text-sm font-bold">
          نوع القرار
          <select
            className={field}
            value={kind}
            onChange={(e) => (setKind(e.target.value), setDraft(null))}
          >
            {data.settings.kinds.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <div className="text-sm font-bold">
          لمن يصدر
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button
              type="button"
              className={chip(Boolean(audience.all))}
              onClick={() => (
                setAudience(audience.all ? {} : { all: true }),
                setDraft(null)
              )}
            >
              👥 جميع الموظفين
            </button>
            {data.roles.map((r) => (
              <button
                key={r.id}
                type="button"
                className={chip(Boolean(audience.roles?.includes(r.id)))}
                onClick={() => toggle("roles", r.id)}
              >
                🏷️ قسم {r.name}
              </button>
            ))}
            {data.teams.map((t) => (
              <button
                key={t.id}
                type="button"
                className={chip(Boolean(audience.teams?.includes(t.id)))}
                onClick={() => toggle("teams", t.id)}
              >
                💬 {t.name}
              </button>
            ))}
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-slate-500">
              👤 موظفون بالاسم ({audience.employees?.length ?? 0})
            </summary>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {data.people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={chip(Boolean(audience.employees?.includes(p.id)))}
                  onClick={() => toggle("employees", p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </details>
        </div>
      </div>
      <label className="mt-3 block text-sm font-bold">
        نص القرار{" "}
        <span className="font-normal text-slate-500">
          — السطر الأول عنوان قصير إن أردت
        </span>
        <textarea
          className={`${field} min-h-36`}
          value={text}
          maxLength={6000}
          onChange={(e) => (setText(e.target.value), setDraft(null))}
        />
      </label>
      {error && (
        <p className="mt-2 rounded-xl bg-red-50 p-2.5 text-sm text-red-800">
          {error}
        </p>
      )}
      {!draft ? (
        <button
          type="button"
          className={`${primary} mt-3`}
          disabled={pending}
          onClick={save}
        >
          حفظ ومراجعة
        </button>
      ) : (
        <div className="mt-3 space-y-2 rounded-xl border border-[#D5DED9] p-3">
          <p className="text-sm">
            يصل إلى <b>{draft.count}</b>: {draft.label}
          </p>
          <label className="block text-sm font-bold">
            العنوان{" "}
            {draft.worded && (
              <span className="font-normal text-[#9a6b00]">
                — صياغة مقترحة، راجعها
              </span>
            )}
            <input
              className={field}
              value={draft.title}
              maxLength={200}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              onBlur={keep}
            />
          </label>
          <label className="block text-sm font-bold">
            النص كما يُطبع
            <textarea
              className={`${field} min-h-36`}
              value={draft.body}
              maxLength={6000}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              onBlur={keep}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={word}
            >
              ✍️ اكتب صياغة مناسبة
            </button>
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={save}
            >
              ↩️ النص كما كتبته
            </button>
            {/* a plain link (a window opened after an await is a blocked pop-up); the edits were saved on leaving the fields */}
            <a
              className={btn}
              href={`/my-decisions/${draft.id}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              📄 معاينة بهوية ترافليون
            </a>
            <button
              type="button"
              className={primary}
              disabled={pending}
              onClick={issue}
            >
              📜 أصدر ({draft.count})
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Filters({
  data,
  filter,
}: {
  data: DecisionsArchive;
  filter: ArchiveFilter;
}) {
  return (
    <form className={`${card} grid gap-2 sm:grid-cols-6`} method="get">
      <label className="text-xs font-bold sm:col-span-2">
        الموظف
        <select
          name="employee"
          defaultValue={filter.employeeId ?? ""}
          className={field}
        >
          <option value="">الكل — حسب القرار</option>
          {data.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-bold">
        النوع
        <select name="kind" defaultValue={filter.kind ?? ""} className={field}>
          <option value="">الكل</option>
          {[...data.settings.kinds, "خطاب رسمي"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label className="text-xs font-bold">
        من
        <input
          type="date"
          name="from"
          defaultValue={filter.from ?? ""}
          className={field}
        />
      </label>
      <label className="text-xs font-bold">
        إلى
        <input
          type="date"
          name="to"
          defaultValue={filter.to ?? ""}
          className={field}
        />
      </label>
      <label className="text-xs font-bold">
        الاستلام
        <select name="ack" defaultValue={filter.ack ?? ""} className={field}>
          <option value="">الكل</option>
          <option value="yes">استلموا</option>
          <option value="no">لم يستلموا</option>
        </select>
      </label>
      <div className="flex gap-2 sm:col-span-6">
        <button className={primary}>تصفية</button>
        <Link className={btn} href="/employees/decisions">
          مسح
        </Link>
      </div>
    </form>
  );
}

function DecisionList({ data }: { data: DecisionsArchive }) {
  if (!data.decisions.length)
    return <section className={card}>لا قرارات بهذه التصفية.</section>;
  return (
    <section className={card}>
      <h2 className="mb-2 font-extrabold">
        القرارات — {data.decisions.length}
      </h2>
      <ul className="divide-y divide-[#E3E8E4] dark:divide-[#294039]">
        {data.decisions.map((d) => (
          <li key={d.id} className="py-3">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                <b dir="ltr">{d.serial}</b>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${d.kind === "إنذار" ? "bg-red-100 text-red-800" : "bg-[#EEF5F1] text-[#185045]"}`}
                >
                  {d.kind}
                </span>
                <span className="font-bold">{d.title}</span>
                <span className="text-xs text-slate-500">
                  {day(d.issuedAt)} · {d.issuer} · إلى {d.audience}
                </span>
                <span className="ms-auto text-xs">
                  صدر {d.tally.issued} · وصل {d.tally.delivered} · ✅{" "}
                  {d.tally.acknowledged} · ⏳ {d.tally.pending}
                </span>
              </summary>
              <p className="mt-2 whitespace-pre-line rounded-xl bg-[#F4F6F3] p-3 text-sm dark:bg-[#0f1c19]">
                {d.text}
              </p>
              <table className="mt-2 w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="text-start">الموظف</th>
                    <th className="text-start">وصله</th>
                    <th className="text-start">فتحه</th>
                    <th className="text-start">استلمت</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recipients.map((r) => (
                    <tr key={r.employeeId}>
                      <td>
                        <Link
                          className="underline"
                          href={`/employees/decisions?employee=${r.employeeId}`}
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td dir="ltr" className="text-end">
                        {r.deliveredAt ? when(r.deliveredAt) : "جرس النظام فقط"}
                      </td>
                      <td dir="ltr" className="text-end">
                        {when(r.openedAt)}
                      </td>
                      <td
                        dir="ltr"
                        className={`text-end font-bold ${r.acknowledgedAt ? "text-[#185045]" : "text-amber-700"}`}
                      >
                        {r.acknowledgedAt
                          ? `${when(r.acknowledgedAt)}${r.via === "web" ? " (system)" : " (bot)"}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <a
                className={`${btn} mt-2`}
                href={`/my-decisions/${d.id}/pdf`}
                target="_blank"
                rel="noreferrer"
              >
                📄 PDF مع بيان الاستلام
              </a>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmployeeArchive({ data }: { data: DecisionsArchive }) {
  const name = data.entries[0]?.name;
  return (
    <section className={card}>
      <h2 className="mb-2 font-extrabold">
        ما وصل {name ? `إلى ${name}` : "هذا الموظف"} — {data.entries.length}
      </h2>
      {data.entries.length ? (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="text-start">الرقم</th>
              <th className="text-start">النوع</th>
              <th className="text-start">العنوان</th>
              <th className="text-start">صدر</th>
              <th className="text-start">وصله</th>
              <th className="text-start">استلم/وقّع</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr
                key={`${e.ref}:${e.employeeId}`}
                className="border-t border-[#E3E8E4] dark:border-[#294039]"
              >
                <td className="py-2 font-bold">{e.serial}</td>
                <td>{e.kind}</td>
                <td>{e.title}</td>
                <td dir="ltr" className="text-end">
                  {day(e.issuedAt)}
                </td>
                <td dir="ltr" className="text-end">
                  {e.deliveredAt ? when(e.deliveredAt) : "—"}
                </td>
                <td
                  dir="ltr"
                  className={`text-end font-bold ${e.acknowledgedAt ? "text-[#185045]" : "text-amber-700"}`}
                >
                  {when(e.acknowledgedAt)}
                </td>
                <td>
                  <a
                    className="underline"
                    href={`/my-decisions/${e.ref}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    PDF
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-slate-500">
          لم يصله قرار ولا خطاب بهذه التصفية.
        </p>
      )}
    </section>
  );
}

/** the sales letters, by number: how many got each, how many signed */
function Letters({ data }: { data: DecisionsArchive }) {
  const groups = useMemo(() => {
    const m = new Map<string, { n: number; signed: number; title: string }>();
    for (const e of data.entries.filter((x) => x.source === "letter")) {
      const g = m.get(e.serial) ?? { n: 0, signed: 0, title: e.title };
      g.n += 1;
      if (e.acknowledgedAt) g.signed += 1;
      m.set(e.serial, g);
    }
    return [...m.entries()];
  }, [data.entries]);
  if (!groups.length) return null;
  return (
    <section className={card}>
      <h2 className="mb-2 font-extrabold">الخطابات الرسمية — قسم المبيعات</h2>
      <ul className="space-y-1 text-sm">
        {groups.map(([serial, g]) => (
          <li key={serial}>
            <b>{g.title}</b> — وقّعه {g.signed} من {g.n}. اختر موظفاً في التصفية
            لترى متى وقّع، أو افتح «📄 الخطابات» في البوت.
          </li>
        ))}
      </ul>
    </section>
  );
}

function Settings({
  data,
  onNotice,
}: {
  data: DecisionsArchive;
  onNotice: (s: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kinds, setKinds] = useState(data.settings.kinds.join("، "));
  const [hour, setHour] = useState(data.settings.remindHour);
  const [days, setDays] = useState(data.settings.remindDays);
  return (
    <details className={card}>
      <summary className="cursor-pointer font-extrabold">
        ⚙️ الأنواع والتذكير
      </summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_9rem_9rem_auto] sm:items-end">
        <label className="text-xs font-bold">
          أنواع القرارات (افصل بفاصلة)
          <input
            className={field}
            value={kinds}
            onChange={(e) => setKinds(e.target.value)}
          />
        </label>
        <label className="text-xs font-bold">
          ساعة التذكير (0 = بلا تذكير)
          <input
            type="number"
            min={0}
            max={23}
            className={field}
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
          />
        </label>
        <label className="text-xs font-bold">
          أيام التذكير
          <input
            type="number"
            min={0}
            max={60}
            className={field}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className={primary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveDecisionSettings({
                kinds: kinds
                  .split(/[،,]/)
                  .map((k) => k.trim())
                  .filter(Boolean),
                remindHour: hour,
                remindDays: days,
              });
              onNotice(r.ok ? "حُفظت الإعدادات." : r.error);
              if (r.ok) router.refresh();
            })
          }
        >
          حفظ
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        يُذكَّر من لم يضغط «استلمت» مرة كل يوم من هذه الساعة (بتوقيت الرياض)، في
        «تنبيهاتي» وجرس النظام، حتى تنقضي الأيام.
      </p>
    </details>
  );
}
