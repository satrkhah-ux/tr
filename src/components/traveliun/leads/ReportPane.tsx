"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Download, Loader2, RotateCcw, Search } from "lucide-react";
import type { Lead } from "@/lib/data/leads";
import { getReportSupervision, incompleteReasons } from "@/lib/data/daily-report";
import { toCsv } from "@/lib/data/table-csv";
import type { Place } from "@/lib/leads/auto";
import { NOTHING, resolvePlace } from "@/lib/leads/places";
import { fold } from "@/lib/leads/sheet";
import {
  allRequestsText,
  applyEdits,
  BUCKETS,
  buildReport,
  bucketLabel,
  dayLabel,
  departmentsText,
  employeesText,
  employeeName,
  exportRows,
  movePeriod,
  periodOf,
  placeOf,
  readQueue,
  reportText,
  requestsFrom,
  visitKey,
  type BucketKey,
  type Edit,
  type PeriodKind,
  type ReportRequest,
  type SupervisionFigures,
} from "@/lib/leads/daily-report";

/**
 * «التقرير» (the owner, 2026-10-29): the follow-up staff's daily requests report, written by the system from the
 * conversations «العملاء» already classified — the day's, the week's or the month's; by employee, by department, or
 * every request. The reviewer corrects an item by hand before copying (a request moved to another department, a
 * destination, who received it, a note — «ارسل صور فقط»); the corrections live in this page only (they stay while the
 * page is open, not after), and the text itself can be edited before it is copied. Nothing here is sent to anyone and
 * nothing is written to the system.
 */
const VIEWS = [
  ["summary", "الملخص"],
  ["employees", "حسب الموظف"],
  ["departments", "حسب القسم"],
  ["all", "كل الطلبات"],
  ["review", "مراجعة وتصحيح"],
] as const;
type View = (typeof VIEWS)[number][0];
const PERIODS: [PeriodKind, string][] = [
  ["day", "يومي"],
  ["week", "أسبوعي"],
  ["month", "شهري"],
];
const ROWS_PER_PAGE = 40;
const FIELD = "h-8 w-full rounded-[8px] border border-[#cfe0d9] bg-white px-2 text-[12px] font-semibold text-[#185045]";

const FIGURES_NOTE = "أرقام المتابعة غير متاحة الآن — «إشراف المتابعة» لم يُفعَّل بعد أو لا صلاحية لك عليها.";

const daysBetween = (from: string, to: string) => Math.max(1, Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1);

export function ReportPane({ leads, team, places, today }: { leads: Lead[]; team: { id: string; arabic_name: string }[]; places: Place[]; today: string }) {
  const [kind, setKind] = useState<PeriodKind>("day");
  const [anchor, setAnchor] = useState(today);
  const [view, setView] = useState<View>("summary");
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [manual, setManual] = useState<{ base: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [withSupervision, setWithSupervision] = useState(false);
  const [supervision, setSupervision] = useState<{ days: number; figures: SupervisionFigures | null } | null>(null);
  const [reading, setReading] = useState(false);
  const [loadingFigures, setLoadingFigures] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // the conversations whose Teletel thread was already read for a reason — the next press goes on to the next ones; and those
  // Teletel could not answer, tried again after all the others
  const [tried, setTried] = useState<string[]>([]);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const latest = useRef(0);
  const resets = useRef(0);
  // moves between periods: a read that ends on another period says nothing about the one now shown
  const moves = useRef(0);

  const nameOf = useMemo(() => new Map(team.map((e) => [e.id, e.arabic_name])), [team]);
  const people = useMemo(() => [...new Set(["مُراد", ...team.map((e) => e.arabic_name)])], [team]);
  const requests = useMemo(() => requestsFrom(leads, nameOf, places), [leads, nameOf, places]);
  const period = useMemo(() => periodOf(kind, anchor, today), [kind, anchor, today]);
  const report = useMemo(() => buildReport(applyEdits(requests, edits), period), [requests, edits, period]);

  // the follow-up figures are «the last N days up to now» — so only a period that reaches today has them
  const reachesToday = period.to === today;
  const days = daysBetween(period.from, today);
  const figures = withSupervision && view === "summary" && reachesToday && supervision?.days === days ? supervision.figures : null;

  const generated = useMemo(() => {
    switch (view) {
      case "employees":
        return employeesText(report);
      case "departments":
        return departmentsText(report);
      case "all":
        return allRequestsText(report);
      default:
        return reportText(report, figures);
    }
  }, [view, report, figures]);
  // a hand-typed text stays until the report under it changes
  const text = manual && manual.base === generated ? manual.text : generated;

  async function loadSupervision(want: number) {
    const mine = ++latest.current;
    setLoadingFigures(true);
    const r = await getReportSupervision(want).catch(() => null);
    if (mine !== latest.current) return;
    setSupervision({ days: want, figures: r });
    // its own message only: a load that works removes the one left by a load that did not, and leaves the reasons' hint alone
    setNote((n) => (r ? (n === FIGURES_NOTE ? null : n) : FIGURES_NOTE));
    setLoadingFigures(false);
  }

  function go(next: { kind?: PeriodKind; anchor?: string }) {
    const k = next.kind ?? kind;
    // never a day that has not come
    const a = next.anchor && next.anchor > today ? today : (next.anchor ?? anchor);
    moves.current += 1;
    setKind(k);
    setAnchor(a);
    setPage(0);
    setNote(null);
    const p = periodOf(k, a, today);
    if (withSupervision && p.to === today) void loadSupervision(daysBetween(p.from, today));
  }

  function step(by: 1 | -1) {
    go({ anchor: movePeriod(period, by, today).from });
  }

  // what is true of the conversation (receiver, destination) is kept by its id; what is true of one visit (the department it
  // counted in that day, the note) by id and day — a client back on another day is another request
  function edit(r: Pick<ReportRequest, "id" | "day">, patch: Edit) {
    const { bucket, note: noted, ...conversation } = patch;
    setEdits((e) => {
      const next = { ...e };
      if (Object.keys(conversation).length > 0) next[r.id] = { ...next[r.id], ...conversation };
      if (bucket !== undefined || noted !== undefined) next[visitKey(r)] = { ...next[visitKey(r)], ...(bucket !== undefined ? { bucket } : {}), ...(noted !== undefined ? { note: noted } : {}) };
      return next;
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNote("تعذّر النسخ — حدّد النص يدوياً.");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([toCsv(exportRows(report))], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `تقرير-الطلبات-${period.from}${period.to !== period.from ? `_${period.to}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const open = report.requests.filter((r) => r.bucket === "incomplete" && !r.note?.trim());
  // the ones not read yet — those Teletel could not answer last time after all the others, so they never hold the queue back
  const toRead = readQueue(open.map((r) => r.id), tried, failedIds);

  async function readReasons() {
    if (toRead.length === 0 || reading) return;
    setReading(true);
    setNote(null);
    const sent = toRead.slice(0, 20);
    const mine = resets.current;
    const movedAt = moves.current;
    const res = await incompleteReasons(sent).catch(() => null);
    // «ألغِ كل التصحيحات» pressed while Teletel was being read: what came back belongs to the reviewer's old page
    if (mine !== resets.current) {
      setReading(false);
      return;
    }
    if (!res) {
      setNote("تعذّر الوصول إلى Teletel الآن — أعد المحاولة بعد قليل.");
      setReading(false);
      return;
    }
    setTried((t) => [...t, ...res.tried]);
    setFailedIds((f) => [...f.filter((id) => !res.tried.includes(id) && !res.failedIds.includes(id)), ...res.failedIds]);
    const found = Object.keys(res.reasons).length;
    if (found > 0) {
      setEdits((e) => {
        const next = { ...e };
        // the reason is the conversation's — it goes on each of its visits still unclear and unexplained, in any period, as the page
        // stands now (a note the reviewer typed meanwhile, or a request moved to another department, is left alone)
        for (const r of applyEdits(requests, e)) {
          const reason = res.reasons[r.id];
          if (reason && r.bucket === "incomplete" && !r.note?.trim()) next[visitKey(r)] = { ...next[visitKey(r)], note: reason };
        }
        return next;
      });
    }
    const left = toRead.filter((id) => !sent.includes(id)).length;
    // what was read is kept (any period's); the sentence about "this period" only if it is still the one shown
    if (movedAt === moves.current) {
      setNote(
        [
          found > 0 ? `قرأتُ سبب ${found} من ${res.tried.length} — والباقي يكتبه المراجع.` : res.tried.length > 0 ? "لم يتضح سبب أي طلب من كلام العميل — اكتبه يدوياً." : "",
          res.failedIds.length > 0 ? `تعذّر الوصول إلى Teletel لـ ${res.failedIds.length} محادثة — أعد المحاولة لاحقاً.` : "",
          left > 0 ? `بقي ${left} — اضغط مرة أخرى لقراءة التالي.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    }
    setReading(false);
  }

  function reset() {
    if (window.confirm(`تُلغى كل التصحيحات اليدوية (${Object.keys(edits).length})؟`)) {
      resets.current += 1;
      setEdits({});
      setTried([]);
      setFailedIds([]);
    }
  }

  const needle = fold(q);
  const shown = report.requests.filter((r) => !needle || fold([employeeName(r), r.country, r.city, r.place, r.note, bucketLabel(r.bucket)].filter(Boolean).join(" ")).includes(needle));
  const pages = Math.max(1, Math.ceil(shown.length / ROWS_PER_PAGE));
  const at = Math.min(page, pages - 1);
  const edited = Object.keys(edits).length;

  // the destination is typed freely and understood when the field is left: a place of the catalogue sets country and city; a Saudi
  // place stays the place the request is (never a package's destination); any other text is the country the reviewer means
  function setDestination(r: ReportRequest, typed: string) {
    const value = typed.trim();
    if (value === (placeOf(r) ?? "")) return;
    const hit = resolvePlace(value, places);
    edit(
      r,
      hit.kind === "destination"
        ? { country: hit.country, city: hit.city, place: null }
        : hit.kind === "origin"
          ? { country: null, city: null, place: hit.place }
          : { country: value && !NOTHING.test(value) ? value : null, city: null, place: null },
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[#e3ece8] bg-white p-3">
        <div className="inline-flex overflow-hidden rounded-[9px] border border-[#cfe0d9]">
          {PERIODS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => go({ kind: k })} className={`h-8 px-3 text-[12px] font-extrabold ${kind === k ? "bg-[#185045] text-white" : "bg-white text-[#185045] hover:bg-[#f0f7f4]"}`}>
              {label}
            </button>
          ))}
        </div>
        {/* the arrows read as the board's pager: previous on the right, next on the left */}
        <button type="button" onClick={() => step(-1)} aria-label="الفترة السابقة" className="grid size-8 place-items-center rounded-[8px] border border-[#cfe0d9] text-[#185045]">
          <ChevronRight className="size-4" />
        </button>
        <button type="button" onClick={() => step(1)} disabled={period.to >= today} aria-label="الفترة التالية" className="grid size-8 place-items-center rounded-[8px] border border-[#cfe0d9] text-[#185045] disabled:opacity-40">
          <ChevronLeft className="size-4" />
        </button>
        <input type="date" value={anchor} max={today} onChange={(e) => e.target.value && go({ anchor: e.target.value })} className="h-8 rounded-[8px] border border-[#cfe0d9] px-2 text-[12px] font-semibold text-[#185045]" />
        <span className="tv-tnum text-[12.5px] font-extrabold text-[#185045]">{kind === "day" ? dayLabel(period.from) : `${dayLabel(period.from)} ← ${dayLabel(period.to)}`}</span>
        {view === "summary" ? (
          <label className="ms-auto inline-flex items-center gap-1.5 text-[12px] font-bold text-[#557d78]">
            <input
              type="checkbox"
              checked={withSupervision}
              disabled={!reachesToday || loadingFigures}
              onChange={(e) => {
                setWithSupervision(e.target.checked);
                if (e.target.checked) void loadSupervision(days);
              }}
            />
            أضف أرقام متابعة الموظفين
            {loadingFigures ? <Loader2 className="size-3.5 animate-spin" /> : null}
          </label>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        <div className="rounded-[10px] border border-[#cfe0d9] bg-[#f4f9f7] p-2 text-center">
          <p className="text-[11px] font-bold text-[#557d78]">إجمالي الطلبات</p>
          <p className="tv-tnum text-lg font-extrabold text-[#185045]">{report.total}</p>
        </div>
        {BUCKETS.map((b) => (
          <div key={b.key} className="rounded-[10px] border border-[#e3ece8] bg-white p-2 text-center">
            <p className="truncate text-[11px] font-bold text-[#557d78]">
              {b.icon} {b.label}
            </p>
            <p className="tv-tnum text-lg font-extrabold text-[#185045]">{report.counts[b.key]}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {VIEWS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={`h-8 rounded-full px-3 text-[12px] font-extrabold ${view === k ? "bg-[#185045] text-white" : "border border-[#cfe0d9] text-[#185045] hover:bg-[#f0f7f4]"}`}>
            {label}
          </button>
        ))}
        {edited > 0 ? (
          <button type="button" onClick={reset} className="ms-auto inline-flex h-8 items-center gap-1 rounded-full border border-[#f2c7c7] px-3 text-[12px] font-bold text-[#c43d3d] hover:bg-[#fff1f1]">
            <RotateCcw className="size-3.5" />
            ألغِ كل التصحيحات ({edited})
          </button>
        ) : null}
      </div>

      {note ? <p className="rounded-[9px] bg-[#fff8eb] px-3 py-2 text-[12px] font-bold text-[#8a5a00]">{note}</p> : null}

      {view !== "review" ? (
        <div className="space-y-2 rounded-[12px] border border-[#e3ece8] bg-white p-3">
          <textarea
            value={text}
            onChange={(e) => setManual({ base: generated, text: e.target.value })}
            rows={Math.min(34, Math.max(10, text.split("\n").length + 1))}
            spellCheck={false}
            aria-label="نص التقرير"
            className="w-full resize-y rounded-[10px] border border-[#cfe0d9] bg-[#fbfdfc] p-3 font-semibold leading-7 text-[#103f37] text-[13px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void copy()} className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-extrabold text-white">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "نُسخ ✓" : "انسخ التقرير"}
            </button>
            <button type="button" onClick={download} className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#185045] px-4 text-[13px] font-extrabold text-[#185045] hover:bg-[#f0f7f4]">
              <Download className="size-4" />
              تصدير (Excel)
            </button>
            {manual && manual.base === generated ? (
              <button type="button" onClick={() => setManual(null)} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#cfe0d9] px-3 text-[12px] font-bold text-[#557d78]">
                <RotateCcw className="size-3.5" />
                أعد توليد النص
              </button>
            ) : null}
            {toRead.length > 0 ? (
              <button type="button" onClick={() => void readReasons()} disabled={reading} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#cfe0d9] px-3 text-[12px] font-bold text-[#185045] disabled:opacity-60">
                {reading ? <Loader2 className="size-3.5 animate-spin" /> : null}
                اقرأ سبب غير المكتمل ({toRead.length})
              </button>
            ) : null}
          </div>
          <p className="text-[11.5px] font-semibold text-[#78948f]">
            النص قابل للتعديل قبل النسخ — وما كتبته بيدك يُترك إذا تغيّرت الفترة أو التصحيحات تحته. «الاستفسارات» ليس له تصنيف في النظام — انقل إليه الطلب من «مراجعة وتصحيح». لا يُرسل شيء لأحد من هنا.
          </p>
        </div>
      ) : (
        <div className="space-y-2 rounded-[12px] border border-[#e3ece8] bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-2 size-4 text-[#93aaa3]" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="ابحث بالموظف أو الوجهة أو القسم" className={`${FIELD} ps-8`} />
            </div>
            <span className="tv-tnum text-[12px] font-bold text-[#557d78]">{shown.length} طلب</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-start text-[12px]">
              <thead>
                <tr className="text-[11px] font-extrabold text-[#557d78]">
                  <th className="p-1.5 text-start">اليوم</th>
                  <th className="p-1.5 text-start">القسم</th>
                  <th className="p-1.5 text-start">الوجهة</th>
                  <th className="p-1.5 text-start">الموظف المستلم</th>
                  <th className="p-1.5 text-start">ملاحظة (السبب / الوصف)</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(at * ROWS_PER_PAGE, (at + 1) * ROWS_PER_PAGE).map((r) => (
                  <tr key={visitKey(r)} className="border-t border-[#eef3f1]">
                    <td className="tv-tnum whitespace-nowrap p-1.5 font-semibold text-[#557d78]">{r.day}</td>
                    <td className="p-1.5">
                      <select value={r.bucket} onChange={(e) => edit(r, { bucket: e.target.value as BucketKey })} className={FIELD}>
                        {BUCKETS.map((b) => (
                          <option key={b.key} value={b.key}>
                            {b.icon} {b.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-1.5">
                      {/* typed freely, understood when left (a new key when the value changes, so the field shows what was understood) */}
                      <input
                        key={placeOf(r) ?? ""}
                        defaultValue={placeOf(r) ?? ""}
                        onBlur={(e) => setDestination(r, e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        placeholder="—"
                        className={FIELD}
                      />
                    </td>
                    <td className="p-1.5">
                      <select value={employeeName(r)} onChange={(e) => edit(r, { employee: e.target.value === "غير مسند" ? null : e.target.value })} className={FIELD}>
                        {[...new Set(["غير مسند", ...people, employeeName(r)])].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-1.5">
                      <input value={r.note ?? ""} onChange={(e) => edit(r, { note: e.target.value })} placeholder={r.bucket === "incomplete" ? "مثل: ارسل صور فقط" : ""} className={FIELD} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 ? (
            <div className="flex items-center justify-center gap-2 text-[12px] font-bold text-[#185045]">
              <button type="button" disabled={at === 0} onClick={() => setPage(at - 1)} className="rounded-[8px] border border-[#cfe0d9] px-2.5 py-1 disabled:opacity-40">
                السابق
              </button>
              <span className="tv-tnum">
                {at + 1} / {pages}
              </span>
              <button type="button" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} className="rounded-[8px] border border-[#cfe0d9] px-2.5 py-1 disabled:opacity-40">
                التالي
              </button>
            </div>
          ) : null}
          <p className="text-[11.5px] font-semibold text-[#78948f]">التصحيحات هنا تغيّر التقرير فقط، ولا تُكتب في النظام — وتبقى ما دامت الصفحة مفتوحة، ثم تزول.</p>
        </div>
      )}
    </section>
  );
}
