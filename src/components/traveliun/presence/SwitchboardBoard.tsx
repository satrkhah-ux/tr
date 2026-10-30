"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reassignByHand, saveSwitchboardRules, type SwitchboardData } from "@/lib/data/switchboard";
import type { Rules } from "@/lib/routing/switchboard-core";

import { buttonTone } from "@/components/ui/button-variants";
/**
 * «البدّالة» (the owner, 2026-10-29): the rules it routes by, who can take a client right now (and why not), what it would
 * do this minute, the last moves — and moving a client by hand, with a reason.
 */

const card = "tv-card rounded-2xl border p-4";
const btn =
  `${buttonTone({ variant: "secondary" })} inline-flex min-h-10 items-center justify-center rounded-xl border px-3 text-sm font-bold disabled:opacity-40`;
const primary = `${buttonTone({ variant: "default" })} inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-sm font-bold disabled:opacity-40`;
const field = "tv-field mt-1 w-full rounded-xl border p-2.5 text-sm";
const REASON: Record<string, string> = { leave: "إجازة", off_shift: "خارج الدوام", break: "زر حالة", offline: "غير متصل", exempt: "معفى من التأخير" };
const when = (iso: string) => new Date(iso).toLocaleString("ar-SA-u-nu-latn-ca-gregory", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" });

export function SwitchboardBoard({ data }: { data: SwitchboardData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState("");
  const [r, setR] = useState<Rules>(data.rules);
  const [move, setMove] = useState({ conversation: "", to: "", reason: "", force: false });
  const run = (task: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const res = await task().catch(() => ({ ok: false, error: "تعذّر الحفظ، أعد المحاولة." }));
      setNotice(res.ok ? ok : (res.error ?? "تعذّر الحفظ."));
      if (res.ok) router.refresh();
    });
  const free = data.board.filter((b) => b.available);
  const num = (key: "orphanMinutes" | "awayMinutes" | "maxWaiting", label: string, unit: string, min: number, max: number) => (
    <label className="text-xs font-bold">
      {label}
      <span className="mt-1 flex items-center gap-2">
        <input type="number" min={min} max={max} className={`${field} w-24`} value={r[key]} onChange={(e) => setR({ ...r, [key]: Number(e.target.value) })} />
        <span className="font-normal text-slate-500">{unit}</span>
      </span>
    </label>
  );

  return (
    <div dir="rtl" className="space-y-4 rounded-3xl bg-[#F4F6F3] p-2 text-[#12332c] sm:p-3 dark:bg-transparent dark:text-[#eaf3ef]">
      <section className={card}>
        <h1 className="text-2xl font-extrabold">البدّالة</h1>
        <p className="mt-1 text-sm text-slate-500">
          تحوّل كل عميل إلى الموظف المتاح: ليس في إجازة ولا على زر حالة ولا غير متصل، والأقل انتظاراً أولاً. العميل الذي سجّله موظف «لدي عميل/اتصال» يعود إليه.
          خارج الدوام يستقبل مُراد، ولا تُسحب أبداً محادثة فيها بيع أو خدمة مؤكدة من موظفها.
        </p>
        {notice && (
          <p role="status" className="mt-3 rounded-xl bg-[#EEF5F1] p-2.5 text-sm text-[#185045]">
            {notice}
          </p>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-2 font-extrabold">
          متاحون الآن: {free.length} من {data.board.length}
        </h2>
        <table className="w-full text-sm">
          <thead className="text-slate-500">
            <tr>
              {["الموظف", "الحالة", "مفتوحة", "منتظرة"].map((h) => (
                <th key={h} className="p-2 text-start font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.board.map((b) => (
              <tr key={b.id} className="border-t border-[#E3E8E4]">
                <td className="p-2 font-bold">{b.name}</td>
                <td className={`p-2 font-bold ${b.available ? "text-[#185045]" : "text-slate-500"}`}>
                  {b.available ? (b.reason === "exempt" ? "متاح · معفى من التأخير" : "متاح") : (REASON[b.reason ?? ""] ?? "غير متاح")}
                </td>
                <td className="p-2">{b.open}</td>
                <td className="p-2">{b.waiting}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={card}>
        <h2 className="mb-2 font-extrabold">ماذا ستفعل الآن</h2>
        {data.preview.note ? (
          <p className="text-sm text-slate-600">{data.preview.note}</p>
        ) : data.preview.moved.length ? (
          <ul className="space-y-1 text-sm">
            {data.preview.moved.map((m) => (
              <li key={m.id}>
                المحادثة <bdi>#{m.id}</bdi> ← <b>{m.to}</b> — {m.why}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">لا عميل يحتاج نقلاً الآن ({data.preview.due} مستحق).</p>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-2 font-extrabold">القواعد</h2>
        <div className="flex flex-wrap gap-4">
          <label className="text-xs font-bold">
            الوضع
            <select className={`${field} w-40`} value={r.mode} onChange={(e) => setR({ ...r, mode: e.target.value as Rules["mode"] })}>
              <option value="on">تعمل</option>
              <option value="dry">تجربة: تقول ولا تنقل</option>
              <option value="off">متوقفة</option>
            </select>
          </label>
          {num("orphanMinutes", "عميل بلا موظف يُحوَّل بعد", "دقيقة", 1, 240)}
          {num("awayMinutes", "عميل عند موظف غائب يُنقل بعد", "دقيقة", 1, 480)}
          {num("maxWaiting", "لا يُعطى موظف عنده منتظرون أكثر من", "(0 = بلا حد)", 0, 200)}
        </div>
        <button className={`${primary} mt-3`} disabled={pending} onClick={() => run(() => saveSwitchboardRules(r), "حُفظت قواعد البدّالة.")}>
          حفظ القواعد
        </button>
      </section>

      <section className={card}>
        <h2 className="mb-2 font-extrabold">نقل عميل باليد</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-bold">
            رقم المحادثة في تيلي تيل
            <input
              className={field}
              inputMode="numeric"
              dir="ltr"
              value={move.conversation}
              onChange={(e) => setMove({ ...move, conversation: e.target.value.replace(/\D/g, "") })}
            />
          </label>
          <label className="text-xs font-bold">
            إلى
            <select className={field} value={move.to} onChange={(e) => setMove({ ...move, to: e.target.value })}>
              <option value="">اختر…</option>
              {data.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            السبب
            <input className={field} maxLength={300} value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} />
          </label>
        </div>
        {data.admin && (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={move.force} onChange={(e) => setMove({ ...move, force: e.target.checked })} />
            انقلها ولو فيها بيع أو خدمة مؤكدة (للإدارة فقط، والسبب مطلوب)
          </label>
        )}
        <button
          className={`${btn} mt-3`}
          disabled={pending || !move.conversation || !move.to || !move.reason.trim()}
          onClick={() => run(() => reassignByHand(Number(move.conversation), move.to, move.reason, move.force), "نُقلت المحادثة وسُجّل السبب.")}
        >
          انقل
        </button>
      </section>

      <section className={card}>
        <h2 className="mb-2 font-extrabold">آخر التحويلات</h2>
        {data.moves.length ? (
          <ul className="space-y-1 text-sm">
            {data.moves.map((m, i) => (
              <li key={i} className="border-t border-[#E3E8E4] pt-1">
                <span className="text-slate-500">{when(m.at)}</span> · المحادثة <bdi>#{m.conversation}</bdi> ← <b>{m.to}</b> · {m.why} · {m.by}
                {m.forced ? " · بالقوة" : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">لا تحويلات بعد.</p>
        )}
      </section>
    </div>
  );
}
