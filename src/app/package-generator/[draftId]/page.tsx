import { redirect } from "next/navigation";

/** Bare draft URL → first stage. */
export default async function Page({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  redirect(`/package-generator/${draftId}/customer`);
}
