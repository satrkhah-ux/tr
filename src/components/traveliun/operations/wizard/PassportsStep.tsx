"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import { readPassportPhoto, upsertTraveler, uploadPassportScan } from "@/lib/data/operation-travelers";
import { trustedFields } from "@/lib/operations/mrz";
import { ageOn, kindForAge, sameName, takesPassportName } from "@/lib/operations/travelers";
import { matchPassport, passportSummary, type KindCount, type MatchRow } from "@/lib/operations/wizard/passports";
import type { StepProps } from "@/lib/operations/wizard/types";
import { TravelersPanel } from "../TravelersPanel";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { useSafeTransition } from "../../useSafeTransition";

/** What the reader is handed — a picture; a PDF is kept as the scan for a person to read. */
const READABLE = /^image\/(jpeg|png|webp)$/;

/**
 * `keep`: a typed name stayed — the passport's is offered, never forced (savedName).
 * `page`: the name as printed on the page and the Arabic one, when they differ from the MRZ's.
 */
type Outcome = {
  file: string;
  state: "saved" | "review" | "unread";
  error?: string;
  keep?: { id: string; name: string; passport: string };
  page?: { id: string; printed?: string; arabic?: string };
};

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

        let rowId: string | null = null;
        let state: Outcome["state"] = "unread";
        let error = read && !read.ok ? t(read.error) : undefined;
        let keep: Outcome["keep"];
        let page: Outcome["page"];
        if (read?.ok) {
          const { values, missing } = trustedFields(read.passport, data.today);
          const row = matchPassport(rows, values, trip, data.today, taken);
          const age = ageOn(values.birth_date || null, trip.travel_start ?? data.today);
          // the passport's name replaces a planned or unnamed one; a typed one stays and is asked about
          const takes = takesPassportName(row) && Boolean(values.full_name);
          const name = takes ? values.full_name : (row?.display_name.trim() ?? "");
          const saved = await upsertTraveler({
            id: row?.id,
            operation_id: data.operation.id,
            sort: row ? undefined : rows.length,
            // the row's name as it is — the server decides by the same rule (savedName)
            display_name: row?.display_name ?? "",
            passport_name: values.full_name,
            traveler_kind: age != null ? kindForAge(age) : (row?.traveler_kind ?? "adult"),
            // only what the read vouched for — an empty field never overwrites what is on file
            ...(values.birth_date ? { birth_date: values.birth_date } : {}),
            ...(values.nationality ? { nationality: values.nationality } : {}),
            ...(values.expiry ? { passport_expiry: values.expiry } : {}),
            ...(values.number && values.full_name ? { passport: { full_name: values.full_name, number: values.number, nationality: values.nationality } } : {}),
          });
          if (saved.ok) {
            rowId = saved.id;
            state = missing.length || read.passport.failed.length ? "review" : "saved";
            if (!takes && values.full_name && !sameName(name, values.full_name)) keep = { id: saved.id, name, passport: values.full_name };
            // the MRZ's name stops at 39 characters — the page's whole one, and the Arabic, one press away
            const { printed_name, arabic_name } = read.passport;
            const printed = printed_name && !sameName(printed_name, values.full_name) ? printed_name : undefined;
            const arabic = arabic_name && !sameName(arabic_name, name) ? arabic_name : undefined;
            if (printed || arabic) page = { id: saved.id, printed, arabic };
            const next: MatchRow = {
              id: saved.id,
              display_name: name,
              name_source: takes ? "passport" : (row?.name_source ?? null),
              traveler_kind: age != null ? kindForAge(age) : (row?.traveler_kind ?? "adult"),
              age: row?.age ?? null,
              birth_date: values.birth_date || row?.birth_date || null,
              nationality: values.nationality || row?.nationality || null,
              has_passport: Boolean(row?.has_passport || values.number),
            };
            if (row) rows[rows.indexOf(row)] = next;
            else rows.push(next);
          } else error = t(saved.error);
        }

        if (!rowId) {
          // unread: kept on a traveller still without a passport (a new one if none), to type from
          const free = rows.find((r) => !taken.has(r.id) && !r.has_passport);
          if (free) rowId = free.id;
          else {
            const added = await upsertTraveler({ operation_id: data.operation.id, display_name: "", traveler_kind: "adult", sort: rows.length });
            if (added.ok) {
              rowId = added.id;
              rows.push({ id: added.id, display_name: "", name_source: "seed", traveler_kind: "adult", age: null, birth_date: null, nationality: null, has_passport: false });
            } else error = t(added.error);
          }
        }
        if (rowId) {
          taken.add(rowId);
          const scan = await uploadPassportScan(rowId, fd);
          if (!scan.ok && state !== "unread") state = "review";
          if (!scan.ok) error = t(scan.error);
        }
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
