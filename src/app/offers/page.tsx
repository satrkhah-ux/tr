import { DraftsList } from "@/components/traveliun/generator/DraftsList";
import { listDrafts } from "@/lib/data/drafts";

export const dynamic = "force-dynamic";

/**
 * «العروض السياحية» — what actually went out to a client.
 *
 * Issued only: a programme earns its place here by having a serial, which it
 * gets from `produceOfferFromDraft` and from nowhere else. Half-written work
 * belongs in the generator, and mixing the two is how someone opens a list
 * looking for the offer they sent and has to read past the ones they never did.
 */
export default async function IssuedOffersPage() {
  const drafts = await listDrafts();
  const issued = drafts.filter((d) => Boolean(d.produced_serial));
  return <DraftsList drafts={issued} titleKey="nav.issuedOffers" variant="issued" />;
}
