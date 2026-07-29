import { notFound } from "next/navigation";
import { OperationCase } from "@/components/traveliun/operations/OperationCase";
import { listOperationPayments, listOperations } from "@/lib/data/operations";
import { listBookings, listDocuments } from "@/lib/data/operation-bookings";
import { listTravelers } from "@/lib/data/operation-travelers";
import { listAssignees, listSentRequests } from "@/lib/data/operation-assign";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OperationCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const operations = await listOperations();
  const operation = operations.find((o) => o.id === id);
  if (!operation) notFound();

  const [travelers, payments, bookings, documents, assignees, sentRequests] = await Promise.all([
    listTravelers(id),
    listOperationPayments(id),
    listBookings(id),
    listDocuments(id),
    listAssignees(),
    listSentRequests(id),
  ]);

  // The itinerary voucher needs the day-by-day program that was authored in the
  // generator; without it that button stays disabled rather than issuing a
  // document with nothing on it.
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("offer_days")
    .select("id", { count: "exact", head: true })
    .eq("offer_id", operation.offer_id);

  const linkRes = await supabase
    .from("operations")
    .select("client_token, client_token_revoked_at")
    .eq("id", id)
    .maybeSingle();
  const link = linkRes.data as { client_token: string | null; client_token_revoked_at: string | null } | null;
  const clientToken = link?.client_token && !link.client_token_revoked_at ? link.client_token : null;

  return (
    <OperationCase
      operation={operation}
      travelers={travelers}
      payments={payments}
      bookings={bookings}
      documents={documents}
      hasDays={(count ?? 0) > 0}
      clientToken={clientToken}
      assignees={assignees}
      sentRequests={sentRequests}
    />
  );
}
