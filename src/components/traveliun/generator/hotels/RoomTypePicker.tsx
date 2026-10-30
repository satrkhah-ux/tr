"use client";

import { useState } from "react";
import { ROOM_CATEGORIES, ROOM_TYPES, SUITE_SUBTYPES, type CatalogItem, type RoomLocale } from "@/lib/catalog/room-catalog";
import { normAr } from "@/lib/catalog/norm";
import { uniqueNames } from "@/lib/catalog/additions";
import { CatalogTextAdd, useCatalogAdditions } from "../../basic/CatalogNamePick";
import { pickRoom, roomCodes, roomPickName, type DraftRoomSpec, type RoomCodes } from "@/lib/offer/draft-types";
import { useTraveliunUI } from "../../TraveliunUIProvider";

const NAMED = "__name__:";

/** A catalogue list as select options, labelled in the screen's language (the id is what is kept). */
export const catalogOptions = (items: CatalogItem[], locale: RoomLocale) => items.map((i) => ({ value: i.id, label: i.label[locale] }));

/**
 * «نوع الغرفة» from the owner's catalogue: the type (required), its category
 * (optional) and — for a suite only — the suite type. The view, the beds,
 * smoking … are not asked here: the hotel confirms them, and operations enters
 * them after confirmation.
 */
export function RoomTypePicker({
  room,
  onPick,
  selectClass,
  extras = true,
}: {
  room: Pick<DraftRoomSpec, "room_type_name" | "room_type_code" | "room_category_code" | "suite_subtype_code">;
  /** the codes and the Arabic name they make — merged into the room as one slice. */
  onPick: (slice: ReturnType<typeof pickRoom>) => void;
  selectClass: string;
  /**
   * The category and the suite type as selects (the default). Off: the type
   * alone — «البيسك» keeps them under «المزيد» (the owner, 2026-10-22: «دون
   * فقد المميزات») — and a chosen one is said under it, never lost.
   */
  extras?: boolean;
}) {
  const { t, language } = useTraveliunUI();
  const locale: RoomLocale = language === "en" ? "en" : "ar";
  const codes = roomCodes(room);
  const set = (slice: Partial<RoomCodes>) => onPick(pickRoom({ ...codes, ...slice }));
  // a file saved before the catalogue keeps its own name until a pick changes it — shown, so the agent knows what prints
  const saved = room.room_type_name.trim();
  const oldName = saved && saved !== roomPickName(codes) ? saved : null;
  const added = useCatalogAdditions("room");
  const [typing, setTyping] = useState(false);
  // «ستاندرد» typed: a catalogue type or category is taken as its code; anything else is the room's own name
  const typed = (name: string) => {
    setTyping(false);
    const is = (i: CatalogItem) => normAr(i.label.ar) === normAr(name) || i.label.en.toLowerCase() === name.trim().toLowerCase();
    const type = ROOM_TYPES.find(is);
    if (type) return set({ room_type_code: type.id });
    const category = ROOM_CATEGORIES.find(is);
    if (category && codes.room_type_code) return set({ room_category_code: category.id });
    onPick({ room_type_id: null, room_type_name: name, room_type_code: null, room_category_code: null, suite_subtype_code: null });
  };
  if (typing) {
    return (
      <CatalogTextAdd
        kind="room"
        known={uniqueNames([...ROOM_TYPES, ...ROOM_CATEGORIES].map((i) => i.label.ar).concat(added))}
        fieldClass={selectClass}
        placeholder="اكتب اسم الغرفة — مثلاً: ستاندرد"
        onCancel={() => setTyping(false)}
        onDone={typed}
      />
    );
  }

  return (
    <span className="grid gap-1">
      <select
        aria-label={t("pg.roomType")}
        value={codes.room_type_code ?? (saved && !codes.room_category_code ? NAMED + saved : "")}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__other__") setTyping(true);
          else if (v.startsWith(NAMED)) typed(v.slice(NAMED.length));
          else set({ room_type_code: v || null });
        }}
        className={selectClass}
      >
        <option value="">{t("pg.chooseRoomType")}</option>
        {catalogOptions(ROOM_TYPES, locale).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
        {/* the names employees added: their own at once, everyone's once the data team approves */}
        {uniqueNames([...added, ...(saved && !codes.room_type_code && !codes.room_category_code ? [saved] : [])]).map((n) => (
          <option key={n} value={NAMED + n}>{n}</option>
        ))}
        <option value="__other__">✎ اسم غرفة آخر…</option>
      </select>
      {!extras && (codes.room_category_code || codes.suite_subtype_code) ? (
        <span className="text-[10.5px] font-bold text-[#557d78]">
          {[
            ROOM_CATEGORIES.find((c) => c.id === codes.room_category_code)?.label[locale],
            SUITE_SUBTYPES.find((c) => c.id === codes.suite_subtype_code)?.label[locale],
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      ) : null}
      {extras && codes.room_type_code ? (
        <select
          aria-label={t("pg.roomCategory")}
          value={codes.room_category_code ?? ""}
          onChange={(e) => set({ room_category_code: e.target.value || null })}
          className={selectClass}
        >
          <option value="">{t("pg.noRoomCategory")}</option>
          {catalogOptions(ROOM_CATEGORIES, locale).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : null}
      {extras && codes.room_type_code === "suite" ? (
        <select
          aria-label={t("pg.suiteSubtype")}
          value={codes.suite_subtype_code ?? ""}
          onChange={(e) => set({ suite_subtype_code: e.target.value || null })}
          className={selectClass}
        >
          <option value="">{t("pg.noSuiteSubtype")}</option>
          {catalogOptions(SUITE_SUBTYPES, locale).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : null}
      {oldName ? (
        <span className="text-[10.5px] font-semibold text-tv-text-faint">{t("pg.roomSavedAs", { name: oldName })}</span>
      ) : null}
    </span>
  );
}
