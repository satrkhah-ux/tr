"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus, Trash2, FileText } from "lucide-react";
import { getOriginalFileUrl } from "@/lib/data/repackage";
import { cityKeys, newCityKey } from "@/lib/offer/draft-types";
import {
  isFieldConfident,
  keyHotels,
  packageNights,
  stageHref,
  withArrival,
  withDeparture,
  type ConfidenceFieldKey,
  type ExtractedPackage,
} from "@/lib/repackage/repackage-types";
import { TeletelSearch } from "../../generator/TeletelSearch";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { addButtonClass, fieldClass, labelClass, removeButtonClass, sectionClass } from "../stage-props";
import type { RepackageStageProps } from "../stage-props";

/** The generator's border for a required field left empty (FieldIssue's useFieldRing). */
const ring = (filled: unknown) => (filled ? "" : " border-[#e0879b] focus:border-[#c22850]");

export function ReviewStage({ draftId, data, patch }: RepackageStageProps) {
  const router = useRouter();
  const { t } = useTraveliunUI();
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getOriginalFileUrl(draftId).then((url) => {
      if (alive) setFileUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [draftId]);

  const pkg = data.extracted;
  if (!pkg) {
    return (
      <div className={sectionClass}>
        <p className="text-[13px] text-[#557d78]">{t("rp.err.noFile")}</p>
      </div>
    );
  }

  const confirm = (key: ConfidenceFieldKey) =>
    patch({ reviewed: Array.from(new Set([...data.reviewed, key])) });
  const update = (partial: Partial<ExtractedPackage>, ...keys: ConfidenceFieldKey[]) =>
    patch({ extracted: { ...pkg, ...partial }, reviewed: Array.from(new Set([...data.reviewed, ...keys])) });

  const nights = packageNights(pkg);
  // each hotel's stop — a city visited twice is two stops, each with its own hotel
  const keys = cityKeys(pkg.cities);
  const hotelStops = keyHotels(pkg.cities, pkg.hotels);
  const stopLabel = (index: number) => {
    const name = pkg.cities[index].city_name.trim();
    const visits = pkg.cities.filter((c) => c.city_name.trim() === name).length;
    if (visits < 2) return name || "—";
    const n = pkg.cities.slice(0, index + 1).filter((c) => c.city_name.trim() === name).length;
    return t("rp.field.visitN", { city: name, n });
  };

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-extrabold text-[#0f3d38]">{t("rp.review.title")}</h2>
        <p className="mt-1 text-[13px] text-[#557d78]">{t("rp.review.hint")}</p>
      </header>

      {/* the client and the travel dates — what the document is addressed to, so first */}
      <section className={sectionClass}>
        <h3 className="text-[14px] font-extrabold text-[#0f3d38]">{t("rp.client.title")}</h3>
        <p className="mb-3 mt-0.5 text-[12px] text-[#557d78]">{t("rp.client.hint")}</p>
        <TeletelSearch onPick={(hit) => update({ customer_name: hit.name, customer_phone: hit.phone })} />
        <div className="grid gap-3 md:grid-cols-2">
          <label className={labelClass}>
            {t("pg.customerName")}
            <input className={`${fieldClass}${ring(pkg.customer_name.trim())}`} value={pkg.customer_name} onChange={(e) => update({ customer_name: e.target.value })} />
          </label>
          <label className={labelClass}>
            {t("pg.customerPhone")}
            <input dir="ltr" inputMode="tel" placeholder="05xxxxxxxx" className={`${fieldClass} tv-tnum text-start${ring(pkg.customer_phone.trim())}`} value={pkg.customer_phone} onChange={(e) => update({ customer_phone: e.target.value })} />
          </label>
          <div className="md:col-span-2">
            <FieldHead label={t("rp.field.dates")} confident={isFieldConfident(data, "dates")} confirmLabel={t("rp.review.confirm")} onConfirm={() => confirm("dates")} />
          </div>
          <label className={labelClass}>
            {t("pg.arrival")}
            <input type="date" dir="ltr" className={`${fieldClass}${ring(pkg.arrival_date)}`} value={pkg.arrival_date ?? ""} onChange={(e) => update(withArrival(pkg, e.target.value || null), "dates")} />
          </label>
          <label className={labelClass}>
            {t("pg.departure")}
            <input
              type="date"
              dir="ltr"
              min={pkg.arrival_date ?? undefined}
              className={`${fieldClass}${ring(pkg.departure_date)}`}
              value={pkg.departure_date ?? ""}
              onChange={(e) => {
                const next = withDeparture(pkg, e.target.value || null);
                // a departure that re-measures the nights is the human setting them
                update(next, ...(next.trip_nights !== undefined ? (["dates", "trip_nights"] as const) : (["dates"] as const)));
              }}
            />
            {pkg.arrival_date && nights > 0 ? (
              <span className="text-[11.5px] font-semibold text-[#93aaa3]">{t("rp.client.departureHint", { nights })}</span>
            ) : null}
          </label>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* extraction (editable, confidence-badged) */}
        <div className="space-y-3">
          <Field label={t("rp.field.country")} confident={isFieldConfident(data, "country")} confirmLabel={t("rp.review.confirm")} onConfirm={() => confirm("country")}>
            <input className={fieldClass} value={pkg.country} onChange={(e) => update({ country: e.target.value, destination: pkg.destination || e.target.value }, "country")} />
          </Field>

          <Field label={t("rp.field.destination")} confident={isFieldConfident(data, "destination")} confirmLabel={t("rp.review.confirm")} onConfirm={() => confirm("destination")}>
            <input className={fieldClass} value={pkg.destination} onChange={(e) => update({ destination: e.target.value }, "destination")} />
          </Field>

          <Field label={t("rp.field.trip_nights")} confident={isFieldConfident(data, "trip_nights")} confirmLabel={t("rp.review.confirm")} onConfirm={() => confirm("trip_nights")}>
            <input type="number" min={0} className={fieldClass} value={pkg.trip_nights ?? ""} onChange={(e) => update({ trip_nights: e.target.value === "" ? null : Number(e.target.value) }, "trip_nights")} />
          </Field>

          <Field label={t("rp.field.pax")} confident={isFieldConfident(data, "pax")} confirmLabel={t("rp.review.confirm")} onConfirm={() => confirm("pax")}>
            <div className="flex gap-2">
              <input type="number" min={0} className={fieldClass} value={pkg.adults} onChange={(e) => update({ adults: Number(e.target.value) || 0 }, "pax")} aria-label={t("rp.field.pax")} />
              <input type="number" min={0} className={fieldClass} value={pkg.children} onChange={(e) => update({ children: Number(e.target.value) || 0 }, "pax")} />
              <input type="number" min={0} className={fieldClass} value={pkg.infants} onChange={(e) => update({ infants: Number(e.target.value) || 0 }, "pax")} />
            </div>
          </Field>

          <Field label={t("rp.field.supplier_total")} confident={isFieldConfident(data, "supplier_total")} confirmLabel={t("rp.review.confirm")} onConfirm={() => confirm("supplier_total")}>
            <div className="flex gap-2">
              <input type="number" min={0} className={fieldClass} value={pkg.supplier_total ?? ""} onChange={(e) => update({ supplier_total: e.target.value === "" ? null : Number(e.target.value) }, "supplier_total")} />
              <input className={`${fieldClass} w-24`} value={pkg.supplier_currency} onChange={(e) => update({ supplier_currency: e.target.value }, "supplier_total")} />
            </div>
          </Field>

          {/* cities + nights */}
          <div className={sectionClass}>
            <FieldHead label={t("rp.field.cities")} confident={isFieldConfident(data, "cities")} confirmLabel={t("rp.review.confirm")} onConfirm={() => confirm("cities")} />
            <div className="mt-2 space-y-2">
              {pkg.cities.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <input className={fieldClass} value={c.city_name} onChange={(e) => { const cities = [...pkg.cities]; cities[i] = { ...c, city_name: e.target.value }; update({ cities }, "cities"); }} />
                  <input type="number" min={0} className={`${fieldClass} w-24`} value={c.nights ?? ""} onChange={(e) => { const cities = [...pkg.cities]; cities[i] = { ...c, nights: e.target.value === "" ? null : Number(e.target.value) }; update({ cities }, "cities"); }} />
                  <button type="button" className={removeButtonClass} onClick={() => update({ cities: pkg.cities.filter((_, j) => j !== i) }, "cities")}><Trash2 className="size-4" /></button>
                </div>
              ))}
              <button type="button" className={addButtonClass} onClick={() => update({ cities: [...pkg.cities, { key: newCityKey(pkg.cities, ""), city_name: "", nights: 1 }] }, "cities")}><Plus className="size-4" />{t("rp.edit.add")}</button>
            </div>
          </div>

          {/* hotels */}
          <div className={sectionClass}>
            <FieldHead label={t("rp.field.hotels")} confident={isFieldConfident(data, "hotels")} confirmLabel={t("rp.review.confirm")} onConfirm={() => confirm("hotels")} />
            <div className="mt-2 space-y-2">
              {pkg.hotels.map((h, i) => (
                <div key={i} className="grid gap-2">
                  {/* which stop — by visit, so the second تبليسي keeps its own hotel */}
                  {pkg.cities.length > 0 ? (
                    <select
                      aria-label={t("rp.field.hotelStop")}
                      className={fieldClass}
                      value={hotelStops[i]?.city_key ?? ""}
                      onChange={(e) => {
                        const at = keys.indexOf(e.target.value);
                        const hotels = [...pkg.hotels];
                        hotels[i] = { ...h, city_key: e.target.value, city_name: pkg.cities[at]?.city_name ?? h.city_name };
                        update({ hotels }, "hotels");
                      }}
                    >
                      <option value="" disabled>—</option>
                      {pkg.cities.map((_, ci) => (
                        <option key={keys[ci]} value={keys[ci]}>{stopLabel(ci)}</option>
                      ))}
                    </select>
                  ) : null}
                  <div className="flex gap-2">
                    <input className={fieldClass} value={h.hotel_name} placeholder={t("rp.field.hotels")} onChange={(e) => { const hotels = [...pkg.hotels]; hotels[i] = { ...h, hotel_name: e.target.value }; update({ hotels }, "hotels"); }} />
                    <input className={`${fieldClass} w-24`} value={h.board} placeholder="BB" onChange={(e) => { const hotels = [...pkg.hotels]; hotels[i] = { ...h, board: e.target.value }; update({ hotels }, "hotels"); }} />
                    <button type="button" className={removeButtonClass} onClick={() => update({ hotels: pkg.hotels.filter((_, j) => j !== i) }, "hotels")}><Trash2 className="size-4" /></button>
                  </div>
                </div>
              ))}
              <button type="button" className={addButtonClass} onClick={() => update({ hotels: [...pkg.hotels, { city_name: "", hotel_name: "", room_type: "", board: "", nights: null, check_in: null, check_out: null }] }, "hotels")}><Plus className="size-4" />{t("rp.edit.add")}</button>
            </div>
          </div>
        </div>

        {/* original file side-by-side */}
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-[11px] font-extrabold tracking-wide text-[#93aaa3]"><FileText className="size-4" />{t("rp.review.original")}</p>
          {fileUrl ? (
            <iframe title={t("rp.review.original")} src={fileUrl} className="h-[560px] w-full rounded-[14px] border border-[#e2ebe7] bg-white" />
          ) : (
            <div className="flex h-[200px] items-center justify-center rounded-[14px] border border-dashed border-[#dbe6e1] text-[13px] text-[#93aaa3]">{t("rp.review.openFile")}</div>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={() => router.push(stageHref(draftId, "edit"))} className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0f4439]">
          {t("rp.stage.edit")}
        </button>
      </div>
    </div>
  );
}

function FieldHead({ label, confident, confirmLabel, onConfirm }: { label: string; confident: boolean; confirmLabel: string; onConfirm: () => void }) {
  const { t } = useTraveliunUI();
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] font-bold text-[#185045]">{label}</span>
      <span className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${confident ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#fff8e8] text-[#a86a10]"}`}>
          {confident ? t("rp.review.confident") : t("rp.review.uncertain")}
        </span>
        {!confident ? (
          <button type="button" onClick={onConfirm} className="inline-flex items-center gap-1 rounded-md bg-[#f0f7f4] px-2 py-0.5 text-[10.5px] font-extrabold text-[#185045] hover:bg-[#e2ede9]">
            <CheckCircle2 className="size-3" />{confirmLabel}
          </button>
        ) : null}
      </span>
    </div>
  );
}

function Field({ label, confident, confirmLabel, onConfirm, children }: { label: string; confident: boolean; confirmLabel: string; onConfirm: () => void; children: React.ReactNode }) {
  return (
    <div className={`${sectionClass} ${confident ? "" : "ring-1 ring-[#f2e2b4]"}`}>
      <FieldHead label={label} confident={confident} confirmLabel={confirmLabel} onConfirm={onConfirm} />
      <div className="mt-2">{children}</div>
    </div>
  );
}
