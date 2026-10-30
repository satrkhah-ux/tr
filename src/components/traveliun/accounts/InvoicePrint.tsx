"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import type { InvoiceDetail } from "@/lib/data/accounts";
import { InvoicePaper } from "./Invoices";

/**
 * «المشاركة كـ PDF» — the invoice alone, A4, no menus: the browser's print saves it as a PDF to send.
 * Internal, not a tax invoice (the owner, 2026-10-30) — the page says so.
 */
export function InvoicePrint({ inv }: { inv: InvoiceDetail }) {
  useEffect(() => {
    // open the print dialog once the fonts are in, so the PDF is not taken in a fallback font
    let done = false;
    void document.fonts.ready.then(() => {
      if (!done) window.print();
    });
    return () => {
      done = true;
    };
  }, []);
  return (
    <main dir="rtl" className="mx-auto max-w-2xl space-y-3 bg-white p-6 text-tv-text-strong print:max-w-none print:p-0">
      <style>{"@page { size: A4; margin: 14mm; } @media print { .tv-card { box-shadow: none !important; break-inside: avoid; } }"}</style>
      <header className="flex items-end justify-between gap-3 border-b-2 border-tv-action-primary pb-3">
        <div>
          <p className="text-2xl font-extrabold text-tv-text-brand">ترافليون</p>
          <p className="text-[12px] font-semibold text-tv-text-faint">فاتورة — ليست فاتورة ضريبية</p>
        </div>
        <button type="button" onClick={() => window.print()} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-tv-border-default px-4 text-[12.5px] font-bold text-tv-text-brand print:hidden">
          <Printer className="size-4" />حفظ كـ PDF
        </button>
      </header>
      <InvoicePaper inv={inv} />
    </main>
  );
}
