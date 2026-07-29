"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Hourglass,
  Plane,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import type { OpsSummary } from "@/lib/data/operations-work";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * Operations, on the dashboard.
 *
 * This is the panel that decides whether the ops section is a screen someone
 * remembers to open, or the first thing they see. It shows only what carries an
 * action: how many cases are shouting, what is still unconfirmed, what money has
 * not arrived — and then names the few worst cases with a direct link into each.
 *
 * Every number arrives already derived from the server (one clock, four queries),
 * so this component only formats.
 */

const SIGNAL_KEY = (c: string) => `ops.signal.${c}` as TranslationKey;
const EXEC_KEY = (s: string) => `ops.exec.${s}` as TranslationKey;

const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function OperationsSnapshot({ summary }: { summary: OpsSummary }) {
  const { t } = useTraveliunUI();

  // No permission → the panel does not exist. The server already withheld the
  // numbers; this keeps the space from being taken by an empty box.
  if (!summary.ok) return null;

  const top = summary.outstanding[0] ?? null;

  const tiles: { key: string; label: TranslationKey; value: string; detail?: string; icon: LucideIcon; color: string; loud?: boolean }[] = [
    {
      key: "needsAction",
      label: "ops.needsAction",
      value: String(summary.needsAction),
      detail: summary.critical > 0 ? t("dash.ops.criticalN", { n: String(summary.critical) }) : undefined,
      icon: AlertTriangle,
      color: summary.critical > 0 ? "#c22850" : summary.needsAction > 0 ? "#d99a00" : "#0f7a52",
      loud: summary.critical > 0,
    },
    { key: "openBookings", label: "dash.ops.openBookings", value: String(summary.openBookings), icon: Hourglass, color: "#0e9bb5" },
    { key: "vouchersPending", label: "dash.ops.vouchersPending", value: String(summary.vouchersPending), icon: FileText, color: "#8b5cf6" },
    { key: "travelSoon", label: "dash.ops.travelSoon", value: String(summary.travelSoon), icon: Plane, color: "#d99a00" },
    {
      key: "outstanding",
      label: "dash.ops.outstanding",
      value: top ? `${money.format(top.amount)} ${top.currency}` : "0",
      detail: summary.outstanding.length > 1 ? t("dash.ops.moreCurrencies", { n: String(summary.outstanding.length - 1) }) : undefined,
      icon: Wallet,
      color: top ? "#a86a10" : "#0f7a52",
    },
    { key: "liveCases", label: "dash.ops.liveCases", value: String(summary.liveCases), icon: ClipboardCheck, color: "#185045" },
  ];

  return (
    <section className="rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-[#003c3a]">
            <ClipboardCheck className="size-[19px] text-[#185045]" />
            {t("dash.ops.title")}
          </h2>
          <p className="mt-1 text-[11.5px] font-semibold text-[#93aaa3]">{t("dash.ops.hint")}</p>
        </div>
        <Link
          href="/operations"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white transition-colors hover:bg-[#0f4439]"
        >
          {t("dash.ops.openBoard")}
        </Link>
      </div>

      {summary.liveCases === 0 ? (
        <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-5 text-center text-[13px] text-[#93aaa3]">
          {t("ops.noOperationsHint")}
        </p>
      ) : (
        <>
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]">
            {tiles.map((tile) => (
              <div
                key={tile.key}
                className={`rounded-[13px] border bg-white p-3.5 ${tile.loud ? "border-[#f0c7c7] bg-[#fdf6f7]" : "border-[#e8efeb]"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11.5px] font-bold leading-tight text-[#6f8f88]">{t(tile.label)}</p>
                  <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px]" style={{ color: tile.color, background: `${tile.color}1a` }}>
                    <tile.icon className="size-4" />
                  </span>
                </div>
                <p className="tv-tnum mt-2 text-[21px] font-extrabold leading-none text-[#003c3a]">
                  <DirText dir="ltr">{tile.value}</DirText>
                </p>
                {tile.detail ? <p className="mt-1 text-[11px] font-bold text-[#c22850]">{tile.detail}</p> : null}
              </div>
            ))}
          </div>

          {summary.urgent.length === 0 ? (
            <p className="mt-4 flex items-center justify-center gap-2 rounded-[10px] border border-[#bfe5d4] bg-[#e9f7f0] px-4 py-3 text-[13px] font-bold text-[#0f7a52]">
              <CheckCircle2 className="size-4" />
              {t("ops.allClear")}
            </p>
          ) : (
            <div className="mt-4">
              <h3 className="mb-2 text-[12.5px] font-extrabold text-[#185045]">{t("dash.ops.urgent")}</h3>
              <ul className="space-y-1.5">
                {summary.urgent.map((c) => {
                  const worst = c.signals[0];
                  const critical = c.signals.some((s) => s.severity === "critical");
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/operations/${c.id}`}
                        className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[11px] border px-3.5 py-2.5 transition-colors hover:bg-[#f8fbfa] ${
                          critical ? "border-[#f0c7c7]" : "border-[#f2e2b4]"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-extrabold text-[#003c3a]">{c.customer_name || "—"}</span>
                          <span className="tv-tnum mt-0.5 block truncate text-[11px] font-bold text-[#93aaa3]">
                            <DirText dir="ltr">{c.serial}</DirText>
                            {c.destination ? <span className="ms-2 font-semibold">{c.destination}</span> : null}
                          </span>
                        </span>

                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            critical ? "bg-[#fdeef2] text-[#c22850]" : "bg-[#fff8e8] text-[#a86a10]"
                          }`}
                        >
                          <AlertTriangle className="size-3" />
                          {worst ? t(SIGNAL_KEY(worst.code)) : ""}
                          {c.signals.length > 1 ? (
                            <span className="tv-tnum opacity-70">
                              <DirText dir="ltr">{`+${c.signals.length - 1}`}</DirText>
                            </span>
                          ) : null}
                        </span>

                        <span className="inline-flex items-center gap-1 rounded-full bg-[#eef4f1] px-2.5 py-1 text-[11px] font-bold text-[#557d78]">
                          {t(EXEC_KEY(c.execution_status))}
                        </span>

                        {c.travel_start ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#557d78]">
                            <CalendarClock className="size-3.5" />
                            <DirText dir="ltr">
                              <span className="tv-tnum">{c.travel_start}</span>
                            </DirText>
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
