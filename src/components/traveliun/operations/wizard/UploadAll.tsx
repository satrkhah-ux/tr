"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import { readPassportPhoto } from "@/lib/data/operation-travelers";
import { sortPaper } from "@/lib/data/upload-sort";
import { readBookingTicket, readHotelConfirmation, saveBookingTicket, saveHotelConfirmation, type HotelRead, type TicketRead } from "@/lib/data/wizard-tickets";
import { parseTicketText } from "@/lib/flights/ticket-parse";
import { trustedFields, type MrzPassport } from "@/lib/operations/mrz";
import { hotelBookings } from "@/lib/operations/wizard/hotels";
import { matchPassport, type MatchRow } from "@/lib/operations/wizard/passports";
import { matchHotel, matchTicket, type PaperKind } from "@/lib/operations/wizard/upload-all";
import type { WizardCase } from "@/lib/operations/wizard/types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { savePassport } from "./passport-save";
import { wzPrimary, wzSecondary } from "./FlightsStep";

/** What the MRZ reader is handed — a picture. */
const READABLE = /^image\/(jpeg|png|webp)$/;
const KINDS: PaperKind[] = ["passport", "ticket", "hotel", "unknown"];
/** Files read at once — a vision read is slow, and one slow file must not hold the rest. */
const AT_ONCE = 2;

type Item = {
  key: number;
  file: File;
  /** sorting: not yet known what it is; reading: read again for the place it was moved to */
  status: "sorting" | "reading" | "ready" | "failed" | "saving" | "saved" | "dropped";
  kind: PaperKind;
  /** a traveller's id, «new» for a traveller the case lacks, or a booking's id; "" not placed */
  target: string;
  /** a ticket's or a confirmation's words, read once */
  text: string;
  /** the picture the MRZ reader reads: the file, or a PDF's first page */
  picture: File | null;
  passport: MrzPassport | null;
  ticket: TicketRead | null;
  hotel: HotelRead | null;
  /** the PNR / the hotel's number, as the employee leaves it */
  ref: string;
  error?: string;
};

const fileOf = (dataUrl: string, name: string) => {
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new File([bytes], name.replace(/\.pdf$/i, ".jpg"), { type: mime });
};

/**
 * «ارفع كل الملفات» (the owner, 2026-10-22): the client's passports, tickets
 * and hotel confirmations in one drop. Each file is sorted (sortPaper), read by
 * its step's own reader, and placed — a passport on its traveller
 * (matchPassport), a ticket on the flight it flies, a confirmation on its hotel
 * (upload-all.ts) — then listed for review: what was read, where it goes, ✓ or
 * «راجع». Nothing is saved before «اعتمد»; saving goes through the steps' own
 * actions, so their rules hold (only checked passport fields, never a blank
 * over a value, the server checks again), and the tiles above follow.
 */
export function UploadAll({ data, canReadMrz, onClose }: { data: WizardCase; canReadMrz: boolean; onClose: () => void }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const op = data.operation;
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const seq = useRef(0);
  // the case's travellers as this page knows them — savePassport keeps it current between approvals
  const rows = useRef<MatchRow[]>(data.travelers.map((r) => ({ ...r })));
  const given = useRef(new Set<string>());
  const flights = data.bookings.filter((b) => b.kind === "flight" && b.status !== "cancelled");
  const hotels = hotelBookings(data);

  const patch = (key: number, next: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...next } : i)));

  /** A ticket or a confirmation read again for the booking it is placed on — from its words, not the file again. */
  async function readFor(item: Pick<Item, "key" | "file" | "text">, kind: PaperKind, target: string): Promise<Partial<Item>> {
    const fd = new FormData();
    fd.append("booking_id", target);
    if (item.text) fd.append("text", item.text);
    else fd.append("file", item.file);
    if (kind === "ticket") {
      const res = await readBookingTicket(fd);
      return res.ok ? { ticket: res.read, ref: res.read.pnr, error: undefined } : { ticket: null, error: t(res.error) };
    }
    const res = await readHotelConfirmation(fd);
    return res.ok ? { hotel: res.result, ref: res.result.read.confirmation, error: undefined } : { hotel: null, error: t(res.error) };
  }

  async function sortOne(item: Item, placed: Set<string>) {
    const fd = new FormData();
    fd.append("file", item.file);
    const sorted = await sortPaper(op.id, fd);
    if (!sorted.ok) return patch(item.key, { status: "failed", error: t(sorted.error) });
    const { kind, text, image } = sorted.paper;
    if (kind === "passport") {
      const picture = image ? fileOf(image, item.file.name) : item.file;
      let passport: MrzPassport | null = null;
      let error: string | undefined;
      if (canReadMrz && READABLE.test(picture.type)) {
        const pd = new FormData();
        pd.append("file", picture);
        const read = await readPassportPhoto(op.id, pd);
        if (read.ok) passport = read.passport;
        else error = t(read.error);
      }
      const row = passport ? matchPassport(rows.current, trustedFields(passport, data.today).values, op, data.today, placed) : null;
      const target = row?.id ?? (passport ? "new" : (rows.current.find((r) => !placed.has(r.id) && !r.has_passport)?.id ?? "new"));
      if (target !== "new") placed.add(target);
      return patch(item.key, { status: "ready", kind, picture, passport, target, error });
    }
    if (kind === "unknown") return patch(item.key, { status: "ready", kind, text });
    const target = (kind === "ticket" ? matchTicket(parseTicketText(text).legs, flights) : matchHotel(text, hotels)) ?? "";
    const read = target ? await readFor({ ...item, text }, kind, target) : {};
    patch(item.key, { status: "ready", kind, text, target, ...read });
  }

  function add(files: File[]) {
    if (!files.length) return;
    const fresh: Item[] = files.map((file) => ({ key: seq.current++, file, status: "sorting", kind: "unknown", target: "", text: "", picture: null, passport: null, ticket: null, hotel: null, ref: "" }));
    setItems((list) => [...list, ...fresh]);
    setBusy(true);
    const queue = [...fresh];
    // the travellers already given a passport in this drop — one passport each
    const placed = new Set(items.filter((i) => i.kind === "passport" && i.target && i.target !== "new" && i.status !== "dropped").map((i) => i.target));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        // one bad file never stops the others
        await sortOne(next, placed).catch(() => patch(next.key, { status: "failed", error: t("wz.up.err.unreadable") }));
      }
    };
    void Promise.all(Array.from({ length: AT_ONCE }, worker)).then(() => setBusy(false));
  }

  async function place(item: Item, value: string) {
    const [kind, target] = value.split(":") as [PaperKind, string];
    // a file that failed to sort is placed by hand too
    patch(item.key, { kind, target, ticket: null, hotel: null, error: undefined, status: "ready" });
    if (kind === "ticket" || kind === "hotel") {
      patch(item.key, { status: "reading" });
      patch(item.key, { status: "ready", ...(await readFor(item, kind, target)) });
    } else if (kind === "passport" && !item.passport && canReadMrz && READABLE.test((item.picture ?? item.file).type)) {
      // a paper sorted wrong, placed as a passport: read by the passport's own reader now
      patch(item.key, { status: "reading" });
      const fd = new FormData();
      fd.append("file", item.picture ?? item.file);
      const read = await readPassportPhoto(op.id, fd);
      patch(item.key, read.ok ? { status: "ready", passport: read.passport } : { status: "ready", error: t(read.error) });
    }
  }

  async function approve(item: Item): Promise<boolean> {
    patch(item.key, { status: "saving", error: undefined });
    let error: TranslationKey | undefined;
    if (item.kind === "passport") {
      const fd = new FormData();
      fd.append("file", item.picture ?? item.file);
      const row = item.target === "new" ? null : (rows.current.find((r) => r.id === item.target) ?? null);
      const out = await savePassport({ operationId: op.id, rows: rows.current, taken: given.current, row, read: item.passport, fd, today: data.today, travelStart: op.travel_start });
      error = out.error;
    } else if (item.kind === "ticket" && item.ticket) {
      const pnr = item.ref.trim().toUpperCase();
      const res = await saveBookingTicket({
        booking_id: item.target,
        pnr,
        ticket_numbers: item.ticket.ticket_numbers,
        legs: item.ticket.legs.map((l) => ({ ...l, pnr: l.pnr?.trim().toUpperCase() === pnr ? "" : l.pnr })),
        baggage: item.ticket.baggage,
      });
      if (!res.ok) error = res.error;
    } else if (item.kind === "hotel" && item.hotel) {
      const fd = new FormData();
      fd.append("booking_id", item.target);
      fd.append("confirmation_number", item.ref.trim());
      fd.append("file", item.file);
      // only what the hotel's record lacks — the server checks again and never overwrites
      if (item.hotel.fill.address && item.hotel.read.address) fd.append("address", item.hotel.read.address);
      if (item.hotel.fill.phone && item.hotel.read.phone) fd.append("phone", item.hotel.read.phone);
      const res = await saveHotelConfirmation(fd);
      if (!res.ok) error = res.error;
    } else error = "wz.up.err.unplaced";
    patch(item.key, error ? { status: "ready", error: t(error) } : { status: "saved" });
    return !error;
  }

  async function approveAll(list: Item[]) {
    setBusy(true);
    for (const item of list) await approve(item);
    setBusy(false);
    router.refresh();
  }

  const reading = items.filter((i) => i.status === "sorting").length;
  const ready = items.filter((i) => i.status === "ready" && canApprove(i));

  // every place a paper can go, by kind — the picker beside each line
  const places: { kind: PaperKind; options: { value: string; label: string }[] }[] = [
    {
      kind: "passport",
      options: [
        ...data.travelers.map((r, i) => ({ value: `passport:${r.id}`, label: r.display_name.trim() || t("wz.up.traveler", { n: i + 1 }) })),
        { value: "passport:new", label: t("wz.up.newTraveler") },
      ],
    },
    { kind: "ticket", options: flights.map((f) => ({ value: `ticket:${f.id}`, label: `${f.title} · ${f.start_date ?? "—"}` })) },
    { kind: "hotel", options: hotels.map((h) => ({ value: `hotel:${h.id}`, label: `${h.city_name || "—"} · ${h.title} · ${h.start_date ?? "—"}` })) },
  ];

  return (
    <section className="rounded-2xl border border-[#cfe0d9] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-extrabold text-[#185045]">{t("wz.up.title")}</h2>
          <p className="mt-0.5 text-[11.5px] font-semibold text-[#93aaa3]">{t("wz.up.hint")}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("wz.up.close")} className="inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-[#557d78] hover:bg-[#f0f5f3]">
          <X className="size-4" />
        </button>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add([...e.dataTransfer.files]);
        }}
        className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-[14px] border-2 border-dashed px-4 py-6 text-center ${over ? "border-[#2aa87a] bg-[#eef8f3]" : "border-[#b7d0c7] bg-[#f8fbf9] hover:bg-[#f0f7f4]"}`}
      >
        {reading ? <Loader2 className="size-6 animate-spin text-[#185045]" /> : <FileUp className="size-6 text-[#185045]" />}
        <span className="text-[13.5px] font-extrabold text-[#185045]">
          {reading ? t("wz.up.reading", { done: items.length - reading, of: items.length }) : t("wz.up.drop")}
        </span>
        <span className="text-[11.5px] font-semibold text-[#93aaa3]">{t("wz.up.types")}</span>
        <input
          type="file"
          multiple
          accept="application/pdf,.pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            add(files);
          }}
        />
      </label>

      {items.length > 0 ? (
        <div className="mt-3 grid gap-3">
          {KINDS.map((kind) => {
            const group = items.filter((i) => i.kind === kind && i.status !== "dropped" && i.status !== "sorting");
            return group.length ? (
              <div key={kind}>
                <h3 className="mb-1.5 text-[12px] font-extrabold text-[#557d78]">
                  {t(`wz.up.group.${kind}` as TranslationKey)} · <DirText>{String(group.length)}</DirText>
                </h3>
                <ul className="grid gap-1.5">
                  {group.map((item) => (
                    <Line key={item.key} item={item} today={data.today} places={places} onPlace={(v) => void place(item, v)} onRef={(ref) => patch(item.key, { ref })} onApprove={() => void approve(item).then((ok) => ok && router.refresh())} onDrop={() => patch(item.key, { status: "dropped" })} />
                  ))}
                </ul>
              </div>
            ) : null;
          })}
          {reading ? (
            <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#557d78]">
              <Loader2 className="size-3.5 animate-spin" />
              {items
                .filter((i) => i.status === "sorting")
                .map((i) => i.file.name)
                .join("، ")}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || ready.length === 0} onClick={() => void approveAll(ready)} className={wzPrimary}>
              {busy && !reading ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {t("wz.up.approveAll", { n: ready.length })}
            </button>
            {items.length > 0 && items.every((i) => i.status === "saved" || i.status === "dropped") ? (
              <span className="text-[12px] font-bold text-[#0f7a52]">{t("wz.up.allDone")}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Ready to save: placed, and — a ticket or a hotel — read for that place. */
function canApprove(i: Item): boolean {
  if (!i.target) return false;
  if (i.kind === "passport") return true;
  if (i.kind === "ticket") return Boolean(i.ticket && i.ref.trim());
  if (i.kind === "hotel") return Boolean(i.hotel && i.ref.trim());
  return false;
}

/** ✓ when what was read checks out; «راجع» when a check digit failed, a name or a date differs, or something is missing. */
function verdict(i: Item, today: string, field: (f: string) => string): { ok: boolean; note: string[] } {
  if (i.kind === "passport") {
    if (!i.passport) return { ok: false, note: [] };
    const { missing } = trustedFields(i.passport, today);
    return { ok: missing.length === 0 && i.passport.failed.length === 0, note: [...new Set<string>([...i.passport.failed, ...missing])].map(field) };
  }
  if (i.kind === "ticket" && i.ticket) {
    const off = i.ticket.names.filter((n) => n.status !== "ok").map((n) => n.name);
    return { ok: off.length === 0 && i.ticket.missing.length === 0 && i.ticket.legs.length > 0 && Boolean(i.ref.trim()), note: [...off, ...i.ticket.missing] };
  }
  if (i.kind === "hotel" && i.hotel) return { ok: i.hotel.diffs.length === 0 && Boolean(i.ref.trim()), note: i.hotel.diffs.map((d) => d.theirs) };
  return { ok: false, note: [] };
}

function Line({
  item,
  today,
  places,
  onPlace,
  onRef,
  onApprove,
  onDrop,
}: {
  item: Item;
  today: string;
  places: { kind: PaperKind; options: { value: string; label: string }[] }[];
  onPlace: (value: string) => void;
  onRef: (ref: string) => void;
  onApprove: () => void;
  onDrop: () => void;
}) {
  const { t } = useTraveliunUI();
  const { ok, note } = verdict(item, today, (f) => t(`wz.up.field.${f}` as TranslationKey));
  const saved = item.status === "saved";
  const working = item.status === "saving" || item.status === "reading";
  const read =
    item.kind === "passport"
      ? item.passport
        ? item.passport.full_name
        : t("wz.up.passport.unread")
      : item.kind === "ticket" && item.ticket
        ? item.ticket.legs.map((l) => `${l.flight_no} ${l.from_iata}→${l.to_iata} ${l.dep_date}`).join(" · ")
        : item.kind === "hotel" && item.hotel
          ? `${item.hotel.read.check_in || "—"} → ${item.hotel.read.check_out || "—"}`
          : "";
  return (
    <li className={`rounded-[12px] border p-2.5 ${saved ? "border-[#cfe9dc] bg-[#f3faf6]" : "border-[#e2ebe7] bg-white"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-bold">
        {saved ? (
          <CheckCircle2 className="size-4 shrink-0 text-[#0f7a52]" />
        ) : working ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-[#557d78]" />
        ) : item.status === "failed" ? (
          <AlertTriangle className="size-4 shrink-0 text-[#c22850]" />
        ) : ok ? (
          <span className="rounded-full bg-[#e9f7f0] px-2 py-0.5 text-[10.5px] text-[#0f7a52]">✓</span>
        ) : (
          <span className="rounded-full bg-[#fff4e0] px-2 py-0.5 text-[10.5px] text-[#a86a10]">{t("wz.up.review")}</span>
        )}
        <span className="min-w-0 break-all text-[#185045]">{item.file.name}</span>
        {read ? (
          <DirText dir="auto" className="tv-tnum min-w-0 break-words font-semibold text-[#557d78]">
            {read}
          </DirText>
        ) : null}
      </div>

      {saved ? null : (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {/* where it goes — any place of any kind: a paper sorted wrong is moved here */}
            <select
              value={item.target ? `${item.kind}:${item.target}` : ""}
              disabled={working}
              onChange={(e) => e.target.value && onPlace(e.target.value)}
              className={`h-9 w-0 min-w-[10rem] flex-1 rounded-[9px] border bg-white px-2 text-[12px] font-bold text-[#185045] ${item.target ? "border-[#dbe6e1]" : "border-[#f0d9a8] bg-[#fffaf0]"}`}
            >
              <option value="">{t("wz.up.unplaced")}</option>
              {places.map((g) =>
                g.options.length ? (
                  <optgroup key={g.kind} label={t(`wz.up.group.${g.kind}` as TranslationKey)}>
                    {g.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null,
              )}
            </select>
            {item.kind === "ticket" || item.kind === "hotel" ? (
              <input
                value={item.ref}
                onChange={(e) => onRef(e.target.value)}
                disabled={working}
                placeholder={t(item.kind === "ticket" ? "wz.up.pnr" : "wz.hotels.number")}
                aria-label={t(item.kind === "ticket" ? "wz.up.pnr" : "wz.hotels.number")}
                dir="ltr"
                className="tv-tnum h-9 w-36 rounded-[9px] border border-[#dbe6e1] bg-white px-2 text-[12px] font-bold text-[#185045]"
              />
            ) : null}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={working || !canApprove(item)} onClick={onApprove} className={`${wzPrimary} h-9`}>
              {t("wz.up.approve")}
            </button>
            <button type="button" disabled={working} onClick={onDrop} className={`${wzSecondary} h-9`}>
              {t("wz.up.remove")}
            </button>
          </div>
        </div>
      )}
      {note.length && !saved ? (
        <p className="mt-1.5 break-words text-[11px] font-semibold text-[#a86a10]">
          {t("wz.up.check")}: <DirText dir="auto">{note.join("، ")}</DirText>
        </p>
      ) : null}
      {item.error ? <p className="mt-1.5 text-[11.5px] font-bold text-[#c22850]">{item.error}</p> : null}
    </li>
  );
}
