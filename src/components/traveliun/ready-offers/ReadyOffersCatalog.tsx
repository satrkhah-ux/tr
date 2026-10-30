"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, CalendarRange, CheckCircle2, ExternalLink, Hotel, Image as ImageIcon,
  Loader2, MapPin, Plane, RefreshCw, Route, Sparkles, X,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  applySync, previewSync, setDesignUrl, setReadyOfferActive, startDraftFromReadyOffer, uploadDesign,
} from "@/lib/data/ready-offers";
import type { TranslationKey, Translator } from "@/lib/i18n";
import { canStartFrom, type ReadyOfferRecord, type SyncDiff } from "@/lib/ready-offers/types";
import { parseList } from "@/lib/ready-offers/parse";
import { designImageUrl } from "@/lib/ready-offers/design";
import { draftHref } from "@/lib/offer/draft-types";
import { useRole } from "@/lib/roles/RoleContext";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { TraveliunShell } from "../TraveliunShell";

const card = "rounded-[14px] border border-[#e2ebe7] bg-white p-4 shadow-[0_2px_10px_rgba(0,60,58,0.04)]";
const chip = "rounded-full border px-2.5 py-1 text-[11.5px] font-bold";

// the owner's sheet has no tiers: an offer is fine, «بها خطأ» (the sheet contradicts itself), or not published
type Filter = "all" | "problems" | "unpublished";

const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

export function ReadyOffersCatalog({
  offers,
  sheetId,
  sessionExpired = false,
}: {
  offers: ReadyOfferRecord[];
  sheetId: string;
  sessionExpired?: boolean;
}) {
  const { t } = useTraveliunUI();
  // Display-only gate; the server actions enforce settings.manage for real.
  const canManage = useRole().can("settings.manage");
  const [filter, setFilter] = useState<Filter>("all");
  const [showSoon, setShowSoon] = useState(true);
  const [syncOpen, setSyncOpen] = useState(false);

  // Deactivated packages are hidden from everyone but an admin, who needs to
  // see them to switch one back on.
  const listed = useMemo(() => offers.filter((o) => o.active || canManage), [offers, canManage]);
  const flagged = (o: ReadyOfferRecord) => Boolean(o.problems?.length);
  const visible = useMemo(
    () =>
      listed.filter(
        (o) =>
          (filter === "all" || (filter === "problems" ? flagged(o) : o.published === false)) &&
          (showSoon || o.status !== "coming_soon"),
      ),
    [listed, filter, showSoon],
  );
  const readyCount = listed.filter((o) => o.status !== "coming_soon").length;
  const counts: Record<Filter, number> = {
    all: listed.length,
    problems: listed.filter((o) => o.active && flagged(o)).length,
    unpublished: listed.filter((o) => o.published === false).length,
  };

  return (
    <TraveliunShell title="nav.readyOffers">
      <div className="tv-fade-up mx-auto max-w-[1100px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-extrabold text-[#003c3a]">{t("ro.title")}</h1>
            <p className="mt-1 text-[12.5px] font-semibold text-tv-text-faint">
              {t("ro.subtitle", { ready: String(readyCount), total: String(offers.length) })}
            </p>
          </div>
          {canManage ? (
            <button
              type="button"
              onClick={() => setSyncOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white hover:bg-[#0f4439]"
            >
              <RefreshCw className="size-4" /> {t("ro.sync")}
            </button>
          ) : null}
        </div>

        <div className="mt-4 mb-5 flex flex-wrap items-center gap-2">
          {(["all", "problems", "unpublished"] as Filter[])
            .filter((key) => key === "all" || counts[key] > 0 || filter === key)
            .map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`${chip} ${
                  filter === key
                    ? key === "problems"
                      ? "border-[#c22850] bg-[#c22850] text-white"
                      : "border-[#185045] bg-[#185045] text-white"
                    : key === "problems"
                      ? "border-[#f4c9d4] bg-[#fdeef2] text-[#c22850] hover:bg-[#fbe2e9]"
                      : "border-[#dbe6e1] bg-white text-[#185045] hover:bg-[#f4f8f6]"
                }`}
              >
                {t(key === "all" ? "ro.tier.all" : key === "problems" ? "ro.filter.problems" : "ro.filter.unpublished")}{" "}
                <span className="tv-tnum opacity-80">{counts[key]}</span>
              </button>
            ))}
          <label className="ms-auto flex items-center gap-2 text-[12px] font-bold text-[#557d78]">
            <input type="checkbox" checked={showSoon} onChange={(e) => setShowSoon(e.target.checked)} />
            {t("ro.showComingSoon")}
          </label>
        </div>

        {sessionExpired ? (
          <div className="rounded-[12px] border border-[#f0e2c4] bg-[#fdf9ee] px-4 py-8 text-center">
            <AlertTriangle className="mx-auto mb-2 size-6 text-[#8a6d1f]" />
            <p className="text-sm font-bold text-[#8a6d1f]">{t("ro.sessionExpired")}</p>
            <Link
              href="/sign-in?redirect=/ready-offers"
              className="mt-4 inline-flex h-10 items-center rounded-[10px] bg-[#185045] px-5 text-[13px] font-bold text-white hover:bg-[#0f4439]"
            >
              {t("auth.login")}
            </Link>
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-[12px] border border-dashed border-[#cfe0d9] px-4 py-12 text-center text-sm text-tv-text-faint">
            {t("ro.empty")}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {visible.map((offer) => (
              <OfferCard key={offer.id} offer={offer} canManage={canManage} />
            ))}
          </div>
        )}
      </div>

      <SyncDialog open={syncOpen} onOpenChange={setSyncOpen} sheetId={sheetId} />
    </TraveliunShell>
  );
}

function OfferCard({ offer, canManage }: { offer: ReadyOfferRecord; canManage: boolean }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [designing, setDesigning] = useState(false);
  const [design, setDesign] = useState(offer.design_url ?? "");
  const [active, setActive] = useState(offer.active);
  // the design as an image (lib/ready-offers/design.ts) — shown only once it has loaded, never a broken box
  const img = designImageUrl(offer.design_url);
  // the probe answers for one link: a new link is probed again, never shown unchecked
  const [probe, setProbe] = useState<{ src: string; ok: boolean } | null>(null);
  const imgOk = img && probe?.src === img ? probe.ok : null;
  const [showInfo, setShowInfo] = useState(false);
  const imageMode = Boolean(img) && imgOk === true;
  const [uploading, setUploading] = useState(false);

  const comingSoon = offer.status === "coming_soon";
  const problems = offer.problems ?? [];
  const startable = canStartFrom({ ...offer, active });
  const includes = parseList(offer.includes_text ?? "");
  const excludes = parseList(offer.excludes_text ?? "");

  async function start() {
    setBusy(true);
    setError(null);
    const res = await startDraftFromReadyOffer(offer.id);
    if (res.ok) router.push(draftHref(res.id));
    else {
      setError(t(res.error as TranslationKey));
      setBusy(false);
    }
  }

  const details = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-extrabold text-[#003c3a]">{offer.country || offer.title}</h2>
          {offer.variant ? (
            <span className="mt-1 inline-block rounded-full bg-[#eef3f1] px-2 py-0.5 text-[11px] font-bold text-[#185045]">
              {offer.variant}
            </span>
          ) : null}
        </div>
        {offer.published === false ? (
          <span className={`${chip} shrink-0 border-[#dbe6e1] bg-[#f4f7f6] text-[#557d78]`}>{t("ro.filter.unpublished")}</span>
        ) : offer.tier ? (
          <span
            className={`${chip} shrink-0 ${
              offer.tier === "premium"
                ? "border-[#e6d9b8] bg-[#fbf6e9] text-[#8a6d1f]"
                : "border-[#c9e6d8] bg-[#eef7f2] text-[#166b4c]"
            }`}
          >
            {t(offer.tier === "premium" ? "ro.tier.premium" : "ro.tier.economy")}
          </span>
        ) : null}
      </div>

      {problems.length ? (
        <div className="mt-3 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-2 text-[12px] text-[#a3203f]">
          <p className="flex items-center gap-1.5 font-extrabold">
            <AlertTriangle className="size-4 shrink-0" /> {t("ro.problem.badge")}
          </p>
          <ul className="mt-1 space-y-0.5 font-semibold">
            {problems.map((p, i) => (
              <li key={i}>• {p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3">
        {comingSoon ? (
          <span className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#e6dcc2] bg-[#fdf9ee] px-2.5 py-1.5 text-[12.5px] font-bold text-[#8a6d1f]">
            <Sparkles className="size-3.5" /> {t("ro.comingSoon")}
          </span>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-[24px] font-extrabold leading-none text-[#0f7a52]">
              {Number(offer.price).toLocaleString("en-US")}
            </span>
            <span className="text-[13px] font-bold text-[#557d78]">{offer.currency ?? "SAR"}</span>
            <span className="text-[11px] font-semibold text-tv-text-faint">{offer.price_basis || t("ro.priceNote")}</span>
          </div>
        )}
      </div>

      <dl className="mt-3 grid gap-1.5 text-[12.5px] text-[#41615b]">
        <Row icon={<MapPin className="size-3.5" />} value={offer.cities_summary} />
        <Row icon={<CalendarRange className="size-3.5" />} value={durationLabel(offer, t)} />
        <Row icon={<Hotel className="size-3.5" />} value={offer.main_hotels} />
        <Row icon={<Route className="size-3.5" />} value={offer.tours_text} />
        <Row icon={<Plane className="size-3.5" />} value={offer.domestic_flight} />
      </dl>

      {includes.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {includes.slice(0, 8).map((item, i) => (
            <li key={i} className="rounded-full bg-[#eef7f2] px-2 py-0.5 text-[11px] font-semibold text-[#166b4c]">
              {item}
            </li>
          ))}
        </ul>
      ) : null}
      {excludes.length ? (
        <p className="mt-2 text-[11.5px] font-semibold text-[#a2726f]">
          {t("ro.excludes")}: {excludes.join(" · ")}
        </p>
      ) : null}

      {offer.validity_raw ? (
        <p className="mt-2 text-[11.5px] font-bold text-tv-text-faint">
          {t("ro.validity")}: {offer.validity_raw}
        </p>
      ) : null}

    </>
  );

  return (
    <div className={`${card} ${active ? "" : "opacity-60"} ${problems.length ? "border-[#f0a9bb] ring-1 ring-[#f4c9d4]" : ""} flex flex-col`}>
      {img && imgOk === null ? (
        // the probe: the image loads out of sight; until it has, the card is the description, as without one
        // eslint-disable-next-line @next/next/no-img-element -- a design from any host, no loader
        <img src={img} alt="" aria-hidden className="hidden" onLoad={() => setProbe({ src: img, ok: true })} onError={() => setProbe({ src: img, ok: false })} />
      ) : null}
      {imageMode && img ? (
        // the design, whole (object-contain — no text cut off a post), the description over it on hover,
        // on keyboard focus, or on a tap (a phone has no hover: a first tap shows it, a second hides it)
        <div
          role="button"
          tabIndex={0}
          aria-expanded={showInfo}
          aria-label={offer.country || offer.title || ""}
          onClick={() => setShowInfo((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setShowInfo((v) => !v);
            }
          }}
          className="group relative -mx-1 overflow-hidden rounded-[12px] bg-[#e9eeec] outline-none focus-visible:ring-2 focus-visible:ring-[#2aa87a]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a design from any host, no loader */}
          <img src={img} alt={offer.title || offer.country || ""} className="block h-auto max-h-[560px] w-full object-contain" />
          <div
            className={`absolute inset-0 overflow-y-auto bg-white/95 p-4 transition-opacity duration-200 ${
              showInfo ? "opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-visible:opacity-100"
            }`}
          >
            {details}
          </div>
        </div>
      ) : (
        details
      )}

      {error ? (
        <p className="mt-3 rounded-[9px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-2 text-[12px] font-bold text-[#c22850]">
          {error}
        </p>
      ) : !startable && active && !comingSoon ? (
        <p className="mt-3 text-[11.5px] font-bold text-[#a3203f]">
          {problems.length ? t("ro.err.hasProblems") : t("ro.err.unpublished")}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <button
          type="button"
          disabled={!startable || busy}
          title={problems.length ? t("ro.err.hasProblems") : offer.published === false ? t("ro.err.unpublished") : undefined}
          onClick={start}
          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-[10px] bg-[#185045] px-3 text-[13px] font-bold text-white hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {t("ro.start")}
        </button>
        {offer.design_url ? (
          <a
            href={offer.design_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#dbe6e1] px-3 text-[13px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
          >
            <ImageIcon className="size-4" /> {t("ro.openDesign")}
          </a>
        ) : null}
        {canManage ? (
          <button
            type="button"
            onClick={() => setDesigning((v) => !v)}
            className="inline-flex h-10 items-center rounded-[10px] border border-[#dbe6e1] px-3 text-[12px] font-bold text-[#557d78] hover:bg-[#f4f8f6]"
          >
            {offer.design_url ? t("ro.editDesign") : t("ro.addDesign")}
          </button>
        ) : null}
      </div>

      {canManage && designing ? (
        <div className="mt-3 grid gap-2 rounded-[10px] border border-[#e2ebe7] bg-[#f8fbfa] p-3">
          <label className="grid gap-1 text-[12px] font-bold text-[#185045]">
            {t("ro.uploadDesign")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                setError(null);
                const form = new FormData();
                form.append("file", file);
                const res = await uploadDesign(offer.id, form);
                setUploading(false);
                if (res.ok) {
                  setDesigning(false);
                  router.refresh();
                } else setError(t(res.error as TranslationKey));
              }}
              className="text-[12px]"
            />
          </label>
          {uploading ? <Loader2 className="size-4 animate-spin text-[#185045]" /> : null}
          <p className="text-[11.5px] font-bold text-tv-text-faint">{t("ro.orLink")}</p>
          <input
            value={design}
            onChange={(e) => setDesign(e.target.value)}
            placeholder="https://drive.google.com/..."
            dir="ltr"
            className="h-10 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] outline-none focus:border-[#2aa87a]"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const res = await setDesignUrl(offer.id, design);
                if (res.ok) {
                  setDesigning(false);
                  router.refresh();
                } else setError(t(res.error as TranslationKey));
              }}
              className="h-9 rounded-[9px] bg-[#185045] px-3 text-[12.5px] font-bold text-white"
            >
              {t("save")}
            </button>
            <button
              type="button"
              onClick={async () => {
                const next = !active;
                setActive(next);
                await setReadyOfferActive(offer.id, next);
                router.refresh();
              }}
              className="h-9 rounded-[9px] border border-[#dbe6e1] px-3 text-[12.5px] font-bold text-[#557d78]"
            >
              {active ? t("ro.deactivate") : t("ro.activate")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ icon, value }: { icon: React.ReactNode; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-tv-text-faint">{icon}</span>
      <span className="whitespace-pre-line">{value}</span>
    </div>
  );
}

function durationLabel(offer: ReadyOfferRecord, t: Translator): string | null {
  if (!offer.days && !offer.nights) return null;
  return t("ro.duration", { days: String(offer.days ?? 0), nights: String(offer.nights ?? 0) });
}

/** The sync's preview and its «اعتماد» — on /ready-offers and on /developer. */
export function SyncDialog({ open, onOpenChange, sheetId }: { open: boolean; onOpenChange: (v: boolean) => void; sheetId: string }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "ready" | "applying" | "done" | "error">("idle");
  const [diff, setDiff] = useState<SyncDiff | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    setState("loading");
    const res = await previewSync();
    if (res.ok) {
      setDiff(res.diff);
      setState("ready");
    } else {
      setMessage(res.error);
      setState("error");
    }
  }

  // the preview starts when the dialog opens — its own onOpenChange only fires on a close
  // from inside it, never on the page opening it, so the dialog sat empty (the evaluator, 7a195c0)
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- opening the dialog is what starts the preview, once per opening */
  useEffect(() => {
    if (!open) return;
    void load();
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  async function apply() {
    setState("applying");
    const res = await applySync();
    if (res.ok) {
      setMessage(t("ro.syncDone", { added: String(res.inserted), updated: String(res.updated), off: String(res.deleted) }));
      setState("done");
      router.refresh();
    } else {
      setMessage(res.error);
      setState("error");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setState("idle");
          setDiff(null);
        }
      }}
    >
      <DialogContent className="max-h-[calc(85vh/var(--tv-zoom))] max-w-[620px] overflow-y-auto" showClose={false}>
        <div className="mb-4 flex items-center justify-between border-b border-[#e1e9e5] pb-3">
          <h2 className="text-base font-extrabold text-[#003c3a]">{t("ro.syncTitle")}</h2>
          <button type="button" onClick={() => onOpenChange(false)} className="rounded-md p-2 text-[#557d78] hover:bg-[#edf3f0]">
            <X className="size-5" />
          </button>
        </div>

        {state === "loading" ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm font-bold text-[#557d78]">
            <Loader2 className="size-4 animate-spin" /> {t("ro.syncReading")}
          </p>
        ) : null}

        {state === "error" ? (
          <p className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-3 text-[13px] font-bold text-[#c22850]">
            {message}
          </p>
        ) : null}

        {state === "done" ? (
          <p className="rounded-[10px] border border-[#bfe5d4] bg-[#e9f7f0] px-3 py-3 text-[13px] font-bold text-[#0f7a52]">
            <CheckCircle2 className="me-1.5 inline size-4" />
            {message}
          </p>
        ) : null}

        {(state === "ready" || state === "applying") && diff ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2 text-center">
              <Stat label={t("ro.diff.added")} value={diff.added.length} tone="good" />
              <Stat label={t("ro.diff.changed")} value={diff.changed.length} tone="warn" />
              <Stat label={t("ro.diff.deactivated")} value={diff.removed.length} tone="bad" />
              <Stat label={t("ro.diff.unchanged")} value={diff.unchanged} tone="mute" />
            </div>

            <DiffList title={t("ro.diff.added")} items={diff.added.map((o) => o.title)} />
            <DiffList
              title={t("ro.diff.changed")}
              items={diff.changed.map((c) => `${c.offer.title} — ${c.fields.join("، ")}`)}
            />
            <DiffList title={t("ro.diff.deactivated")} items={diff.removed.map((d) => d.title)} />

            {diff.problems.length ? (
              <div className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#c22850]">
                  <AlertTriangle className="size-4" /> {t("ro.diff.problems")} ({diff.problems.length})
                </p>
                <ul className="space-y-1 text-[12px] text-[#a3203f]">
                  {diff.problems.map((p) => (
                    <li key={p.code}>
                      <b>{p.title}</b> — {p.reasons.join("، ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {diff.warnings.length ? (
              <div className="rounded-[10px] border border-[#f0e2c4] bg-[#fdf9ee] p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#8a6d1f]">
                  <AlertTriangle className="size-4" /> {t("ro.diff.warnings")}
                </p>
                <ul className="space-y-1 text-[12px] text-[#7a6428]">
                  {diff.warnings.slice(0, 12).map((w) => (
                    <li key={w.code}>
                      <b>{w.title}</b> — {w.notes.join("، ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {diff.errors.length ? (
              <ul className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] p-3 text-[12px] font-bold text-[#c22850]">
                {diff.errors.map((e, i) => (
                  <li key={i}>{e.tab}{e.row ? ` (${e.row})` : ""}: {e.reason}</li>
                ))}
              </ul>
            ) : null}

            <div className="flex items-center gap-2 border-t border-[#e1e9e5] pt-3">
              <button
                type="button"
                onClick={apply}
                disabled={state === "applying"}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-50"
              >
                {state === "applying" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                {t("ro.syncApply")}
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="h-10 rounded-[10px] border border-[#dbe6e1] px-4 text-[13px] font-bold text-[#557d78]"
              >
                {t("cancel")}
              </button>
              <a
                href={sheetUrl(sheetId)}
                target="_blank"
                rel="noopener noreferrer"
                className="ms-auto inline-flex items-center gap-1 text-[12px] font-bold text-[#185045] hover:underline"
              >
                {t("ro.openSheet")} <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "good" | "warn" | "bad" | "mute" }) {
  const tones = {
    good: "border-[#bfe5d4] bg-[#e9f7f0] text-[#0f7a52]",
    warn: "border-[#f0e2c4] bg-[#fdf9ee] text-[#8a6d1f]",
    bad: "border-[#f4c9d4] bg-[#fdeef2] text-[#c22850]",
    mute: "border-[#dbe6e1] bg-[#f6faf8] text-[#557d78]",
  }[tone];
  return (
    <div className={`rounded-[10px] border px-2 py-2 ${tones}`}>
      <div className="text-[18px] font-extrabold leading-none">{value}</div>
      <div className="mt-1 text-[11px] font-bold">{label}</div>
    </div>
  );
}

function DiffList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1 text-[12.5px] font-extrabold text-[#185045]">{title}</p>
      <ul className="space-y-0.5 text-[12px] text-[#41615b]">
        {items.map((item, i) => (
          <li key={i}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}
