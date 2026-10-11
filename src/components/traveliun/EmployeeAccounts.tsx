"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, KeyRound, Loader2, MailCheck, ShieldAlert } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  issueEmployeeAccount,
  listEmployeeAccounts,
  type EmployeeAccount,
} from "@/lib/data/employee-accounts";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * Who can actually sign in.
 *
 * An `employees` row is a personnel record, not an account — nine of twelve had
 * one and could not log in, and nothing on any screen said so. The two were
 * only ever joined in the Supabase console, by hand, by someone who then had to
 * remember to write the auth id back onto the employee.
 *
 * This screen is the join, stated. It shows the state per person and issues the
 * missing half in one press. Nobody types a password for anybody: the invitation
 * lets them set their own, and we never see it.
 */
export function EmployeeAccounts() {
  const { t, language } = useTraveliunUI();
  const [rows, setRows] = useState<EmployeeAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function load() {
    const result = await listEmployeeAccounts();
    if (!result.ok) {
      setError(result.error === "err.forbidden" ? t("err.forbidden") : t("err.loadFailed"));
      setRows([]);
      return;
    }
    setError(null);
    setRows(result.rows);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function issue(row: EmployeeAccount) {
    setBusy(row.id);
    setNote(null);
    startTransition(async () => {
      const result = await issueEmployeeAccount(row.id);
      setBusy(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setNote(t("emp.inviteSent", { email: result.email }));
      await load();
    });
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", { dateStyle: "medium" }).format(new Date(iso))
      : "—";

  const missing = (rows ?? []).filter((r) => !r.active).length;

  return (
    <TraveliunShell title="nav.employeeAccounts">
      <div className="tv-fade-up space-y-4">
        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-[#003c3a]">
            <KeyRound className="size-4 text-[#185045]" />
            {t("emp.accountsTitle")}
          </h2>
          <p className="mt-1 text-[12.5px] font-semibold text-[#93aaa3]">{t("emp.accountsHint")}</p>

          {rows !== null && missing > 0 ? (
            <p className="mt-3 flex items-center gap-2 rounded-[10px] border border-[#f2e2b4] bg-[#fffdf7] px-4 py-2.5 text-[12px] font-bold text-[#a86a10]">
              <ShieldAlert className="size-4 shrink-0" />
              {t("emp.missingCount", { count: String(missing) })}
            </p>
          ) : null}
          {note ? (
            <p className="mt-3 flex items-center gap-2 rounded-[10px] border border-[#bfe5d4] bg-[#e9f7f0] px-4 py-2.5 text-[12px] font-bold text-[#0f7a52]">
              <MailCheck className="size-4 shrink-0" />
              {note}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 rounded-[10px] border border-[#f2c7c7] bg-[#fff1f1] px-4 py-2.5 text-[12px] font-bold text-[#c43d3d]">
              {error}
            </p>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          {rows === null ? (
            <div className="tv-shimmer h-40" />
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-[#93aaa3]">{t("noData")}</p>
          ) : (
            <table className="w-full text-start text-[13px]">
              <thead>
                <tr className="border-b border-[#e7f0ec] bg-[#f8fbf9] text-[11.5px] font-extrabold text-[#557d78]">
                  <th className="px-4 py-3 text-start">{t("col.arabicName")}</th>
                  <th className="px-4 py-3 text-start">{t("col.email")}</th>
                  <th className="px-4 py-3 text-start">{t("emp.accountState")}</th>
                  <th className="px-4 py-3 text-start">{t("emp.lastSignIn")}</th>
                  <th className="px-4 py-3 text-start" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-[#f1f5f3] last:border-b-0">
                    <td className="px-4 py-3 font-bold text-[#185045]">{row.arabic_name}</td>
                    <td className="px-4 py-3 text-[#557d78]">
                      <DirText dir="ltr">{row.email || "—"}</DirText>
                    </td>
                    <td className="px-4 py-3">
                      {row.active ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e9f7f0] px-2.5 py-1 text-[11px] font-extrabold text-[#0f7a52]">
                          <CheckCircle2 className="size-3.5" />
                          {t("emp.canSignIn")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff8e8] px-2.5 py-1 text-[11px] font-extrabold text-[#a86a10]">
                          {t("emp.noAccount")}
                        </span>
                      )}
                    </td>
                    <td className="tv-tnum px-4 py-3 text-[12px] text-[#93aaa3]">
                      {/* Invited is not the same as using it — a person who never
                          opened the mail reads as active everywhere else. */}
                      {row.active && !row.last_sign_in_at ? t("emp.neverSignedIn") : fmt(row.last_sign_in_at)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      {row.active ? null : (
                        <button
                          type="button"
                          onClick={() => issue(row)}
                          disabled={busy !== null || !row.email}
                          title={row.email ? undefined : t("emp.needsEmail")}
                          className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white transition-colors hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy === row.id ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
                          {t("emp.issueAccount")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}
