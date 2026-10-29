"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, BadgeCheck, CalendarClock, ClipboardCheck, Database, FilePlus2, FileText, FolderOpen, Hotel, MapPin, PackageCheck, Search, Stamp, Users, Wallet, type LucideIcon } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import { actionDue, VISA_OPEN, type VisaBoard } from "@/lib/visa-files/types";
import { homeKindsFor, type HomeKind } from "@/lib/roles/homes";
import { useRole } from "@/lib/roles/RoleContext";
import { useCanOpen } from "@/lib/roles/useCanOpen";
import type { OpsSummary } from "@/lib/data/operations-work";
import type { MyDashboard as MyDashboardData } from "@/lib/dashboard/my-stats";
import { OperationsSnapshot } from "../operations/OperationsSnapshot";
import { MyFollowups } from "../sla/MyFollowups";
import { MyDashboard } from "../MyDashboard";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * «الرئيسية» per department (the owner, 2026-10-29): the colleague opens on their own department's work — a visa
 * colleague on files and what is due today; operations on the live cases; sales on their offers and follow-ups;
 * data on the tables. A colleague in more than one department gets a tab per department, their own first
 * (lib/roles/homes.ts). Only what exists already is drawn: the visa board, the operations summary, «لوحتي», the
 * follow-ups — and links to the pages themselves.
 */

type Tile = { labelKey: TranslationKey; href: string; icon: LucideIcon };

const TILES: Record<HomeKind, Tile[]> = {
  visas: [
    { labelKey: "nav.visaBoard", href: "/visa-files", icon: Stamp },
    { labelKey: "nav.visaNew", href: "/visa-files/new", icon: FilePlus2 },
    { labelKey: "nav.visaCatalogue", href: "/visas", icon: FileText },
  ],
  operations: [
    { labelKey: "nav.operations", href: "/operations", icon: ClipboardCheck },
    { labelKey: "nav.externalTrips", href: "/confirmed-trips", icon: PackageCheck },
  ],
  sales: [
    { labelKey: "nav.basic", href: "/basic", icon: FilePlus2 },
    { labelKey: "nav.readyOffers", href: "/ready-offers", icon: PackageCheck },
    { labelKey: "nav.myFollowups", href: "/my-followups", icon: Users },
    { labelKey: "nav.customers", href: "/clients", icon: Users },
  ],
  data: [
    { labelKey: "nav.dataSearch", href: "/data-search", icon: Search },
    { labelKey: "nav.dataReview", href: "/data-quality", icon: BadgeCheck },
    { labelKey: "nav.hotels", href: "/hotels", icon: Hotel },
    { labelKey: "nav.countries", href: "/countries", icon: MapPin },
    { labelKey: "nav.priceReview", href: "/price-review", icon: Database },
  ],
};

const HOME_LABEL: Record<HomeKind, TranslationKey> = {
  visas: "dash.home.visas",
  operations: "dash.home.operations",
  sales: "dash.home.sales",
  data: "dash.home.data",
};

const CARD = "rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)] dark:border-[#24423a] dark:bg-[#12261f]";

/** The colleague's departments as tabs (one department: no tabs), the first selected. */
export function DepartmentHomes({ opsSummary, mine, visaBoard }: { opsSummary: OpsSummary; mine: MyDashboardData; visaBoard: VisaBoard | null }) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const kinds = homeKindsFor(can);
  const [active, setActive] = useState<HomeKind | null>(null);
  const kind = active && kinds.includes(active) ? active : kinds[0];
  if (!kind) return null;

  return (
    <div className="space-y-4">
      {kinds.length > 1 ? (
        <div className="flex max-w-full overflow-x-auto rounded-[12px] border border-[#dbe6e1] bg-white p-1 shadow-[0_1px_2px_rgba(0,60,58,0.04)] sm:inline-flex dark:border-[#24423a] dark:bg-[#12261f]">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setActive(k)}
              className={`inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-[9px] px-4 text-[13px] font-bold transition-colors ${
                k === kind ? "bg-[#185045] text-white" : "text-[#557d78] hover:bg-[#f0f7f4] dark:text-[#9fc4bb] dark:hover:bg-[#16302a]"
              }`}
            >
              {t(HOME_LABEL[k])}
            </button>
          ))}
        </div>
      ) : null}
      <h1 className="text-lg font-extrabold text-[#003c3a] dark:text-[#e3efeb]">{t(HOME_LABEL[kind])}</h1>

      {kind === "visas" ? <VisasHome board={visaBoard} /> : null}
      {kind === "operations" ? <OperationsSnapshot summary={opsSummary} /> : null}
      {kind === "sales" ? (
        <>
          <MyFollowups />
          <MyDashboard data={mine} />
        </>
      ) : null}
      <QuickTiles kind={kind} />
    </div>
  );
}

function QuickTiles({ kind }: { kind: HomeKind }) {
  const { t } = useTraveliunUI();
  const opens = useCanOpen();
  const tiles = TILES[kind].filter(opens);
  if (!tiles.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-[13px] font-extrabold text-[#557d78] dark:text-[#9fc4bb]">{t("dash.home.quick")}</h2>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {tiles.map((x) => (
          <Link key={x.href} href={x.href} className={`${CARD} flex items-center gap-3 text-[13px] font-bold text-[#185045] transition-shadow hover:shadow-[0_8px_22px_rgba(0,60,58,0.09)] dark:text-[#d4e7e1]`}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-[#185045]/10 text-[#185045] dark:bg-[#2aa87a]/15 dark:text-[#6fd3ae]">
              <x.icon className="size-5" />
            </span>
            {t(x.labelKey)}
          </Link>
        ))}
      </div>
    </section>
  );
}

/** «التأشيرات»: the board's counters, and the files whose next step is due — each opens its file. */
function VisasHome({ board }: { board: VisaBoard | null }) {
  const { t } = useTraveliunUI();
  if (!board) return <p className={`${CARD} text-[13px] font-semibold text-[#93aaa3]`}>{t("dash.home.visaLoadError")}</p>;
  const c = board.counts;
  const open = VISA_OPEN.reduce((n, s) => n + (c.byStatus[s] ?? 0), 0);
  const stats: { label: TranslationKey; value: number; icon: LucideIcon; warn?: boolean }[] = [
    { label: "dash.home.visaOpen", value: open, icon: FolderOpen },
    { label: "dash.home.visaDue", value: c.actionDue, icon: CalendarClock, warn: c.actionDue > 0 },
    { label: "dash.home.visaOverdue", value: c.replyOverdue, icon: AlertTriangle, warn: c.replyOverdue > 0 },
    { label: "dash.home.visaMissing", value: c.missingDocs, icon: FileText, warn: c.missingDocs > 0 },
    { label: "dash.home.visaDeliver", value: c.toDeliver, icon: BadgeCheck },
    { label: "dash.home.visaUnpaid", value: c.unpaid.files, icon: Wallet, warn: c.unpaid.files > 0 },
  ];
  const due = board.rows.filter((r) => actionDue(r)).slice(0, 8);
  return (
    <>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        {stats.map((s) => (
          <Link key={s.label} href="/visa-files" className={`${CARD} block`}>
            <span className={`flex items-center gap-2 text-[12px] font-bold ${s.warn ? "text-[#b45309] dark:text-[#f0b45c]" : "text-[#6f8f88] dark:text-[#9fc4bb]"}`}>
              <s.icon className="size-4" />
              {t(s.label)}
            </span>
            <span className="tv-tnum mt-1.5 block text-[26px] font-extrabold text-[#003c3a] dark:text-[#e3efeb]">
              <DirText>{String(s.value)}</DirText>
            </span>
          </Link>
        ))}
      </div>
      <section className={CARD}>
        <h2 className="mb-2 text-[13px] font-extrabold text-[#185045] dark:text-[#d4e7e1]">{t("dash.home.today")}</h2>
        {due.length === 0 ? (
          <p className="text-[12.5px] font-semibold text-[#93aaa3]">{t("dash.home.noneToday")}</p>
        ) : (
          <ul className="divide-y divide-[#eef3f1] dark:divide-[#24423a]">
            {due.map((r) => (
              <li key={r.id}>
                <Link href={`/visa-files/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[12.5px] font-bold text-[#185045] hover:underline dark:text-[#d4e7e1]">
                  <DirText className="text-[#93aaa3]">{r.serial}</DirText>
                  <span>{r.clientName ?? "—"}</span>
                  <span className="text-[#557d78] dark:text-[#9fc4bb]">{r.country ?? ""}</span>
                  <span className="ms-auto font-semibold text-[#6f8f88] dark:text-[#9fc4bb]">{r.nextAction ?? ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
