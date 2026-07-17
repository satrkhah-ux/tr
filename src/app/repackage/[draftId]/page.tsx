import { redirect } from "next/navigation";

export default async function RepackageDraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  redirect(`/repackage/${draftId}/import`);
}
