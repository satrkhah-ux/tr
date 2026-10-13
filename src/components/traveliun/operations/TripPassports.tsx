import { getClientPassports } from "@/lib/data/client-passports";
import { TripPassportUpload } from "./TripPassportUpload";

/**
 * «جوازات المسافرين» on the client's /trip link (operations order 11): each
 * traveller's passport photo, uploaded by the client and reviewed by us. Hidden
 * when the case has no travellers yet (or 0068 is not applied).
 */
export async function TripPassports({ token }: { token: string }) {
  const rows = await getClientPassports(token);
  if (!rows || rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <h2 className="text-[15px] font-extrabold">جوازات المسافرين</h2>
      <p className="mt-1 text-[12.5px] font-semibold text-[#557d78]">
        صوّر صفحة البيانات في جواز كل مسافر كاملة وواضحة (صورة أو PDF، حتى 8 ميجابايت) — نراجعها ونكمل بها حجوزاتكم.
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <TripPassportUpload key={r.id} token={token} travelerId={r.id} label={r.label} state={r.state} />
        ))}
      </ul>
    </section>
  );
}
