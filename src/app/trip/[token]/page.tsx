import type { CSSProperties, ReactNode } from "react";
import { notFound } from "next/navigation";
import { getClientHub } from "@/lib/data/operation-hub";
import { getClientTrip, type TripFlight } from "@/lib/data/client-trip";
import { DOCUMENT_LABEL } from "@/lib/operations/voucher-dto";
import { TripReceipts } from "@/components/traveliun/operations/TripReceipts";
import { getTripGuide } from "@/lib/data/destination-guides";
import { waNumber, type ClientService, type ServiceKind } from "@/lib/operations/drivers";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const DOC_LABEL: Record<string, string> = DOCUMENT_LABEL;

const SERVICE_LABEL: Record<ServiceKind, string> = {
  reception: "استقبال من المطار",
  farewell: "توصيل إلى المطار",
  transfer: "انتقال",
  tour: "جولة",
};

/** «الجمعة 20 نوفمبر» — a traveller reads days, not ISO dates. */
function dayLabel(date: string | null): string {
  if (!date) return "يُحدَّد لاحقاً";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/**
 * The client's trip page — made for a phone in a hand at an airport, not a
 * folder of PDFs: the trip at a glance, today's driver, the flights, the
 * stays, the programme day by day, who to call, what is left to pay — and the
 * documents last.
 *
 * Carries no cost, no supplier, no internal note and no passport data (see
 * getClientTrip): a client forwards this to their family, and everything on it
 * has to survive that. A partner's client sees the partner's name and colour.
 */
export default async function TripHubPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [hub, trip, guide] = await Promise.all([getClientHub(token), getClientTrip(token), getTripGuide(token)]);
  if (!hub || !trip) notFound();

  // a partner's colour when it is their client — a validated hex from brandVars, else ours
  const accent = { "--trip": hub.brand.color ?? "#135549" } as CSSProperties;
  const whatsapp = waNumber(hub.brand.whatsapp || hub.brand.phone);
  const say = (text: string) => `https://wa.me/${whatsapp}?text=${encodeURIComponent(text)}`;
  const emergency = trip.info.emergency_phone || hub.brand.phone;

  const todays = trip.services.filter((s) => s.date === trip.today);
  const dated = new Set(trip.days.map((d) => d.date).filter(Boolean));
  const loose = trip.services.filter((s) => !s.date || !dated.has(s.date));
  // flights, stays and drives carry their own status above; the rest still being worked on
  const pending = hub.pending.filter((p) => p.kind === "visa" || (p.kind === "service" && !p.title.startsWith("جولة")));

  return (
    <main dir="rtl" style={accent} className="min-h-screen bg-[#f4f8f6] px-4 py-6 text-[#0f3d38] sm:py-10">
      <div className="mx-auto w-full max-w-[680px] space-y-4">
        <header className="rounded-2xl bg-[var(--trip)] px-5 py-6 text-white shadow-[0_10px_30px_rgba(19,85,73,0.25)] sm:px-6">
          <p className="text-[13px] font-bold opacity-80">{hub.brand.name}</p>
          <h1 className="mt-1 break-words text-[24px] font-extrabold">{hub.destination || "رحلتك"}</h1>
          <p className="mt-2 break-words text-[13.5px] font-semibold opacity-90">
            {hub.customer_name ? `${hub.customer_name} · ` : ""}
            <bdi dir="ltr">{hub.serial}</bdi>
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[12.5px] font-bold">
            {hub.travel_start ? (
              <span className="rounded-full bg-white/15 px-3 py-1">
                {dayLabel(hub.travel_start)} ← {dayLabel(hub.travel_end)}
              </span>
            ) : null}
            {trip.travellers > 0 ? <span className="rounded-full bg-white/15 px-3 py-1">المسافرون: {trip.travellers}</span> : null}
          </div>
        </header>

        {todays.length > 0 ? (
          <Card title="اليوم" tone="accent">
            <ul className="space-y-2">
              {todays.map((s, i) => (
                <ServiceItem key={i} s={s} today={trip.today} />
              ))}
            </ul>
          </Card>
        ) : null}

        {trip.flights.length > 0 ? (
          <Card title="الرحلات">
            <ul className="space-y-3">
              {trip.flights.map((f, i) => (
                <FlightItem key={i} f={f} />
              ))}
            </ul>
          </Card>
        ) : null}

        {trip.hotels.length > 0 ? (
          <Card title="الفنادق">
            <ul className="space-y-2.5">
              {trip.hotels.map((h, i) => (
                <li key={i} className="rounded-[12px] border border-[#e2ebe7] p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-[14px] font-extrabold">
                      {h.name}
                      {h.city ? <span className="font-semibold text-[#557d78]"> — {h.city}</span> : null}
                    </p>
                    <Status confirmed={h.confirmed} />
                  </div>
                  <p className="mt-1 text-[12.5px] font-semibold text-[#557d78]">
                    {dayLabel(h.check_in)} ← {dayLabel(h.check_out)}
                    {h.nights ? ` · عدد الليالي ${h.nights}` : ""}
                  </p>
                  {h.rooms.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5 text-[12.5px] font-semibold text-[#0f3d38]">
                      {h.rooms.map((r) => (
                        <li key={r} className="break-words">
                          {r}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {h.confirmation ? (
                    <p className="mt-1.5 text-[12px] font-bold text-[#0f7a52]">
                      رقم التأكيد <bdi dir="ltr">{h.confirmation}</bdi>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {trip.days.length > 0 || loose.length > 0 ? (
          <Card title="البرنامج يوماً بيوم">
            <ol className="space-y-3">
              {trip.days.map((d) => {
                const drives = trip.services.filter((s) => s.date && s.date === d.date);
                return (
                  <li key={d.day_number} className="rounded-[12px] border border-[#e2ebe7] p-3.5">
                    <p className="text-[12px] font-bold text-[#93aaa3]">
                      اليوم {d.day_number} · {dayLabel(d.date)}
                      {d.city ? ` · ${d.city}` : ""}
                    </p>
                    {d.title ? <p className="mt-0.5 break-words text-[14px] font-extrabold">{d.title}</p> : null}
                    {d.activities.length > 0 ? (
                      <ul className="mt-1.5 list-disc space-y-0.5 ps-5 text-[12.5px] font-semibold text-[#334f4b]">
                        {d.activities.map((a, i) => (
                          <li key={i} className="break-words">
                            {a}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {d.note ? <p className="mt-1.5 break-words text-[12px] font-semibold text-[#557d78]">{d.note}</p> : null}
                    {drives.length > 0 ? (
                      <ul className="mt-2.5 space-y-2">
                        {drives.map((s, i) => (
                          <ServiceItem key={i} s={s} today={trip.today} />
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            {loose.length > 0 ? (
              <>
                {trip.days.length > 0 ? <h3 className="mt-4 text-[13px] font-extrabold">التنقلات والجولات</h3> : null}
                <ul className="mt-2 space-y-2">
                  {loose.map((s, i) => (
                    <ServiceItem key={i} s={s} today={trip.today} withDate />
                  ))}
                </ul>
              </>
            ) : null}
          </Card>
        ) : null}

        <Card title="للتواصل والطوارئ">
          <div className="space-y-2">
            {emergency ? (
              <Row label="رقم الطوارئ">
                <a href={tel(emergency)} className="font-extrabold text-[#0f7a52] underline-offset-2 hover:underline">
                  <bdi dir="ltr">{emergency}</bdi>
                </a>
              </Row>
            ) : null}
            {trip.info.agent_name || trip.info.agent_phone ? (
              <Row label="الوكيل المحلي">
                <span className="break-words">{trip.info.agent_name}</span>
                {trip.info.agent_phone ? (
                  <a href={tel(trip.info.agent_phone)} className="ms-2 font-extrabold text-[#0f7a52]">
                    <bdi dir="ltr">{trip.info.agent_phone}</bdi>
                  </a>
                ) : null}
              </Row>
            ) : null}
          </div>
          {whatsapp ? (
            <a
              href={say(`مرحباً، بخصوص رحلتي — الملف ${hub.serial}`)}
              target="_blank"
              rel="noopener"
              className="mt-3 flex h-12 w-full items-center justify-center rounded-[12px] bg-[#1f9d57] text-[14px] font-extrabold text-white"
            >
              تواصل معنا عبر واتساب
            </a>
          ) : null}
        </Card>

        {guide ? (
          <Card title={`دليل الطوارئ — ${guide.country}`}>
            <div className="space-y-1.5">
              {guide.local_agent_name || guide.local_agent_phone ? (
                <Row label="الوكيل المحلي">
                  {guide.local_agent_name}
                  {guide.local_agent_phone ? (
                    <a href={tel(guide.local_agent_phone)} className="ms-2 font-extrabold text-[#0f7a52]">
                      <bdi dir="ltr">{guide.local_agent_phone}</bdi>
                    </a>
                  ) : null}
                </Row>
              ) : null}
              {guide.ambulance ? (
                <Row label="الإسعاف">
                  <a href={tel(guide.ambulance)} className="font-extrabold text-[#c22850]"><bdi dir="ltr">{guide.ambulance}</bdi></a>
                </Row>
              ) : null}
              {guide.police ? (
                <Row label="الشرطة">
                  <a href={tel(guide.police)} className="font-extrabold"><bdi dir="ltr">{guide.police}</bdi></a>
                </Row>
              ) : null}
              {guide.embassy_phone ? (
                <Row label="السفارة">
                  <a href={tel(guide.embassy_phone)} className="font-extrabold"><bdi dir="ltr">{guide.embassy_phone}</bdi></a>
                </Row>
              ) : null}
              {guide.hospital ? <Row label="مستشفى">{guide.hospital}</Row> : null}
              {guide.notes ? <p className="whitespace-pre-line break-words text-[12.5px] font-semibold text-[#557d78]">{guide.notes}</p> : null}
            </div>
          </Card>
        ) : null}

        {trip.money ? (
          <Card title="الرصيد والدفع">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Money label="الإجمالي" value={trip.money.total} currency={trip.money.currency} />
              <Money label="المدفوع" value={trip.money.paid} currency={trip.money.currency} />
              <Money label="المتبقي" value={trip.money.remaining} currency={trip.money.currency} strong={trip.money.remaining > 0} />
            </div>
            {trip.money.remaining > 0 ? (
              <>
                <p className="mt-3 whitespace-pre-line break-words text-[13px] font-semibold text-[#334f4b]">
                  {trip.info.pay_note || "للسداد تواصل معنا عبر واتساب، وسنرسل لك طريقة الدفع المناسبة."}
                </p>
                {whatsapp ? (
                  <a
                    href={say(`مرحباً، أرغب في سداد المتبقي لرحلتي — الملف ${hub.serial}`)}
                    target="_blank"
                    rel="noopener"
                    className="mt-3 flex h-11 w-full items-center justify-center rounded-[12px] bg-[var(--trip)] text-[13.5px] font-extrabold text-white"
                  >
                    سداد المتبقي
                  </a>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-[13px] font-bold text-[#0f7a52]">تم السداد بالكامل — شكراً لك.</p>
            )}
          </Card>
        ) : null}

        {pending.length > 0 ? (
          <section className="rounded-2xl border border-[#f2e2b4] bg-[#fff8e8] p-5">
            <h2 className="text-[14px] font-extrabold text-[#a86a10]">قيد الإنجاز</h2>
            <ul className="mt-2 space-y-1.5">
              {pending.map((p, i) => (
                <li key={i} className="break-words text-[13px] font-bold text-[#8a5a0c]">
                  {p.title}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Card title="مستنداتك">
          {hub.documents.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-[13.5px] text-[#93aaa3]">
              لم تصدر المستندات بعد. ستظهر هنا فور إصدارها — احتفظ بهذا الرابط.
            </p>
          ) : (
            <ul className="space-y-2">
              {hub.documents.map((d) => (
                <li key={d.token}>
                  <a
                    href={`/voucher/${d.token}/pdf`}
                    target="_blank"
                    rel="noopener"
                    className="flex items-center justify-between gap-3 rounded-[12px] border border-[#e2ebe7] px-4 py-3.5 transition-colors hover:bg-[#f4f8f6]"
                  >
                    <span className="min-w-0">
                      <span className="block text-[14px] font-extrabold">{DOC_LABEL[d.kind] ?? d.kind}</span>
                      <span className="mt-0.5 block text-[11.5px] font-semibold text-[#93aaa3]">
                        <bdi dir="ltr">{d.issued_at}</bdi>
                      </span>
                    </span>
                    <span className="shrink-0 rounded-[9px] bg-[var(--trip)] px-3.5 py-2 text-[12.5px] font-bold text-white">فتح PDF</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <TripReceipts token={token} />

        {/* back home: one tap to tell us how it went (operations order 6) */}
        {hub.travel_end && hub.travel_end < trip.today ? (
          <a
            href={`/trip/${token}/rate`}
            className="flex h-12 w-full items-center justify-center rounded-[12px] border-2 border-[var(--trip)] bg-white text-[14px] font-extrabold text-[var(--trip)]"
          >
            ★ قيّموا رحلتكم
          </a>
        ) : null}

        <footer className="pb-4 text-center text-[12px] font-semibold text-[#93aaa3]">
          {hub.brand.name}
          {hub.brand.phone ? <> · <bdi dir="ltr">{hub.brand.phone}</bdi></> : null}
          {hub.brand.website ? <> · <bdi dir="ltr">{hub.brand.website}</bdi></> : null}
        </footer>
      </div>
    </main>
  );
}

function Card({ title, tone, children }: { title: string; tone?: "accent"; children: ReactNode }) {
  return (
    <section
      className={`rounded-2xl border bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)] ${
        tone === "accent" ? "border-[var(--trip)]" : "border-[#e2ebe7]"
      }`}
    >
      <h2 className="mb-3 text-[15px] font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline justify-between gap-2 text-[13.5px] font-bold">
      <span className="text-[#557d78]">{label}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function Status({ confirmed }: { confirmed: boolean }) {
  return confirmed ? (
    <span className="shrink-0 rounded-full bg-[#e9f7f0] px-2.5 py-0.5 text-[11.5px] font-bold text-[#0f7a52]">مؤكد</span>
  ) : (
    <span className="shrink-0 rounded-full bg-[#fff8e8] px-2.5 py-0.5 text-[11.5px] font-bold text-[#a86a10]">قيد التأكيد</span>
  );
}

function Money({ label, value, currency, strong }: { label: string; value: number; currency: string; strong?: boolean }) {
  return (
    <div className={`rounded-[11px] px-2 py-2.5 ${strong ? "bg-[#fff8e8] text-[#a86a10]" : "bg-[#f4f8f6]"}`}>
      <p className="text-[11px] font-bold opacity-70">{label}</p>
      <p className="mt-0.5 break-words text-[14.5px] font-extrabold">
        <bdi dir="ltr">{`${value.toLocaleString("en-US")} ${currency}`}</bdi>
      </p>
    </div>
  );
}

function FlightItem({ f }: { f: TripFlight }) {
  return (
    <li className="rounded-[12px] border border-[#e2ebe7] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words text-[13.5px] font-extrabold">{f.title}</p>
        <Status confirmed={f.confirmed} />
      </div>
      <ul className="mt-2 space-y-2">
        {f.legs.map((l, i) => (
          <li key={i} className="rounded-[10px] bg-[#f4f8f6] px-3 py-2.5">
            <p className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] font-bold">
              <span className="text-[#557d78]">{l.label}</span>
              <bdi dir="ltr" className="font-extrabold">
                {`${l.flight_no || "—"} · ${l.from} → ${l.to}`}
              </bdi>
            </p>
            <p className="mt-1 text-[12.5px] font-semibold text-[#334f4b]">
              {l.departure ? (
                <>
                  الإقلاع {dayLabel(l.departure.slice(0, 10))} <bdi dir="ltr">{l.departure.slice(11, 16)}</bdi>
                  {l.arrival ? (
                    <>
                      {" "}
                      · الوصول <bdi dir="ltr">{l.arrival.slice(11, 16)}</bdi>
                      {l.arrival.slice(0, 10) !== l.departure.slice(0, 10) ? ` (${dayLabel(l.arrival.slice(0, 10))})` : ""}
                    </>
                  ) : null}
                </>
              ) : (
                "الموعد يُحدَّد لاحقاً"
              )}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex flex-wrap gap-x-3 text-[12px] font-bold text-[#557d78]">
        {f.cabin ? <span>الدرجة: {f.cabin}</span> : null}
        {f.pnr ? (
          <span className="text-[#0f7a52]">
            رقم الحجز <bdi dir="ltr">{f.pnr}</bdi>
          </span>
        ) : null}
      </p>
    </li>
  );
}

function ServiceItem({ s, today, withDate }: { s: ClientService; today: string; withDate?: boolean }) {
  return (
    <li className="rounded-[11px] border border-[#e2ebe7] bg-[#fbfdfc] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words text-[13px] font-extrabold">
          {SERVICE_LABEL[s.kind]}
          {s.kind === "tour" || s.kind === "transfer" ? <span className="font-semibold text-[#557d78]"> — {s.title.replace(/^جولة:\s*/, "")}</span> : null}
        </p>
        <span className="shrink-0 rounded-full bg-[#eef4f1] px-2.5 py-0.5 text-[12px] font-extrabold">
          {withDate ? `${dayLabel(s.date)} · ` : ""}
          <bdi dir="ltr">{s.time || "يُحدَّد لاحقاً"}</bdi>
        </span>
      </div>
      <div className="mt-1 space-y-0.5 text-[12.5px] font-semibold text-[#334f4b]">
        {s.meet ? <p className="break-words">نقطة الالتقاء: {s.meet}</p> : null}
        {s.flight ? (
          <p>
            الرحلة: <bdi dir="ltr">{s.flight}</bdi>
          </p>
        ) : null}
        {s.car ? <p className="break-words">السيارة: {s.car}</p> : null}
        {s.program ? <p className="break-words text-[#557d78]">{s.program}</p> : null}
      </div>
      {s.progress ? (
        <p className={`mt-1.5 text-[12.5px] font-extrabold ${s.progress === "done" ? "text-[#0f7a52]" : "text-[#a86a10]"}`}>
          {s.progress === "done" ? "✓ تم الاستقبال" : "السائق في الطريق"}
        </p>
      ) : null}
      {s.driver ? (
        <div className="mt-2 rounded-[10px] bg-[var(--trip)] px-3 py-2.5 text-white">
          <p className="text-[11.5px] font-bold opacity-80">سائقك اليوم</p>
          <p className="mt-0.5 break-words text-[14px] font-extrabold">
            {s.driver.name || "السائق"}
            {s.driver.plate ? (
              <span className="ms-2 text-[12.5px] font-bold opacity-90">
                اللوحة <bdi dir="ltr">{s.driver.plate}</bdi>
              </span>
            ) : null}
          </p>
          {s.driver.phone ? (
            <a href={tel(s.driver.phone)} className="mt-1.5 inline-flex rounded-[9px] bg-white/20 px-3 py-1.5 text-[13px] font-extrabold">
              اتصل بالسائق <bdi dir="ltr" className="ms-1.5">{s.driver.phone}</bdi>
            </a>
          ) : null}
        </div>
      ) : s.date && s.date > today ? (
        <p className="mt-1.5 text-[11.5px] font-semibold text-[#93aaa3]">تظهر بيانات السائق هنا يوم الخدمة.</p>
      ) : null}
    </li>
  );
}
