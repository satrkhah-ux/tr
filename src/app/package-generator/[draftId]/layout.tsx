import { redirect } from "next/navigation";
import { featureOn } from "@/lib/features-server";
import { getPartnerSession } from "@/lib/partners/session";

/**
 * The legacy generator switched off (/developer, features.ts legacy_generator):
 * every old address of a draft — a bookmark, a link in a chat, a stage URL —
 * opens the SAME draft in «بيسك», which edits the same offer_drafts row. A
 * partner is not sent anywhere: /package-generator is their «ملفاتي».
 *
 * A layout, so the eleven stage pages need no line each. It runs on entering
 * the draft, not on every move between its stages — enough for a switch.
 */
export default async function LegacyDraftLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ draftId: string }>;
}) {
  if (!(await featureOn("legacy_generator")) && !(await getPartnerSession())) {
    redirect(`/basic/${encodeURIComponent((await params).draftId)}`);
  }
  return children;
}
