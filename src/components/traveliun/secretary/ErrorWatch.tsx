"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { errorReportFrom, sendErrorToMurad } from "./send-error";

/**
 * «أرسل الخطأ لمُراد» beside every error the app shows: the pages write their
 * errors as role="alert" (64 places), so one watcher here offers the button for
 * all of them instead of a button in each. A page may name the action with
 * data-murad-action on the alert or around it. Ignored: Next's route announcer
 * and مُراد's own alerts (data-murad-own).
 */
const SKIP = "next-route-announcer, #__next-route-announcer__, [data-murad-own]";

function latestAlert(): { text: string; action: string | null } | null {
  const alerts = [...document.querySelectorAll<HTMLElement>('[role="alert"]')].reverse();
  for (const el of alerts) {
    if (el.closest(SKIP) || !el.getClientRects().length) continue;
    const text = el.innerText.trim();
    if (text) return { text, action: el.closest("[data-murad-action]")?.getAttribute("data-murad-action") ?? null };
  }
  return null;
}

export function ErrorWatch() {
  const [alert, setAlert] = useState<{ text: string; action: string | null } | null>(null);
  const [dismissed, setDismissed] = useState("");

  useEffect(() => {
    let frame = 0;
    const look = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = latestAlert();
        setAlert((was) => (was?.text === next?.text && was?.action === next?.action ? was : next));
      });
    };
    look();
    const observer = new MutationObserver(look);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["role", "hidden", "class", "style"] });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  if (!alert || alert.text === dismissed) return null;
  return <div dir="rtl" className="fixed end-12 bottom-24 z-[100] flex items-center gap-1 rounded-full border border-red-200 bg-white py-1 ps-3 pe-1 text-xs shadow-lg md:bottom-6">
    <button type="button" onClick={() => sendErrorToMurad(errorReportFrom(alert.text, alert.action))} className="font-bold text-red-800 hover:underline">
      ظهر خطأ — أرسله لمُراد
    </button>
    <button type="button" onClick={() => setDismissed(alert.text)} aria-label="إخفاء" className="rounded-full p-1 text-tv-text-faint hover:bg-[#f4f8f6]"><X className="size-3.5" /></button>
  </div>;
}
