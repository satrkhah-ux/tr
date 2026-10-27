"use client";

import { useState, type ReactNode } from "react";
import { CalendarCheck, MessageCircle } from "lucide-react";
import { SecretaryChat } from "./SecretaryChat";

export function SecretaryWorkspace({ children }: { children: ReactNode }) {
  const [view, setView] = useState<"work" | "chat">("work");
  return <>
    <div className="flex gap-2 rounded-2xl border border-[#dfe8e4] bg-white p-1.5" aria-label="مساحة مُراد">
      {([["work", "خطة العمل", CalendarCheck], ["chat", "محادثتي مع مُراد", MessageCircle]] as const).map(([key, label, Icon]) =>
        <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}
          className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition-colors ${view === key ? "bg-[var(--tv-brand)] text-white" : "text-[#557d78] hover:bg-[#f0f5f3]"}`}>
          <Icon className="size-4 shrink-0" />{label}
        </button>)}
    </div>
    <div hidden={view !== "work"} className="space-y-5">{children}</div>
    <section hidden={view !== "chat"} aria-label="محادثتي مع مُراد" className="overflow-hidden rounded-2xl border border-[#dfe8e4] bg-white shadow-sm">
      <header className="flex items-center gap-3 border-b border-[#e7eeeb] px-5 py-4">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-[#eaf2ee] text-[#185045]"><MessageCircle className="size-5" /></span>
        <div><h2 className="font-bold">محادثتي مع مُراد</h2><p className="mt-0.5 text-xs text-[#6c8680]">محادثاتك ومهامك في مكان واحد</p></div>
      </header>
      <SecretaryChat tall active={view === "chat"} />
    </section>
  </>;
}
