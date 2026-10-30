"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CalendarDays, Copy, Printer } from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import type { ScheduleRow } from "@/lib/data/operation-drivers";
import type { TranslationKey } from "@/lib/i18n";
import { DriverSend } from "./DriversPanel";
import { OpsLinkButton } from "./OpsLinkButton";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";

const field =
  "tv-field h-10 rounded-[10px] border px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus";

/**
 * «جدول السائقين» — every drive and tour of every case on one day, per city:
 * the sheet the local agent dispatches cars from. Printed (only the sheet —
 * the app's chrome stays off the paper) or copied as text into a WhatsApp chat.
 */
export function DriverSchedule({ date, city: initialCity, rows }: { date: string; city: string; rows: ScheduleRow[] }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [city, setCity] = useState(initialCity);
  const [copied, setCopied] = useState(false);

  const cities = useMemo(() => [...new Set(rows.map((r) => r.city).filter(Boolean))].sort(), [rows]);
  const shown = rows.filter((r) => !city || r.city === city);
  const groups = [...new Set(shown.map((r) => r.city))].map((c) => ({ city: c, rows: shown.filter((r) => r.city === c) }));
  const kindLabel = (k: ScheduleRow["kind"]) => t(`ops.drv.kind.${k}` as TranslationKey);

  function copy() {
    const text = [
      `${t("ops.drv.schedule")} — ${date}${city ? ` — ${city}` : ""}`,
      ...groups.flatMap((g) => [
        "",
        g.city ? `• ${g.city}` : "•",
        ...g.rows.map((r) =>
          [
            r.time || "—",
            kindLabel(r.kind),
            `${r.serial} ${r.customer ?? ""}`.trim(),
            r.pax ? `${t("ops.drv.pax")} ${r.pax}` : "",
            r.flight,
            r.meet,
            [r.driver, r.phone].filter(Boolean).join(" "),
            [r.car, r.plate].filter(Boolean).join(" "),
          ]
            .filter(Boolean)
            .join(" | "),
        ),
      ]),
    ].join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <TraveliunShell title="nav.operations">
      {/* on paper: the sheet alone */}
      <style>{`@media print { body * { visibility: hidden !important; } .drv-sheet, .drv-sheet * { visibility: visible !important; } .drv-sheet { position: absolute; inset: 0; padding: 10mm; } .drv-noprint { display: none !important; } }`}</style>
      <div className="tv-fade-up space-y-4">
        <section className="drv-noprint rounded-2xl border border-[#e2ebe7] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="flex items-center gap-2 text-lg font-extrabold text-[#003c3a]">
              <CalendarDays className="size-5" />
              {t("ops.drv.schedule")}
            </h1>
            <Link href="/operations" className="text-[12.5px] font-bold text-[#557d78] hover:underline">
              {t("ops.backToBoard")}
            </Link>
          </div>
          <p className="mt-1 text-[12.5px] font-semibold text-tv-text-faint">{t("ops.drv.scheduleHint")}</p>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="grid gap-1.5 text-[11.5px] font-bold text-[#185045]">
              {t("ops.drv.date")}
              <input
                type="date"
                dir="ltr"
                value={date}
                onChange={(e) => e.target.value && router.push(`/operations/drivers?date=${e.target.value}${city ? `&city=${encodeURIComponent(city)}` : ""}`)}
                className={`${field} tv-tnum`}
              />
            </label>
            <label className="grid gap-1.5 text-[11.5px] font-bold text-[#185045]">
              {t("ops.drv.city")}
              <select value={city} onChange={(e) => setCity(e.target.value)} className={field}>
                <option value="">{t("ops.drv.allCities")}</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <div className="ms-auto flex gap-2">
              <button
                type="button"
                onClick={copy}
                disabled={shown.length === 0}
                className="tv-btn-secondary inline-flex h-10 items-center gap-1.5 rounded-[10px] border px-3 text-[12.5px] font-bold disabled:opacity-50"
              >
                <Copy className="size-4" />
                {copied ? t("copied") : t("ops.drv.copy")}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={shown.length === 0}
                className="tv-btn-primary inline-flex h-10 items-center gap-1.5 rounded-[10px] px-3.5 text-[12.5px] font-bold disabled:opacity-50"
              >
                <Printer className="size-4" />
                {t("ops.drv.print")}
              </button>
            </div>
          </div>
        </section>

        {shown.length === 0 ? (
          <section className="rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
            <EmptyState icon={CalendarDays} title={t("ops.drv.empty")} description="" />
          </section>
        ) : (
          <div className="drv-sheet space-y-4">
            <p className="hidden text-[15px] font-extrabold text-black print:block">
              {t("ops.drv.schedule")} — <DirText dir="ltr">{date}</DirText>
              {city ? ` — ${city}` : ""}
            </p>
            {groups.map((g) => (
              <section key={g.city} className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)] print:rounded-none print:border-black print:shadow-none">
                <h2 className="mb-2 text-[14px] font-extrabold text-[#185045]">
                  {g.city || "—"} <span className="tv-tnum text-[12px] text-tv-text-faint">({g.rows.length})</span>
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-start text-[12px]">
                    <thead>
                      <tr className="border-b border-[#e2ebe7] text-[11px] font-bold text-tv-text-faint">
                        <th className="px-2 py-1.5 text-start">{t("ops.drv.time")}</th>
                        <th className="px-2 py-1.5 text-start">{t("ops.drv.case")}</th>
                        <th className="px-2 py-1.5 text-start">{t("ops.drv.pax")}</th>
                        <th className="px-2 py-1.5 text-start">{t("ops.drv.flight")}</th>
                        <th className="px-2 py-1.5 text-start">{t("ops.drv.meet")}</th>
                        <th className="px-2 py-1.5 text-start">{t("ops.drv.driver")}</th>
                        <th className="px-2 py-1.5 text-start">{t("ops.drv.car")}</th>
                        <th className="drv-noprint px-2 py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.id} className="border-b border-[#f0f4f2] align-top font-semibold text-[#0f3d38]">
                          <td className="tv-tnum px-2 py-2 font-extrabold">
                            <DirText dir="ltr">{r.time || "—"}</DirText>
                            <span className="block text-[10.5px] font-bold text-[#557d78]">{kindLabel(r.kind)}</span>
                          </td>
                          <td className="px-2 py-2">
                            <Link href={`/operations/${r.operation_id}`} className="font-extrabold hover:underline">
                              <DirText dir="ltr">{r.serial}</DirText>
                            </Link>
                            <span className="block">{r.customer ?? "—"}</span>
                            {r.kind === "tour" || r.kind === "transfer" ? <span className="block text-[10.5px] text-[#557d78]">{r.title}</span> : null}
                            {!r.confirmed ? <span className="block text-[10.5px] font-bold text-[#a86a10]">{t("ops.drv.unconfirmed")}</span> : null}
                          </td>
                          <td className="tv-tnum px-2 py-2">{r.pax || "—"}</td>
                          <td className="px-2 py-2">{r.flight ? <DirText dir="ltr">{r.flight}</DirText> : "—"}</td>
                          <td className="px-2 py-2">{r.meet || "—"}</td>
                          <td className="px-2 py-2">
                            {r.driver || <span className="text-[#a86a10]">{t("ops.drv.noDriver")}</span>}
                            {r.phone ? (
                              <span className="tv-tnum block text-[11px]">
                                <DirText dir="ltr">{r.phone}</DirText>
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-2">{[r.car, r.plate].filter(Boolean).join(" · ") || "—"}</td>
                          <td className="drv-noprint px-2 py-2">
                            <div className="flex max-w-[360px] flex-wrap gap-1.5">
                              <DriverSend bookingId={r.id} />
                              {r.phone ? <OpsLinkButton kind="driver" bookingId={r.id} /> : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </TraveliunShell>
  );
}
