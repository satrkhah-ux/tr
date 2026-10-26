import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { AdminSecretaryViewer } from "@/components/traveliun/secretary/AdminSecretaryViewer";
import { SecretaryBoardSection } from "@/components/traveliun/secretary/SecretaryBoardSection";
import { SecretaryChat } from "@/components/traveliun/secretary/SecretaryChat";
import { SecretaryCompare } from "@/components/traveliun/secretary/SecretaryCompare";
import { SecretaryEditRequest } from "@/components/traveliun/secretary/SecretaryEditRequest";
import { adminSecretaryEmployees } from "@/lib/secretary/chat";
import { getSecretaryBoard } from "@/lib/data/my-followups";
import { currentSecretaryEmployee } from "@/lib/secretary/core";

export default async function SecretaryPage() {
  const [employee, adminList, board] = await Promise.all([currentSecretaryEmployee(), adminSecretaryEmployees(), getSecretaryBoard()]);
  if (!employee && !adminList) redirect("/dashboard");
  return <TraveliunShell title="nav.secretary">
    <div dir="rtl" className="mx-auto max-w-3xl space-y-5 text-[#185045]">
      <header>
        <h1 className="text-2xl font-extrabold">مُراد — سكرتيري الخاص</h1>
        <p className="mt-2 text-sm">أداة عملك السريعة: من ينتظرك، من الساخن، الرد الجاهز لكل عميل — ومُراد يتابع وحده ما أنجزتَه. لا يصل العميل شيء إلا بزر إرسالك أنت.</p>
      </header>
      {/* the work screen first (the owner, 2026-10-26: «ليست رسالة للقراءة وإنما أداة للوصول السريع») */}
      {board && <SecretaryBoardSection initial={board} />}
      {employee && <SecretaryCompare />}
      {employee && <SecretaryEditRequest />}
      {/* the administration also reads any employee's secretary THREAD (their chat and plans) */}
      {adminList && <AdminSecretaryViewer employees={adminList} />}
      {employee && <div className="overflow-hidden rounded-2xl border border-[#dfe8e4] bg-[#fbfdfc]">
        <SecretaryChat tall />
      </div>}
    </div>
  </TraveliunShell>;
}
