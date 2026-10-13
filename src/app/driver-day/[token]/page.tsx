import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getDriverDay } from "@/lib/data/public-links";
import { DriverStepButtons } from "@/components/traveliun/operations/DriverStepButtons";
import type { ServiceKind } from "@/lib/operations/drivers";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const KIND: Record<ServiceKind, string> = {
  reception: "استقبال من المطار / Airport pick-up",
  farewell: "توصيل إلى المطار / Airport drop-off",
  transfer: "انتقال / Transfer",
  tour: "جولة / Tour",
};

const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/**
 * «رابط السائق» (operations order 11): one driver's pick-ups on one day — the
 * time, the flight, where to meet, the hotel with its map, how many guests —
 * and a button to say the guests are with him. No price, no passport. The
 * token is the gate (public-links.ts). Bilingual: the driver abroad may not
 * read Arabic.
 */
export default async function DriverDayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const day = await getDriverDay(token);
  if (!day) notFound();

  return (
    <main dir="rtl" className="min-h-screen bg-[#f4f8f6] px-4 py-6 text-[#0f3d38] sm:py-10">
      <div className="mx-auto w-full max-w-[640px] space-y-4">
        <header className="rounded-2xl bg-[#135549] px-5 py-5 text-white">
          <p className="text-[13px] font-bold opacity-80">ترافليون — يومك / Traveliun — your day</p>
          <h1 className="mt-1 text-[22px] font-extrabold">
            <bdi dir="ltr">{day.date}</bdi>
          </h1>
          {day.driver ? <p className="mt-1 break-words text-[13.5px] font-semibold opacity-90">{day.driver}</p> : null}
        </header>

        {day.pickups.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[#cfe0d9] bg-white px-4 py-8 text-center text-[14px] font-semibold text-[#93aaa3]">
            لا استلامات لهذا اليوم. / No pick-ups on this day.
          </p>
        ) : (
          day.pickups.map((p) => (
            <section key={p.id} className={`rounded-2xl border bg-white p-5 ${p.step === "done" ? "border-[#bfe3cf]" : "border-[#e2ebe7]"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-[12.5px] font-bold text-[#557d78]">{KIND[p.kind]}</p>
                <span className="rounded-full bg-[#eef4f1] px-3 py-1 text-[16px] font-extrabold">
                  <bdi dir="ltr">{p.time || "—"}</bdi>
                </span>
              </div>
              <p className="mt-1 break-words text-[15px] font-extrabold">
                {p.lead || p.serial} <bdi dir="ltr" className="text-[12px] font-bold text-[#93aaa3]">{p.serial}</bdi>
              </p>
              {p.kind === "tour" || p.kind === "transfer" ? <p className="mt-0.5 break-words text-[13px] font-semibold">{p.title}</p> : null}

              <dl className="mt-3 space-y-1.5 text-[13px] font-semibold">
                {p.flight ? (
                  <Line label="الرحلة / Flight">
                    <bdi dir="ltr">{p.flight}</bdi>
                    {p.landing ? (
                      <span className="ms-2 text-[#a86a10]">
                        الهبوط / Landing <bdi dir="ltr">{p.landing}</bdi>
                      </span>
                    ) : null}
                  </Line>
                ) : null}
                {p.meet ? <Line label="نقطة الالتقاء / Meeting point">{p.meet}</Line> : null}
                {p.hotel ? (
                  <Line label="الفندق / Hotel">
                    {[p.hotel.name, p.hotel.name_en].filter(Boolean).join(" — ")}{" "}
                    <a href={p.hotel.map} target="_blank" rel="noopener" className="ms-1 font-extrabold text-[#0f7a52] underline">
                      الخريطة / Map
                    </a>
                  </Line>
                ) : null}
                {p.pax ? <Line label="الضيوف / Guests">{p.pax}</Line> : null}
                {p.car || p.plate ? <Line label="السيارة / Car">{[p.car, p.plate].filter(Boolean).join(" · ")}</Line> : null}
              </dl>

              {p.step === "done" ? (
                <p className="mt-3 rounded-[12px] bg-[#e9f7f0] px-4 py-3 text-[14px] font-extrabold text-[#0f7a52]">✓ تم الاستقبال / Picked up</p>
              ) : p.step === "on_way" ? (
                <p className="mt-3 text-[12.5px] font-bold text-[#a86a10]">في الطريق / On the way</p>
              ) : null}
              <DriverStepButtons token={token} bookingId={p.id} step={p.step} />
            </section>
          ))
        )}

        {day.contact ? (
          <a
            href={tel(day.contact)}
            className="flex h-12 w-full items-center justify-center rounded-[12px] border border-[#cfe0d9] bg-white text-[14px] font-extrabold text-[#135549]"
          >
            العمليات / Operations <bdi dir="ltr" className="ms-2">{day.contact}</bdi>
          </a>
        ) : null}
      </div>
    </main>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="text-[11.5px] font-bold text-[#93aaa3]">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
