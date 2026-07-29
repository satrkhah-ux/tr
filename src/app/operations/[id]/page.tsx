import { notFound } from "next/navigation";
import { OperationCase } from "@/components/traveliun/operations/OperationCase";
import { listOperationPayments, listOperations } from "@/lib/data/operations";
import { listBookings, listDocuments } from "@/lib/data/operation-bookings";
import { listTravelers } from "@/lib/data/operation-travelers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OperationCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const operations = await listOperations();
  const operation = operations.find((o) => o.id === id);
  if (!operation) notFound();

  const [travelers, payments, bookings, documents] = await Promise.all([
    listTravelers(id),
    listOperationPayments(id),
    listBookings(id),
    listDocuments(id),
  ]);

  // The itinerary voucher needs the day-by-day program that was authored in the
  // generator; without it that button stays disabled rather than issuing a
  // document with nothing on it.
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("offer_days")
    .select("id", { count: "exact", head: true })
    .eq("offer_id", operation.offer_id);

  return (
    <OperationCase
      operation={operation}
      travelers={travelers}
      payments={payments}
      bookings={bookings}
      documents={documents}
      hasDays={(count ?? 0) > 0}
    />
  );
}
