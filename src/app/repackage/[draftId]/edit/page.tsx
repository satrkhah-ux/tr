import { RepackageStagePage } from "@/components/traveliun/repackage/RepackageStagePage";

export default async function Page({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  return <RepackageStagePage draftId={draftId} stage="edit" />;
}
