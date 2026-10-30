"use client";

import { useState } from "react";
import { IdCard } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/**
 * «لوحة الاستقبال» on demand.
 *
 * Deliberately not a plain link: the name is the whole document, and it is the
 * one thing that is a decision rather than a lookup. The booking name is the
 * default, but a client asking for a specific spelling — or for the sign to
 * carry whoever is actually meeting the driver — is the ordinary case.
 *
 * Opens in a new tab rather than downloading: the operator wants to look at it
 * before deciding to print, and an A4 landscape sheet is easy to misjudge.
 */
export function WelcomeBoardButton({
  serial,
  defaultName,
  className,
}: {
  serial: string;
  defaultName?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName ?? "");
  const [subtitle, setSubtitle] = useState("");

  const href =
    `/welcome-board/${encodeURIComponent(serial)}/pdf` +
    `?name=${encodeURIComponent(name.trim())}&subtitle=${encodeURIComponent(subtitle.trim())}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="لوحة استقبال المطار"
        className={
          className ??
          "inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[var(--tv-brand)] hover:bg-[#f0f7f4]"
        }
      >
        <IdCard className="size-3.5" />
        لوحة الاستقبال
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <h2 className="text-base font-extrabold text-[var(--tv-brand)]">لوحة استقبال المطار</h2>
          <p className="mt-1 text-[12px] font-semibold text-[#557d78]">
            تُطبع بهوية شركتكم وشعارها وألوانها — ورقة أفقية واحدة بحجم A4.
          </p>

          <label className="mt-4 grid gap-1.5 text-[12px] font-bold text-[var(--tv-brand)]">
            الاسم على اللوحة
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={defaultName || "اسم الضيف"}
              className="tv-field h-11 w-full rounded-[10px] border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus"
            />
          </label>

          <label className="mt-3 grid gap-1.5 text-[12px] font-bold text-[var(--tv-brand)]">
            سطر ثانٍ (اختياري)
            <input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="اسم المجموعة أو الجهة"
              className="tv-field h-11 w-full rounded-[10px] border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus"
            />
          </label>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-10 items-center rounded-[10px] border border-[#dbe6e1] px-4 text-[12.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6]"
            >
              إغلاق
            </button>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              // An empty name would print a sheet with the serial on it, which
              // helps nobody standing in arrivals.
              aria-disabled={!name.trim() && !defaultName}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[var(--tv-brand)] px-4 text-[12.5px] font-bold text-white hover:opacity-90"
            >
              <IdCard className="size-4" />
              عرض وطباعة
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
