import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { AdminSecretaryViewer } from "@/components/traveliun/secretary/AdminSecretaryViewer";
import { SecretaryBoardSection } from "@/components/traveliun/secretary/SecretaryBoardSection";
import { SecretaryWorkspace } from "@/components/traveliun/secretary/SecretaryWorkspace";
import { SecretaryCompare } from "@/components/traveliun/secretary/SecretaryCompare";
import { SecretaryEditRequest } from "@/components/traveliun/secretary/SecretaryEditRequest";
import { adminSecretaryEmployees } from "@/lib/secretary/chat";
import { getSecretaryBoard } from "@/lib/data/my-followups";
import { currentSecretaryEmployee } from "@/lib/secretary/core";

export default async function SecretaryPage() {
  const [employee, adminList, board] = await Promise.all([currentSecretaryEmployee(), adminSecretaryEmployees(), getSecretaryBoard()]);
  if (!employee && !adminList) redirect("/dashboard");
  const work = <>
    {board && <SecretaryBoardSection initial={board} />}
    {employee && <SecretaryCompare />}
    {employee && <SecretaryEditRequest />}
    {adminList && <AdminSecretaryViewer employees={adminList} />}
  </>;
  return <TraveliunShell title="nav.secretary">
    <div dir="rtl" className="mx-auto max-w-3xl space-y-5 text-[#185045]">
      <header>
        <h1 className="text-2xl font-extrabold">مُراد — سكرتيري الخاص</h1>
        <p className="mt-2 text-sm">أداة عملك السريعة: من ينتظرك، من الساخن، الرد الجاهز لكل عميل — ومُراد يتابع وحده ما أنجزتَه. لا يصل العميل شيء إلا بزر إرسالك أنت.</p>
      </header>
      {employee ? <SecretaryWorkspace>{work}</SecretaryWorkspace> : work}
    </div>
  </TraveliunShell>;
}
