"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CalendarCheck,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Gauge,
  Link2,
  Send,
  Sparkles,
  Users,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import type { HubData } from "@/lib/data/offers";
import { checkSummary, checkText, validateOffer, type CheckLevel } from "@/lib/offer-validation";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

const CHECK_STYLE: Record<CheckLevel, { icon: LucideIcon; color: string; bg: string }> = {
  ok: { icon: CheckCircle2, color: "#0f7a52", bg: "#eef7f2" },
  warn: { icon: AlertTriangle, color: "#a86a10", bg: "#fff8e8" },
  error: { icon: XCircle, color: "#be123c", bg: "#fdeef2" },
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export function TraveliunIntelligenceHub({ data }: { data: HubData }) {
  const { t, dir } = useTraveliunUI();
  const { kpis, offer } = data;
  const checks = offer ? validateOffer(offer) : [];
  const summary = checkSummary(checks);
  const [copied, setCopied] = useState(false);
  const [clientLink, setClientLink] = useState(offer ? `/client-offer/${offer.serial}` : "");

  useEffect(() => {
    if (offer) setClientLink(`${window.location.origin}/client-offer/${offer.serial}`);
  }, [offer]);

  async function copyClientLink() {
    if (!clientLink) return;
    await navigator.clipboard.writeText(clientLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const operations: { label: string; value: string; detail: string; icon: LucideIcon; color: string }[] = [
    { label: t("hub.kpi.readiness"), value: `${kpis.readiness}%`, detail: t("hub.kpi.readinessDetail"), icon: Gauge, color: "#2aa87a" },
    { label: t("hub.kpi.confirmed"), value: `${kpis.confirmed}/${kpis.offersCount}`, detail: t("hub.kpi.confirmedDetail"), icon: CheckCircle2, color: "#0e9bb5" },
    { label: t("hub.kpi.sales"), value: formatNumber(kpis.revenue), detail: t("hub.kpi.salesDetail"), icon: Wallet, color: "#d99a00" },
    { label: t("hub.kpi.avg"), value: formatNumber(kpis.average), detail: t("hub.kpi.avgDetail"), icon: Users, color: "#e0577f" },
  ];

  return (
    <TraveliunShell title="nav.intelligenceHub">
      <div className="tv-fade-up space-y-[18px]" dir={dir}>
        <section
          className="flex flex-wrap items-center justify-between gap-[18px] rounded-[18px] px-[26px] py-6 text-white shadow-[0_10px_30px_rgba(18,63,55,0.28)]"
          style={{ background: "linear-gradient(120deg,#123f37,#185045 55%,#1f6154)" }}
        >
          <div>
            <p className="flex items-center gap-2 text-[12.5px] font-bold tracking-[0.03em] text-[#8fe3c4]">
              <Sparkles className="size-[18px]" />
              <DirText>TRAVELIUN INTELLIGENCE OS</DirText>
            </p>
            <h1 className="mt-2 text-[26px] font-extrabold">{t("hub.heading")}</h1>
            <p className="mt-1.5 text-[13.5px] font-medium text-[#bfe0d6]">
              {t("hub.sub")}
            </p>
          </div>
          {offer ? (
            <div className="flex flex-wrap gap-2.5">
              <Link href={`/client-offer/${offer.serial}`} className="inline-flex h-[46px] items-center gap-2 rounded-[11px] border border-white/20 bg-white/10 px-[18px] text-[13.5px] font-bold text-white transition-colors hover:bg-white/20">
                <Link2 className="size-4" /> {t("hub.clientLink")}
              </Link>
              {offer.pdf_url ? (
                <a href={offer.pdf_url} download className="inline-flex h-[46px] items-center gap-2 rounded-[11px] bg-white px-[18px] text-[13.5px] font-extrabold text-[#185045] transition-transform active:translate-y-px">
                  <Download className="size-4" /> {t("hub.downloadPdf")}
                </a>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
          {operations.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.label} className="rounded-[15px] border border-[#e2ebe7] bg-white p-[18px] shadow-[0_1px_2px_rgba(0,60,58,0.04)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(0,60,58,0.09)]">
                <div className="flex items-start justify-between">
                  <p className="text-[12.5px] font-bold text-[#6f8f88]">{item.label}</p>
                  <span className="flex size-[38px] items-center justify-center rounded-[11px]" style={{ color: item.color, background: `${item.color}1a` }}>
                    <Icon className="size-5" />
                  </span>
                </div>
                <p className="tv-tnum mt-2.5 text-[30px] font-extrabold text-[#003c3a]"><DirText>{item.value}</DirText></p>
                <p className="mt-1.5 text-[11.5px] font-semibold text-[#93aaa3]">{item.detail}</p>
              </article>
            );
          })}
        </section>

        {!offer ? (
          <section className="rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
            <EmptyState title={t("hub.noOffer")} description={t("hub.noOfferDesc")} />
          </section>
        ) : (
          <>
            <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
              <article className="rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
                <div className="flex items-center justify-between border-b border-[#eef2f0] px-5 py-4">
                  <h2 className="text-lg font-extrabold text-[#003c3a]">{t("hub.readyOffer")}</h2>
                  <span className="rounded-full bg-[#e4f6ef] px-3 py-1 text-xs font-bold text-[#10966b]">{t("hub.latestBadge")}</span>
                </div>
                <div className="grid gap-4 p-5 lg:grid-cols-3">
                  <InfoBlock label={t("col.serial")} value={offer.serial} numeric />
                  <InfoBlock label={t("col.destination")} value={offer.destination ?? "—"} />
                  <InfoBlock label={t("col.duration")} value={offer.duration ?? "—"} />
                  <InfoBlock label={t("col.date")} value={offer.offer_date ?? "—"} numeric />
                  <InfoBlock label={t("hub.travellers")} value={t("hub.adultsCount", { count: offer.adults })} />
                  {offer.total != null ? <InfoBlock label={t("col.total")} value={`${formatNumber(offer.total)} ${offer.currency ?? ""}`} numeric strong /> : null}
                </div>
                {offer.cities.length > 0 ? (
                  <div className="border-t border-[#eef2f0] p-5">
                    <div className="grid gap-3 md:grid-cols-3">
                      {offer.cities.slice(0, 3).map((city, index) => (
                        <Stage key={index} label={`${city.city_name}${city.nights != null ? ` · ${city.nights} ${t("col.nights")}` : ""}`} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>

              <article className="rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BrainCircuit className="size-5 text-[#2aa87a]" />
                    <h2 className="text-lg font-extrabold text-[#003c3a]">{t("hub.smartCheck")}</h2>
                  </div>
                  <span
                    className="rounded-full px-3 py-1 text-xs font-extrabold"
                    style={
                      summary.passed
                        ? { background: "#e3f6ee", color: "#0f7a52" }
                        : { background: "#fdeef2", color: "#be123c" }
                    }
                  >
                    {summary.passed ? t("hub.readyBadge") : t("hub.issues", { count: summary.errors })}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {checks.map((check, index) => {
                    const style = CHECK_STYLE[check.level];
                    const Icon = style.icon;
                    return (
                      <div
                        key={index}
                        className="flex items-start gap-3 rounded-md px-3 py-2.5 text-sm font-semibold"
                        style={{ background: style.bg, color: style.color }}
                      >
                        <Icon className="mt-0.5 size-4 shrink-0" />
                        <span className="leading-6">{checkText(t, check)}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-[11.5px] font-semibold text-[#93aaa3]">
                  {t("hub.advisory")}
                </p>
              </article>
            </section>

            <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
              <article className="rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-extrabold text-[#003c3a]">{t("hub.clientLink")}</h2>
                  <Sparkles className="size-5 text-[#f4b400]" />
                </div>
                <div className="rounded-md border border-[#dce7e2] bg-[#f7faf8] p-3 text-left text-sm font-semibold text-[#185045]" dir="ltr">{clientLink}</div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <button type="button" onClick={copyClientLink} className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[#c9d8d3] bg-white text-sm font-bold text-[#185045] hover:bg-[#f4f8f6]">
                    <Copy className="size-4" /> {copied ? t("copied") : t("copy")}
                  </button>
                  <Link href={`/client-offer/${offer.serial}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#2aa87a] text-sm font-bold text-white hover:bg-[#248d68]">
                    <span className="flex" style={{ transform: "scaleX(-1)" }}><Send className="size-4" /></span> {t("open")}
                  </Link>
                  {offer.pdf_url ? (
                    <a href={offer.pdf_url} download className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#185045] text-sm font-bold text-white hover:bg-[#0f4439]">
                      <Download className="size-4" /> PDF
                    </a>
                  ) : <span />}
                </div>
              </article>

              <article className="rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
                <div className="mb-4 flex items-center gap-2">
                  <Activity className="size-5 text-[#00a7b2]" />
                  <h2 className="text-lg font-extrabold text-[#003c3a]">{t("hub.itinerary")}</h2>
                </div>
                {offer.cities.length > 0 ? (
                  <div className="space-y-2">
                    {offer.cities.map((city, index) => (
                      <div key={index} className="grid gap-3 rounded-md border border-[#e2ebe7] px-3 py-3 md:grid-cols-[130px_1fr]">
                        <span className="font-extrabold text-[#185045]">{city.city_name}</span>
                        <span className="text-sm text-[#557d78]">{[city.hotel_name, city.meals].filter(Boolean).join(" · ") || "—"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-[#93aaa3]">{t("hub.noCities")}</p>
                )}
              </article>
            </section>

            {offer.includes.length > 0 || offer.excludes.length > 0 ? (
              <section className="grid gap-5 lg:grid-cols-2">
                {offer.includes.length > 0 ? <ListPanel title={t("hub.includes")} items={offer.includes} icon={CalendarCheck} /> : null}
                {offer.excludes.length > 0 ? <ListPanel title={t("hub.excludes")} items={offer.excludes} icon={FileText} /> : null}
              </section>
            ) : null}
          </>
        )}
      </div>
    </TraveliunShell>
  );
}

function InfoBlock({ label, value, strong = false, numeric = false }: { label: string; value: string; strong?: boolean; numeric?: boolean }) {
  return (
    <div className="rounded-[11px] bg-[#f4f8f6] p-3">
      <p className="text-[11px] font-bold text-[#93aaa3]">{label}</p>
      <p className={`mt-1.5 text-[13.5px] ${numeric ? "tv-tnum" : ""} ${strong ? "font-extrabold text-[#0f7a52]" : "font-bold text-[#185045]"}`}>
        {numeric ? <DirText>{value}</DirText> : value}
      </p>
    </div>
  );
}

function Stage({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-[#dce7e2] bg-[#f7faf8] px-3 py-3 text-sm font-bold text-[#185045]">
      {label}
      <span className="size-3 rounded-full bg-[#2aa87a]" />
    </div>
  );
}

function ListPanel({ title, items, icon: Icon }: { title: string; items: string[]; icon: LucideIcon }) {
  return (
    <article className="rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="size-5 text-[#557d78]" />
        <h2 className="text-lg font-extrabold text-[#003c3a]">{title}</h2>
      </div>
      <div className="grid gap-2">
        {items.map((item, index) => (
          <div key={index} className="flex gap-3 rounded-md bg-[#f4f8f6] px-3 py-2 text-sm font-semibold text-[#185045]">
            <span className="font-extrabold text-[#2aa87a]">{index + 1}</span>
            {item}
          </div>
        ))}
      </div>
    </article>
  );
}
