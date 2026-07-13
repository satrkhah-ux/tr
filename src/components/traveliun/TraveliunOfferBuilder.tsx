"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BedDouble,
  Bus,
  CheckCircle2,
  Copy,
  FileText,
  Hotel,
  Loader2,
  Plane,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  createOffer,
  type BuilderData,
  type OfferCityInput,
  type OfferFlightInput,
  type OfferServiceInput,
} from "@/lib/data/offers";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

const DEFAULT_INCLUDES = ["الفنادق", "وجبة الإفطار", "الاستقبال والتوديع", "الجولات السياحية", "الطيران الداخلي"];

export function TraveliunOfferBuilder({ data }: { data: BuilderData }) {
  const { t, dir } = useTraveliunUI();
  const [customerId, setCustomerId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [countryName, setCountryName] = useState(data.countries[0]?.name ?? "");
  const [destination, setDestination] = useState(data.countries[0]?.name ?? "");
  const [duration, setDuration] = useState("");
  const [offerDate, setOfferDate] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [cities, setCities] = useState<OfferCityInput[]>([]);
  const [flights, setFlights] = useState<OfferFlightInput[]>([]);
  const [services, setServices] = useState<OfferServiceInput[]>(DEFAULT_INCLUDES.map((label) => ({ label, kind: "include" as const })));
  const [terms, setTerms] = useState("");
  const [total, setTotal] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [currency, setCurrency] = useState("SAR");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedSerial, setSavedSerial] = useState<string | null>(null);

  const selectedCountry = useMemo(
    () => data.countries.find((c) => c.name === countryName) ?? data.countries[0],
    [data.countries, countryName],
  );

  function addCity() {
    const firstCity = selectedCountry?.cities[0];
    setCities((prev) => [
      ...prev,
      { city_name: firstCity?.name ?? "", hotel_name: firstCity?.hotels[0] ?? null, room_type: null, nights: 1, check_in: null, check_out: null, meals: "شامل الإفطار" },
    ]);
  }
  function updateCity(index: number, patch: Partial<OfferCityInput>) {
    setCities((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }
  function addFlight() {
    setFlights((prev) => [...prev, { carrier: null, from_airport: null, to_airport: null, flight_date: null, passengers: adults, baggage: null }]);
  }
  function updateFlight(index: number, patch: Partial<OfferFlightInput>) {
    setFlights((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }
  function addService(kind: "include" | "exclude", label = "") {
    setServices((prev) => [...prev, { label, kind }]);
  }
  function updateService(index: number, patch: Partial<OfferServiceInput>) {
    setServices((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  async function save() {
    if (saving) return;
    setError(null);
    if (!destination.trim()) {
      setError(t("err.destinationRequired"));
      return;
    }
    setSaving(true);
    const result = await createOffer({
      customer_id: customerId || null,
      employee_id: employeeId || null,
      destination: destination.trim(),
      duration: duration.trim() || null,
      offer_date: offerDate || null,
      adults,
      children,
      infants,
      total: total.trim() === "" ? null : Number(total),
      buy_total: buyPrice.trim() === "" ? null : Number(buyPrice),
      currency,
      cities: cities.filter((c) => c.city_name.trim() !== ""),
      flights: flights.filter((f) => f.carrier || f.from_airport || f.to_airport),
      services: services.filter((s) => s.label.trim() !== ""),
      terms: terms.split("\n").map((t) => t.trim()).filter(Boolean),
    });
    setSaving(false);
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    setSavedSerial(result.serial);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (savedSerial) {
    return (
      <TraveliunShell title="title.addOffer">
        <div className="tv-fade-up mx-auto max-w-[640px] rounded-2xl border border-[#bfe5d4] bg-white p-8 text-center shadow-[0_1px_2px_rgba(0,60,58,0.04)]" dir={dir}>
          <div className="mx-auto mb-4 flex size-[76px] items-center justify-center rounded-[20px] bg-[#e9f7f0] text-[#0f7a52]">
            <CheckCircle2 className="size-9" />
          </div>
          <h2 className="text-xl font-extrabold text-[#003c3a]">{t("builder.saved")}</h2>
          <p className="mt-2 text-sm font-semibold text-[#557d78]">
            {t("builder.serialLabel")} <DirText dir="ltr" className="tv-tnum font-bold text-[#185045]">{savedSerial}</DirText>
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href={`/client-offer/${savedSerial}`} target="_blank" className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-[#185045] px-5 text-sm font-bold text-white hover:bg-[#0f4439]">
              <Copy className="size-4" /> {t("offers.openClientLink")}
            </Link>
            <a href={`/offer/${savedSerial}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-[11px] border border-[#d8e3de] px-5 text-sm font-bold text-[#185045] hover:bg-[#f4f8f6]">
              {t("hub.downloadPdf")}
            </a>
            <a href={`/offer/${savedSerial}/image`} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-[11px] border border-[#d8e3de] px-5 text-sm font-bold text-[#185045] hover:bg-[#f4f8f6]">
              {t("builder.downloadImage")}
            </a>
            <button type="button" onClick={() => setSavedSerial(null)} className="inline-flex h-11 items-center gap-2 rounded-[11px] border border-[#d8e3de] px-5 text-sm font-bold text-[#185045] hover:bg-[#f4f8f6]">
              {t("builder.newOffer")}
            </button>
          </div>
        </div>
      </TraveliunShell>
    );
  }

  return (
    <TraveliunShell title="title.addOffer">
      <div className="tv-fade-up space-y-4 pb-10" dir={dir}>
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e2ebe7] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <h1 className="text-[22px] font-extrabold text-[#003c3a]">{t("builder.newTitle")}</h1>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={saving} className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-[#185045] px-5 text-sm font-bold text-white hover:bg-[#0f4439] disabled:opacity-70">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {saving ? t("saving") : t("builder.saveDb")}
            </button>
          </div>
        </section>

        {error ? (
          <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-3 text-[13px] font-semibold text-[#c22850]">{error}</p>
        ) : null}

        <Panel title={t("builder.customerTrip")}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label={t("builder.customer")}>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={field}>
                <option value="">{t("builder.chooseCustomer")}</option>
                {data.customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </Field>
            <Field label={t("builder.employee")}>
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={field}>
                <option value="">{t("builder.chooseEmployee")}</option>
                {data.employees.map((e) => (<option key={e.id} value={e.id}>{e.name}</option>))}
              </select>
            </Field>
            <Field label={t("builder.country")}>
              <select
                value={countryName}
                onChange={(e) => { setCountryName(e.target.value); setDestination(e.target.value); setCities([]); }}
                className={field}
              >
                {data.countries.map((c) => (<option key={c.id} value={c.name}>{c.name}</option>))}
              </select>
            </Field>
            <Field label={t("builder.destinationClient")}>
              <input value={destination} onChange={(e) => setDestination(e.target.value)} className={field} />
            </Field>
            <Field label={t("builder.duration")}>
              <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder={t("builder.durationPlaceholder")} className={field} />
            </Field>
            <Field label={t("builder.startDate")}>
              <input type="date" dir="ltr" value={offerDate} onChange={(e) => setOfferDate(e.target.value)} className={`${field} text-start`} />
            </Field>
            <Field label={t("builder.adults")}><NumberInput value={adults} onChange={setAdults} /></Field>
            <Field label={t("builder.children")}><NumberInput value={children} onChange={setChildren} /></Field>
            <Field label={t("builder.infants")}><NumberInput value={infants} onChange={setInfants} /></Field>
          </div>
        </Panel>

        <Panel
          title={t("builder.citiesHotels")}
          icon={Hotel}
          actions={
            <div className="flex gap-2">
              <AddButton label={t("builder.addCity")} onClick={addCity} />
              <AddButton label={t("builder.addHotel")} onClick={addCity} />
            </div>
          }
        >
          {cities.length === 0 ? (
            <Empty text={t("builder.noCities")} />
          ) : (
            <div className="space-y-3">
              {cities.map((city, index) => {
                const cityData = selectedCountry?.cities.find((c) => c.name === city.city_name) ?? selectedCountry?.cities[0];
                return (
                  <div key={index} className="grid gap-3 rounded-[12px] border border-[#e2ebe7] p-3 lg:grid-cols-[1.2fr_1.4fr_1fr_100px_auto]">
                    <LabeledSelect label={t("builder.city")} value={city.city_name} onChange={(v) => updateCity(index, { city_name: v, hotel_name: (selectedCountry?.cities.find((c) => c.name === v)?.hotels[0]) ?? null })} options={(selectedCountry?.cities ?? []).map((c) => c.name)} />
                    <LabeledSelect label={t("builder.hotel")} value={city.hotel_name ?? ""} onChange={(v) => updateCity(index, { hotel_name: v })} options={cityData?.hotels ?? []} allowEmpty />
                    <LabeledInput label={t("builder.roomType")} value={city.room_type ?? ""} onChange={(v) => updateCity(index, { room_type: v })} />
                    <LabeledNumber label={t("builder.nights")} value={city.nights ?? 0} onChange={(v) => updateCity(index, { nights: v })} />
                    <RemoveButton onClick={() => setCities((prev) => prev.filter((_, i) => i !== index))} />
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          title={t("builder.flights")}
          icon={Plane}
          actions={<AddButton label={t("builder.addFlight")} onClick={addFlight} />}
        >
          {flights.length === 0 ? (
            <Empty text={t("builder.noFlights")} />
          ) : (
            <div className="space-y-3">
              {flights.map((flight, index) => (
                <div key={index} className="grid gap-3 rounded-[12px] border border-[#e2ebe7] p-3 lg:grid-cols-[1.4fr_1fr_1fr_130px_auto]">
                  <LabeledInput label={t("builder.carrier")} value={flight.carrier ?? ""} onChange={(v) => updateFlight(index, { carrier: v })} />
                  <LabeledInput label={t("builder.from")} value={flight.from_airport ?? ""} onChange={(v) => updateFlight(index, { from_airport: v })} />
                  <LabeledInput label={t("builder.to")} value={flight.to_airport ?? ""} onChange={(v) => updateFlight(index, { to_airport: v })} />
                  <LabeledDate label={t("builder.date")} value={flight.flight_date ?? ""} onChange={(v) => updateFlight(index, { flight_date: v })} />
                  <RemoveButton onClick={() => setFlights((prev) => prev.filter((_, i) => i !== index))} />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title={t("builder.servicesTransfers")}
          icon={BedDouble}
          actions={
            <div className="flex gap-2">
              <AddButton label={t("builder.addTransfer")} icon={Bus} onClick={() => addService("include", "توصيل من وإلى المطار")} />
              <AddButton label={t("builder.addService")} onClick={() => addService("include")} />
            </div>
          }
        >
          <div className="grid gap-2 md:grid-cols-2">
            {services.map((service, index) => (
              <div key={index} className="flex items-center gap-2 rounded-[10px] border border-[#e2ebe7] p-2">
                <select value={service.kind} onChange={(e) => updateService(index, { kind: e.target.value as "include" | "exclude" })} className="h-10 rounded-[8px] border border-[#dbe6e1] bg-white px-2 text-xs font-bold text-[#185045] outline-none">
                  <option value="include">{t("builder.include")}</option>
                  <option value="exclude">{t("builder.exclude")}</option>
                </select>
                <input value={service.label} onChange={(e) => updateService(index, { label: e.target.value })} placeholder={t("builder.serviceName")} className="h-10 flex-1 rounded-[8px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]" />
                <RemoveButton onClick={() => setServices((prev) => prev.filter((_, i) => i !== index))} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title={t("builder.terms")} icon={FileText}>
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={t("builder.termsPlaceholder")} className="h-28 w-full rounded-[11px] border border-[#dbe6e1] bg-white p-3 text-sm text-[#0f3d38] outline-none focus:border-[#2aa87a]" />
        </Panel>

        <Panel title={t("builder.finalPrice")}>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t("builder.sellPrice")}>
              <input type="number" dir="ltr" value={total} onChange={(e) => setTotal(e.target.value)} className={`${field} text-start tv-tnum`} />
            </Field>
            <Field label={t("builder.currency")}>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={field}>
                {["SAR", "USD", "AED", "TRY", "MYR", "THB", "IDR"].map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
            </Field>
          </div>

          <div className="mt-4 rounded-[12px] border border-[#f2e2b4] bg-[#fffdf5] p-4">
            <p className="mb-3 flex items-center gap-2 text-[13px] font-extrabold text-[#a86a10]">
              {t("builder.internalPricing")}
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label={t("builder.buyInternal")}>
                <input type="number" dir="ltr" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} className={`${field} text-start tv-tnum`} />
              </Field>
              <Field label={t("builder.computedProfit")}>
                <div className="flex h-[46px] items-center rounded-[11px] border border-[#dbe6e1] bg-white px-3">
                  {total.trim() !== "" && buyPrice.trim() !== "" ? (
                    <span className="tv-tnum text-sm font-extrabold text-[#0f7a52]">
                      <DirText dir="ltr">{`${(Number(total) - Number(buyPrice)).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`}</DirText>
                    </span>
                  ) : (
                    <span className="text-sm text-[#93aaa3]">—</span>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </Panel>

        <div className="flex justify-end">
          <button type="button" onClick={save} disabled={saving} className="inline-flex h-12 items-center gap-2 rounded-[11px] bg-[#2aa87a] px-8 text-sm font-extrabold text-white hover:bg-[#248d68] disabled:opacity-70">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("builder.saveOffer")}
          </button>
        </div>
      </div>
    </TraveliunShell>
  );
}

function Panel({ title, icon: Icon, actions, children }: { title: string; icon?: typeof Hotel; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="flex items-center justify-between gap-3 border-b border-[#eef2f0] px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-[#003c3a]">
          {Icon ? <Icon className="size-5 text-[#185045]" /> : null}
          {title}
        </h2>
        {actions}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 text-[13px] font-bold text-[#185045]">
      {label}
      {children}
    </label>
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <input type="number" min={0} dir="ltr" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} className={`${field} text-start tv-tnum`} />;
}
function LabeledSelect({ label, value, onChange, options, allowEmpty = false }: { label: string; value: string; onChange: (v: string) => void; options: string[]; allowEmpty?: boolean }) {
  return (
    <label className="grid gap-1.5 text-xs font-bold text-[#185045]">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={fieldSm}>
        {allowEmpty ? <option value="">—</option> : null}
        {options.map((o) => (<option key={o} value={o}>{o}</option>))}
      </select>
    </label>
  );
}
function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1.5 text-xs font-bold text-[#185045]">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} className={fieldSm} />
    </label>
  );
}
function LabeledNumber({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="grid gap-1.5 text-xs font-bold text-[#185045]">
      {label}
      <input type="number" min={0} dir="ltr" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} className={`${fieldSm} text-start tv-tnum`} />
    </label>
  );
}
function LabeledDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1.5 text-xs font-bold text-[#185045]">
      {label}
      <input type="date" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldSm} text-start`} />
    </label>
  );
}
function AddButton({ label, icon: Icon = Plus, onClick }: { label: string; icon?: typeof Plus; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#cfe0d9] bg-white px-3 text-xs font-bold text-[#185045] hover:bg-[#f4f8f6]">
      <Icon className="size-4" /> {label}
    </button>
  );
}
function RemoveButton({ onClick }: { onClick: () => void }) {
  const { t } = useTraveliunUI();
  return (
    <button type="button" onClick={onClick} title={t("delete")} className="mt-5 inline-flex h-10 items-center justify-center rounded-[9px] border border-[#f2d0d7] bg-white px-3 text-[#c43d5a] hover:bg-[#fdeef2]">
      <Trash2 className="size-4" />
    </button>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-sm text-[#9cafaa]">{text}</p>;
}

const field = "h-[46px] rounded-[11px] border border-[#dbe6e1] bg-white px-3 text-sm font-normal text-[#0f3d38] outline-none transition-colors focus:border-[#2aa87a]";
const fieldSm = "h-10 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-sm font-normal text-[#0f3d38] outline-none transition-colors focus:border-[#2aa87a]";
