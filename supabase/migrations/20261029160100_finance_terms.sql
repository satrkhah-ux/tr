-- «الشروط المالية» in the client PDF (the owner, 2026-10-29, session G):
-- three paragraphs — الحسابات البنكية، شروط الدفع، تقسيط المبلغ.
--
--  · bank rows (term_kind 'bank', 20261029160000): `checked` is the tick «يظهر
--    في ملفات العملاء» — switching accounts is changing the ticks;
--  · payment rows ('payment') carry a milestone: when (on confirmation / N days
--    after confirmation / N days before travel) and how much (a percent of the
--    client's total, or a fixed amount in the offer's currency). The PDF prints
--    the date it falls on and the amount;
--  · 'instalment': the instalment plan's text (Tabby / Tamara fees from session E).
--
-- Needs 20261029160000 first (it adds 'payment' and 'bank').
-- NOT applied by code: the coordinator applies it (backup first).
-- Rollback: scripts/rollback-finance-terms.sql. Dry run: scripts/dryrun-20261029160100.mjs.

alter table public.terms
  add column if not exists due_when text check (due_when in ('confirm', 'after_confirm', 'before_travel')),
  add column if not exists due_days int check (due_days between 0 and 365),
  add column if not exists due_percent numeric(5, 2) check (due_percent > 0 and due_percent <= 100),
  add column if not exists due_amount numeric(12, 2) check (due_amount > 0);

alter type public.term_kind add value if not exists 'instalment';
