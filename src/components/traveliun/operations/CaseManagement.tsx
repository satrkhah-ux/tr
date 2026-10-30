"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { History, Loader2, Lock, MessageSquarePlus, Phone, UserCheck } from "lucide-react";
import { DirText } from "@/components/DirText";
import { addCaseNote, saveClientInfo, setCaseAssignee, type ActivityEntry, type StaffOption } from "@/lib/data/operation-case";
import type { ClientInfo } from "@/lib/operations/case-list";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition, useSessionField } from "../useSafeTransition";

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "h-10 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[13px] text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]";
const label = "grid gap-1.5 text-[11.5px] font-bold text-[#185045]";

/** Actions the log has words for; anything newer shows its code rather than nothing. */
const KNOWN = new Set([
  "operation.confirmed",
  "operation.client_status",
  "operation.execution_status",
  "operation.cancelled",
  "operation.assigned",
  "operation.client_info",
  "operation.note",
  "payment.recorded",
  "passport.saved",
  "passport.viewed",
  "passport.scan_viewed",
  "booking.created",
  "booking.confirmed",
  "booking.cancelled",
  "booking.retimed",
  "dispatch.sent",
  "dispatch.held",
  "voucher.issued",
  "voucher.revoked",
  "supplier.prebooked",
  "supplier.booked",
  "supplier.cancelled",
]);

/** The audit clock, on the company's wall: «2026-11-20 15:15» in Riyadh. */
const riyadh = (iso: string) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Riyadh" }).slice(0, 16);

/**
 * The case as a piece of work: who owns it, what its trip page tells the client,
 * the team's notes, and who did what when.
 */
export function CaseManagement({
  operationId,
  assigneeId,
  staff,
  clientInfo,
  activity,
}: {
  operationId: string;
  assigneeId: string | null;
  staff: StaffOption[];
  clientInfo: ClientInfo;
  activity: ActivityEntry[];
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState(clientInfo);
  const [savedInfo, setSavedInfo] = useState(false);
  const [note, setNote, forgetNote] = useSessionField(`note:${operationId}`, "");
  const [showAll, setShowAll] = useState(false);

  const notes = activity.filter((a) => a.action === "operation.note");
  const log = activity.filter((a) => a.action !== "operation.note");

  function run(action: () => Promise<{ ok: true } | { ok: false; error: TranslationKey }>, after?: () => void) {
    startTransition(async () => {
      setError(null);
      const res = await action();
      if (!res.ok) setError(t(res.error));
      else {
        after?.();
        router.refresh();
      }
    });
  }

  function detailOf(a: ActivityEntry): string {
    const m = a.meta;
    const to =
      m.to && a.action === "operation.client_status"
        ? t(`ops.client.${m.to}` as TranslationKey)
        : m.to && a.action === "operation.execution_status"
          ? t(`ops.exec.${m.to}` as TranslationKey)
          : m.to;
    return [
      to,
      m.amount ? `${m.amount} ${m.currency ?? ""}`.trim() : "",
      m.confirmation_number,
      [m.date, m.time].filter(Boolean).join(" "),
      m.seeded ? `+${m.seeded}` : "",
      a.action !== "operation.note" ? m.note : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return (
    <section className={card}>
      {error ? <p className="mb-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <label className={label}>
            <span className="flex items-center gap-1.5">
              <UserCheck className="size-3.5" />
              {t("ops.list.caseOwner")}
            </span>
            <select
              value={assigneeId ?? ""}
              disabled={pending}
              onChange={(e) => run(() => setCaseAssignee(operationId, e.target.value || null))}
              className={field}
            >
              <option value="">{t("ops.list.noOwner")}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-[12px] border border-[#d6eadf] bg-[#f2fbf6] p-3">
            <p className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#0f7a52]">
              <Phone className="size-3.5" />
              {t("ops.list.clientInfo")}
            </p>
            <p className="mt-0.5 text-[11px] font-semibold text-[#557d78]">{t("ops.list.clientInfoHint")}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className={label}>
                {t("ops.list.emergency")}
                <input dir="ltr" value={info.emergency_phone} onChange={(e) => setInfo({ ...info, emergency_phone: e.target.value })} className={`${field} tv-tnum`} />
              </label>
              <label className={label}>
                {t("ops.list.agentName")}
                <input value={info.agent_name} onChange={(e) => setInfo({ ...info, agent_name: e.target.value })} className={field} />
              </label>
              <label className={label}>
                {t("ops.list.agentPhone")}
                <input dir="ltr" value={info.agent_phone} onChange={(e) => setInfo({ ...info, agent_phone: e.target.value })} className={`${field} tv-tnum`} />
              </label>
              <label className={`${label} sm:col-span-2`}>
                {t("ops.list.payNote")}
                <textarea
                  value={info.pay_note}
                  onChange={(e) => setInfo({ ...info, pay_note: e.target.value })}
                  rows={2}
                  className="w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 py-2 text-[13px] text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => saveClientInfo(operationId, info), () => setSavedInfo(true))}
              className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {savedInfo ? t("ops.list.saved") : t("save")}
            </button>
          </div>
        </div>

        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-[#185045]">
            <Lock className="size-3.5" />
            {t("ops.list.notes")}
          </h2>
          <p className="mb-2 text-[11px] font-semibold text-tv-text-faint">{t("ops.list.notesHint")}</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="block w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 py-2 text-[13px] text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
          />
          <button
            type="button"
            disabled={pending || !note.trim()}
            onClick={() => run(() => addCaseNote(operationId, note), forgetNote)}
            className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4] disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <MessageSquarePlus className="size-3.5" />}
            {t("ops.list.addNote")}
          </button>
          {notes.length === 0 ? (
            <p className="mt-3 text-[12px] font-semibold text-tv-text-faint">{t("ops.list.noNotes")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-[10px] bg-[#f8fbf9] px-3 py-2">
                  <p className="whitespace-pre-line break-words text-[12.5px] font-semibold text-[#0f3d38]">{n.meta.note}</p>
                  <p className="tv-tnum mt-1 text-[10.5px] font-bold text-tv-text-faint">
                    {n.actor ?? "—"} · <DirText dir="ltr">{riyadh(n.created_at)}</DirText>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-5 border-t border-[#f0f4f2] pt-4">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-[#185045]">
          <History className="size-4" />
          {t("ops.list.activity")}
        </h2>
        {log.length === 0 ? (
          <p className="text-[12px] font-semibold text-tv-text-faint">{t("ops.list.noActivity")}</p>
        ) : (
          <>
            <ol className="space-y-1.5">
              {(showAll ? log : log.slice(0, 12)).map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px] font-semibold text-[#334f4b]">
                  <span className="tv-tnum text-[11px] font-bold text-tv-text-faint">
                    <DirText dir="ltr">{riyadh(a.created_at)}</DirText>
                  </span>
                  <span className="font-extrabold text-[#0f3d38]">{a.actor ?? "—"}</span>
                  <span>{KNOWN.has(a.action) ? t(`ops.list.act.${a.action}` as TranslationKey) : a.action}</span>
                  {detailOf(a) ? <span className="min-w-0 break-words text-[#557d78]">— {detailOf(a)}</span> : null}
                </li>
              ))}
            </ol>
            {log.length > 12 ? (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-[12px] font-bold text-[#185045] hover:underline">
                {showAll ? "−" : `+${log.length - 12}`}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
