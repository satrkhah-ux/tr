import type { Place } from "./auto";

// A requested country need not have a bookable package in our catalogue.
// ISO region names come from the runtime's CLDR data, in both client languages.
const codes = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
const arabic = new Intl.DisplayNames(["ar"], { type: "region" });
const english = new Intl.DisplayNames(["en"], { type: "region" });
const normalize = (name: string) => name.replace(/[أإآ]/g, "ا").replace(/[\u064b-\u065f]/g, "").toLowerCase();
const regions = codes.map(code => ({ name: code === "DK" ? "الدنمارك" : arabic.of(code)!, english: english.of(code)! }));
const cache = new WeakMap<Place[], Place[]>();

export function withCountryNames(places: Place[]): Place[] {
  const cached = cache.get(places);
  if (cached) return cached;
  const countries = places.filter(place => place.name === place.country);
  const extra: Place[] = [];
  for (const region of regions) {
    const canonical = countries.find(place => normalize(place.name) === normalize(region.name)
      || (place.aliases ?? []).some(alias => normalize(alias) === normalize(region.english))
      || (region.english === "United States" && /^(?:الولايات المتحدة|امريكا)/.test(normalize(place.name))));
    const country = canonical?.name ?? region.name;
    if (!canonical) extra.push({ name: country, country, aliases: [region.english] });
    else if (normalize(canonical.name) !== normalize(region.name)) extra.push({ name: region.name, country });
  }
  const result = [...places, ...extra];
  cache.set(places, result);
  return result;
}
