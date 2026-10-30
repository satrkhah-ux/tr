"use client";

import Link from "next/link";
import { Inbox, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { VISA_OPEN, VISA_STATUS_LABEL, type VisaBoard, type VisaRow, type VisaStatus } from "@/lib/visa-files/types";
import {
  FOCUS_LABEL,
  dueText,
  fmtDate,
  hasMore,
  isDefaultFilter,
  defaultBoardFilter,
  money,
  pickFocus,
  pickStatus,
  relativeDay,
  rowFlags,
  type BoardFilterState,
} from "@/lib/visa-files/ui";
import { PaymentChip, StatusChip, Notice, btn, btnPrimary, card, field, label } from "./visa-ui";

/** the board as the page keeps it: nothing yet, only a failure, or data — with the failure of the last refresh beside it */
export type BoardPhase = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; board: VisaBoard; error?: string };

/** the seven steps of the work, in the work's order (the owner's strip); «cancelled» is reached from «الكل» */
const STRIP: readonly VisaStatus[] = ["new", "collecting", "ready", "submitted", "approved", "rejected", "delivered"];
const ATTENTION = ["missingDocs", "replyOverdue", "actionDue", "toDeliver", "unpaid"] as const;

type Props = {
  phase: BoardPhase;
  filter: BoardFilterState;
  /** the countries seen so far, for the country filter */
  countries: string[];
  /** the management: the employee picker and every employee's load */
  manager: boolean;
  now: number;
  refreshing: boolean;
  onFilter: (next: BoardFilterState) => void;
  onRefresh: () => void;
};

/** «لوحة التأشيرات» — counters that filter, what needs attention, the people, and the files themselves. Presentational: the page holds the state. */
export function VisaBoardView({ phase, filter, countries, manager, now, refreshing, onFilter, onRefresh }: Props) {
  const board = phase.kind === "ready" ? phase.board : null;
  const set = (patch: Partial<BoardFilterState>) => onFilter({ ...filter, ...patch, limit: defaultBoardFilter().limit });
  return (
    <div dir="rtl" className="space-y-4">
      <section className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold text-[#003c3a]">لوحة التأشيرات</h1>
          <p className="mt-1 text-[13px] font-semibold text-tv-text-faint">الملفات الجاهزة وقيد التنفيذ، والمستندات الناقصة، والردود، والعملاء الذين لم يسددوا.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> تحديث
          </button>
          <Link href="/visa-files/new" className={btnPrimary}>
            <Plus className="size-4" /> ملف تأشيرة جديد
          </Link>
        </div>
      </section>

      {phase.kind === "error" ? (
        <section className={`${card} space-y-3`}>
          <Notice tone="error">{phase.message}</Notice>
          <button type="button" className={btn} onClick={onRefresh} disabled={refreshing}>إعادة المحاولة</button>
        </section>
      ) : null}
      {phase.kind === "ready" && phase.error ? <Notice tone="error">{`تعذّر التحديث، والأرقام آخر نسخة ناجحة. ${phase.error}`}</Notice> : null}

      {phase.kind === "loading" ? <BoardSkeleton /> : null}

      {board ? (
        <>
          <section aria-label="حالات الملفات" className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            <Counter
              title="المفتوحة"
              count={VISA_OPEN.reduce((n, s) => n + board.counts.byStatus[s], 0)}
              on={filter.status === "open" && !filter.focus}
              onPress={() => onFilter(pickStatus(filter, "open"))}
            />
            {STRIP.map((s) => (
              <Counter key={s} title={VISA_STATUS_LABEL[s]} count={board.counts.byStatus[s]} on={filter.status === s && !filter.focus} onPress={() => onFilter(pickStatus(filter, s))} />
            ))}
          </section>

          <section aria-label="ما يحتاج انتباهاً" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {ATTENTION.map((k) => {
              const count = k === "unpaid" ? board.counts.unpaid.files : board.counts[k];
              return (
                <Counter
                  key={k}
                  title={FOCUS_LABEL[k]}
                  count={count}
                  alert={count > 0}
                  note={k === "unpaid" && count > 0 ? dueText(board.counts.unpaid.due) : undefined}
                  on={filter.focus === k}
                  onPress={() => onFilter(pickFocus(filter, k))}
                />
              );
            })}
          </section>

          {manager && board.people.length > 0 ? (
            <section className={card} aria-label="حمل الموظفين">
              <h2 className="text-sm font-extrabold text-[#185045]">الملفات المفتوحة عند كل موظف</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {board.people.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-pressed={filter.assignedTo === p.id}
                      onClick={() => set({ assignedTo: filter.assignedTo === p.id ? "" : p.id })}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-[10px] border px-4 text-sm font-bold transition-colors ${
                        filter.assignedTo === p.id ? "border-[#185045] bg-[#185045] text-white" : "border-[#dbe6e1] bg-white text-[#185045] hover:bg-[#f4f8f6]"
                      }`}
                    >
                      {p.name}
                      <span className="tv-tnum rounded-full bg-[#eef4f1] px-2 text-xs text-[#185045]">{p.open}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {phase.kind !== "loading" ? (
        <section className={`${card} grid gap-3 sm:grid-cols-2 xl:grid-cols-4`} aria-label="التصفية">
          <label className={`${label} sm:col-span-2 xl:col-span-1`}>
            بحث
            <span className="relative block">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-tv-text-faint" />
              <input
                type="search"
                value={filter.search}
                onChange={(e) => onFilter({ ...filter, search: e.target.value, limit: defaultBoardFilter().limit })}
                placeholder="الرقم أو الاسم أو الجوال"
                className={`${field} ps-9`}
              />
            </span>
          </label>
          <label className={label}>
            الدولة
            <select className={field} value={filter.country} onChange={(e) => set({ country: e.target.value })}>
              <option value="">كل الدول</option>
              {countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {manager ? (
            <label className={label}>
              عرض كموظف
              <select className={field} value={filter.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })}>
                <option value="">كل الموظفين</option>
                <option value="none">بلا مسؤول</option>
                {(board?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.open})</option>)}
              </select>
            </label>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <button type="button" className={btn} aria-pressed={filter.status === "all" && !filter.focus} onClick={() => onFilter(pickStatus(filter, "all"))}>
              كل الملفات
            </button>
            {!isDefaultFilter(filter) ? (
              <button type="button" className={btn} onClick={() => onFilter(defaultBoardFilter())}>مسح التصفية</button>
            ) : null}
          </div>
        </section>
      ) : null}

      {board ? (
        <FileList board={board} filter={filter} now={now} onFilter={onFilter} refreshing={refreshing} />
      ) : null}
    </div>
  );
}

function Counter({ title, count, on, onPress, alert, note }: { title: string; count: number; on: boolean; onPress: () => void; alert?: boolean; note?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPress}
      className={`flex min-h-16 min-w-0 flex-col items-start justify-center gap-0.5 rounded-2xl border px-3 py-2 text-start transition-colors ${
        on
          ? "border-[#185045] bg-[#185045] text-white"
          : alert
            ? "border-[#f3c9d3] bg-[#fdecef] text-[#c22850] hover:bg-[#fbdde4]"
            : "border-[#e2ebe7] bg-white text-[#185045] hover:bg-[#f4f8f6]"
      }`}
    >
      <span className="tv-tnum text-xl font-extrabold leading-none">{count}</span>
      <span className="text-[12px] font-bold leading-tight">{title}</span>
      {note ? <DirText className="text-[11px] font-bold opacity-90">{note}</DirText> : null}
    </button>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="جارٍ تحميل اللوحة">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28" />)}
    </div>
  );
}

function FileList({ board, filter, now, onFilter, refreshing }: { board: VisaBoard; filter: BoardFilterState; now: number; onFilter: (next: BoardFilterState) => void; refreshing: boolean }) {
  const rows = board.rows;
  const person = (id: string | null) => (id === null ? "بلا مسؤول" : (board.people.find((p) => p.id === id)?.name ?? "مُسنَد"));
  const filtered = !isDefaultFilter(filter);
  if (rows.length === 0) {
    return (
      <section className={card}>
        <EmptyState
          icon={Inbox}
          title={filtered ? "لا توجد ملفات مطابقة" : "لا توجد ملفات تأشيرة مفتوحة"}
          description={filtered ? "غيّر التصفية أو ابحث بكلمة أخرى." : "ابدأ ملفاً جديداً من محادثة عميل في تليتيل أو بإدخال بياناته."}
          action={filtered ? { label: "مسح التصفية", onClick: () => onFilter(defaultBoardFilter()) } : undefined}
        />
        {filtered ? null : (
          <div className="flex justify-center pb-4">
            <Link href="/visa-files/new" className={btnPrimary}><Plus className="size-4" /> ملف تأشيرة جديد</Link>
          </div>
        )}
      </section>
    );
  }
  return (
    <section aria-label="الملفات" className="space-y-3">
      <p className="flex items-center gap-2 text-[13px] font-bold text-[#557d78]">
        <span className="tv-tnum">{rows.length}</span> ملف
        {filter.focus ? <span className="rounded-full bg-[#fff8e8] px-3 py-0.5 text-xs text-[#a86a10]">{FOCUS_LABEL[filter.focus]}</span> : null}
        {refreshing ? <Loader2 className="size-4 animate-spin" aria-label="جارٍ التحديث" /> : null}
      </p>
      {/* phones: a card per file; from md up: the table */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => <li key={r.id}><FileCard r={r} now={now} person={person(r.assignedTo)} /></li>)}
      </ul>
      <div className={`${card} hidden overflow-x-auto !p-0 md:block`}>
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-[#eef2f0] text-start text-[12px] font-bold text-tv-text-faint">
              {["الرقم", "العميل", "الدولة والنوع", "المسافرون", "الحالة", "السداد", "الرد المتوقع", "الإجراء التالي", "ناقص", "المسؤول"].map((h) => <th key={h} scope="col" className="px-3 py-3 text-start">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <FileTableRow key={r.id} r={r} now={now} person={person(r.assignedTo)} />)}
          </tbody>
        </table>
      </div>
      {hasMore(rows.length, filter.limit) ? (
        <button type="button" className={`${btn} w-full`} onClick={() => onFilter({ ...filter, limit: filter.limit + defaultBoardFilter().limit })}>عرض المزيد</button>
      ) : null}
    </section>
  );
}

/** the reply date as the row shows it: the date, and «تأخر يومان» in red when it is late */
function Reply({ r, now }: { r: VisaRow; now: number }) {
  const late = rowFlags(r, now).replyLate;
  if (!r.expectedReplyAt) return <span className="text-tv-text-faint">—</span>;
  return (
    <span className={late ? "font-extrabold text-[#c22850]" : "text-[#185045]"}>
      {fmtDate(r.expectedReplyAt)}
      {late ? <span className="block text-xs">{relativeDay(r.expectedReplyAt, now)}</span> : null}
    </span>
  );
}
function NextAction({ r, now }: { r: VisaRow; now: number }) {
  if (!r.nextAction && !r.nextActionAt) return <span className="text-tv-text-faint">—</span>;
  const due = rowFlags(r, now).actionDue;
  return (
    <span className={due ? "font-extrabold text-[#a86a10]" : "text-[#185045]"}>
      {r.nextAction ?? "متابعة"}
      {r.nextActionAt ? <span className="block text-xs">{fmtDate(r.nextActionAt)}{due ? ` — ${relativeDay(r.nextActionAt, now)}` : ""}</span> : null}
    </span>
  );
}
function Owing({ r, now }: { r: VisaRow; now: number }) {
  const f = rowFlags(r, now);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <PaymentChip state={f.payment} />
      {f.due > 0 ? <DirText className="tv-tnum text-xs font-bold text-[#c22850]">{money(f.due, r.currency)}</DirText> : null}
    </span>
  );
}
const typeLine = (r: VisaRow) => [r.country, r.visaType].filter(Boolean).join(" · ");

function FileCard({ r, now, person }: { r: VisaRow; now: number; person: string }) {
  return (
    <Link href={`/visa-files/${r.id}`} className="block rounded-2xl border border-[#e2ebe7] bg-white p-3.5 shadow-[0_1px_2px_rgba(0,60,58,0.04)] hover:bg-[#f7faf8]">
      <span className="flex items-center justify-between gap-2">
        <DirText className="text-xs font-bold text-tv-text-faint">{r.serial}</DirText>
        <StatusChip status={r.status} />
      </span>
      <span className="mt-1 block font-extrabold text-[#003c3a]">{r.clientName}</span>
      {r.clientPhone ? <DirText className="text-xs text-tv-text-faint">{r.clientPhone}</DirText> : null}
      <span className="mt-1 block text-sm text-[#185045]">{typeLine(r)} · <span className="tv-tnum">{r.applicants}</span> مسافر</span>
      <span className="mt-2 block"><Owing r={r} now={now} /></span>
      <span className="mt-2 grid grid-cols-2 gap-2 text-[13px]">
        <span><span className="block text-[11px] font-bold text-tv-text-faint">الرد المتوقع</span><Reply r={r} now={now} /></span>
        <span><span className="block text-[11px] font-bold text-tv-text-faint">الإجراء التالي</span><NextAction r={r} now={now} /></span>
      </span>
      <span className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        {r.missingDocs > 0 ? <span className="rounded-full bg-[#fff8e8] px-3 py-0.5 font-bold text-[#a86a10]">ناقص <span className="tv-tnum">{r.missingDocs}</span> مستند</span> : <span />}
        <span className="font-semibold text-tv-text-faint">{person}</span>
      </span>
    </Link>
  );
}

function FileTableRow({ r, now, person }: { r: VisaRow; now: number; person: string }) {
  const link = "inline-flex min-h-11 items-center hover:underline";
  return (
    <tr className="border-b border-[#eef2f0] align-top last:border-0 hover:bg-[#f7faf8]">
      <td className="px-3 py-1"><Link href={`/visa-files/${r.id}`} className={`${link} whitespace-nowrap font-bold text-[#185045]`}><DirText>{r.serial}</DirText></Link></td>
      <td className="px-3 py-1">
        <Link href={`/visa-files/${r.id}`} className={`${link} font-extrabold text-[#003c3a]`}>{r.clientName}</Link>
        {r.clientPhone ? <DirText className="block text-xs text-tv-text-faint">{r.clientPhone}</DirText> : null}
      </td>
      <td className="px-3 py-3 text-[#185045]">{typeLine(r)}</td>
      <td className="tv-tnum px-3 py-3">{r.applicants}</td>
      <td className="px-3 py-3"><StatusChip status={r.status} /></td>
      <td className="px-3 py-3"><Owing r={r} now={now} /></td>
      <td className="px-3 py-3"><Reply r={r} now={now} /></td>
      <td className="px-3 py-3"><NextAction r={r} now={now} /></td>
      <td className="px-3 py-3">{r.missingDocs > 0 ? <span className="tv-tnum rounded-full bg-[#fff8e8] px-3 py-0.5 text-xs font-bold text-[#a86a10]">{r.missingDocs}</span> : <span className="text-tv-text-faint">—</span>}</td>
      <td className="px-3 py-3 text-[#557d78]">{person}</td>
    </tr>
  );
}
