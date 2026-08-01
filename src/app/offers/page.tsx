import { DraftsList } from "@/components/traveliun/generator/DraftsList";
import { listDrafts } from "@/lib/data/drafts";

export const dynamic = "force-dynamic";

/**
 * «البكجات السياحية» — every programme, drafted or issued.
 *
 * The same list the generator opens with, reached from the other direction: an
 * agent hunting for a file thinks of it either as the thing they are building
 * or the thing they built, and both roads should end at the same table with the
 * same actions — search, continue editing, duplicate, open the issued offer,
 * delete.
 *
 * Deliberately ONE component rather than a second table of `offers`: two lists
 * of the same work drift, and then someone has to decide which one is right.
 * A programme that has been issued carries its serial in this list already.
 */
export default async function PackagesPage() {
  const drafts = await listDrafts();
  return <DraftsList drafts={drafts} titleKey="nav.packages" />;
}
