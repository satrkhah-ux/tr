"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Eye, Loader2, Search, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import { StatusBadge, statusTone } from "@/components/ui/StatusBadge";
import { listKanban, updateOfferStage, type KanbanCard, type KanbanColumn } from "@/lib/data/offers";
import { KANBAN_STAGES } from "@/lib/data/pipeline";
import type { TranslationKey } from "@/lib/i18n";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

type DragState = { from: string; id: string } | null;
type StatusFilter = "all" | "confirmed" | "sent";

const STAGE_LABEL = new Map<string, TranslationKey>(KANBAN_STAGES.map((s) => [s.key, s.labelKey]));

export function TraveliunKanban() {
  const { t, dir } = useTraveliunUI();
  const stageName = (key: string) => {
    const labelKey = STAGE_LABEL.get(key);
    return labelKey ? t(labelKey) : key;
  };
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [drag, setDrag] = useState<DragState>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<(KanbanCard & { stage: string }) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await listKanban();
    setColumns(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return columns.map((col) => ({
      ...col,
      cards: col.cards.filter((c) => {
        const matchesQuery = !q || [c.serial, c.destination ?? ""].some((v) => v.toLowerCase().includes(q));
        const matchesStatus = statusFilter === "all" || c.status === statusFilter;
        return matchesQuery && matchesStatus;
      }),
    }));
  }, [columns, query, statusFilter]);

  async function moveCard(targetStage: string) {
    if (!drag || drag.from === targetStage) {
      setDrag(null);
      return;
    }
    const { id, from } = drag;
    setDrag(null);
    setSavingId(id);

    const snapshot = columns;
    setColumns((cols) => {
      const card = cols.find((c) => c.key === from)?.cards.find((c) => c.id === id);
      if (!card) return cols;
      return cols.map((col) => {
        if (col.key === from) return { ...col, cards: col.cards.filter((c) => c.id !== id) };
        if (col.key === targetStage) return { ...col, cards: [card, ...col.cards] };
        return col;
      });
    });

    const result = await updateOfferStage(id, targetStage);
    setSavingId(null);
    if (!result.ok) {
      setColumns(snapshot);
      setError(result.error ? t(result.error) : t("err.stageUpdateFailed"));
    }
  }

  const filterButtons: { key: StatusFilter; label: string }[] = [
    { key: "all", label: t("all") },
    { key: "confirmed", label: t("activeFilter") },
    { key: "sent", label: t("packageSent") },
  ];

  return (
    <TraveliunShell title="nav.kanban">
      <div className="tv-fade-up">
        <section className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <div className="inline-flex overflow-hidden rounded-[11px] bg-[#e2ede9] p-1 text-sm">
            {filterButtons.map((btn) => (
              <button
                key={btn.key}
                type="button"
                onClick={() => setStatusFilter(btn.key)}
                className={`rounded-lg px-4 py-2 font-bold transition-colors ${
                  statusFilter === btn.key ? "bg-white text-[#185045] shadow-[0_1px_3px_rgba(0,60,58,0.12)]" : "text-[#6f8f88] hover:text-[#185045]"
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
          <div className="relative h-11 w-full max-w-[280px]">
            <Search className="absolute end-3 top-1/2 size-5 -translate-y-1/2 text-[#8aa29b]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-full w-full rounded-[11px] border border-[#dbe6e1] bg-[#f5f8f7] pe-11 ps-4 text-sm text-[#557d78] outline-none focus:border-[#2aa87a]"
            />
          </div>
          {savingId ? (
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#6f8f88]"><Loader2 className="size-4 animate-spin" /> {t("saving")}</span>
          ) : null}
          {error ? <span className="text-sm font-semibold text-[#c22850]">{error}</span> : null}
        </section>

        {loading ? (
          <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            {KANBAN_STAGES.map((s) => (
              <div key={s.key} className="min-h-[220px] rounded-2xl border border-[#e2ebe7] bg-white p-3">
                <div className="tv-shimmer mb-3 h-8 rounded-md" />
                <div className="tv-shimmer mb-2 h-20 rounded-md" />
                <div className="tv-shimmer h-20 rounded-md" />
              </div>
            ))}
          </section>
        ) : (
          <section className="overflow-x-auto pb-3">
            <div className="grid min-w-[1180px] grid-cols-6 gap-4">
              {visible.map((column) => (
                <div
                  key={column.key}
                  className="min-h-[520px] rounded-2xl border border-[#e2ebe7] bg-[#f7faf8] shadow-sm"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => moveCard(column.key)}
                >
                  <div className="flex items-center justify-between rounded-t-2xl bg-[#185045] px-4 py-4 text-sm font-bold text-white">
                    <span className="truncate">{stageName(column.key)}</span>
                    <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{column.cards.length}</span>
                  </div>
                  <div className="space-y-3 p-3">
                    {column.cards.map((card) => (
                      <article
                        key={card.id}
                        draggable
                        onDragStart={() => setDrag({ from: column.key, id: card.id })}
                        className="cursor-grab rounded-[11px] border border-[#dce7e2] bg-white p-3 text-sm text-[#557d78] shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#b6cbc4] hover:shadow-md active:cursor-grabbing"
                      >
                        <p className="tv-tnum mb-3 font-bold text-[#185045]"><DirText dir="ltr">{card.serial}</DirText></p>
                        {card.offer_date ? (
                          <p className="mb-2 flex items-center gap-2">
                            <CalendarDays className="size-4 text-[#8ca49e]" />
                            <DirText dir="ltr" className="tv-tnum">{card.offer_date}</DirText>
                          </p>
                        ) : null}
                        <p className="mb-3"><span className="font-semibold text-[#185045]">{t("destination")}:</span> {card.destination ?? "—"}</p>
                        <div className="flex items-center justify-between">
                          <StatusBadge tone={statusTone(card.status)} />
                          <button
                            type="button"
                            onClick={() => setSelected({ ...card, stage: column.key })}
                            className="inline-flex items-center gap-1 text-xs font-bold text-[#185045] hover:text-[#0f4439]"
                          >
                            <Eye className="size-3.5" /> {t("details")}
                          </button>
                        </div>
                      </article>
                    ))}
                    {column.cards.length === 0 ? (
                      <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-3 py-6 text-center text-xs text-[#9cafaa]">{t("noCards")}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {selected ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" dir={dir} onClick={() => setSelected(null)}>
          <div className="w-full max-w-[520px] rounded-2xl border border-[#e2ebe7] bg-white p-5 text-[#185045] shadow-[0_18px_48px_rgba(0,0,0,0.22)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between border-b border-[#e1e9e5] pb-4">
              <div>
                <h2 className="tv-tnum text-lg font-extrabold"><DirText dir="ltr">{selected.serial}</DirText></h2>
                <p className="mt-1 text-sm text-[#6d8a84]">{stageName(selected.stage)}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-md p-2 text-[#557d78] hover:bg-[#edf3f0]" aria-label={t("close")}><X className="size-5" /></button>
            </div>
            <div className="grid gap-3 text-sm">
              <InfoRow label={t("destination")} value={selected.destination ?? "—"} />
              <InfoRow label={t("col.date")} value={selected.offer_date ?? "—"} ltr />
              <div className="flex items-center justify-between rounded-md bg-[#f4f8f6] px-4 py-3">
                <span className="font-bold text-[#185045]">{t("col.status")}</span>
                <StatusBadge tone={statusTone(selected.status)} />
              </div>
            </div>
            <Link
              href={`/client-offer/${selected.serial}`}
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[11px] bg-[#185045] text-sm font-bold text-white hover:bg-[#0f4439]"
            >
              {t("offers.openClientLink")}
            </Link>
          </div>
        </div>
      ) : null}
    </TraveliunShell>
  );
}

function InfoRow({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-[#f4f8f6] px-4 py-3">
      <span className="font-bold text-[#185045]">{label}</span>
      <span className={`text-[#557d78] ${ltr ? "tv-tnum" : ""}`}>{ltr ? <DirText dir="ltr">{value}</DirText> : value}</span>
    </div>
  );
}
