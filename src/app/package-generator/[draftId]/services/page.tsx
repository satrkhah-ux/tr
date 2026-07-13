import { GeneratorStagePage } from "@/components/traveliun/generator/GeneratorStagePage";

export default async function Page({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  return <GeneratorStagePage draftId={draftId} stage="services" />;
}
