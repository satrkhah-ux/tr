"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ClipboardType,
  FileUp,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { importFromPdf, listRepackageSuppliers, type RepackageSupplierOption } from "@/lib/data/repackage";
import { stageHref } from "@/lib/repackage/repackage-types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass, labelClass, sectionClass } from "../stage-props";
import type { RepackageStageProps } from "../stage-props";

/** sessionStorage key telling /edit it was reached via the high-confidence jump. */
export const AUTO_ADVANCE_KEY = "rp-auto-advanced";

/** What the supplier actually sent. Each maps to one field on the FormData. */
const SOURCES = [
  { key: "file", labelKey: "rp.src.file", hintKey: "rp.src.fileHint", icon: FileUp, accept: "application/pdf,.pdf" },
  { key: "image", labelKey: "rp.src.image", hintKey: "rp.src.imageHint", icon: ImageIcon, accept: "image/*" },
  { key: "text", labelKey: "rp.src.text", hintKey: "rp.src.textHint", icon: ClipboardType, accept: "" },
  { key: "url", labelKey: "rp.src.url", hintKey: "rp.src.urlHint", icon: LinkIcon, accept: "" },
] as const;

type SourceKey = (typeof SOURCES)[number]["key"];

/** Which reader produced the fields — the user deserves to know. */
const READ_LABEL = {
  "ai-vision": "rp.read.aiVision",
  "ai-text": "rp.read.aiText",
  parser: "rp.read.parser",
  none: "rp.read.none",
} as const;

export function ImportStage({ draftId, data }: RepackageStageProps) {
  const router = useRouter();
  const { t } = useTraveliunUI();
  const [supplier, setSupplier] = useState(data.source.supplier_name);
  const [kind, setKind] = useState<SourceKey>("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<RepackageSupplierOption[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const imported = data.source.imported_at != null;
  const ready =
    (kind === "file" || kind === "image" ? file !== null : kind === "text" ? text.trim().length > 30 : url.trim().length > 8);

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
    if (!ready || loading) return;
    setError(null);
    setLoading(true);
    try {
      const fd = new FormData();
      if ((kind === "file" || kind === "image") && file) fd.append("file", file);
      if (kind === "text") fd.append("text", text);
      if (kind === "url") fd.append("url", url);
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
        <div className={`${sectionClass} space-y-3`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[13px] font-bold text-[#0f7a52]">
              <CheckCircle2 className="size-4" />
              {t("rp.import.done")} ·{" "}
              <span className="text-[#557d78]">{t(READ_LABEL[data.source.how ?? "none"])}</span>
            </div>
            <button
              type="button"
              onClick={() => router.push(stageHref(draftId, "review"))}
              className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white transition-colors hover:bg-[#0f4439]"
            >
              {t("rp.stage.review")}
            </button>
          </div>
          {/* what the reader understood, in its own words — a fast sanity check */}
          {data.source.summary ? (
            <div className="rounded-[10px] border border-[#dbe6e1] bg-[#f8fbfa] px-3 py-2.5">
              <p className="mb-1 flex items-center gap-1.5 text-[11.5px] font-extrabold text-[#185045]">
                <Sparkles className="size-3.5" />
                {t("rp.read.summary")}
              </p>
              <p className="text-[12.5px] leading-relaxed text-[#41615b]">{data.source.summary}</p>
            </div>
          ) : null}
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

        {/* the supplier sends what they have — a file, a screenshot, a message, a link */}
        <div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SOURCES.map((s) => {
              const Icon = s.icon;
              const active = kind === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setKind(s.key);
                    setError(null);
                    setFile(null);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-[12.5px] font-bold transition-colors ${
                    active
                      ? "border-[#185045] bg-[#185045] text-white"
                      : "border-[#dbe6e1] bg-white text-[#185045] hover:bg-[#f4f8f6]"
                  }`}
                >
                  <Icon className="size-4" />
                  {t(s.labelKey)}
                </button>
              );
            })}
          </div>
          <p className="mb-2 text-[12px] text-[#93aaa3]">{t(SOURCES.find((s) => s.key === kind)!.hintKey)}</p>

          {kind === "file" || kind === "image" ? (
            <input
              ref={inputRef}
              type="file"
              accept={kind === "image" ? "image/*" : "application/pdf,.pdf"}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={loading}
              className="block w-full cursor-pointer rounded-[10px] border border-dashed border-[#b7d0c7] bg-[#f8fbfa] px-3 py-3 text-sm text-[#185045] file:mr-3 file:rounded-md file:border-0 file:bg-[#185045] file:px-3 file:py-1.5 file:text-white"
            />
          ) : kind === "text" ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={loading}
              rows={9}
              dir="auto"
              placeholder={t("rp.src.textPlaceholder")}
              className="block w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 py-2.5 text-[13px] leading-relaxed text-[#0f3d38] outline-none focus:border-[#2aa87a]"
            />
          ) : (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
              dir="ltr"
              placeholder="https://…"
              className={fieldClass}
            />
          )}
        </div>

        {error ? (
          <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-2 text-[13px] font-bold text-[#c22850]">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={!ready || loading}
          className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : imported ? <RefreshCw className="size-4" /> : <FileUp className="size-4" />}
          {loading ? t("rp.import.uploading") : imported ? t("rp.import.reimport") : t("rp.import.upload")}
        </button>
      </div>
    </div>
  );
}
