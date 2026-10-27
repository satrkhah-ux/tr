import "server-only";

import { randomUUID } from "node:crypto";
import { issuedDraftData } from "@/lib/data/issued-draft";
import { intlPhone } from "@/lib/providers/teletel";
import { catalogFor, saleMarker, saleVisaLines } from "./from-sale-core";
import { blankTraveler, toColumns, type StoredTraveler } from "./rows";
import { cleanFields, defaultServices, expectedDocs, fold, money2, requirementLines } from "./rules";
import { addEvents, audit, db, insertVisaFile } from "./store";

type OfferRow = {
  id: string;
  serial: string | null;
  partner_company_id: string | null;
  customers: { arabic_name: string | null; mobile: string | null } | { arabic_name: string | null; mobile: string | null }[] | null;
};

/**
 * The sale of a file with visas opens their files (the owner, 2026-10-26: «يفتح اسم العميل والدولة والخدمة المطلوبة
 * ويكون الملف جاهز للموظف للمراجعة والإدخال»): one file per country and type of the issued draft, with the client, the
 * heads, the catalogue's price and expected documents, the default services — new and unassigned, so whoever works
 * visas finds it on the board. Called when the client's confirmation opens the operations case, best-effort; a sale
 * confirmed twice, or a file the department opened by hand, never doubles a file. Our own sales only (a partner
 * company's client is its own to follow). Returns the serials it opened.
 */
export async function openVisaFilesForSale(offerId: string): Promise<string[]> {
  const { data } = await db().from("offers").select("id, serial, partner_company_id, customers(arabic_name, mobile)").eq("id", offerId).maybeSingle();
  const offer = data as OfferRow | null;
  if (!offer?.serial || offer.partner_company_id) return [];
  const lines = saleVisaLines(await issuedDraftData(db(), { id: offer.id, serial: offer.serial, partner_company_id: null }));
  if (lines.length === 0) return [];

  const marker = saleMarker(offer.serial);
  const [{ data: existing }, { data: catalog }] = await Promise.all([
    db().from("visa_files").select("country, visa_type").like("note", `${marker}%`),
    db().from("visas").select("id, country, country_id, visa_type, sell_price, sell_currency, arabic_requirements, status"),
  ]);
  const taken = new Set(((existing ?? []) as { country: string; visa_type: string | null }[]).map((f) => `${fold(f.country)}|${fold(f.visa_type ?? "")}`));
  const rows = ((catalog ?? []) as { id: string; country: string | null; country_id: string | null; visa_type: string | null; sell_price: number | null; sell_currency: string | null; arabic_requirements: string | null; status: string | null }[])
    .filter((r) => (r.status ?? "Active") === "Active");
  const customer = Array.isArray(offer.customers) ? offer.customers[0] : offer.customers;
  const clientName = customer?.arabic_name?.trim() || `عميل ${offer.serial}`;
  const clientPhone = customer?.mobile?.trim() || null;

  const opened: string[] = [];
  for (const line of lines) {
    if (taken.has(`${fold(line.country)}|${fold(line.visaType ?? "")}`)) continue;
    const cat = catalogFor(line, rows);
    const cleaned = cleanFields({ country: line.country, visaType: line.visaType ?? cat?.visa_type ?? undefined, applicants: line.applicants, clientName, clientPhone: clientPhone ?? undefined });
    if (!cleaned.ok) continue;
    const f = cleaned.set;
    const travelers: StoredTraveler[] = Array.from({ length: line.applicants }, () => blankTraveler(randomUUID()));
    const per = cat?.sell_price && cat.sell_price > 0 ? cat.sell_price : null;
    const currency = cat?.sell_currency && /^[A-Za-z]{3}$/.test(cat.sell_currency) ? cat.sell_currency.toUpperCase() : "SAR";
    const made = await insertVisaFile({
      ...toColumns({ ...f, assignedTo: null, countryId: cat?.country_id ?? null, visaCatalogId: cat?.id ?? null, currency }),
      client_phone: clientPhone ? (intlPhone(clientPhone) ?? clientPhone) : null,
      fee_service: per ? money2(per * line.applicants) : 0,
      fee_embassy: 0,
      note: [marker, line.note].filter(Boolean).join(" — "),
      travelers,
      documents: expectedDocs(requirementLines(cat?.arabic_requirements), travelers.map((t) => t.id)),
      services: defaultServices(),
      created_by: null,
    });
    if (!made) continue;
    await addEvents(made.id, null, [{ kind: "created", text: `فُتح الملف تلقائياً عند تأكيد البيع ${offer.serial} — ${line.country}${f.visaType ? ` (${f.visaType})` : ""} · ${line.applicants} متقدم` }]);
    await audit("visa.file.created", made.id, { serial: made.serial, country: line.country, applicants: line.applicants, sale: offer.serial, catalog: cat?.id ?? null, auto: true });
    opened.push(made.serial);
  }
  return opened;
}
