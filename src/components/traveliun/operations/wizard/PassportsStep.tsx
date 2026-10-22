"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import { readPassportPhoto, upsertTraveler } from "@/lib/data/operation-travelers";
import { trustedFields } from "@/lib/operations/mrz";
import { matchPassport, passportSummary, type KindCount, type MatchRow } from "@/lib/operations/wizard/passports";
import type { StepProps } from "@/lib/operations/wizard/types";
import { TravelersPanel } from "../TravelersPanel";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { useSafeTransition } from "../../useSafeTransition";
import { savePassport, type PassportOutcome } from "./passport-save";

/** What the reader is handed — a picture; a PDF is kept as the scan for a person to read. */
const READABLE = /^image\/(jpeg|png|webp)$/;

/** A file's outcome as the list shows it — passport-save.ts's, with the error said. */
type Outcome = Omit<PassportOutcome, "error"> & { file: string; error?: string };

/**
 * Step 1 — «الجوازات»: every passport at once. Each photo is read (when the
 * reader is on), given to the traveller it belongs to (matchPassport), saved
 * with only what passed its check digits, and kept as that traveller's scan.
 * What could not be read is still kept — on a traveller without a passport —
 * for a person to type from. The list below is the case's own (TravelersPanel):
 * the client's uploads from /trip, the visa, «أدخل يدوياً».
 */
export function PassportsStep({ data, canReadMrz }: StepProps) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const summary = passportSummary(data);
  const trip = data.operation;

  function uploadAll(files: File[]) {
    run(async () => {
      setOutcomes([]);
      setProgress({ done: 0, of: files.length });
      const rows: MatchRow[] = data.travelers.map((r) => ({ ...r }));
      const taken = new Set<string>();
      const results: Outcome[] = [];

      for (const [i, file] of files.entries()) {
        const fd = new FormData();
        fd.append("file", file);
        const read = canReadMrz && READABLE.test(file.type) ? await readPassportPhoto(data.operation.id, fd) : null;
        const passport = read?.ok ? read.passport : null;
        const row = passport ? matchPassport(rows, trustedFields(passport, data.today).values, trip, data.today, taken) : null;
        const out = await savePassport({ operationId: data.operation.id, rows, taken, row, read: passport, fd, today: data.today, travelStart: trip.travel_start });
        const error = out.error ? t(out.error) : read && !read.ok ? t(read.error) : undefined;
        const { state, keep, page } = out;
        results.push({ file: file.name, state, error, keep, page });
        setProgress({ done: i + 1, of: files.length });
      }
      setOutcomes(results);
      setProgress(null);
      router.refresh();
    });
  }

  const kinds = (c: KindCount) =>
    (["adult", "child", "infant"] as const)
      .filter((k) => c[k] > 0)
      .map((k) => `${c[k]} ${t(`ops.traveler.${k}` as TranslationKey)}`)
      .join(" + ") || "0";

  return (
    <div className="space-y-3">
      {/* who travels — the passports against what the offer was priced for */}
      <div className={`rounded-[12px] px-4 py-3 text-[12.5px] font-bold ${summary.mismatch ? "bg-[#fff8e8] text-[#a86a10]" : "bg-[#f2fbf6] text-[#0f7a52]"}`}>
        <p className="flex items-start gap-2">
          {summary.mismatch ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
          <span>
            {summary.sold
              ? t(summary.mismatch ? "wz.pass.mismatch" : "wz.pass.match", { sold: kinds(summary.sold), actual: kinds(summary.actual) })
              : t("wz.pass.actual", { actual: kinds(summary.actual) })}
          </span>
        </p>
        <p className="mt-1 text-[11.5px] font-semibold opacity-80">
          {t("wz.pass.onFile", { n: summary.withPassport, of: data.travelers.length })}
          {summary.short ? <span className="ms-2 text-[#c22850]">{t("wz.pass.short", { n: summary.short })}</span> : null}
          {summary.visas ? <span className="ms-2 text-[#c22850]">{t("wz.pass.visas", { n: summary.visas })}</span> : null}
        </p>
      </div>

      {/* upload first */}
      <label
        className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-[14px] border-2 border-dashed border-[#b7d0c7] bg-[#f8fbf9] px-4 py-6 text-center hover:bg-[#f0f7f4] ${pending ? "pointer-events-none opacity-70" : ""}`}
      >
        {pending ? <Loader2 className="size-6 animate-spin text-[#185045]" /> : <Upload className="size-6 text-[#185045]" />}
        <span className="text-[13.5px] font-extrabold text-[#185045]">
          {progress ? t("wz.pass.reading", { done: progress.done, of: progress.of }) : t("wz.pass.upload")}
        </span>
        <span className="text-[11.5px] font-semibold text-[#93aaa3]">{t(canReadMrz ? "wz.pass.uploadHint" : "wz.pass.uploadHintNoMrz")}</span>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          disabled={pending}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) uploadAll(files);
          }}
        />
      </label>

      {outcomes.length > 0 ? (
        <ul className="grid gap-1 text-[11.5px] font-bold">
          {outcomes.map((o, i) => (
            <li key={i} className={o.state === "saved" ? "text-[#0f7a52]" : o.state === "review" ? "text-[#a86a10]" : "text-[#c22850]"}>
              {o.file} — {t(`wz.pass.result.${o.state}` as TranslationKey)}
              {o.error ? <span className="font-semibold"> ({o.error})</span> : null}
              {o.keep ? <KeptName keep={o.keep} operationId={data.operation.id} /> : null}
              {o.page ? <PageNames page={o.page} operationId={data.operation.id} /> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <a href="#travelers" className="inline-block text-[12px] font-bold text-[#557d78] underline-offset-2 hover:underline">
        {t("wz.manual")}
      </a>

      <TravelersPanel operationId={data.operation.id} trip={trip} travelers={data.travelers} canReadMrz={canReadMrz} />
    </div>
  );
}

/**
 * A typed name stayed while the passport says otherwise — said, with the
 * passport's name one press away («استبدال بالاسم من الجواز»), never forced.
 */
function KeptName({ keep, operationId }: { keep: NonNullable<Outcome["keep"]>; operationId: string }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) return null;
  return (
    <span className="ms-1 inline-flex flex-wrap items-center gap-1.5 font-semibold text-[#a86a10]">
      {t("ops.trav.nameKept", { name: keep.name, passport: keep.passport })}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run(async () => {
            const res = await upsertTraveler({ id: keep.id, operation_id: operationId, display_name: keep.passport, passport_name: keep.passport });
            if (!res.ok) return setError(t(res.error));
            setDone(true);
            router.refresh();
          })
        }
        className="inline-flex h-7 items-center rounded-[7px] border border-[#e0c58a] bg-white px-2 text-[11px] font-bold text-[#185045] hover:bg-[#fffaf0] disabled:opacity-60"
      >
        {t("ops.trav.usePassportName")}
      </button>
      {error ? <span className="text-[#c22850]">{error}</span> : null}
    </span>
  );
}

/** The names the page prints — the Latin one whole, the Arabic one — each a press away from being the traveller's. */
function PageNames({ page, operationId }: { page: NonNullable<Outcome["page"]>; operationId: string }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) return null;
  const use = (name: string, passportName: string) =>
    run(async () => {
      const res = await upsertTraveler({ id: page.id, operation_id: operationId, display_name: name, passport_name: passportName });
      if (!res.ok) return setError(t(res.error));
      setDone(true);
      router.refresh();
    });
  const chip =
    "inline-flex h-7 items-center rounded-[7px] border border-[#e0c58a] bg-white px-2 text-[11px] font-bold text-[#185045] hover:bg-[#fffaf0] disabled:opacity-60";
  return (
    <span className="ms-1 inline-flex flex-wrap items-center gap-1.5">
      {page.printed ? (
        <button type="button" disabled={pending} title={t("ops.trav.useName")} onClick={() => use(page.printed ?? "", page.printed ?? "")} className={chip}>
          {t("ops.trav.printedName", { name: page.printed })}
        </button>
      ) : null}
      {page.arabic ? (
        <button type="button" disabled={pending} title={t("ops.trav.useName")} onClick={() => use(page.arabic ?? "", "")} className={chip}>
          {t("ops.trav.arabicName", { name: page.arabic })}
        </button>
      ) : null}
      {error ? <span className="text-[#c22850]">{error}</span> : null}
    </span>
  );
}
