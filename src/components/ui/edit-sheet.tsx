"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";

/**
 * «التعديل يفتح في مكانه» (the owner, 2026-10-29): an editor opens in a side panel over the page, so the
 * page behind keeps its scroll position — never a form at the top of the page that throws the reader up
 * from the row they pressed. Escape, the backdrop and the close button all call `onClose`.
 */
export function EditSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent
        side="inline-end"
        aria-describedby={undefined}
        className="w-[640px] max-w-[calc(100vw/var(--tv-zoom))] bg-[#fbfdfc] dark:bg-[#0f1f1b]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#e2ebe7] bg-inherit px-5 py-3 dark:border-[#24423a]">
          <h2 className="text-sm font-extrabold text-[#185045] dark:text-[#e3efeb]">{title}</h2>
          <SheetClose
            className="flex size-9 items-center justify-center rounded-[9px] border border-[#dbe6e1] text-[#557d78] hover:bg-[#f4f8f6] dark:border-[#24423a] dark:hover:bg-[#16302a]"
            aria-label="close"
          >
            <X className="size-4" />
          </SheetClose>
        </div>
        <div className="p-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
