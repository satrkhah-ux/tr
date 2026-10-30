"use client";

import { useRef, useState, useTransition } from "react";
import { Download, Info, Loader2, Upload } from "lucide-react";
import { exportCatalog, importCatalog } from "@/lib/data/catalog-transfer";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * Export and import the reference catalogue.
 *
 * Export builds the file in a server action and the browser saves it — the data
 * never passes through a public URL. Import reads the chosen file in the
 * browser, hands the parsed JSON to the server, and the server merges it: adds
 * what is missing, touches nothing that exists.
 */
export function DataTransfer() {
  const { t } = useTraveliunUI();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function doExport() {
    setBusy("export");
    setNote(null);
    setError(null);
    startTransition(async () => {
      const result = await exportCatalog();
      setBusy(null);
      if (!result.ok) {
        setError(result.error === "err.forbidden" ? t("err.forbidden") : t("err.loadFailed"));
        return;
      }
      const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
      const blob = new Blob([JSON.stringify(result.data, null, 1)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `traveliun-catalog-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNote(t("data.exportDone", { count: String(total) }));
    });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setBusy("import");
    setNote(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        setBusy(null);
        setError(t("pg.err.badImport"));
        return;
      }
      startTransition(async () => {
        const result = await importCatalog(parsed);
        setBusy(null);
        if (!result.ok) {
          setError(result.error === "pg.err.badImport" ? t("pg.err.badImport") : t("err.loadFailed"));
          return;
        }
        const added = Object.values(result.added).reduce((a, b) => a + b, 0);
        const skipped = Object.values(result.skipped).reduce((a, b) => a + b, 0);
        setNote(t("data.importDone", { added: String(added), skipped: String(skipped) }));
      });
    };
    reader.readAsText(file);
  }

  return (
    <TraveliunShell title="nav.dataTransfer">
      <div className="tv-fade-up mx-auto max-w-2xl space-y-4">
        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <h2 className="text-base font-extrabold text-[#003c3a]">{t("data.transferTitle")}</h2>
          <p className="mt-1.5 text-[12.5px] font-semibold leading-6 text-tv-text-faint">{t("data.transferHint")}</p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={doExport}
              disabled={pending}
              className="tv-btn-primary inline-flex h-12 items-center justify-center gap-2 rounded-[12px] px-4 text-sm font-bold transition-colors disabled:opacity-50"
            >
              {busy === "export" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {busy === "export" ? t("data.exporting") : t("data.exportBtn")}
            </button>

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={pending}
              className="tv-btn-secondary inline-flex h-12 items-center justify-center gap-2 rounded-[12px] border px-4 text-sm font-bold transition-colors disabled:opacity-50"
            >
              {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {busy === "import" ? t("data.importing") : t("data.importBtn")}
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} className="hidden" />
          </div>

          <p className="mt-4 flex items-start gap-2 rounded-[10px] border border-[#dbe6e1] bg-[#f8fbf9] px-3.5 py-2.5 text-[11.5px] font-bold leading-5 text-[#557d78]">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {t("data.importNote")}
          </p>

          {note ? (
            <p className="mt-3 rounded-[10px] border border-[#bfe5d4] bg-[#e9f7f0] px-4 py-2.5 text-[12.5px] font-bold text-[#0f7a52]">
              {note}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 rounded-[10px] border border-[#f2c7c7] bg-[#fff1f1] px-4 py-2.5 text-[12.5px] font-bold text-[#c43d3d]">
              {error}
            </p>
          ) : null}
        </section>
      </div>
    </TraveliunShell>
  );
}
