import { notFound } from "next/navigation";
import { OperationCase, OperationRefused } from "@/components/traveliun/operations/OperationCase";
import { listOperationPayments, listOperations } from "@/lib/data/operations";
import { listInstallments } from "@/lib/data/operation-payments";
import { listBookings, listDocuments } from "@/lib/data/operation-bookings";
import { listOrSeedTravelers } from "@/lib/data/operation-travelers";
import { isOpenAIConfigured } from "@/lib/providers/openai";
import { listAssignees, listSentRequests } from "@/lib/data/operation-assign";
import { getCaseExtras, listCaseActivity } from "@/lib/data/operation-case";
import { DriversPanel } from "@/components/traveliun/operations/DriversPanel";
import { CaseManagement } from "@/components/traveliun/operations/CaseManagement";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getSupplierWork } from "@/lib/data/supplier-work";
import { getCaseProfit } from "@/lib/data/operation-money";
import { CaseProfitCard } from "@/components/traveliun/operations/CaseProfitCard";
import { gateCaseManager, gateOperation } from "@/lib/operations/access";

export const dynamic = "force-dynamic";

export default async function OperationCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // an own-files holder opening a colleague's case by its URL is told so, plainly
  const denied = await gateOperation(id);
  if (denied) return <OperationRefused reason={denied} />;
  const operations = await listOperations();
  const operation = operations.find((o) => o.id === id);
  if (!operation) notFound();

  // started first, awaited last — it does not hold up the rest
  const supplierWorkP = getSupplierWork(id);
  // null without pricing.internal — the card is then not drawn at all
  const profitP = getCaseProfit(id);
  const [travelers, payments, installments, bookings, documents, assignees, sentRequests, canBook, canManage, canReport, extras, activity] = await Promise.all([
    // a new case starts with the travelers the offer was sold for
    listOrSeedTravelers(id),
    listOperationPayments(id),
    listInstallments(id),
    listBookings(id),
    listDocuments(id),
    listAssignees(),
    listSentRequests(id),
    // Only decides whether the button is DRAWN. The server action checks the
    // same permission again — this is courtesy, not security.
    currentCan("operations.book"),
    // the manager's steps on THIS case (cancel, refunds, money corrections, the schedule, supplier
    // money): operations.write, or operations.manage_own on one's own file — courtesy too
    gateCaseManager(id).then((denied) => !denied),
    // the all-cases report stays operations.write
    currentCan("operations.write"),
    getCaseExtras(id),
    listCaseActivity(id),
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
      installments={installments}
      bookings={bookings}
      documents={documents}
      hasDays={(count ?? 0) > 0}
      clientToken={clientToken}
      assignees={assignees}
      sentRequests={sentRequests}
      canBook={canBook}
      canManage={canManage}
      canReadMrz={isOpenAIConfigured()}
      drivers={<DriversPanel serial={operation.serial} customerName={operation.customer_name} bookings={bookings} />}
      management={
        <CaseManagement
          operationId={id}
          assigneeId={extras.assignee_id}
          staff={assignees.filter((a) => a.kind === "employee" && a.id).map((a) => ({ id: a.id as string, label: a.label }))}
          clientInfo={extras.client_info}
          activity={activity}
        />
      }
      supplierWork={await supplierWorkP}
      money={await profitP.then((p) => (p ? <CaseProfitCard profit={p} showReport={canReport} /> : null))}
    />
  );
}
