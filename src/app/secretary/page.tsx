import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { SecretaryChat } from "@/components/traveliun/secretary/SecretaryChat";
import { currentSecretaryEmployee } from "@/lib/secretary/core";

export default async function SecretaryPage() {
  const employee = await currentSecretaryEmployee();
  if (!employee) redirect("/dashboard");
  return <TraveliunShell title="nav.secretary">
    <div dir="rtl" className="mx-auto max-w-3xl space-y-4 text-[#185045]">
      <header>
        <h1 className="text-2xl font-extrabold">سكرتيري الخاص</h1>
        <p className="mt-2 text-sm">يعرف محادثاتك وملفات متابعتك أنت فقط، ويرسل لك خطة يومك عند أول دخول. اسأله عن محادثاتك ومهامك وعملائك الساخنين.</p>
      </header>
      <div className="overflow-hidden rounded-2xl border border-[#dfe8e4] bg-[#fbfdfc]">
        <SecretaryChat tall />
      </div>
    </div>
  </TraveliunShell>;
}
