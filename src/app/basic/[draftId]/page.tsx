import { redirect } from "next/navigation";
import { BasicEditor, type BasicPreload } from "@/components/traveliun/basic/BasicEditor";
import { getCountryHotels, getDraft, getGeneratorLookups } from "@/lib/data/drafts";
import { getProfitSettings } from "@/lib/data/app-settings";
import { withModelLookups } from "@/lib/data/model-lookups";
import { getTourPrices, getTourPrograms, getTransferCars } from "@/lib/data/tour-programs";
import { suggestPricingForDraft } from "@/lib/data/pricing-suggest";
import { currentCan } from "@/lib/roles/current";
import { getPartnerSession } from "@/lib/partners/session";
import { tripCountries } from "@/lib/offer/basic";
import { findLookupCountry } from "@/lib/offer/draft-types";
import { translate } from "@/lib/i18n";

export default async function BasicDraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  // our agents, and a partner company on its own files (the drafts and pricing already scope to it)
  if (!(await currentCan("offers.write")) && !(await getPartnerSession())) redirect("/dashboard");
  const { draftId } = await params;
  const [draft, lookups, profitSettings] = await Promise.all([getDraft(draftId), getGeneratorLookups({ catalog: false }).then(withModelLookups), getProfitSettings()]);
  if (!draft) redirect("/basic");

  // what the editor would ask for one after another on opening, asked here at once (BasicPreload — the owner,
  // 2026-10-19: «ثقيلة»); an issued file is not priced to open
  const data = draft.data;
  const countries = tripCountries(data).sort();
  const hotelCountries = [...new Set([data.trip.country, ...data.cities.map((c) => c.country ?? "")].map((n) => findLookupCountry(lookups.countries, n)?.name ?? "").filter(Boolean))];
  const cityNames = [...new Set(data.cities.map((c) => c.city_name))].sort();
  const [hotels, cars, prices, programs, priced] = await Promise.all([
    Promise.all(hotelCountries.map(async (name) => [name, await getCountryHotels(name).catch(() => null)] as const)),
    countries.length ? getTransferCars(countries).catch(() => null) : Promise.resolve([] as string[]),
    countries.length ? getTourPrices(countries).catch(() => null) : Promise.resolve([]),
    cityNames.length ? getTourPrograms(cityNames).catch(() => null) : Promise.resolve([]),
    data.produced_serial || !data.scope.transport
      ? Promise.resolve(null)
      : suggestPricingForDraft(draft.id, { hotel: translate("ar", "pg.hotel"), airline: translate("ar", "pg.airline") }).catch(() => null),
  ]);
  const listPrices: Record<string, { price: number; currency: string }> = {};
  if (priced?.ok) for (const i of priced.items) if (i.item_type === "transport" && i.ref && i.sell_price != null) listPrices[i.ref] = { price: i.sell_price, currency: i.sell_currency || "SAR" };
  // a lookup that failed is left to the editor to ask again (its key stays empty)
  const preload: BasicPreload = {
    hotelsByCountry: Object.fromEntries(hotels.filter((h): h is readonly [string, NonNullable<(typeof h)[1]>] => h[1] != null)),
    carsKey: cars ? countries.join("|") : "",
    cars: cars ?? [],
    pricesKey: prices ? countries.join("|") : "",
    prices: prices ?? [],
    programsKey: programs ? cityNames.join("|") : "",
    programs: programs ?? [],
    listPrices: priced?.ok ? listPrices : null,
  };
  return <BasicEditor draftId={draft.id} initialData={draft.data} savedAt={draft.updated_at} lookups={lookups} profitSettings={profitSettings} preload={preload} />;
}
