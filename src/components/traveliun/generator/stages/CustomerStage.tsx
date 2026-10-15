"use client";

import { useState } from "react";
import { BedDouble, Building2, MapPin, Users } from "lucide-react";
import { usePartnerBrand } from "@/lib/partners/PartnerContext";
import type { TeletelCustomerHit } from "@/lib/data/teletel-actions";
import {
  AGE_BANDS,
  clampAge,
  inheritBoard,
  inheritRoomType,
  matchPartner,
  MEAL_PLANS,
  MEAL_PLAN_BOARD,
  MEAL_PLAN_LABEL_KEYS,
  moveTripCountry,
  resizeRooms,
  resizeAges,
  roomTypeNames,
  type MealPlan,
} from "@/lib/offer/draft-types";
import { FieldIssue, useFieldRing } from "../FieldIssue";
import { TeletelSearch } from "../TeletelSearch";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass, labelClass, sectionClass, type StageFormProps } from "../stage-props";

/**
 * Stage 1 — customer / company.
 * Primary path: pick the customer from Teletel (search by name/phone) — one tap
 * fills name+phone, and label-derived destinations («رحلة جورجيا») become chips
 * that fill the trip destination. Manual fields stay as the fallback.
 */
export function CustomerStage({ data, patch, lookups }: StageFormProps) {
  const partner = usePartnerBrand();
  const nameRing = useFieldRing("customer.customer_name");
  const phoneRing = useFieldRing("customer.customer_phone");
  const { t } = useTraveliunUI();
  const customer = data.customer;
  const companySale = Boolean(customer.partner_company_id || customer.company.trim());

  const [destinations, setDestinations] = useState<string[]>([]);

  function update(patchSlice: Partial<typeof customer>) {
    patch({ customer: { ...customer, ...patchSlice } });
  }

  function pick(hit: TeletelCustomerHit) {
    update({ customer_name: hit.name, customer_phone: hit.phone });
    setDestinations(hit.destinations);
  }

  function applyDestination(name: string) {
    // the same swap as TripStage's picker: the chip is the other writer of the country
    patch(moveTripCountry(data, lookups, { ...data.trip, country: name, destination: name }));
    setDestinations((prev) => prev.filter((d) => d !== name));
  }

  return (
    <section className={sectionClass}>
      <h2 className="mb-4 text-base font-extrabold text-[#003c3a]">{t("pg.customerTitle")}</h2>

      {/* Teletel lookup — our customers, so never on a partner's screen */}
      {partner ? null : <TeletelSearch onPick={pick} />}

      {/* destination suggestions pulled from the picked contact */}
      {destinations.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[11px] border border-[#bfe5d4] bg-[#e9f7f0] px-3 py-2.5">
          <span className="text-[12px] font-bold text-[#0f7a52]">{t("tl.destFromLabels")}</span>
          {destinations.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => applyDestination(name)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#0f7a52] px-3 text-[12px] font-bold text-white hover:bg-[#0c6543]"
            >
              <MapPin className="size-3.5" /> {t("tl.addDestination", { name })}
            </button>
          ))}
        </div>
      ) : null}

      {/* The company comes FIRST: choosing one says this file is not being sold
          to a walk-in client at all, which changes what the rest of the stage
          needs. */}
      {partner ? null : <CompanyPicker data={data} patch={patch} lookups={lookups} />}

      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          {t("pg.customerName")}
          {companySale ? <span className="text-[11px] font-semibold text-[#93aaa3]">{t("pg.company.clientOptional")}</span> : null}
          <input
            value={customer.customer_name}
            onChange={(e) => update({ customer_name: e.target.value })}
            className={`${fieldClass}${nameRing}`}
          />
          <FieldIssue field="customer.customer_name" />
        </label>
        <label className={labelClass}>
          {t("pg.customerPhone")}
          <input
            dir="ltr"
            inputMode="tel"
            value={customer.customer_phone}
            onChange={(e) => update({ customer_phone: e.target.value })}
            className={`${fieldClass} tv-tnum text-start${phoneRing}`}
            placeholder="05xxxxxxxx"
          />
          <FieldIssue field="customer.customer_phone" />
        </label>
      </div>

      <TravelersBlock data={data} patch={patch} />
      {/* Transport moved to the TRIP card: the vehicle is decided once the
          dates and the cities are known, and the car count belongs beside the
          journey it carries rather than beside the client's phone number. */}
      <RoomsBlock data={data} patch={patch} lookups={lookups} />
    </section>
  );
}

/**
 * Whose file is this?
 *
 * Picking a registered partner company does three things at once: the produced
 * offer stores that company, the document comes out under their name, logo and
 * colours, and the client-details advisories fall silent — the partner has the
 * client, and their contact details are not ours to collect.
 *
 * A company typed into a draft before this picker existed is kept as a disabled
 * option, so an old draft still shows what it said.
 */
function CompanyPicker({ data, patch, lookups }: Pick<StageFormProps, "data" | "patch" | "lookups">) {
  const { t } = useTraveliunUI();
  const customer = data.customer;
  const partners = lookups.partners;
  const selected = matchPartner(customer, partners);
  const legacy = !selected && customer.company.trim() ? customer.company.trim() : null;

  function pick(id: string) {
    const partner = partners.find((p) => p.id === id) ?? null;
    patch({
      customer: {
        ...customer,
        partner_company_id: partner?.id ?? null,
        // keep the NAME too: reports and the legacy `company` field still read it
        company: partner?.name ?? "",
      },
    });
  }

  return (
    <div className="mb-4 rounded-[12px] border border-[#dbe6e1] bg-[#f8fbfa] p-3.5">
      <div className="flex flex-wrap items-end gap-3">
        <label className={`${labelClass} min-w-[240px] flex-1`}>
          <span className="flex items-center gap-1.5">
            <Building2 className="size-4" />
            {t("pg.company")}
          </span>
          <select
            value={selected?.id ?? ""}
            onChange={(e) => pick(e.target.value)}
            className={fieldClass}
          >
            <option value="">{t("pg.company.direct")}</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            {legacy ? <option value="" disabled>{legacy}</option> : null}
          </select>
        </label>

        {selected ? (
          <div className="flex items-center gap-2 pb-1">
            <span className="size-6 rounded-[7px] border border-[#dbe6e1]" style={{ background: selected.brand_color }} />
            <span className="size-6 rounded-[7px] border border-[#dbe6e1]" style={{ background: selected.accent_color }} />
          </div>
        ) : null}
      </div>
      <p className="mt-1.5 text-[11.5px] font-semibold text-[#93aaa3]">
        {selected ? t("pg.company.brandedHint", { name: selected.name }) : t("pg.company.hint")}
      </p>
    </div>
  );
}

const blockClass = "mt-5 border-t border-[#e7f0ec] pt-5";
const blockTitleClass = "flex items-center gap-2 text-[13.5px] font-extrabold text-[#0f3d38]";
const smallLabelClass = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

/**
 * Travelers live WITH the customer, not with the trip frame: "who is going" is
 * the first thing an agent is told on the phone. Ages are captured too — a
 * child's age changes the hotel rate and the airline fare, so "2 children" with
 * no ages is a quote the supplier can reprice after the client has agreed.
 */
function TravelersBlock({ data, patch }: Pick<StageFormProps, "data" | "patch">) {
  const adultsRing = useFieldRing("trip.adults");
  const { t } = useTraveliunUI();
  const trip = data.trip;

  /** Counts and ages move together — the ages list is always count-long. */
  function setCount(field: "children" | "infants", raw: number) {
    const count = Math.max(Math.trunc(raw) || 0, 0);
    const agesField = field === "children" ? "children_ages" : "infant_ages";
    patch({
      trip: {
        ...trip,
        [field]: count,
        // A new row starts at a plausible age, not 0 — a «طفل» aged zero is an
        // infant, and someone would have to notice and fix every one.
        [agesField]: resizeAges(trip[agesField], count, AGE_BANDS[field].fallback).map((a) => clampAge(field, a)),
      },
    });
  }

  function setAge(field: "children_ages" | "infant_ages", index: number, raw: number) {
    const kind = field === "children_ages" ? "children" : "infants";
    const next = trip[field].map((age, i) => (i === index ? clampAge(kind, raw) : age));
    patch({ trip: { ...trip, [field]: next } });
  }

  return (
    <div className={blockClass}>
      <h3 className={blockTitleClass}>
        <Users className="size-4 text-[#185045]" />
        {t("pg.travelersTitle")}
      </h3>

      <div className="mt-3 grid grid-cols-3 gap-4">
        <label className={smallLabelClass}>
          {t("pg.adults")}
          <input
            type="number" min={0} dir="ltr"
            value={trip.adults}
            onChange={(e) => patch({ trip: { ...trip, adults: Math.max(Number(e.target.value) || 0, 0) } })}
            className={`${fieldClass} tv-tnum text-center${adultsRing}`}
          />
          <FieldIssue field="trip.adults" />
        </label>
        <label className={smallLabelClass}>
          {t("pg.children")}
          <input
            type="number" min={0} dir="ltr"
            value={trip.children}
            onChange={(e) => setCount("children", Number(e.target.value))}
            className={`${fieldClass} tv-tnum text-center`}
          />
        </label>
        <label className={smallLabelClass}>
          {t("pg.infants")}
          <input
            type="number" min={0} dir="ltr"
            value={trip.infants}
            onChange={(e) => setCount("infants", Number(e.target.value))}
            className={`${fieldClass} tv-tnum text-center`}
          />
        </label>
      </div>

      {trip.children_ages.length > 0 || trip.infant_ages.length > 0 ? (
        <div className="mt-3 rounded-[11px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
          <p className="mb-2 text-[11.5px] font-bold text-[#557d78]">
            {t("pg.agesHint")} — {t("pg.agesBands")}
          </p>
          <div className="flex flex-wrap gap-2">
            {trip.children_ages.map((age, i) => (
              <AgeField
                key={`c${i}`}
                label={t("pg.childAgeN", { n: i + 1 })}
                value={age}
                kind="children"
                onChange={(v) => setAge("children_ages", i, v)}
              />
            ))}
            {trip.infant_ages.map((age, i) => (
              <AgeField
                key={`i${i}`}
                label={t("pg.infantAgeN", { n: i + 1 })}
                value={age}
                kind="infants"
                onChange={(v) => setAge("infant_ages", i, v)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AgeField({
  label,
  value,
  kind,
  onChange,
}: {
  label: string;
  value: number;
  kind: "children" | "infants";
  onChange: (v: number) => void;
}) {
  const band = AGE_BANDS[kind];
  return (
    <label className="grid gap-1 text-[11px] font-bold text-[#557d78]">
      {label}
      <input
        type="number" min={band.min} max={band.max} dir="ltr"
        // The spinner and typing now agree; setAge clamps whatever arrives.
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${fieldClass} tv-tnum h-9 w-20 text-center`}
      />
    </label>
  );
}

/**
 * Room and meal defaults, entered once here and inherited by every city.
 *
 * Changing a default re-applies it only to the ROOMS that still carry the old
 * one. A city where the agent deliberately booked a different second room (the
 * driver's, which is never labelled as such) keeps it, while its first room
 * still follows the trip. Value equality is the flag — there is nothing to
 * mark dirty and nothing to get out of step.
 */
function RoomsBlock({ data, patch, lookups }: Pick<StageFormProps, "data" | "patch" | "lookups">) {
  const { t } = useTraveliunUI();
  const trip = data.trip;

  function setRooms(raw: number) {
    const rooms = Math.max(Math.trunc(raw) || 1, 1);
    patch({
      trip: { ...trip, rooms },
      // A count is a LINE fact, so the guard stays at line level — and it goes
      // through resizeRooms, which keeps rooms[] and rooms_count in step.
      // Writing the mirror alone used to publish three rooms of one type.
      hotels: data.hotels.map((h) => (h.rooms_count === trip.rooms ? resizeRooms(h, rooms) : h)),
    });
  }

  /** A NAME — the id is per-hotel and gets resolved once a hotel is picked. */
  function setRoomType(name: string) {
    patch({
      trip: { ...trip, default_room_type_name: name },
      hotels: data.hotels.map((h) => inheritRoomType(h, trip.default_room_type_name, name)),
    });
  }

  /**
   * The meal plan is the question the client is actually asked, and the board
   * is the same answer in the suppliers' and the database's vocabulary. One
   * deriver, one direction — the board is never typed.
   */
  function setMealPlan(value: string) {
    const plan = value === "" ? null : (value as MealPlan);
    const board = plan ? MEAL_PLAN_BOARD[plan] : null;
    patch({
      trip: { ...trip, meal_plan: plan, default_board: board },
      hotels: data.hotels.map((h) => inheritBoard(h, trip.default_board, board)),
    });
  }

  return (
    <div className={blockClass}>
      <h3 className={blockTitleClass}>
        <BedDouble className="size-4 text-[#185045]" />
        {t("pg.roomsTitle")}
      </h3>
      <p className="mt-1 text-[11.5px] font-semibold text-[#93aaa3]">{t("pg.roomsHint")}</p>

      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <label className={smallLabelClass}>
          {t("pg.roomsCount")}
          <input
            type="number" min={1} dir="ltr"
            value={trip.rooms}
            onChange={(e) => setRooms(Number(e.target.value))}
            className={`${fieldClass} tv-tnum text-center`}
          />
          <FieldIssue field="trip.rooms" />
        </label>
        <label className={smallLabelClass}>
          {t("pg.roomType")}
          <select value={trip.default_room_type_name} onChange={(e) => setRoomType(e.target.value)} className={fieldClass}>
            <option value="">{t("pg.chooseRoomType")}</option>
            {/* distinct NAMES: the raw table has one row per hotel, so the same
                «جناح» would otherwise repeat once for every hotel in the system */}
            {roomTypeNames(lookups.roomTypes).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className={smallLabelClass}>
          {t("pg.meals")}
          <select value={trip.meal_plan ?? ""} onChange={(e) => setMealPlan(e.target.value)} className={fieldClass}>
            <option value="">{t("pg.chooseBoard")}</option>
            {MEAL_PLANS.map((plan) => (
              <option key={plan} value={plan}>{t(MEAL_PLAN_LABEL_KEYS[plan])}</option>
            ))}
          </select>
          <FieldIssue field="trip.meal_plan" />
        </label>
      </div>
      {/* Said once, here, rather than discovered on the document: the five
          answers do not map one-to-one onto the five board codes a supplier
          understands, and the agent should know which half is which. */}
      {trip.meal_plan === "lunch" || trip.meal_plan === "dinner" ? (
        <p className="mt-2 text-[11.5px] font-semibold text-[#93aaa3]">{t("pg.mealsHint")}</p>
      ) : null}
    </div>
  );
}
