import { listPrice } from "@/lib/murad/visa";
import { withoutPrices } from "@/lib/murad/price-visibility";
import { runsOn } from "./numbered-lines";

/**
 * «مراجعة القائمة» on /visas: what is wrong with each row, read the way Murad
 * reads it — the list is what a client is told on WhatsApp, word for word.
 */
export type VisaIssue =
  /** paused: Murad does not mention it */
  | "inactive"
  /** no country picked: Murad cannot find it by country */
  | "noCountry"
  /** no sell price: Murad says «السعر يحدده زميلنا» */
  | "noPrice"
  /** a sell price in another currency: Murad quotes riyals only, so says nothing */
  | "notSar"
  | "noRequirements"
  /** «1- … 2- …» in one line */
  | "runOn"
  /** every line holds a price, so with prices hidden («إعدادات مُراد») the client gets no requirements at all */
  | "lostWhenHidden"
  /** some lines hold a price or a fee: dropped when prices are hidden, and may contradict the sell price */
  | "pricesInside";

export type VisaReviewInput = {
  id: string;
  country: string | null;
  country_id: string | null;
  visa_type: string | null;
  sell_price: number | null;
  sell_currency: string | null;
  arabic_requirements: string | null;
  status: string | null;
};

export type VisaReview = { id: string; country: string; visa_type: string | null; issues: VisaIssue[] };

export function visaIssues(row: VisaReviewInput): VisaIssue[] {
  const issues: VisaIssue[] = [];
  if ((row.status ?? "Active") !== "Active") issues.push("inactive");
  if (!row.country_id) issues.push("noCountry");
  const price = listPrice({ country: row.country ?? "", visa_type: row.visa_type, sell_price: row.sell_price, sell_currency: row.sell_currency, arabic_requirements: row.arabic_requirements, status: row.status });
  if (price === null) issues.push(typeof row.sell_price === "number" && row.sell_price > 0 ? "notSar" : "noPrice");
  const text = (row.arabic_requirements ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) {
    issues.push("noRequirements");
    return issues;
  }
  if (runsOn(text)) issues.push("runOn");
  const shown = withoutPrices(text);
  if (!shown) issues.push("lostWhenHidden");
  else if (shown !== text) issues.push("pricesInside");
  return issues;
}

/** Every row with something to fix, the most broken first; the clean ones are left out. */
export function reviewVisas(rows: VisaReviewInput[]): VisaReview[] {
  return rows
    .map((r) => ({ id: r.id, country: r.country?.trim() || "—", visa_type: r.visa_type?.trim() || null, issues: visaIssues(r) }))
    .filter((r) => r.issues.length > 0)
    .sort((a, b) => b.issues.length - a.issues.length || a.country.localeCompare(b.country, "ar"));
}
