"use client";

import Link from "next/link";
import type { TranslationKey } from "@/lib/i18n";
import { DirText } from "@/components/DirText";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

type TraveliunNotReadyProps = {
  /** Free-form name of the missing screen (kept LTR-isolated as data). */
  title?: string;
};

const RELATED: { labelKey: TranslationKey; href: string }[] = [
  { labelKey: "nav.dashboard", href: "/dashboard" },
  { labelKey: "nav.intelligenceHub", href: "/travel-intelligence" },
  { labelKey: "nav.kanban", href: "/kanban-board" },
  { labelKey: "nav.customers", href: "/customers" },
  { labelKey: "nav.packages", href: "/offers" },
  { labelKey: "nav.packageGenerator", href: "/package-generator" },
];

export function TraveliunNotReady({ title }: TraveliunNotReadyProps) {
  const { t } = useTraveliunUI();

  return (
    <TraveliunShell title="notready.title">
      <section className="rounded-md border border-[#c8d2cd] bg-white p-8 shadow-[0_3px_8px_rgba(0,0,0,0.14)]">
        {title ? (
          <p className="mb-2 text-xs font-semibold text-[#93aaa3]">
            <DirText dir="ltr">{title}</DirText>
          </p>
        ) : null}
        <h2 className="mb-3 text-2xl font-bold text-[#185045]">{t("notready.heading")}</h2>
        <p className="mb-6 max-w-[720px] text-sm leading-7 text-[#557d78]">{t("notready.desc")}</p>
        <div className="flex flex-wrap gap-3">
          {RELATED.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md border border-[#dfe8e4] px-4 py-2 text-sm font-semibold text-[#185045] hover:bg-[#f7faf8]"
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </div>
      </section>
    </TraveliunShell>
  );
}
