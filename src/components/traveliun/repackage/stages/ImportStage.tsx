"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FileUp, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { importFromPdf, listRepackageSuppliers, type RepackageSupplierOption } from "@/lib/data/repackage";
import { stageHref } from "@/lib/repackage/repackage-types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass, labelClass, sectionClass } from "../stage-props";
import type { RepackageStageProps } from "../stage-props";

/** sessionStorage key telling /edit it was reached via the high-confidence jump. */
export const AUTO_ADVANCE_KEY = "rp-auto-advanced";

export function ImportStage({ draftId, data }: RepackageStageProps) {
  const router = useRouter();
  const { t } = useTraveliunUI();
  const [supplier, setSupplier] = useState(data.source.supplier_name);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<RepackageSupplierOption[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const imported = data.source.imported_at != null;

  // one-tap supplier suggestions from the registry
  useEffect(() => {
    let alive = true;
    void listRepackageSuppliers().then((rows) => {
      if (alive) setKnown(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function submit() {
    if (!file || loading) return;
    setError(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("supplier", supplier);
      const res = await importFromPdf(draftId, fd);
      if (!res.ok) {
        setError(t(res.error));
        return;
      }
      // High confidence → jump straight to pricing; else stop at review.
      if (res.autoAdvance) {
        try { window.sessionStorage.setItem(AUTO_ADVANCE_KEY, draftId); } catch { /* ignore */ }
      }
      // No router.refresh() here — refreshing while the push is in flight can
      // cancel the navigation; the target page server-loads fresh data anyway.
      router.push(stageHref(draftId, res.autoAdvance ? "edit" : "review"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-extrabold text-[#0f3d38]">{t("rp.import.title")}</h2>
        <p className="mt-1 text-[13px] text-[#557d78]">{t("rp.import.hint")}</p>
      </header>

      {imported ? (
        <div className={`${sectionClass} flex flex-wrap items-center justify-between gap-3`}>
          <div className="flex items-center gap-2 text-[13px] font-bold text-[#0f7a52]">
            <CheckCircle2 className="size-4" />
            {t("rp.import.done")} ·{" "}
            <span className="text-[#557d78]">
              {data.source.pdf_kind === "scanned" ? t("rp.import.scannedPdf") : t("rp.import.textPdf")}
              {data.source.ocr_used ? ` · ${t("rp.import.ocrUsed")}` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={() => router.push(stageHref(draftId, "review"))}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white transition-colors hover:bg-[#0f4439]"
          >
            {t("rp.stage.review")}
          </button>
        </div>
      ) : null}

      <div className={`${sectionClass} space-y-4`}>
        <label className={labelClass}>
          {t("rp.import.supplierLabel")}
          <input
            className={fieldClass}
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder={t("rp.import.supplierPlaceholder")}
            disabled={loading}
            list="rp-suppliers"
          />
          <datalist id="rp-suppliers">
            {known.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </label>
        {known.length > 0 && !supplier ? (
          <div className="flex flex-wrap gap-1.5">
            {known.slice(0, 6).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSupplier(s.name)}
                className="rounded-full border border-dashed border-[#b7d0c7] px-2.5 py-1 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
              >
                {s.name}
              </button>
            ))}
          </div>
        ) : null}

        <label className={labelClass}>
          {t("rp.import.fileLabel")}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={loading}
            className="block w-full cursor-pointer rounded-[10px] border border-dashed border-[#b7d0c7] bg-[#f8fbfa] px-3 py-3 text-sm text-[#185045] file:mr-3 file:rounded-md file:border-0 file:bg-[#185045] file:px-3 file:py-1.5 file:text-white"
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-2 text-[13px] font-bold text-[#c22850]">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={!file || loading}
          className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : imported ? <RefreshCw className="size-4" /> : <FileUp className="size-4" />}
          {loading ? t("rp.import.uploading") : imported ? t("rp.import.reimport") : t("rp.import.upload")}
        </button>
      </div>
    </div>
  );
}
