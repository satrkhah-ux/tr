"use client";

import { Download, FileText } from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import type { GuideFile } from "@/lib/data/guide-actions";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

function formatSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TraveliunGuide({ files }: { files: GuideFile[] }) {
  const { t } = useTraveliunUI();
  return (
    <TraveliunShell title="nav.guide">
      <div className="tv-fade-up">
        {files.length === 0 ? (
          <section className="rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
            <EmptyState
              icon={FileText}
              title={t("guide.emptyTitle")}
              description={t("guide.emptyDesc")}
            />
          </section>
        ) : (
          <section className="rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
            <h2 className="mb-4 text-xl font-bold text-[#185045]">{t("guide.filesTitle")}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {files.map((file) => {
                const size = formatSize(file.size);
                return (
                  <a
                    key={file.name}
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-[11px] border border-[#e2ebe7] px-4 py-3 text-sm text-[#557d78] transition-colors hover:border-[#b7d0c7] hover:bg-[#f7faf8]"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#e8f1ed] text-[#185045]">
                      <Download className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-[#185045]">{file.name}</span>
                      {size ? <span className="tv-tnum text-xs text-[#93aaa3]"><DirText dir="ltr">{size}</DirText></span> : null}
                    </span>
                  </a>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </TraveliunShell>
  );
}
