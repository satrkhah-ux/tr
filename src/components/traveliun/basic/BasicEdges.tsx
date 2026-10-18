"use client";

import { Moon, Sunrise } from "lucide-react";
import type { ArrivalEdge, DepartureEdge, DraftData } from "@/lib/offer/draft-types";

/**
 * «بكج متقدم» → the trip's two edges (the owner, 2026-10-18): a small-hours
 * flight home with no hotel that last night (a noon check-out, a tour, the car
 * until the airport), and an arrival whose hotel starts a day off — the night
 * before booked, an early check-in asked, or the first night elsewhere. The
 * question proposes itself when the ticket's hour calls for it; the nights and
 * dates follow (setEdge).
 */

const IN: { mode: ArrivalEdge | null; label: string; hint: string }[] = [
  { mode: null, label: "كالمعتاد", hint: "الدخول إلى الفندق يوم الوصول" },
  { mode: "prev_night", label: "ليلة سابقة", hint: "تُحجز الليلة قبل الوصول ليدخل الغرفة فور وصوله" },
  { mode: "early_checkin", label: "دخول مبكر", hint: "يُطلب من الفندق حسب التوفر، ويُذكر للعميل" },
  { mode: "no_hotel", label: "بدون فندق الليلة الأولى", hint: "يبيت على حسابه أو عند أقاربه، والفندق من اليوم التالي" },
];
const OUT: { mode: DepartureEdge | null; label: string; hint: string }[] = [
  { mode: null, label: "ليلة كاملة", hint: "الفندق حتى يوم المغادرة" },
  { mode: "no_hotel_day", label: "آخر يوم بدون فندق", hint: "خروج 12:00 ثم جولة، والسيارة معه بالأمتعة حتى المطار" },
  { mode: "late_checkout", label: "خروج متأخر", hint: "يُطلب من الفندق حسب التوفر" },
];

/** the hour of a «YYYY-MM-DDTHH:MM», or null */
const hourOf = (iso: string | null | undefined) => (iso && /T\d{2}:/.test(iso) ? Number(iso.slice(11, 13)) : null);

export function BasicEdges({ data, onEdge }: { data: DraftData; onEdge: (side: "in" | "out", mode: ArrivalEdge | DepartureEdge | null) => void }) {
  const first = data.cities[0];
  const last = data.cities[data.cities.length - 1];
  if (!first || !last) return null;
  const outbound = data.flights.find((f) => f.leg_order === "outbound");
  const inbound = data.flights.find((f) => f.leg_order === "inbound");
  const landH = hourOf(outbound?.arrival_at);
  const homeH = hourOf(inbound?.departure_at);
  const chip = (on: boolean) =>
    `rounded-[8px] border px-2.5 py-1.5 text-start text-[12px] font-bold ${on ? "border-[#185045] bg-[#185045] text-white" : "border-[#cfe0d9] bg-white text-[#185045] hover:bg-[#f4f8f6]"}`;

  return (
    <div className="grid gap-2 rounded-[12px] border border-[#e6efeb] p-2.5 md:grid-cols-2">
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 inline-flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#185045]">
          <Sunrise className="size-4" />
          الدخول إلى أول فندق
        </legend>
        {landH != null && landH < 6 && !first.edge_in ? (
          <p className="rounded-[8px] bg-[#fff8e8] px-2 py-1 text-[11.5px] font-bold text-[#a86a10]">
            الطائرة تهبط فجراً ({outbound?.arrival_at?.slice(11, 16)}) — هل يحتاج ليلة سابقة لضمان الدخول عند الوصول؟
          </p>
        ) : null}
        {IN.map((o) => (
          <button key={o.label} type="button" title={o.hint} onClick={() => onEdge("in", o.mode)} className={chip((first.edge_in ?? null) === o.mode)}>
            {o.label}
            <span className="block text-[10.5px] font-semibold opacity-75">{o.hint}</span>
          </button>
        ))}
      </fieldset>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 inline-flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#185045]">
          <Moon className="size-4" />
          آخر ليلة قبل الطيران
        </legend>
        {homeH != null && homeH < 6 && !last.edge_out ? (
          <p className="rounded-[8px] bg-[#fff8e8] px-2 py-1 text-[11.5px] font-bold text-[#a86a10]">
            رحلة العودة فجر {inbound?.departure_at?.slice(0, 10)} الساعة {inbound?.departure_at?.slice(11, 16)} — هل يحتاج ليلة {last.check_out ?? ""} في الفندق؟
          </p>
        ) : null}
        {OUT.map((o) => (
          <button key={o.label} type="button" title={o.hint} onClick={() => onEdge("out", o.mode)} className={chip((last.edge_out ?? null) === o.mode)}>
            {o.label}
            <span className="block text-[10.5px] font-semibold opacity-75">{o.hint}</span>
          </button>
        ))}
      </fieldset>
    </div>
  );
}
