import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { SupervisionBoard } from "@/components/traveliun/followups/SupervisionBoard";
import { SupervisionReport } from "@/components/traveliun/followups/SupervisionReport";
import { SupervisionSetup } from "@/components/traveliun/followups/SupervisionSetup";
import { getSupervisionBoard, getSupervisionReport, listSupervisors } from "@/lib/followups/supervision/actions";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/** «إشراف المتابعة» (the owner, 2026-10-29): inside «المتابعة» — the cases, the reports, and (the management) who supervises and when. */
export default async function FollowupSupervisionPage() {
  await guardPath("/followups/supervision");
  const [board, report, setup] = await Promise.all([getSupervisionBoard(), getSupervisionReport(30), listSupervisors()]);
  if (!board) redirect("/dashboard");
  return <TraveliunShell title="nav.followupSupervision">
    <div dir="rtl" className="space-y-6 text-[#185045]">
      <header>
        <h1 className="text-2xl font-extrabold">إشراف المتابعة</h1>
        <p className="mt-1 text-sm">الحالات المتأخرة من «المتابعة» نفسها: تصل للموظف أولاً، ثم لمشرفه، ثم للإدارة — بأوقات الدوام فقط. تُغلق الحالة بفعل حقيقي: رسالة أُرسلت، مكالمة وُثّقت بنتيجتها، إعادة إسناد، أو رد العميل.</p>
      </header>
      <SupervisionBoard initial={board} />
      {report && <SupervisionReport initial={report} />}
      {setup && <SupervisionSetup initial={setup} />}
    </div>
  </TraveliunShell>;
}
