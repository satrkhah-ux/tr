"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Check, Copy, Loader2, Mail, Send, Store, UserRound, Users } from "lucide-react";
import {
  assignBooking,
  draftBookingRequest,
  sendBookingRequest,
  type AssigneeKind,
  type AssigneeOption,
  type RequestDraft,
} from "@/lib/data/operation-assign";
import type { OperationBooking } from "@/lib/data/operation-bookings";
import type { TranslationKey } from "@/lib/i18n";
import { assigneeGroups, assigneesFor, type AssigneeGroup } from "@/lib/operations/supplier-request";
import { isUnassigned } from "@/lib/operations/wizard";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

const field =
  "tv-field h-10 w-full rounded-[10px] border px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus";

/** The option «الكل» stands for — it opens the list, it assigns nobody. */
const ALL = "__all";

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
  partnerId = null,
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
  /** the file's partner company (offers.partner_company_id) — offered on its own file only. */
  partnerId?: string | null;
  onDone: () => void;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(booking.handoff_note ?? "");
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);
  // «ينفّذه» opens on the operations team and the suppliers; «الكل» adds every colleague (the owner, 2026-10-22)
  const [all, setAll] = useState(false);

  const currentId = booking.assignee_employee_id ?? booking.assignee_partner_id ?? booking.assignee_supplier_id ?? null;
  // nobody chose yet (the column default, no assigned_at) reads as that — not as «قسم العمليات»
  const unset = isUnassigned(booking);
  const value = unset ? "" : `${booking.assignee_kind ?? "ops"}:${currentId ?? ""}`;
  // only who fits this booking's kind (supplier-request.ts assigneesFor) — and whoever already has it
  const listed = assigneesFor(assignees, booking, unset ? null : value, partnerId);
  // Whoever holds it now, even when the list no longer offers them (a supplier set «Disabled»,
  // a partner made inactive): shown by name and marked — a value with no option of its own
  // made the browser show the first one, «قسم العمليات» (as TransportStep keeps its city's supplier).
  const missing = !unset && !listed.some((a) => `${a.kind}:${a.id ?? ""}` === value);
  const holder = booking.assignee_label ?? (booking.assignee_kind === "ops" ? t("ops.assignee.ops") : "—");
  // the list still loading says nothing about them yet
  const shown = assignees.length > 0 ? `${holder} (${t("ops.assignee.inactive")})` : holder;
  const options: AssigneeOption[] = missing ? [...listed, { kind: booking.assignee_kind ?? "ops", id: currentId, label: shown, phone: null }] : listed;
  const { groups, hidden } = assigneeGroups(options, unset ? null : value, all);
  const groupLabel = (g: AssigneeGroup<AssigneeOption>) =>
    g.key === "suppliers"
      ? t("ops.assignee.suppliers", { service: t(`ops.booking.${booking.kind}` as TranslationKey), country: g.country ?? t("ops.assignee.anyCountry") })
      : t(`ops.assignee.group.${g.key}`);

  function assign(raw: string) {
    if (raw === ALL) return setAll(true);
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
            {unset ? (
              <option value="" disabled>
                {t("wz.transport.unassigned")}
              </option>
            ) : null}
            {groups.map((g) => (
              <optgroup key={`${g.key}:${g.country ?? ""}`} label={groupLabel(g)}>
                {g.items.map((a) => (
                  <option key={`${a.kind}:${a.id ?? ""}`} value={`${a.kind}:${a.id ?? ""}`}>
                    {a.kind === "partner" ? `🏢 ${a.label}` : a.kind === "employee" ? `👤 ${a.label}` : a.kind === "supplier" ? `🧾 ${a.label}` : a.label}
                  </option>
                ))}
              </optgroup>
            ))}
            {hidden > 0 ? <option value={ALL}>{t("ops.assignee.showAll", { n: hidden })}</option> : null}
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
          className="tv-btn-secondary inline-flex h-10 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-bold disabled:opacity-60"
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
            {draft.to_phone ? <span className="font-semibold text-tv-text-faint" dir="ltr">{draft.to_phone}</span> : null}
          </p>
          <p className="mb-2 text-[11px] font-semibold text-tv-text-faint">{t("ops.request.review")}</p>
          {/* editable on purpose — what gets stored is what actually went out */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            dir="auto"
            className="mb-2 block w-full rounded-[9px] border border-[#dbe6e1] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-[#0f3d38] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
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
            {draft.to_email ? (
              <a
                href={`mailto:${draft.to_email}?subject=${encodeURIComponent(draft.subject ?? "")}&body=${encodeURIComponent(body)}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
              >
                <Mail className="size-3.5" />
                {t("ops.sup.email")}
              </a>
            ) : null}
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
              className="tv-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-[9px] border px-3 text-[12px] font-bold disabled:opacity-60 max-sm:min-h-10"
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
  unset,
}: {
  kind: AssigneeKind | undefined;
  label: string | null;
  /** isUnassigned — said plainly instead of «قسم العمليات». */
  unset?: boolean;
}) {
  const { t } = useTraveliunUI();
  if (unset) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4e0] px-2 py-0.5 text-[10.5px] font-bold text-[#a86a10]">
        <Users className="size-3" />
        {t("wz.transport.unassigned")}
      </span>
    );
  }
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
      {kind === "partner" ? <Building2 className="size-3" /> : kind === "supplier" ? <Store className="size-3" /> : <UserRound className="size-3" />}
      {label ?? (kind === "supplier" ? t("ops.sup.supplier") : t(`ops.assignee.${kind}`))}
    </span>
  );
}
