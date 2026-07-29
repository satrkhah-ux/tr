import { notFound } from "next/navigation";
import { OperationCase } from "@/components/traveliun/operations/OperationCase";
import { listOperationPayments, listOperations } from "@/lib/data/operations";
import { listTravelers } from "@/lib/data/operation-travelers";

export const dynamic = "force-dynamic";

export default async function OperationCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const operations = await listOperations();
  const operation = operations.find((o) => o.id === id);
  if (!operation) notFound();

  const [travelers, payments] = await Promise.all([listTravelers(id), listOperationPayments(id)]);

  return <OperationCase operation={operation} travelers={travelers} payments={payments} />;
}
