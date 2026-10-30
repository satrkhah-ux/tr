import { redirect } from "next/navigation";
import { AccountsShell } from "@/components/traveliun/accounts/AccountsShell";
import { FinanceLock } from "@/components/traveliun/finance/FinanceLock";
import { accountsGate } from "@/lib/data/finance";
import "./accounts.css";

export const dynamic = "force-dynamic";

/**
 * «الحسابات» — its own frame and its own door (the owner, 2026-10-30: «الدخول بكلمة سر للادارة»):
 * finance.accounts or the book's owner, then the finance password, open 30 minutes from the last use.
 * Every loader and action below checks the same door again (accountsOpen).
 */
export default async function AccountsLayout({ children }: { children: React.ReactNode }) {
  const gate = await accountsGate();
  if (gate === "forbidden") redirect("/dashboard");
  const door =
    gate === "set" || gate === "ask" ? <FinanceLock mode={gate} title="الحسابات" />
    : gate === "none" ? <p className="tv-card mx-auto mt-10 max-w-sm rounded-2xl border p-6 text-center text-sm font-semibold text-tv-text-muted">لم تضع الإدارة كلمة سر القسم المالي بعد. تُوضع من «الحسابات المالية».</p>
    : gate === "error" ? <p className="tv-card mx-auto mt-10 max-w-sm rounded-2xl border p-6 text-center text-sm font-semibold text-tv-status-danger">تعذّر التحقق من كلمة السر الآن. حدّث الصفحة بعد قليل.</p>
    : null;
  return <AccountsShell open={gate === "open"}>{door ?? children}</AccountsShell>;
}
