"use client";

import { useState } from "react";
import { Copy, Loader2, Plus, Save, Trash2 } from "lucide-react";
import catalog from "@/lib/catalog/hotel-room-catalog.json";
import {
  BED_TYPES,
  ROOM_CATEGORIES,
  ROOM_FEATURES,
  ROOM_TYPES,
  ROOM_VIEWS,
  SUITE_SUBTYPES,
  type BedGroup,
  type BedStatus,
  type CatalogItem,
  type LocaleChoice,
} from "@/lib/catalog/room-catalog";
import { saveRoomDetails, type OperationBooking } from "@/lib/data/operation-bookings";
import { readRooms, roomDetailIssues, roomLines, roomSpecFor, type BookingRoomSpec } from "@/lib/operations/room-details";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

const field = "tv-field h-10 w-full rounded-[10px] border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus";
const label = "grid gap-1.5 text-[12px] font-bold text-[#185045]";
const chip = (on: boolean) =>
  `inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-bold ${on ? "border-[#2aa87a] bg-tv-status-success-bg text-tv-status-success" : "border-[#dbe6e1] text-[#557d78]"}`;

const BED_STATUSES: BedStatus[] = ["guaranteed", "on_request", "unspecified"];
const num = (v: string) => (v.trim() === "" ? null : Math.trunc(Number(v)));
const newId = () => Math.random().toString(36).slice(2, 8);

/**
 * «تفاصيل الغرفة» — what the hotel confirmed about each room, in the
 * catalogue's Arabic lists (the owner's file), shown on a confirmed hotel only.
 * Checked against the file's rules before it is sent; the voucher then prints
 * it in the stay's language.
 */
export function RoomDetails({ booking, onDone }: { booking: OperationBooking; onDone: () => void }) {
  const { t, language } = useTraveliunUI();
  const lines = roomLines(booking.detail);
  const [line, setLine] = useState(lines[0]);
  const [specs, setSpecs] = useState<Record<string, BookingRoomSpec>>(() => Object.fromEntries(lines.map((l) => [l, roomSpecFor(booking.detail, l)])));
  const [locale, setLocale] = useState<LocaleChoice>(() => readRooms(booking.detail).locale);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useSafeTransition();

  const spec = specs[line];
  const set = (patch: Partial<BookingRoomSpec>) => setSpecs((s) => ({ ...s, [line]: { ...s[line], ...patch } }));
  const name = (i: CatalogItem) => i.label[language];
  const groups = spec.bed_groups ?? [];
  const setGroups = (next: BedGroup[]) =>
    set({ bed_groups: next, selected_bed_group_id: next.some((g) => g.id === spec.selected_bed_group_id) ? spec.selected_bed_group_id : null });
  const toggle = (key: "view_ids" | "feature_ids", id: string) => {
    const list = spec[key] ?? [];
    set({ [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] });
  };
  const custom = spec.custom_room_name ?? { ar: null, en: null };
  const nameStatus = spec.custom_name_status ?? { ar: "missing", en: "missing" };
  const setCustom = (lang: "ar" | "en", value: string, verified: boolean) =>
    set({
      custom_room_name: { ...custom, [lang]: value },
      custom_name_status: { ...nameStatus, [lang]: !value.trim() ? "missing" : verified ? "verified" : "draft" },
    });

  function save() {
    const found = lines.flatMap((l) => roomDetailIssues(specs[l]).map((i) => `${lines.length > 1 ? `${l}: ` : ""}${t(`ops.room.issue.${i}` as TranslationKey)}`));
    setIssues(found);
    if (found.length > 0) return;
    startTransition(async () => {
      setError(null);
      const res = await saveRoomDetails({ booking_id: booking.id, rooms: specs, locale });
      if (!res.ok) setError(t(res.error));
      else onDone();
    });
  }

  const select = (key: "room_type_id" | "room_category_id" | "suite_subtype_id", list: CatalogItem[], text: TranslationKey) => (
    <label className={label}>
      {t(text)}
      <select value={spec[key] ?? ""} onChange={(e) => set({ [key]: e.target.value || null })} className={field}>
        <option value="">—</option>
        {list.map((i) => (
          <option key={i.id} value={i.id}>
            {name(i)}
          </option>
        ))}
      </select>
    </label>
  );
  const number = (key: "bedroom_count" | "max_guests" | "max_adults" | "max_children", text: TranslationKey, min: number) => (
    <label className={label}>
      {t(text)}
      <input
        type="number"
        min={min}
        dir="ltr"
        inputMode="numeric"
        value={spec[key] ?? ""}
        onChange={(e) => set({ [key]: num(e.target.value) })}
        className={`${field} tv-tnum`}
      />
    </label>
  );

  return (
    <div className="mt-2 grid gap-3 rounded-[9px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
      <p className="text-[11.5px] font-semibold text-tv-text-faint">{t("ops.room.hint")}</p>

      {lines.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {lines.map((l) => (
            <button key={l} type="button" onClick={() => setLine(l)} className={chip(l === line)}>
              {l}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSpecs(Object.fromEntries(lines.map((l) => [l, spec])))}
            className="inline-flex items-center gap-1 text-[11.5px] font-bold text-[#557d78] hover:underline"
          >
            <Copy className="size-3.5" />
            {t("ops.room.copyAll")}
          </button>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {select("room_type_id", ROOM_TYPES, "ops.room.type")}
        {select("room_category_id", ROOM_CATEGORIES, "ops.room.category")}
        {spec.room_type_id === "suite" ? select("suite_subtype_id", SUITE_SUBTYPES, "ops.room.suite") : null}
        {number("bedroom_count", "ops.room.bedrooms", 1)}
      </div>

      {/* each arrangement is a whole alternative; the beds inside it are together */}
      <div className="grid gap-2">
        <span className="text-[12px] font-extrabold text-[#185045]">{t("ops.room.beds")}</span>
        {groups.map((g, gi) => (
          <div key={g.id} className="grid gap-1.5 rounded-[9px] border border-[#e2ebe7] bg-white p-2">
            <div className="flex items-center justify-between text-[11.5px] font-bold text-[#557d78]">
              {t("ops.room.bedOption", { n: gi + 1 })}
              <button type="button" aria-label={t("delete")} onClick={() => setGroups(groups.filter((x) => x.id !== g.id))} className="text-[#c43d3d]">
                <Trash2 className="size-3.5" />
              </button>
            </div>
            {g.beds.map((bed, bi) => {
              const setBed = (patch: Partial<typeof bed>) =>
                setGroups(groups.map((x) => (x.id === g.id ? { ...x, beds: x.beds.map((y, j) => (j === bi ? { ...y, ...patch } : y)) } : x)));
              return (
                <div key={bi} className="grid grid-cols-[5rem_minmax(0,1fr)_2rem] items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    dir="ltr"
                    inputMode="numeric"
                    aria-label={t("ops.room.bedQty")}
                    value={bed.quantity}
                    onChange={(e) => setBed({ quantity: num(e.target.value) ?? 0 })}
                    className={`${field} tv-tnum`}
                  />
                  <select value={bed.bed_type_id} onChange={(e) => setBed({ bed_type_id: e.target.value })} className={field}>
                    {BED_TYPES.map((i) => (
                      <option key={i.id} value={i.id}>
                        {name(i)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={t("delete")}
                    onClick={() => setGroups(groups.map((x) => (x.id === g.id ? { ...x, beds: x.beds.filter((_, j) => j !== bi) } : x)))}
                    className="text-[#c43d3d]"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setGroups(groups.map((x) => (x.id === g.id ? { ...x, beds: [...x.beds, { bed_type_id: "single", quantity: 1 }] } : x)))}
              className="inline-flex items-center gap-1 justify-self-start text-[11.5px] font-bold text-[#185045] hover:underline"
            >
              <Plus className="size-3.5" />
              {t("ops.room.addBed")}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setGroups([...groups, { id: newId(), beds: [{ bed_type_id: "double", quantity: 1 }] }])}
          className="inline-flex h-8 items-center gap-1.5 justify-self-start rounded-[8px] border border-dashed border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4] max-sm:min-h-10"
        >
          <Plus className="size-3.5" />
          {t("ops.room.addOption")}
        </button>
        {groups.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={label}>
              {t("ops.room.bedChosen")}
              <select value={spec.selected_bed_group_id ?? ""} onChange={(e) => set({ selected_bed_group_id: e.target.value || null })} className={field}>
                <option value="">{t("ops.room.bedAll")}</option>
                {groups.map((g, gi) => (
                  <option key={g.id} value={g.id}>
                    {t("ops.room.bedOption", { n: gi + 1 })}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              {t("ops.room.bedStatus")}
              <select value={spec.bed_configuration_status ?? "unspecified"} onChange={(e) => set({ bed_configuration_status: e.target.value as BedStatus })} className={field}>
                {BED_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {catalog.room_name_export.bed_status_suffix[s][language]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </div>

      {(
        [
          ["view_ids", ROOM_VIEWS, "ops.room.views"],
          ["feature_ids", ROOM_FEATURES, "ops.room.features"],
        ] as const
      ).map(([key, list, text]) => (
        <div key={key} className="grid gap-1.5">
          <span className="text-[12px] font-extrabold text-[#185045]">{t(text)}</span>
          <div className="flex flex-wrap gap-1.5">
            {list.map((i) => (
              <label key={i.id} className={chip((spec[key] ?? []).includes(i.id))}>
                <input type="checkbox" className="sr-only" checked={(spec[key] ?? []).includes(i.id)} onChange={() => toggle(key, i.id)} />
                {name(i)}
              </label>
            ))}
          </div>
        </div>
      ))}
      {spec.feature_ids?.includes("connecting") ? (
        <label className={`${label} sm:max-w-xs`}>
          {t("ops.room.connecting")}
          <select
            value={spec.connecting_status === "confirmed" || spec.connecting_status === "on_request" ? spec.connecting_status : ""}
            onChange={(e) => set({ connecting_status: (e.target.value || "not_applicable") as BookingRoomSpec["connecting_status"] })}
            className={field}
          >
            <option value="">—</option>
            <option value="confirmed">{t("ops.room.connecting.confirmed")}</option>
            <option value="on_request">{t("ops.room.connecting.on_request")}</option>
          </select>
        </label>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-3">
        <span className="text-[12px] font-extrabold text-[#185045] sm:col-span-3">{t("ops.room.capacity")}</span>
        {number("max_guests", "ops.room.maxGuests", 1)}
        {number("max_adults", "ops.room.maxAdults", 0)}
        {number("max_children", "ops.room.maxChildren", 0)}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <span className="text-[12px] font-extrabold text-[#185045] sm:col-span-2">{t("ops.room.customName")}</span>
        {(["ar", "en"] as const).map((lang) => (
          <div key={lang} className="grid gap-1">
            <label className={label}>
              {t(lang === "ar" ? "ops.room.customAr" : "ops.room.customEn")}
              <input
                dir={lang === "en" ? "ltr" : "rtl"}
                value={custom[lang] ?? ""}
                onChange={(e) => setCustom(lang, e.target.value, false)}
                className={field}
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-[#557d78]">
              <input
                type="checkbox"
                className="size-4 accent-[#185045]"
                disabled={!custom[lang]?.trim()}
                checked={nameStatus[lang] === "verified"}
                onChange={(e) => setCustom(lang, custom[lang] ?? "", e.target.checked)}
              />
              {t("ops.room.verified")}
            </label>
          </div>
        ))}
        <p className="text-[11px] font-semibold text-tv-text-faint sm:col-span-2">{t("ops.room.customHint")}</p>
      </div>

      <label className={`${label} sm:max-w-xs`}>
        {t("ops.room.locale")}
        <select value={locale} onChange={(e) => setLocale(e.target.value as LocaleChoice)} className={field}>
          {catalog.ui.export_language_options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label[language]}
            </option>
          ))}
        </select>
      </label>

      {issues.length > 0 ? (
        <ul className="list-disc space-y-0.5 ps-5 text-[12px] font-bold text-[#c22850]">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-[12px] font-bold text-[#c22850]">{error}</p> : null}
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="tv-btn-primary inline-flex h-10 items-center gap-2 justify-self-start rounded-[10px] px-4 text-[12.5px] font-bold disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        {t("save")}
      </button>
    </div>
  );
}
