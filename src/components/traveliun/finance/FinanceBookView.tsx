"use client";

import { useEffect, useMemo, useState } from "react";
import { saveFinance } from "@/lib/data/finance";
import { arCount } from "@/lib/eye/anomalies";
import {
  DEBT_KINDS, EVERY, MONTHS, breakEven, bookingProfit, bookingReserve, debtLeft, debtPaid, monthPlan, payrollByTeam, quarter, rentDue, sar, summary, targetMonth, treasury, treasuryIn, treasuryOut,
  type Booking, type Debt, type Target, type DebtKind, type Expense, type FinanceBook, type Partner, type Rent, type Staff,
} from "@/lib/finance/model";

type Tab = "summary" | "plan" | "staff" | "rents" | "debts" | "profits";
const field = "tv-field w-full min-w-0 rounded-lg border px-2 py-1.5 text-sm";
const card = "tv-card rounded-2xl border p-4 sm:p-5";
const th = "whitespace-nowrap px-2 py-2 text-right text-xs font-semibold text-[#5b6b66]";
const td = "px-2 py-1.5 align-top";
const num = (v: string) => { const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) && n >= 0 ? n : 0; };
const uid = () => crypto.randomUUID();
const upd = <T extends { id: string }>(list: T[], id: string, p: Partial<T>) => list.map((x) => (x.id === id ? { ...x, ...p } : x));
const today = () => new Date().toISOString().slice(0, 10);

export function FinanceBookView({ initial }: { initial: FinanceBook }) {
  const [book, setBook] = useState(initial);
  const [base, setBase] = useState(initial.updatedAt);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<Tab>("summary");
  const set = (fn: (b: FinanceBook) => FinanceBook) => { setBook(fn); setDirty(true); setMessage(""); };

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    setBusy(true);
    try {
      const r = await saveFinance(book, base);
      if (r.ok) { setBase(r.updatedAt); setBook((b) => ({ ...b, updatedAt: r.updatedAt })); setDirty(false); setMessage("حُفظت الحسابات."); }
      else setMessage(r.error);
    } catch { setMessage("تعذّر الاتصال — لم يُحفظ شيء."); } finally { setBusy(false); }
  }

  const tabs: [Tab, string][] = [["summary", "الملخص"], ["plan", "الخطة القادمة"], ["staff", `الرواتب (${book.staff.length})`], ["rents", `الإيجارات (${book.rents.length})`], ["debts", `الديون (${book.debts.length})`], ["profits", "الأرباح والشركاء"]];
  return <div dir="rtl" className="min-w-0 space-y-4 text-[#10231f]">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-extrabold text-[#185045]">الحسابات المالية</h1>
        <p className="mt-1 text-sm text-[#5b6b66]">سرّية: لا يفتحها إلا حساب المطوّر. كل حفظ يُبقي نسخة كاملة من السابق.</p></div>
    </header>
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-[#dbe6e1] bg-white/95 p-2 backdrop-blur">
      <nav className="flex flex-wrap gap-1" aria-label="أقسام الحسابات">{tabs.map(([k, label]) =>
        <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${tab === k ? "bg-[#185045] text-white" : "text-[#185045] hover:bg-[#eef4f1]"}`}>{label}</button>)}</nav>
      <span className="ms-auto text-sm" role="status">{message || (dirty ? "تغييرات غير محفوظة" : "")}</span>
      <button onClick={() => void save()} disabled={busy || !dirty} className="tv-btn-primary min-h-10 rounded-lg px-5 text-sm font-bold disabled:opacity-40">{busy ? "جارٍ الحفظ…" : "حفظ"}</button>
    </div>
    {tab === "summary" && <Summary book={book} />}
    {tab === "plan" && <PlanTab book={book} set={set} />}
    {tab === "staff" && <StaffTab book={book} set={set} />}
    {tab === "rents" && <RentsTab book={book} set={set} />}
    {tab === "debts" && <DebtsTab book={book} set={set} />}
    {tab === "profits" && <ProfitsTab book={book} set={set} />}
  </div>;
}

type Edit = { book: FinanceBook; set: (fn: (b: FinanceBook) => FinanceBook) => void };

function Summary({ book }: { book: FinanceBook }) {
  const s = useMemo(() => summary(book), [book]);
  const now = new Date();
  const plan = useMemo(() => monthPlan(book, now.getFullYear(), now.getMonth() + 1, 12), [book]); // eslint-disable-line react-hooks/exhaustive-deps
  const teams = payrollByTeam(book.staff);
  const tiles: [string, string, string][] = [
    ["المصروف الثابت شهرياً", sar(s.monthly), "رواتب + إيجارات (معدّل الشهر) + أقساط"],
    ["الرواتب", sar(s.salaries), s.stopping ? `بعد إيقاف ${arCount(s.stopping, "موظف", "موظفَين", "موظفين")}: ${sar(s.salariesAfter)}` : arCount(book.staff.length, "موظف", "موظفان", "موظفين")],
    ["الإيجارات — معدّل الشهر", sar(s.rentsMonthly), `${sar(s.rentsMonthly * 12)} في السنة`],
    ["أقساط هذا الشهر", sar(s.installments), "من الديون ذات القسط الشهري"],
    ["الديون المتبقية", sar(s.debtLeft), s.debtPaid ? `سُدّد منها ${sar(s.debtPaid)}` : "لم تُسجَّل دفعات بعد"],
  ];
  return <div className="space-y-4">
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">{tiles.map(([label, value, hint]) =>
      <div key={label} className={card}><p className="text-sm text-[#5b6b66]">{label}</p><p className="mt-1 text-2xl font-extrabold text-[#185045]">{value}</p><p className="mt-1 text-xs text-[#5b6b66]">{hint}</p></div>)}</div>
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={card}><h2 className="mb-3 font-bold">الرواتب حسب الفريق</h2>
        <ul className="divide-y divide-[#eef2f0]">{teams.map((t) => <li key={t.team} className="flex justify-between gap-2 py-2 text-sm"><span>{t.team} <span className="text-[#5b6b66]">· {t.people.length}</span></span><strong>{sar(t.total)}</strong></li>)}</ul></section>
      <section className={card}><h2 className="mb-3 font-bold">الديون حسب النوع</h2>
        <ul className="divide-y divide-[#eef2f0]">{s.byKind.map((k) => <li key={k.kind} className="flex justify-between gap-2 py-2 text-sm"><span>{k.label}</span><strong>{sar(k.left)}</strong></li>)}</ul>
        {!s.byKind.length && <p className="text-sm">لا ديون متبقية.</p>}</section>
    </div>
    <section className={card}><h2 className="mb-1 font-bold">ما يُدفع في الأشهر الاثني عشر القادمة</h2>
      <p className="mb-3 text-xs text-[#5b6b66]">الرواتب كما هي اليوم، والإيجار في شهر دفعه، والأقساط حتى ينتهي الدين. الديون بلا قسط شهري لا تدخل هنا.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
        <thead><tr className="border-b border-[#dbe6e1]"><th className={th}>الشهر</th><th className={th}>الرواتب</th><th className={th}>الإيجارات المستحقة</th><th className={th}>الأقساط</th><th className={th}>المجموع</th></tr></thead>
        <tbody>{plan.map((p) => <tr key={`${p.year}-${p.month}`} className="border-b border-[#eef2f0]">
          <td className={`${td} whitespace-nowrap font-semibold`}>{MONTHS[p.month - 1]} {p.year}</td><td className={td}>{sar(p.salaries)}</td>
          <td className={td}>{p.rents.length ? p.rents.map((r) => <div key={r.name}>{r.name}: {sar(r.amount)}</div>) : "—"}</td>
          <td className={td}>{p.installments ? sar(p.installments) : "—"}</td><td className={`${td} font-bold`}>{sar(p.total)}</td></tr>)}</tbody>
        <tfoot><tr><td className={`${td} font-bold`} colSpan={4}>مجموع السنة</td><td className={`${td} font-extrabold text-[#185045]`}>{sar(plan.reduce((a, p) => a + p.total, 0))}</td></tr></tfoot>
      </table></div></section>
  </div>;
}

function StaffTab({ book, set }: Edit) {
  const teams = payrollByTeam(book.staff);
  const teamNames = teams.map((t) => t.team);
  const patch = (id: string, p: Partial<Staff>) => set((b) => ({ ...b, staff: upd(b.staff, id, p) }));
  const add = (team: string) => set((b) => ({ ...b, staff: [...b.staff, { id: uid(), name: "", job: "", team, place: "", salary: 0, note: "", stopFrom: "", startFrom: "" }] }));
  const pickTeam = (s: Staff, v: string) => {
    if (v !== "__new") return patch(s.id, { team: v });
    const name = window.prompt("اسم الفريق الجديد")?.trim();
    if (name) patch(s.id, { team: name });
  };
  return <div className="space-y-4">
    <button onClick={() => add(teamNames[0] ?? "")} className="min-h-10 rounded-lg border border-[#185045] px-4 text-sm font-bold text-[#185045]">+ أضف موظفاً</button>
    {teams.map((t) => <section key={t.team} className={card}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">{t.team} <span className="text-sm font-normal text-[#5b6b66]">· {t.people.length}</span></h2><strong className="text-[#185045]">{sar(t.total)} شهرياً</strong></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm">
        <thead><tr><th className={th}>الاسم</th><th className={th}>الوظيفة</th><th className={th}>الفريق</th><th className={th}>المكان</th><th className={th}>الراتب الشهري</th><th className={th}>يبدأ من</th><th className={th}>يتوقف من</th><th className={th}>ملاحظة</th><th className={th} /></tr></thead>
        <tbody>{t.people.map((s) => <tr key={s.id} className={s.stopFrom ? "bg-[#fbf4f0]" : ""}>
          <td className={td}><input aria-label="الاسم" value={s.name} onChange={(e) => patch(s.id, { name: e.target.value })} className={`${field} min-w-36`} /></td>
          <td className={td}><input aria-label="الوظيفة" value={s.job} onChange={(e) => patch(s.id, { job: e.target.value })} className={field} /></td>
          <td className={td}><select aria-label="الفريق" value={s.team} onChange={(e) => pickTeam(s, e.target.value)} className={`${field} min-w-36`}>
            {[...new Set([...teamNames, s.team])].map((n) => <option key={n} value={n}>{n || "بلا فريق"}</option>)}<option value="__new">+ فريق جديد…</option></select></td>
          <td className={td}><input aria-label="المكان" value={s.place} onChange={(e) => patch(s.id, { place: e.target.value })} className={field} /></td>
          <td className={td}><input aria-label="الراتب" type="number" min={0} inputMode="decimal" value={s.salary || ""} placeholder="0" onChange={(e) => patch(s.id, { salary: num(e.target.value) })} className={`${field} w-28`} /></td>
          <td className={td}><input aria-label="يبدأ من" type="month" value={s.startFrom} onChange={(e) => patch(s.id, { startFrom: e.target.value })} className={`${field} w-36`} /></td>
          <td className={td}><input aria-label="يتوقف من" type="month" value={s.stopFrom} onChange={(e) => patch(s.id, { stopFrom: e.target.value })} className={`${field} w-36`} /></td>
          <td className={td}><input aria-label="ملاحظة" value={s.note} onChange={(e) => patch(s.id, { note: e.target.value })} className={field} /></td>
          <td className={td}><button onClick={() => confirm(`حذف «${s.name || "موظف"}» من الرواتب؟`) && set((b) => ({ ...b, staff: b.staff.filter((x) => x.id !== s.id) }))} className="min-h-9 rounded-lg px-2 text-sm text-[#9a3412] hover:bg-[#fbf4f0]">حذف</button></td>
        </tr>)}</tbody></table></div>
      <button onClick={() => add(t.team)} className="mt-2 text-sm font-semibold text-[#185045] underline">+ أضف إلى {t.team}</button>
    </section>)}
  </div>;
}

function RentsTab({ book, set }: Edit) {
  const patch = (id: string, p: Partial<Rent>) => set((b) => ({ ...b, rents: upd(b.rents, id, p) }));
  const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
  const next = (r: Rent) => { for (let i = 0; i < 12; i++) { const mm = ((m - 1 + i) % 12) + 1; if (rentDue(r, mm) > 0) return `${MONTHS[mm - 1]} ${y + Math.floor((m - 1 + i) / 12)}`; } return "—"; };
  return <section className={card}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">الإيجارات</h2>
      <button onClick={() => set((b) => ({ ...b, rents: [...b.rents, { id: uid(), name: "", yearly: 0, every: 3, startMonth: m, note: "" }] }))} className="min-h-10 rounded-lg border border-[#185045] px-4 text-sm font-bold text-[#185045]">+ أضف إيجاراً</button></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
      <thead><tr><th className={th}>الاسم</th><th className={th}>المبلغ السنوي</th><th className={th}>الدفع</th><th className={th}>شهر أول دفعة</th><th className={th}>الدفعة الواحدة</th><th className={th}>الدفعة القادمة</th><th className={th}>ملاحظة</th><th className={th} /></tr></thead>
      <tbody>{book.rents.map((r) => <tr key={r.id}>
        <td className={td}><input aria-label="الاسم" value={r.name} onChange={(e) => patch(r.id, { name: e.target.value })} className={`${field} min-w-36`} /></td>
        <td className={td}><input aria-label="المبلغ السنوي" type="number" min={0} inputMode="decimal" value={r.yearly || ""} placeholder="0" onChange={(e) => patch(r.id, { yearly: num(e.target.value) })} className={`${field} w-28`} /></td>
        <td className={td}><select aria-label="الدفع" value={r.every} onChange={(e) => patch(r.id, { every: Number(e.target.value) })} className={field}>{Object.entries(EVERY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
        <td className={td}><select aria-label="شهر أول دفعة" value={r.startMonth} onChange={(e) => patch(r.id, { startMonth: Number(e.target.value) })} className={field}>{MONTHS.map((n, i) => <option key={n} value={i + 1}>{i + 1} — {n}</option>)}</select></td>
        <td className={`${td} whitespace-nowrap font-semibold`}>{sar((r.yearly * r.every) / 12)}</td>
        <td className={`${td} whitespace-nowrap`}>{next(r)}</td>
        <td className={td}><input aria-label="ملاحظة" value={r.note} onChange={(e) => patch(r.id, { note: e.target.value })} className={field} /></td>
        <td className={td}><button onClick={() => confirm(`حذف «${r.name || "إيجار"}»؟`) && set((b) => ({ ...b, rents: b.rents.filter((x) => x.id !== r.id) }))} className="min-h-9 rounded-lg px-2 text-sm text-[#9a3412] hover:bg-[#fbf4f0]">حذف</button></td>
      </tr>)}</tbody></table></div>
  </section>;
}

function DebtsTab({ book, set }: Edit) {
  const [open, setOpen] = useState<string | null>(null);
  const patch = (id: string, p: Partial<Debt>) => set((b) => ({ ...b, debts: upd(b.debts, id, p) }));
  const kinds = (Object.keys(DEBT_KINDS) as DebtKind[]).map((k) => ({ kind: k, debts: book.debts.filter((d) => d.kind === k) })).filter((g) => g.debts.length);
  const total = book.debts.reduce((a, d) => a + debtLeft(d), 0);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm">المتبقي من كل الديون: <strong className="text-lg text-[#185045]">{sar(total)}</strong></p>
      <button onClick={() => set((b) => ({ ...b, debts: [...b.debts, { id: uid(), creditor: "", kind: "supplier", amount: 0, monthly: 0, payments: [], note: "" }] }))} className="min-h-10 rounded-lg border border-[#185045] px-4 text-sm font-bold text-[#185045]">+ أضف ديناً</button>
    </div>
    {kinds.map((g) => <section key={g.kind} className={card}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">{DEBT_KINDS[g.kind]} <span className="text-sm font-normal text-[#5b6b66]">· {g.debts.length}</span></h2>
        <strong className="text-[#185045]">المتبقي {sar(g.debts.reduce((a, d) => a + debtLeft(d), 0))}</strong></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
        <thead><tr><th className={th}>الجهة</th><th className={th}>النوع</th><th className={th}>المبلغ</th><th className={th}>المدفوع</th><th className={th}>المتبقي</th><th className={th}>قسط شهري</th><th className={th}>ملاحظة</th><th className={th} /></tr></thead>
        <tbody>{g.debts.map((d) => <DebtRow key={d.id} d={d} open={open === d.id} toggle={() => setOpen(open === d.id ? null : d.id)} patch={(p) => patch(d.id, p)}
          remove={() => confirm(`حذف دين «${d.creditor || "بلا اسم"}» ودفعاته؟`) && set((b) => ({ ...b, debts: b.debts.filter((x) => x.id !== d.id) }))} />)}</tbody>
      </table></div>
    </section>)}
  </div>;
}

function DebtRow({ d, open, toggle, patch, remove }: { d: Debt; open: boolean; toggle: () => void; patch: (p: Partial<Debt>) => void; remove: () => void }) {
  const [pay, setPay] = useState({ date: today(), amount: "", note: "" });
  const left = debtLeft(d);
  const months = d.monthly > 0 && left > 0 ? Math.ceil(left / d.monthly) : 0;
  const addPayment = () => {
    const amount = num(pay.amount);
    if (!amount || !/^\d{4}-\d{2}-\d{2}$/.test(pay.date)) return;
    patch({ payments: [...d.payments, { id: uid(), date: pay.date, amount, note: pay.note.trim() }] });
    setPay({ date: today(), amount: "", note: "" });
  };
  return <>
    <tr className="border-t border-[#eef2f0]">
      <td className={td}><input aria-label="الجهة" value={d.creditor} onChange={(e) => patch({ creditor: e.target.value })} className={`${field} min-w-36`} /></td>
      <td className={td}><select aria-label="النوع" value={d.kind} onChange={(e) => patch({ kind: e.target.value as DebtKind })} className={`${field} min-w-32`}>{Object.entries(DEBT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
      <td className={td}><input aria-label="المبلغ" type="number" min={0} inputMode="decimal" value={d.amount || ""} placeholder="0" onChange={(e) => patch({ amount: num(e.target.value) })} className={`${field} w-28`} /></td>
      <td className={`${td} whitespace-nowrap`}>{sar(debtPaid(d))}</td>
      <td className={`${td} whitespace-nowrap font-bold ${left ? "text-[#9a3412]" : "text-[#185045]"}`}>{left ? sar(left) : "سُدّد"}</td>
      <td className={td}><input aria-label="قسط شهري" type="number" min={0} inputMode="decimal" value={d.monthly || ""} placeholder="—" onChange={(e) => patch({ monthly: num(e.target.value) })} className={`${field} w-24`} />
        {months > 0 && <span className="mt-1 block text-xs text-[#5b6b66]">المتبقي: {arCount(months, "شهر", "شهران", "أشهر")}</span>}</td>
      <td className={td}><input aria-label="ملاحظة" value={d.note} onChange={(e) => patch({ note: e.target.value })} className={field} /></td>
      <td className={`${td} whitespace-nowrap`}><button onClick={toggle} aria-expanded={open} className="min-h-9 rounded-lg px-2 text-sm font-semibold text-[#185045] hover:bg-[#eef4f1]">دفعات ({d.payments.length})</button>
        <button onClick={remove} className="min-h-9 rounded-lg px-2 text-sm text-[#9a3412] hover:bg-[#fbf4f0]">حذف</button></td>
    </tr>
    {open && <tr><td colSpan={8} className="bg-[#f7faf8] p-3">
      <ul className="mb-2 space-y-1 text-sm">{d.payments.map((p) => <li key={p.id} className="flex flex-wrap items-center gap-3"><span className="font-semibold">{p.date}</span><span>{sar(p.amount)}</span><span className="text-[#5b6b66]">{p.note}</span>
        <button onClick={() => confirm("حذف هذه الدفعة؟") && patch({ payments: d.payments.filter((x) => x.id !== p.id) })} className="text-xs text-[#9a3412] underline">حذف</button></li>)}
        {!d.payments.length && <li className="text-[#5b6b66]">لا دفعات مسجلة.</li>}</ul>
      <form onSubmit={(e) => { e.preventDefault(); addPayment(); }} className="flex flex-wrap items-end gap-2">
        <label className="text-xs">التاريخ<input aria-label="تاريخ الدفعة" type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} className={field} /></label>
        <label className="text-xs">المبلغ<input aria-label="مبلغ الدفعة" type="number" min={0} inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} className={`${field} w-32`} /></label>
        <label className="min-w-40 flex-1 text-xs">ملاحظة<input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} className={field} /></label>
        <button className="tv-btn-primary min-h-9 rounded-lg px-4 text-sm font-bold">سجّل الدفعة</button>
      </form>
    </td></tr>}
  </>;
}

function ProfitsTab({ book, set }: Edit) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1, q = Math.ceil(m / 3);
  // from the first quarter with a booking (at most a year back) to the next one; earlier quarters were never recorded here
  const qi = (d: string) => Number(d.slice(0, 4)) * 4 + Math.floor((Number(d.slice(5, 7)) - 1) / 3);
  const now4 = y * 4 + (q - 1);
  const from = Math.max(now4 - 3, Math.min(now4, ...book.bookings.map((b) => qi(b.date))));
  const quarters = Array.from({ length: now4 + 2 - from }, (_, i) => quarter(book, Math.floor((from + i) / 4), ((from + i) % 4) + 1));
  const cur = quarters.find((x) => x.year === y && x.q === q)!;
  const shareSum = book.partners.reduce((a, p) => a + p.share, 0);
  const patchPartner = (id: string, p: Partial<Partner>) => set((b) => ({ ...b, partners: upd(b.partners, id, p) }));
  const patchBooking = (id: string, p: Partial<Booking>) => set((b) => ({ ...b, bookings: upd(b.bookings, id, p) }));
  const sellers = [...new Set(book.staff.map((s) => s.name).filter(Boolean))];
  const bookings = [...book.bookings].sort((a, b) => (a.date < b.date ? 1 : -1));
  const tiles: [string, string, string][] = [
    ["خزينة الشركة", sar(treasury(book)), `دخلها ${sar(treasuryIn(book))} (${book.reservePct}% من صافي ربح كل حجز)، وسُحب منها ${sar(treasuryOut(book))}`],
    ["ربح الحجوزات المطلوب هذا الشهر", sar(breakEven(book, y, m)), "ليغطي المصاريف الثابتة بعد نصيب الخزينة"],
    [`القابل للتوزيع — الربع ${q} من ${y}`, sar(Math.max(0, cur.distributable)), cur.distributable < 0 ? `ينقص ${sar(-cur.distributable)} عن تغطية المصاريف` : "يُقسَّم على الشركاء آخر الربع"],
  ];
  return <div className="space-y-4">
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">{tiles.map(([label, value, hint]) =>
      <div key={label} className={card}><p className="text-sm text-[#5b6b66]">{label}</p><p className="mt-1 text-2xl font-extrabold text-[#185045]">{value}</p><p className="mt-1 text-xs text-[#5b6b66]">{hint}</p></div>)}</div>

    <section className={card}><h2 className="mb-1 font-bold">القاعدة</h2>
      <p className="mb-3 text-sm text-[#5b6b66]">من صافي ربح كل حجز تُسحب نسبة الخزينة فوراً. وكل ثلاثة أشهر: صافي أرباح الحجوزات ناقص نصيب الخزينة ناقص المصاريف الثابتة للربع (الرواتب ومنها رواتب الشركاء، والإيجارات، والأقساط) — إن بقي شيء قُسِّم على الشركاء بنسبهم.</p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">نصيب الخزينة من كل حجز (%)<input type="number" min={0} max={100} value={book.reservePct} onChange={(e) => set((b) => ({ ...b, reservePct: Math.min(100, num(e.target.value)) }))} className={`${field} w-24`} /></label>
        {book.partners.map((p) => <div key={p.id} className="flex items-end gap-1">
          <label className="text-sm">الشريك<input value={p.name} onChange={(e) => patchPartner(p.id, { name: e.target.value })} className={`${field} w-32`} /></label>
          <label className="text-sm">النسبة %<input type="number" min={0} max={100} value={p.share} onChange={(e) => patchPartner(p.id, { share: Math.min(100, num(e.target.value)) })} className={`${field} w-20`} /></label>
          <button onClick={() => confirm(`حذف الشريك «${p.name}»؟`) && set((b) => ({ ...b, partners: b.partners.filter((x) => x.id !== p.id) }))} className="min-h-9 rounded-lg px-2 text-sm text-[#9a3412] hover:bg-[#fbf4f0]">حذف</button>
        </div>)}
        <button onClick={() => set((b) => ({ ...b, partners: [...b.partners, { id: uid(), name: "", share: 0 }] }))} className="min-h-9 rounded-lg border border-[#185045] px-3 text-sm font-bold text-[#185045]">+ شريك</button>
      </div>
      {shareSum !== 100 && <p className="mt-2 text-sm font-bold text-[#9a3412]">مجموع نسب الشركاء {shareSum}% — يجب أن يكون 100%.</p>}
    </section>

    <section className={card}><h2 className="mb-3 font-bold">الأرباع</h2>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
        <thead><tr className="border-b border-[#dbe6e1]"><th className={th}>الربع</th><th className={th}>الحجوزات</th><th className={th}>صافي الأرباح</th><th className={th}>للخزينة</th><th className={th}>المصاريف الثابتة</th><th className={th}>مصاريف أخرى</th><th className={th}>القابل للتوزيع</th>{book.partners.map((p) => <th key={p.id} className={th}>{p.name} {p.share}%</th>)}</tr></thead>
        <tbody>{quarters.map((x) => <tr key={`${x.year}-${x.q}`} className={`border-b border-[#eef2f0] ${x.year === y && x.q === q ? "bg-[#f1f8f5]" : ""}`}>
          <td className={`${td} whitespace-nowrap font-semibold`}>الربع {x.q} — {x.year}</td><td className={td}>{x.bookings}</td><td className={td}>{sar(x.profit)}</td><td className={td}>{sar(x.reserve)}</td><td className={td}>{sar(x.fixed)}</td><td className={td}>{sar(x.other)}</td>
          <td className={`${td} font-bold ${x.distributable < 0 ? "text-[#9a3412]" : "text-[#185045]"}`}>{sar(x.distributable)}</td>
          {x.shares.map((s, i) => <td key={`${s.name}-${i}`} className={td}>{sar(s.amount)}</td>)}</tr>)}</tbody>
      </table></div></section>

    <section className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">الحجوزات المباعة ({book.bookings.length})</h2>
        <button onClick={() => set((b) => ({ ...b, bookings: [{ id: uid(), date: today(), title: "", seller: "", sale: 0, cost: 0, note: "" }, ...b.bookings] }))} className="min-h-10 rounded-lg border border-[#185045] px-4 text-sm font-bold text-[#185045]">+ أضف حجزاً</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
        <thead><tr><th className={th}>التاريخ</th><th className={th}>الحجز</th><th className={th}>البائع</th><th className={th}>سعر البيع</th><th className={th}>التكلفة</th><th className={th}>صافي الربح</th><th className={th}>للخزينة</th><th className={th}>ملاحظة</th><th className={th} /></tr></thead>
        <tbody>{bookings.map((b) => { const profit = bookingProfit(b); return <tr key={b.id}>
          <td className={td}><input aria-label="التاريخ" type="date" value={b.date} onChange={(e) => e.target.value && patchBooking(b.id, { date: e.target.value })} className={`${field} w-36`} /></td>
          <td className={td}><input aria-label="الحجز" value={b.title} onChange={(e) => patchBooking(b.id, { title: e.target.value })} className={`${field} min-w-40`} /></td>
          <td className={td}><select aria-label="البائع" value={b.seller} onChange={(e) => patchBooking(b.id, { seller: e.target.value })} className={`${field} min-w-32`}><option value="">—</option>{[...new Set([...sellers, b.seller])].filter(Boolean).map((n) => <option key={n} value={n}>{n}</option>)}</select></td>
          <td className={td}><input aria-label="سعر البيع" type="number" min={0} inputMode="decimal" value={b.sale || ""} placeholder="0" onChange={(e) => patchBooking(b.id, { sale: num(e.target.value) })} className={`${field} w-28`} /></td>
          <td className={td}><input aria-label="التكلفة" type="number" min={0} inputMode="decimal" value={b.cost || ""} placeholder="0" onChange={(e) => patchBooking(b.id, { cost: num(e.target.value) })} className={`${field} w-28`} /></td>
          <td className={`${td} whitespace-nowrap font-bold ${profit < 0 ? "text-[#9a3412]" : "text-[#185045]"}`}>{sar(profit)}</td>
          <td className={`${td} whitespace-nowrap`}>{sar(bookingReserve(b, book.reservePct))}</td>
          <td className={td}><input aria-label="ملاحظة" value={b.note} onChange={(e) => patchBooking(b.id, { note: e.target.value })} className={field} /></td>
          <td className={td}><button onClick={() => confirm(`حذف الحجز «${b.title || b.date}»؟`) && set((x) => ({ ...x, bookings: x.bookings.filter((k) => k.id !== b.id) }))} className="min-h-9 rounded-lg px-2 text-sm text-[#9a3412] hover:bg-[#fbf4f0]">حذف</button></td>
        </tr>; })}</tbody>
      </table></div>
      {!book.bookings.length && <p className="mt-2 text-sm text-[#5b6b66]">لا حجوزات بعد. سجّل كل حجز مباع بسعره وتكلفته، فيُحسب نصيب الخزينة والشركاء وحده.</p>}
    </section>

    <MoneyLog title="مصاريف أخرى" items={book.expenses} onChange={(expenses) => set((b) => ({ ...b, expenses }))}
      hint="كل مصروف غير الرواتب والإيجارات والأقساط: إعلانات، فواتير، رسوم حكومية، مستحقات نهاية خدمة… يُخصم في ربعه قبل قسمة الشركاء." add="+ أضف مصروفاً" />
    <MoneyLog title="مسحوبات الخزينة" items={book.treasuryOut} onChange={(treasuryOut) => set((b) => ({ ...b, treasuryOut }))}
      hint="ما يُصرف من الخزينة نفسها (سداد دين، طارئ…). لا يُخصم من أرباح الربع، بل من رصيد الخزينة فقط." add="+ أضف سحباً" />
  </div>;
}

/** «الخطة القادمة»: each month's targets beside what it costs, the current pace and what is done so far */
function PlanTab({ book, set }: Edit) {
  const patch = (id: string, p: Partial<Target>) => set((b) => ({ ...b, targets: upd(b.targets, id, p) }));
  const targets = [...book.targets].sort((a, b) => (a.month < b.month ? -1 : 1));
  const addMonth = () => {
    const last = targets.at(-1)?.month;
    const d = new Date();
    const [y, m] = last ? last.split("-").map(Number) : [d.getFullYear(), d.getMonth() + 1];
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    set((b) => ({ ...b, targets: [...b.targets, { id: uid(), month: next, sales: 0, profit: 0, debtBudget: 0, focus: "", payments: "" }] }));
  };
  return <div className="space-y-4">
    <p className="text-sm text-[#5b6b66]">لكل شهر: الهدف، وما يكلّفه الشهر (الرواتب والإيجارات والأقساط والمصاريف المسجّلة فيه)، والمتوقع بمعدّل آخر 90 يوماً، وما تحقق من الحجوزات المسجّلة.</p>
    {targets.map((t) => { const x = targetMonth(book, t); const [y, m] = t.month.split("-").map(Number);
      const pct = t.profit > 0 ? Math.min(100, Math.round((100 * x.done.profit) / t.profit)) : 0;
      const stat = (label: string, value: number, hint = "", bad = false) => <div className="rounded-xl bg-[#f6faf8] p-3"><p className="text-xs text-[#5b6b66]">{label}</p><p className={`mt-0.5 text-lg font-extrabold ${bad ? "text-[#9a3412]" : "text-[#185045]"}`}>{sar(value)}</p>{hint && <p className="text-[11px] text-[#5b6b66]">{hint}</p>}</div>;
      return <section key={t.id} className={card}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold text-[#185045]">{MONTHS[m - 1]} {y}</h2>
          <button onClick={() => confirm(`حذف خطة ${MONTHS[m - 1]} ${y}؟`) && set((b) => ({ ...b, targets: b.targets.filter((k) => k.id !== t.id) }))} className="min-h-9 rounded-lg px-2 text-sm text-[#9a3412] hover:bg-[#fbf4f0]">حذف</button></div>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
          {stat("ما يكلّفه الشهر", x.cover, `ثابت ${sar(x.fixed)}${x.other ? ` + مصاريف ${sar(x.other)}` : ""}`)}
          {stat("المتوقع بالمعدّل الحالي", x.pace.profit, x.paceSurplus < 0 ? `ينقص ${sar(-x.paceSurplus)} عن التغطية` : `يفيض ${sar(x.paceSurplus)}`, x.paceSurplus < 0)}
          {stat("الفائض عند تحقيق الهدف", x.surplus, "للسداد والخزينة", x.surplus < 0)}
          {stat("تحقق حتى الآن", x.done.profit, `${x.done.count} حجز · ${pct}% من الهدف`)}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eef2f0]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="ما تحقق من هدف الربح"><div className="h-full bg-[#185045]" style={{ width: `${pct}%` }} /></div>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="text-sm">هدف المبيعات<input type="number" min={0} inputMode="decimal" value={t.sales || ""} placeholder="0" onChange={(e) => patch(t.id, { sales: num(e.target.value) })} className={`${field} w-36`} /></label>
          <label className="text-sm">هدف صافي الربح<input type="number" min={0} inputMode="decimal" value={t.profit || ""} placeholder="0" onChange={(e) => patch(t.id, { profit: num(e.target.value) })} className={`${field} w-36`} /></label>
          <label className="text-sm">ميزانية السداد<input type="number" min={0} inputMode="decimal" value={t.debtBudget || ""} placeholder="0" onChange={(e) => patch(t.id, { debtBudget: num(e.target.value) })} className={`${field} w-36`} /></label>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-semibold">ماذا نركز (بند في كل سطر)<textarea value={t.focus} onChange={(e) => patch(t.id, { focus: e.target.value })} rows={9} className={`${field} mt-1 font-normal leading-7`} /></label>
          <label className="text-sm font-semibold">خطة السداد (بند في كل سطر)<textarea value={t.payments} onChange={(e) => patch(t.id, { payments: e.target.value })} rows={9} className={`${field} mt-1 font-normal leading-7`} /></label>
        </div>
      </section>; })}
    <button onClick={addMonth} className="min-h-10 rounded-lg border border-[#185045] px-4 text-sm font-bold text-[#185045]">+ أضف شهراً</button>
  </div>;
}

/** a dated list of amounts: «مصاريف أخرى» and «مسحوبات الخزينة» */
function MoneyLog({ title, hint, add, items, onChange }: { title: string; hint: string; add: string; items: Expense[]; onChange: (items: Expense[]) => void }) {
  const patch = (id: string, p: Partial<Expense>) => onChange(upd(items, id, p));
  return <section className={card}>
    <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">{title} ({items.length})</h2>
      <button onClick={() => onChange([{ id: uid(), date: today(), title: "", amount: 0, note: "" }, ...items])} className="min-h-10 rounded-lg border border-[#185045] px-4 text-sm font-bold text-[#185045]">{add}</button></div>
    <p className="mb-3 text-xs text-[#5b6b66]">{hint}</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
      <thead><tr><th className={th}>التاريخ</th><th className={th}>البند</th><th className={th}>المبلغ</th><th className={th}>ملاحظة</th><th className={th} /></tr></thead>
      <tbody>{[...items].sort((a, b) => (a.date < b.date ? 1 : -1)).map((x) => <tr key={x.id}>
        <td className={td}><input aria-label="التاريخ" type="date" value={x.date} onChange={(e) => e.target.value && patch(x.id, { date: e.target.value })} className={`${field} w-36`} /></td>
        <td className={td}><input aria-label="البند" value={x.title} onChange={(e) => patch(x.id, { title: e.target.value })} className={`${field} min-w-40`} /></td>
        <td className={td}><input aria-label="المبلغ" type="number" min={0} inputMode="decimal" value={x.amount || ""} placeholder="0" onChange={(e) => patch(x.id, { amount: num(e.target.value) })} className={`${field} w-28`} /></td>
        <td className={td}><input aria-label="ملاحظة" value={x.note} onChange={(e) => patch(x.id, { note: e.target.value })} className={field} /></td>
        <td className={td}><button onClick={() => confirm(`حذف «${x.title || x.date}»؟`) && onChange(items.filter((k) => k.id !== x.id))} className="min-h-9 rounded-lg px-2 text-sm text-[#9a3412] hover:bg-[#fbf4f0]">حذف</button></td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
