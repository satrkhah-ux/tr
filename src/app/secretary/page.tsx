import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { AdminSecretaryViewer } from "@/components/traveliun/secretary/AdminSecretaryViewer";
import { SecretaryChat } from "@/components/traveliun/secretary/SecretaryChat";
import { adminSecretaryEmployees } from "@/lib/secretary/chat";
import { currentSecretaryEmployee } from "@/lib/secretary/core";

export default async function SecretaryPage() {
  const [employee, adminList] = await Promise.all([currentSecretaryEmployee(), adminSecretaryEmployees()]);
  if (!employee && !adminList) redirect("/dashboard");
  return <TraveliunShell title="nav.secretary">
    <div dir="rtl" className="mx-auto max-w-3xl space-y-4 text-[#185045]">
      <header>
        <h1 className="text-2xl font-extrabold">سكرتيري الخاص</h1>
        <p className="mt-2 text-sm">يعرف محادثاتك وملفات متابعتك أنت فقط، ويرسل لك خطة يومك عند أول دخول. اسأله عن محادثاتك ومهامك وعملائك الساخنين.</p>
      </header>
      {/* «مشاهدة الإدارة»: hidden under view-as-an-employee, because the admin then holds that role's permissions */}
      {adminList && <AdminSecretaryViewer employees={adminList} />}
      {employee && <div className="overflow-hidden rounded-2xl border border-[#dfe8e4] bg-[#fbfdfc]">
        <SecretaryChat tall />
      </div>}
    </div>
  </TraveliunShell>;
}
