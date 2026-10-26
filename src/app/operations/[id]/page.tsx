import { notFound } from "next/navigation";
import { after } from "next/server";
import { sweepCaseTbo } from "@/lib/operations/tbo-sweep";
import { OperationCase, OperationRefused } from "@/components/traveliun/operations/OperationCase";
import { isOpenAIConfigured } from "@/lib/providers/openai";
import { listAssignees, listSentRequests } from "@/lib/data/operation-assign";
import { getCaseExtras, listCaseActivity } from "@/lib/data/operation-case";
import { DriversPanel } from "@/components/traveliun/operations/DriversPanel";
import { CaseManagement } from "@/components/traveliun/operations/CaseManagement";
import { currentCan } from "@/lib/roles/current";
import { getCaseProfit } from "@/lib/data/operation-money";
import { CaseProfitCard } from "@/components/traveliun/operations/CaseProfitCard";
import { gateCaseManager, gateOperation } from "@/lib/operations/access";
import { loadWizardCase } from "@/lib/data/wizard-case";
import { CaseWizardShell, ReadyGate } from "@/components/traveliun/operations/wizard/CaseWizardShell";
import { leadName } from "@/lib/operations/travelers";

export const dynamic = "force-dynamic";

/**
 * A case opens as «معالج الحجوزات» (the owner, 2026-10-17) on its first step
 * with work left; `?view=all` is the one page with everything, as before.
 */
export default async function OperationCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // an own-files holder opening a colleague's case by its URL is told so, plainly
  const denied = await gateOperation(id);
  if (denied) return <OperationRefused reason={denied} />;

  // started first, awaited last — they do not hold up the rest
  const dataP = loadWizardCase(id);
  // the manager's steps on THIS case (cancel, refunds, money corrections, the schedule, supplier
  // money): operations.write, or operations.manage_own on one's own file — courtesy: the server checks again
  const canManageP = gateCaseManager(id).then((no) => !no);
  const [data, canManage] = await Promise.all([dataP, canManageP]);
  if (!data) notFound();

  // TBO is asked about this case's bookings as the page opens — after the answer,
  // never holding it up; a change shows as an issue on the next load (tbo-sweep.ts)
  after(() => sweepCaseTbo(id, new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" })).catch(() => undefined));

  if (query.view !== "all") {
    const canSeeCost = await currentCan("pricing.internal");
    return <CaseWizardShell data={data} canManage={canManage} canReadMrz={isOpenAIConfigured()} openUpload={query.upload === "1"} canSeeCost={canSeeCost} />;
  }

  // null without pricing.internal — the card is then not drawn at all
  const profitP = getCaseProfit(id);
  const [assignees, sentRequests, canBook, canReport, extras, activity] = await Promise.all([
    listAssignees(),
    listSentRequests(id),
    // Only decides whether the button is DRAWN. The server action checks the
    // same permission again — this is courtesy, not security.
    currentCan("operations.book"),
    // the all-cases report stays operations.write
    currentCan("operations.write"),
    getCaseExtras(id),
    listCaseActivity(id),
  ]);
  const operation = data.operation;

  return (
    <OperationCase
      operation={operation}
      travelers={data.travelers}
      payments={data.payments}
      installments={data.installments}
      bookings={data.bookings}
      documents={data.documents}
      hasDays={data.hasDays}
      clientToken={data.clientToken}
      assignees={assignees}
      sentRequests={sentRequests}
      canBook={canBook}
      canManage={canManage}
      canReadMrz={isOpenAIConfigured()}
      drivers={<DriversPanel serial={operation.serial} guestName={leadName(data.travelers) || null} bookings={data.bookings} />}
      ready={<ReadyGate data={data} />}
      management={
        <CaseManagement
          operationId={id}
          assigneeId={extras.assignee_id}
          staff={assignees.filter((a) => a.kind === "employee" && a.id).map((a) => ({ id: a.id as string, label: a.label }))}
          clientInfo={extras.client_info}
          activity={activity}
        />
      }
      supplierWork={data.supplierWork}
      money={await profitP.then((p) => (p ? <CaseProfitCard profit={p} showReport={canReport} /> : null))}
    />
  );
}
