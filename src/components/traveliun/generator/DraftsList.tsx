"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Copy,
  FilePlus2,
  FileText,
  FileUp,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { createDraft, deleteDraft, duplicateDraft, type DraftSummary } from "@/lib/data/drafts";
import { stageHref } from "@/lib/offer/draft-types";
import type { TranslationKey } from "@/lib/i18n";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * /package-generator — where a package starts.
 *
 * Three doors, said plainly, because an agent arriving here has exactly three
 * intentions: take one of the company's ready packages, build one from nothing, or
 * re-issue a supplier's file as ours. Those used to be a link, a button, and a
 * separate menu entry two clicks away.
 *
 * Below them the drafts, as a TABLE rather than cards: an agent looking for the
 * Baku programme they were on yesterday scans by destination, travellers and
 * duration — none of which the cards showed.
 */

const card = "rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const MONEY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function DraftsList({ drafts }: { drafts: DraftSummary[] }) {
  const router = useRouter();
  const { t } = useTraveliunUI();
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rows, setRows] = useState(drafts);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    if (creating) return;
    setCreating(true);
    setError(null);
    const result = await createDraft();
    if (!result.ok) {
      setError(t(result.error));
      setCreating(false);
      return;
    }
    router.push(stageHref(result.id, "customer"));
  }

  async function onDelete(id: string) {
    setBusyId(id);
    const result = await deleteDraft(id);
    setBusyId(null);
    if (result.ok) setRows((current) => current.filter((row) => row.id !== id));
    else if (result.error) setError(t(result.error));
  }

  /** «إعادة الإصدار»: a fresh draft from the same programme — see duplicateDraft. */
  async function onDuplicate(id: string) {
    setBusyId(id);
    setError(null);
    const result = await duplicateDraft(id);
    setBusyId(null);
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    router.push(stageHref(result.id, "customer"));
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((d) =>
      [d.title, d.destination, d.customer_name, d.company, d.produced_serial]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, query]);

  return (
    <TraveliunShell title="nav.packageGenerator">
      <div className="tv-fade-up space-y-4">
        <section className={`${card} px-5 py-4`}>
          <h1 className="text-lg font-extrabold text-[#003c3a]">{t("pg.hubTitle")}</h1>
          <p className="mt-1 text-[12.5px] font-semibold text-[#93aaa3]">{t("pg.hubSubtitle")}</p>
        </section>

        {/* the three doors */}
        <section className="grid gap-3 md:grid-cols-3">
          <StartCard titleKey="pg.startReady" hintKey="pg.startReadyHint" icon={Sparkles} color="#8b5cf6" href="/ready-offers" />
          <StartCard
            titleKey="pg.startNew"
            hintKey="pg.startNewHint"
            icon={FilePlus2}
            color="#2aa87a"
            onClick={() => void onCreate()}
            busy={creating}
          />
          <StartCard titleKey="pg.startRepackage" hintKey="pg.startRepackageHint" icon={FileUp} color="#0e9bb5" href="/repackage" />
        </section>

        {error ? (
          <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-3 text-[13px] font-semibold text-[#c22850]">
            {error}
          </p>
        ) : null}

        {/* the drafts */}
        <section className={`${card} p-5`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold text-[#003c3a]">{t("pg.draftsTitle")}</h2>
              <p className="mt-0.5 text-[11.5px] font-semibold text-[#93aaa3]">
                {t("pg.draftsCount", { n: String(rows.length) })} · {t("pg.draftsSubtitle")}
              </p>
            </div>
            <div className="relative">
              <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-[#8aa29b]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("pg.searchDrafts")}
                className="h-10 w-[min(340px,70vw)] rounded-[10px] border border-[#dbe6e1] bg-white px-3 pe-9 text-sm text-[#185045] outline-none focus:border-[#2aa87a]"
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={rows.length === 0 ? t("pg.noDrafts") : t("noResults")}
              description={rows.length === 0 ? t("pg.noDraftsDesc") : ""}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1240px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="bg-[#185045] text-white">
                    <Th>{t("col.serial")}</Th>
                    <Th>{t("col.customer")}</Th>
                    <Th>{t("col.destination")}</Th>
                    <Th>{t("pg.col.duration")}</Th>
                    <Th>{t("col.date")}</Th>
                    <Th>{t("col.adults")}</Th>
                    <Th>{t("pg.col.people")}</Th>
                    <Th>{t("col.total")}</Th>
                    <Th>{t("pg.col.state")}</Th>
                    <Th>{t("pg.col.updated")}</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((draft) => (
                    <tr key={draft.id} className="border-b border-[#eef2f0] last:border-b-0 hover:bg-[#f8fbfa]">
                      {/* The programme number leads the row: it is what everyone
                          quotes — on WhatsApp, on the phone, on the ops board. A
                          draft that has not been issued has none yet and says so,
                          rather than showing an empty cell. */}
                      <Td>
                        {draft.produced_serial ? (
                          <DirText dir="ltr">
                            <span className="tv-tnum font-extrabold text-[#185045]">{draft.produced_serial}</span>
                          </DirText>
                        ) : (
                          <span className="text-[11.5px] font-semibold text-[#b6c4bf]">{t("pg.noSerial")}</span>
                        )}
                      </Td>
                      <Td>
                        <span className="block font-extrabold text-[#0f3d38]">
                          {draft.customer_name || draft.title || t("pg.untitledDraft")}
                        </span>
                        {draft.company ? (
                          <span className="block text-[11px] font-semibold text-[#8b5cf6]">{draft.company}</span>
                        ) : null}
                      </Td>
                      <Td>{draft.destination || "—"}</Td>
                      <Td>
                        {draft.days > 0 || draft.nights > 0
                          ? t("pg.daysNights", { d: String(draft.days), n: String(draft.nights) })
                          : "—"}
                      </Td>
                      <Td>
                        {draft.travel_date ? (
                          <DirText dir="ltr">
                            <span className="tv-tnum">{draft.travel_date}</span>
                          </DirText>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>
                        <DirText dir="ltr">
                          <span className="tv-tnum font-bold">{String(draft.adults)}</span>
                        </DirText>
                      </Td>
                      {/* the breakdown stays on hover: the column is a count, and
                          «2 · 0 · 0» in every row reads as noise */}
                      <Td>
                        <span
                          className="inline-flex items-center gap-1.5 font-bold text-[#557d78]"
                          title={`${draft.adults} · ${draft.children} · ${draft.infants}`}
                        >
                          <Users className="size-3.5" />
                          <DirText dir="ltr">
                            <span className="tv-tnum">{String(draft.travelers)}</span>
                          </DirText>
                        </span>
                      </Td>
                      <Td>
                        {draft.total != null ? (
                          <DirText dir="ltr">
                            <span className="tv-tnum font-bold text-[#0f3d38]">
                              {`${MONEY.format(draft.total)} ${draft.currency}`}
                            </span>
                          </DirText>
                        ) : (
                          <span className="text-[11.5px] font-semibold text-[#b6c4bf]">{t("pg.noPrice")}</span>
                        )}
                      </Td>
                      <Td>
                        {draft.produced_serial ? (
                          <span className="rounded-full bg-[#e4f6ef] px-2.5 py-0.5 text-[10.5px] font-bold text-[#10966b]">
                            {t("pg.state.issued")}
                          </span>
                        ) : (
                          <span className="rounded-full bg-[#fff8e8] px-2.5 py-0.5 text-[10.5px] font-bold text-[#a86a10]">
                            {t("pg.state.draft")}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <DirText dir="ltr">
                          <span className="tv-tnum text-[11.5px] text-[#93aaa3]">
                            {draft.updated_at.slice(0, 16).replace("T", " ")}
                          </span>
                        </DirText>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Link
                            href={stageHref(draft.id, "customer")}
                            className="inline-flex h-9 items-center rounded-[9px] bg-[#185045] px-3 text-[11.5px] font-bold text-white hover:bg-[#0f4439]"
                          >
                            {t("pg.continueEditing")}
                          </Link>
                          <button
                            type="button"
                            onClick={() => void onDuplicate(draft.id)}
                            disabled={busyId === draft.id}
                            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] px-3 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60"
                          >
                            {busyId === draft.id ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                            {t("pg.reissue")}
                          </button>
                          {draft.produced_serial ? (
                            <Link
                              href={`/offer/${draft.produced_serial}/preview`}
                              className="inline-flex h-9 items-center gap-1 rounded-[9px] border border-[#dbe6e1] px-3 text-[11.5px] font-bold text-[#0e9bb5] hover:bg-[#f0fafc]"
                            >
                              {t("pg.openIssued")}
                              <ArrowUpRight className="size-3" />
                            </Link>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void onDelete(draft.id)}
                            disabled={busyId === draft.id}
                            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#f2c7c7] px-3 text-[11.5px] font-bold text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60"
                          >
                            <Trash2 className="size-3.5" />
                            {t("pg.deleteDraft")}
                          </button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}

function Th({ children }: { children?: ReactNode }) {
  return (
    <th className="whitespace-nowrap px-3 py-2.5 text-start text-[11.5px] font-extrabold first:rounded-se-[10px] last:rounded-ss-[10px]">
      {children}
    </th>
  );
}

function Td({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2.5 align-middle text-[#557d78]">{children}</td>;
}

/** One of the three ways to start. A link or a button, the same shape either way. */
function StartCard({
  titleKey,
  hintKey,
  icon: Icon,
  color,
  href,
  onClick,
  busy,
}: {
  titleKey: TranslationKey;
  hintKey: TranslationKey;
  icon: LucideIcon;
  color: string;
  href?: string;
  onClick?: () => void;
  busy?: boolean;
}) {
  const { t } = useTraveliunUI();
  const body = (
    <>
      <span
        className="flex size-12 shrink-0 items-center justify-center rounded-[13px] transition-transform group-hover:scale-105"
        style={{ color, background: `${color}1a` }}
      >
        {busy ? <Loader2 className="size-6 animate-spin" /> : <Icon className="size-6" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[14.5px] font-extrabold text-[#0f3d38]">{t(titleKey)}</span>
        <span className="mt-0.5 block text-[11.5px] font-semibold text-[#93aaa3]">{t(hintKey)}</span>
      </span>
    </>
  );

  const className =
    "group flex h-full items-center gap-3.5 rounded-[15px] border border-[#e2ebe7] bg-white p-4 text-start shadow-[0_1px_2px_rgba(0,60,58,0.04)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(0,60,58,0.09)]";

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={busy} className={`${className} disabled:opacity-70`}>
      {body}
    </button>
  );
}
