"use client";

import { useEffect, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { PAYMENT_LABEL, VISA_STATUS_LABEL, type PaymentState, type VisaStatus } from "@/lib/visa-files/types";

import { buttonTone } from "@/components/ui/button-variants";
/**
 * The visa screens' look: the operations screens' palette (white cards, #185045 green, 44 px targets), which the dark
 * layer in globals.css already remaps. Status and payment chips keep their own tints, as the other badges do.
 */
/** a colleague for a picker */
export type Person = { id: string; name: string };
/** what the last action of a section said, shown under it */
export type Message = { tone: "ok" | "error" | "busy"; text: string } | null;

export const card = "tv-card rounded-2xl border p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)] sm:p-5";
export const field = "tv-field h-11 w-full min-w-0 rounded-[10px] border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus disabled:opacity-60";
export const area = "tv-field min-h-24 w-full min-w-0 rounded-[10px] border p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus";
export const label = "grid min-w-0 gap-1.5 text-[12px] font-bold text-[#185045]";
export const btn = `${buttonTone({ variant: "secondary" })} inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border px-4 text-sm font-bold transition-colors disabled:opacity-50`;
export const btnPrimary = `${buttonTone({ variant: "default" })} inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-bold transition-colors disabled:opacity-50`;
export const btnDanger = "inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-[#f3c9d3] bg-white px-4 text-sm font-bold text-[#c22850] transition-colors hover:bg-[#fdecef] disabled:opacity-50";
export const heading = "text-sm font-extrabold text-[#185045]";

const STATUS_TONE: Record<VisaStatus, string> = {
  new: "bg-[#eef4f1] text-[#557d78]",
  collecting: "bg-tv-status-warning-bg text-tv-status-warning",
  ready: "bg-[#dff1f4] text-[#0e7490]",
  submitted: "bg-[#e8eefc] text-[#3b4fa8]",
  approved: "bg-tv-status-success-bg text-tv-status-success",
  rejected: "bg-tv-status-danger-bg text-tv-status-danger",
  delivered: "bg-[#d5eee3] text-[#0b5e3f]",
  cancelled: "bg-[#eef1f4] text-[#5b6b78]",
};
const PAYMENT_TONE: Record<PaymentState, string> = {
  unpaid: "bg-tv-status-danger-bg text-tv-status-danger",
  partial: "bg-tv-status-warning-bg text-tv-status-warning",
  paid: "bg-tv-status-success-bg text-tv-status-success",
  free: "bg-[#eef1f4] text-[#5b6b78]",
};
const chip = "inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs font-extrabold";

export function StatusChip({ status }: { status: VisaStatus }) {
  return <span className={`${chip} ${STATUS_TONE[status]}`}>{VISA_STATUS_LABEL[status]}</span>;
}
export function PaymentChip({ state }: { state: PaymentState }) {
  return <span className={`${chip} ${PAYMENT_TONE[state]}`}>{PAYMENT_LABEL[state]}</span>;
}

/** One inline line under a form or a list: what happened, in words. Errors are alerts, the rest polite status. */
export function Notice({ tone, children }: { tone: "error" | "ok" | "busy"; children: ReactNode }) {
  const look = tone === "error" ? "bg-tv-status-danger-bg text-tv-status-danger" : tone === "ok" ? "bg-tv-status-success-bg text-tv-status-success" : "bg-[#eef4f1] text-[#557d78]";
  const Icon = tone === "error" ? AlertTriangle : tone === "ok" ? CheckCircle2 : Loader2;
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-[10px] px-3 py-2 text-[13px] font-bold ${look}`}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone === "busy" ? "animate-spin" : ""}`} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

const LEAVE = "لديك تعديلات لم تُحفظ. إن غادرت الصفحة الآن ستضيع. هل تريد المغادرة؟";
/**
 * Unsaved changes ask before they are lost: a reload or a closed tab (the browser's own question) and a click on any
 * link of this site (the menu, the tabs) — Next has no hook to stop a client-side navigation, so the click is
 * caught on the way down, before the link hears it. The browser's back button is not caught.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const to = new URL(link.href, window.location.href);
      if (to.origin !== window.location.origin || to.pathname + to.search === window.location.pathname + window.location.search) return;
      if (!window.confirm(LEAVE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}
