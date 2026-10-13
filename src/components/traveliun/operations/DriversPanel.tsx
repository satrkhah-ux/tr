"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CalendarDays, Car, Check, Copy, Loader2, Pencil, Plane, Send, UserRound } from "lucide-react";
import { DirText } from "@/components/DirText";
import { updateBooking, type OperationBooking } from "@/lib/data/operation-bookings";
import { draftDriverMessage, sendDriverMessage, type DriverDraft } from "@/lib/data/operation-drivers";
import { DRV, driverServiceKind, driverStep, meetTime, timeKey, waNumber, type ServiceKind } from "@/lib/operations/drivers";
import type { TranslationKey } from "@/lib/i18n";
import { WelcomeBoardButton } from "../WelcomeBoardButton";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition, useSessionField } from "../useSafeTransition";
import { OpsLinkButton } from "./OpsLinkButton";

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "h-10 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[13px] text-[#185045] outline-none focus:border-[#2aa87a]";
const label = "grid gap-1.5 text-[11.5px] font-bold text-[#185045]";

const KIND_TONE: Record<ServiceKind, string> = {
  reception: "bg-[#e9f7f0] text-[#0f7a52]",
  farewell: "bg-[#eaf1ff] text-[#2b57c4]",
  transfer: "bg-[#eef4f1] text-[#557d78]",
  tour: "bg-[#fff4e0] text-[#a86a10]",
};

/**
 * «السائقون والاستقبال» — a card per drive and tour of this case.
 *
 * The card IS the booking's detail (السائق، جوال السائق، السيارة …), saved
 * through updateBooking like any other detail, so the voucher, the itinerary
 * and the client page all read the same facts. The reception's time is not
 * typed here first: the pull set it from the landing, and editing the flight
 * moves it (flight-follow.ts).
 */
export function DriversPanel({ serial, customerName, bookings }: { serial: string; customerName: string | null; bookings: OperationBooking[] }) {
  const { t } = useTraveliunUI();
  const rows = bookings
    .filter((b) => b.status !== "cancelled")
    .flatMap((b) => {
      const kind = driverServiceKind(b);
      return kind ? [{ b, kind }] : [];
    })
    .sort((x, y) => `${x.b.start_date ?? "9999"} ${meetTime(x.b) || "99:99"}`.localeCompare(`${y.b.start_date ?? "9999"} ${meetTime(y.b) || "99:99"}`));

  return (
    <section className={card}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-[#185045]">
          <Car className="size-4" />
          {t("ops.drv.title")}
        </h2>
        <Link
          href="/operations/drivers"
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
        >
          <CalendarDays className="size-3.5" />
          {t("ops.drv.schedule")}
        </Link>
      </div>
      <p className="mb-3 text-[11.5px] font-semibold text-[#93aaa3]">{t("ops.drv.hint")}</p>

      {rows.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-5 text-center text-[13px] text-[#93aaa3]">{t("ops.drv.none")}</p>
      ) : (
        <ul className="grid gap-2.5 lg:grid-cols-2">
          {rows.map(({ b, kind }) => (
            <DriverCard key={b.id} booking={b} kind={kind} serial={serial} customerName={customerName} />
          ))}
        </ul>
      )}
    </section>
  );
}

const FORM_KEYS = [DRV.driver, DRV.phone, DRV.car, DRV.plate, DRV.meet] as const;

function parseKept(kept: string): Record<string, string> {
  try {
    return kept ? (JSON.parse(kept) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function DriverCard({
  booking,
  kind,
  serial,
  customerName,
}: {
  booking: OperationBooking;
  kind: ServiceKind;
  serial: string;
  customerName: string | null;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const d = booking.detail ?? {};
  const tk = timeKey(kind);
  const initial = Object.fromEntries([...FORM_KEYS, tk].map((k) => [k, d[k] ?? ""]));
  const [editing, setEditing] = useState(false);
  // what was typed survives a reload after a deploy, until it is saved (order 4)
  const [kept, setKept] = useSessionField(`drv:${booking.id}`, "");
  // a draft left by an earlier load of this tab reopens the form; closing it discards the draft
  const open = editing || kept !== "";
  const form: Record<string, string> = { ...initial, ...parseKept(kept) };
  const set = (k: string, v: string) => setKept(JSON.stringify({ ...form, [k]: v }));
  const [pending, startTransition] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const time = meetTime(booking);

  function save() {
    startTransition(async () => {
      setError(null);
      // an emptied field is dropped, as in the booking edit form — a blank «السائق» is not a driver
      const detail = Object.fromEntries(
        Object.entries({ ...d, ...form })
          .map(([k, v]) => [k, v.trim()] as const)
          .filter(([, v]) => v),
      );
      const res = await updateBooking({ id: booking.id, detail });
      if (!res.ok) setError(t(res.error));
      else {
        setKept("");
        setEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <li className="rounded-[12px] border border-[#e2ebe7] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-extrabold text-[#0f3d38]">
            <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${KIND_TONE[kind]}`}>{t(`ops.drv.kind.${kind}` as TranslationKey)}</span>
            <span className="min-w-0 break-words">{booking.title}</span>
          </p>
          <p className="tv-tnum mt-1 text-[11.5px] font-bold text-[#557d78]">
            <DirText dir="ltr">{booking.start_date ?? "—"}</DirText>
            <span className="mx-1.5 text-[#cfe0d9]">|</span>
            {time ? <DirText dir="ltr">{time}</DirText> : <span className="text-[#a86a10]">{t("ops.drv.timeLater")}</span>}
            {booking.status !== "confirmed" ? <span className="ms-2 text-[#a86a10]">{t("ops.drv.unconfirmed")}</span> : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (open) setKept("");
            setEditing(!open);
          }}
          aria-label={t("edit")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-[#dbe6e1] text-[#557d78] hover:bg-[#f4f8f6]"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] font-semibold">
        {d[DRV.flight] ? <Fact icon={<Plane className="size-3" />} label={t("ops.drv.flight")} value={d[DRV.flight]} ltr /> : null}
        {d[DRV.meet] ? <Fact label={t("ops.drv.meet")} value={d[DRV.meet]} /> : null}
        <Fact icon={<UserRound className="size-3" />} label={t("ops.drv.driver")} value={d[DRV.driver] || t("ops.drv.noDriver")} muted={!d[DRV.driver]} />
        {d[DRV.phone] ? <Fact label={t("ops.drv.phone")} value={d[DRV.phone]} ltr /> : null}
        {d[DRV.car] || d[DRV.plate] ? <Fact icon={<Car className="size-3" />} label={t("ops.drv.car")} value={[d[DRV.car], d[DRV.plate]].filter(Boolean).join(" · ")} /> : null}
        {driverStep(d) ? <Fact label={t("ops.link.step")} value={[d[DRV.status], d[DRV.handedAt]].filter(Boolean).join(" · ")} /> : null}
        {d[DRV.landing] ? <Fact icon={<Plane className="size-3" />} label={t("ops.link.landing")} value={d[DRV.landing]} ltr /> : null}
      </dl>

      {open ? (
        <div className="mt-2 grid gap-2 rounded-[9px] border border-[#e2ebe7] bg-[#f8fbf9] p-3 sm:grid-cols-2">
          {[
            [DRV.driver, "ops.drv.driver"],
            [DRV.phone, "ops.drv.phone"],
            [DRV.car, "ops.drv.car"],
            [DRV.plate, "ops.drv.plate"],
            [tk, "ops.drv.time"],
            [DRV.meet, "ops.drv.meet"],
          ].map(([key, labelKey]) => (
            <label key={key} className={label}>
              {t(labelKey as TranslationKey)}
              <input
                value={form[key] ?? ""}
                onChange={(e) => set(key, e.target.value)}
                dir={key === DRV.phone || key === DRV.plate || key === tk ? "ltr" : undefined}
                placeholder={key === tk ? "15:15" : undefined}
                className={`${field} ${key === DRV.phone || key === tk ? "tv-tnum" : ""}`}
              />
            </label>
          ))}
          {error ? <p className="text-[11.5px] font-bold text-[#c22850] sm:col-span-2">{error}</p> : null}
          <div className="sm:col-span-2">
            <button
              type="button"
              disabled={pending}
              onClick={save}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {t("save")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <DriverSend bookingId={booking.id} onSent={() => router.refresh()} />
        {d[DRV.phone] && booking.start_date ? <OpsLinkButton kind="driver" bookingId={booking.id} /> : null}
        {booking.start_date ? (
          <Link
            href={`/operations/drivers?date=${booking.start_date}${booking.city_name ? `&city=${encodeURIComponent(booking.city_name.trim())}` : ""}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
          >
            <CalendarDays className="size-3.5" />
            {t("ops.drv.schedule")}
          </Link>
        ) : null}
        {kind === "reception" ? <WelcomeBoardButton serial={serial} defaultName={customerName} /> : null}
      </div>
    </li>
  );
}

function Fact({ label, value, icon, ltr, muted }: { label: string; value: string; icon?: ReactNode; ltr?: boolean; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[10.5px] font-bold text-[#93aaa3]">
        {icon}
        {label}
      </dt>
      <dd className={`break-words ${muted ? "text-[#a86a10]" : "text-[#0f3d38]"}`}>{ltr ? <DirText dir="ltr">{value}</DirText> : value}</dd>
    </div>
  );
}

/**
 * «أرسل للسائق»: draft from the booking, review, then send — over Teletel when
 * the driver already has a conversation there, else copy / open WhatsApp and
 * mark it sent. Shared by the case card and the day's schedule.
 */
export function DriverSend({ bookingId, onSent }: { bookingId: string; onSent?: () => void }) {
  const { t } = useTraveliunUI();
  const [pending, startTransition] = useSafeTransition();
  const [draft, setDraft] = useState<DriverDraft | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);

  function prepare() {
    startTransition(async () => {
      setError(null);
      const res = await draftDriverMessage(bookingId);
      if (!res.ok) setError(t(res.error));
      else {
        setDraft(res.draft);
        setBody(res.draft.body);
      }
    });
  }

  function send(channel: "whatsapp" | "manual") {
    if (!draft) return;
    startTransition(async () => {
      setError(null);
      const res = await sendDriverMessage({ booking_id: bookingId, channel, to_label: draft.to_label, to_phone: draft.to_phone, body });
      if (!res.ok) setError(t(res.error));
      else {
        setDraft(null);
        setSent(true);
        onSent?.();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => (draft ? setDraft(null) : prepare())}
        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#185045] px-2.5 text-[11.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : sent ? <Check className="size-3.5" /> : <Send className="size-3.5" />}
        {t("ops.drv.send")}
      </button>
      {error ? <p className="w-full text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
      {draft ? (
        <div className="w-full rounded-[9px] border border-[#d6eadf] bg-white p-3">
          <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[11.5px] font-bold text-[#0f7a52]">
            <UserRound className="size-3.5" />
            {draft.to_label}
            {draft.to_phone ? <DirText dir="ltr" className="font-semibold text-[#93aaa3]">{draft.to_phone}</DirText> : null}
          </p>
          <p className="mb-2 text-[11px] font-semibold text-[#93aaa3]">{t("ops.drv.review")}</p>
          {/* editable on purpose — what is stored is what actually went out */}
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
              <Send className="size-3.5" />
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
                href={`https://wa.me/${waNumber(draft.to_phone)}?text=${encodeURIComponent(body)}`}
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
    </>
  );
}
