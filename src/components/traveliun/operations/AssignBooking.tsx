"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Building2, Check, Copy, Loader2, Send, UserRound, Users } from "lucide-react";
import {
  assignBooking,
  draftBookingRequest,
  sendBookingRequest,
  type AssigneeKind,
  type AssigneeOption,
  type RequestDraft,
} from "@/lib/data/operation-assign";
import type { OperationBooking } from "@/lib/data/operation-bookings";
import { useTraveliunUI } from "../TraveliunUIProvider";

const field =
  "h-10 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[13px] text-[#185045] outline-none focus:border-[#2aa87a]";

/**
 * Hand a booking to whoever is actually going to do it, then prepare the request
 * and send it — as two separate acts.
 *
 * Assigning is instant because it is internal bookkeeping. SENDING is not: the
 * message is drafted from the operation, shown in an editable box, and only
 * leaves when a human presses the button. A request that goes out the moment a
 * dropdown changes is a request nobody read.
 */
export function AssignBooking({
  booking,
  operationId,
  assignees,
  onDone,
}: {
  booking: OperationBooking & {
    assignee_kind?: AssigneeKind;
    assignee_employee_id?: string | null;
    assignee_partner_id?: string | null;
    handoff_note?: string | null;
  };
  operationId: string;
  assignees: AssigneeOption[];
  onDone: () => void;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(booking.handoff_note ?? "");
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);

  const currentId = booking.assignee_employee_id ?? booking.assignee_partner_id ?? null;
  const value = `${booking.assignee_kind ?? "ops"}:${currentId ?? ""}`;

  function assign(raw: string) {
    const [kind, id] = raw.split(":") as [AssigneeKind, string];
    startTransition(async () => {
      setError(null);
      const res = await assignBooking({
        booking_id: booking.id,
        kind,
        assignee_id: id || null,
        handoff_note: note || null,
      });
      if (!res.ok) setError(t(res.error));
      else {
        onDone();
        router.refresh();
      }
    });
  }

  function prepare() {
    startTransition(async () => {
      setError(null);
      const res = await draftBookingRequest(booking.id);
      if (!res.ok) {
        setError(t(res.error));
        return;
      }
      setDraft(res.draft);
      setBody(res.draft.body);
    });
  }

  function send(channel: "whatsapp" | "manual") {
    if (!draft) return;
    startTransition(async () => {
      setError(null);
      const res = await sendBookingRequest({
        booking_id: booking.id,
        operation_id: operationId,
        channel,
        to_label: draft.to_label,
        to_phone: draft.to_phone,
        body,
      });
      if (!res.ok) setError(t(res.error));
      else {
        setDraft(null);
        onDone();
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-2 rounded-[9px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-1.5 text-[11.5px] font-bold text-[#185045]">
          {t("ops.assignee")}
          <select value={value} onChange={(e) => assign(e.target.value)} disabled={pending} className={field}>
            {assignees.map((a) => (
              <option key={`${a.kind}:${a.id ?? ""}`} value={`${a.kind}:${a.id ?? ""}`}>
                {a.kind === "partner" ? `🏢 ${a.label}` : a.kind === "employee" ? `👤 ${a.label}` : a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-[11.5px] font-bold text-[#185045]">
          {t("ops.assign.note")}
          <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={prepare}
          className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#b7d0c7] bg-white px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4] disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          {t("ops.request.draft")}
        </button>
      </div>

      {error ? <p className="mt-2 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}

      {draft ? (
        <div className="mt-3 rounded-[9px] border border-[#d6eadf] bg-white p-3">
          <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[11.5px] font-bold text-[#0f7a52]">
            <Building2 className="size-3.5" />
            {draft.to_label}
            {draft.to_phone ? <span className="font-semibold text-[#93aaa3]" dir="ltr">{draft.to_phone}</span> : null}
          </p>
          <p className="mb-2 text-[11px] font-semibold text-[#93aaa3]">{t("ops.request.review")}</p>
          {/* editable on purpose — what gets stored is what actually went out */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            dir="auto"
            className="mb-2 block w-full rounded-[9px] border border-[#dbe6e1] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-[#0f3d38] outline-none focus:border-[#2aa87a]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !draft.canSendWhatsapp}
              title={draft.canSendWhatsapp ? undefined : t("ops.err.noConversation")}
              onClick={() => send("whatsapp")}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {t("ops.request.sendWhatsapp")}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(body);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
            >
              <Copy className="size-3.5" />
              {copied ? t("copied") : t("ops.dispatch.copy")}
            </button>
            {draft.to_phone ? (
              <a
                href={`https://wa.me/${draft.to_phone.replace(/\D/g, "")}?text=${encodeURIComponent(body)}`}
                target="_blank"
                rel="noopener"
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
              >
                {t("ops.dispatch.openWhatsapp")}
              </a>
            ) : null}
            <button
              type="button"
              disabled={pending}
              onClick={() => send("manual")}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4] disabled:opacity-60"
            >
              <Check className="size-3.5" />
              {t("ops.request.markSent")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The chip on a collapsed booking row — who owns it, at a glance. */
export function AssigneeChip({
  kind,
  label,
}: {
  kind: AssigneeKind | undefined;
  label: string | null;
}) {
  const { t } = useTraveliunUI();
  if (!kind || kind === "ops") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#eef4f1] px-2 py-0.5 text-[10.5px] font-bold text-[#557d78]">
        <Users className="size-3" />
        {t("ops.assignee.ops")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#eaf1ff] px-2 py-0.5 text-[10.5px] font-bold text-[#2b57c4]">
      {kind === "partner" ? <Building2 className="size-3" /> : <UserRound className="size-3" />}
      {label ?? t(`ops.assignee.${kind}`)}
    </span>
  );
}
